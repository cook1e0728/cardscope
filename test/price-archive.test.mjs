import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_SHARDS, archiveDay, catalogSyncRunning, createArchiveReader, createArchiveStorage, createPriceArchiveController, decodeShard, encodeShard, loadManifest, mergeArchiveRows, mergeSnapshotRows,
  monthOf, normalizeArchiveRow, rowKey, runPriceArchive, shardOf, storeRowsInArchive
} from '../providers/price-archive.mjs';

process.env.PORT = '0';
process.env.CATALOG_SYNC_ON_START = 'false';
process.env.CATALOG_WARM_ON_START = 'false';
const { buildPriceHistory, server } = await import('../server.mjs?price-archive');
test.after(async () => {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

const DAY = 24 * 60 * 60 * 1000;
const TODAY = '2026-11-20';                       // fake "current_date"; archivable = older than 2026-10-21
const NOW = Date.parse(`${TODAY}T12:00:00Z`);
const noLog = { log() {}, warn() {}, error() {} };
const row = (card_id, snapshot_date, amount, over = {}) => ({ card_id, provider: 'cardmarket', variant: 'holo', currency: 'EUR', snapshot_date, amount, ...over });
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// In-memory Storage: get/put/remove like the Supabase client in price-archive.mjs. Options inject failures.
function fakeStorage({ dropPuts = false, corruptPuts = false, failPutAfter = Infinity } = {}) {
  const files = new Map(), calls = [], gets = [], stale = new Map();   // stale: path -> old bytes that a versioned (CDN-cacheable) read still returns
  let puts = 0;
  return {
    files, calls, gets, stale, bucket: 'price-archive', prefix: 'v1',
    shardPath: (month, shard) => `v1/${month}/${String(shard).padStart(2, '0')}.json.gz`,
    manifestPath: 'v1/manifest.json',
    async ensureBucket() { calls.push('ensureBucket'); return { created: false }; },
    async get(path, options = {}) { calls.push(`get ${path}`); gets.push({ path, version: options.version }); return (stale.get(options.version ? path : '') ?? files.get(path)) ? Buffer.from(stale.get(options.version ? path : '') ?? files.get(path)) : null; },
    async put(path, bytes) {
      calls.push(`put ${path}`);
      if (++puts > failPutAfter) throw new Error('ARCHIVE_STORAGE_PUT_500');
      if (dropPuts) return;
      files.set(path, corruptPuts ? Buffer.from('not gzip') : Buffer.from(bytes));
    },
    async remove(paths) { for (const path of paths) files.delete(path); }
  };
}

// Emulates the three SQL functions of migration 20261020110000 on an in-memory table, plus the run table the archiver uses as a lock.
function fakeDb({ rows = [], runs = [], deleteFails = false } = {}) {
  const state = { rows: [...rows], runs: [...runs], calls: [] };
  const cutoff = TODAY && addDays(TODAY, -30);
  const newer = r => state.rows.some(n => n.card_id === r.card_id && n.provider === r.provider && n.variant === r.variant && n.snapshot_date > r.snapshot_date);
  const archivable = date => state.rows.filter(r => r.snapshot_date === date && newer(r));
  state.db = async (path, options = {}) => {
    state.calls.push(`${options.method || 'GET'} ${path.split('?')[0]}`);
    const [route, query = ''] = path.split('?'), q = new URLSearchParams(query), body = options.body ? JSON.parse(options.body) : null;
    if (route === '/rpc/price_snapshots_archivable_dates') return [...new Set(state.rows.filter(r => r.snapshot_date < cutoff && newer(r)).map(r => r.snapshot_date))].sort().slice(0, body.p_limit);
    if (route === '/rpc/price_snapshots_archivable') { if (body.p_date >= cutoff) throw new Error('ARCHIVE_DATE_TOO_RECENT'); return archivable(body.p_date).sort((a, b) => a.card_id.localeCompare(b.card_id)).map(r => ({ ...r })); }
    if (route === '/rpc/price_snapshots_archive_delete') {
      if (body.p_date >= cutoff) throw new Error('ARCHIVE_DATE_TOO_RECENT');
      const now = archivable(body.p_date);
      if (now.length !== body.p_expected) throw new Error(`ARCHIVE_COUNT_MISMATCH: archived ${body.p_expected}, now archivable ${now.length}`);
      if (deleteFails) throw new Error('connection reset');
      state.rows = state.rows.filter(r => !now.includes(r));
      return now.length;
    }
    if (route === '/catalog_sync_runs') {
      if (options.method === 'POST') { const created = { id: state.runs.length + 1, ...body[0], started_at: new Date(NOW + state.runs.length).toISOString(), metadata: {} }; state.runs.push(created); return [created]; }
      if (options.method === 'PATCH') { const target = state.runs.find(r => r.id === Number(q.get('id').replace('eq.', ''))); Object.assign(target, body); return null; }
      const provider = q.get('provider'), status = q.get('status');
      return state.runs.filter(r => (!status || r.status === status.replace('eq.', '')) && (provider?.startsWith('eq.') ? r.provider === provider.slice(3) : !/price-(snapshot|archive)/.test(r.provider) || false));
    }
    throw new Error(`unexpected ${path}`);
  };
  return state;
}

test('shards are stable, in range, and spread cards out', () => {
  assert.equal(shardOf('pokemon-pokemontcg-base1-1'), shardOf('pokemon-pokemontcg-base1-1'));
  const counts = new Array(ARCHIVE_SHARDS).fill(0);
  for (let i = 0; i < 6400; i++) counts[shardOf(`card-${i}`)]++;
  assert.ok(counts.every(n => n > 100 && n < 320), `spread ${counts.join(',')}`);
  assert.equal(shardOf('x', 1), 0);
});

test('a shard file round-trips, its bytes are deterministic, and malformed files or rows are rejected', async () => {
  const sibling = Array.from({ length: 500 }, (_, i) => `b${i}`).find(id => shardOf(id) === shardOf('a'));
  const rows = [row(sibling, '2026-09-02', 2.5), row('a', '2026-09-01', 1.1, { provider: 'tcgplayer', currency: 'USD', variant: '' }), row('a', '2026-09-01', 1.2)].map(normalizeArchiveRow);
  const shard = shardOf('a');
  const first = await encodeShard('2026-09', shard, rows), second = await encodeShard('2026-09', shard, [...rows].reverse());
  assert.equal(first.digest, second.digest, 'row order does not change the file');
  const decoded = await decodeShard(first.gz, { month: '2026-09', shard });
  assert.equal(decoded.digest, first.digest);
  assert.deepEqual(decoded.rows.map(r => [r.card_id, r.provider, r.variant, r.amount]), [['a', 'cardmarket', 'holo', 1.2], ['a', 'tcgplayer', '', 1.1], [sibling, 'cardmarket', 'holo', 2.5]].sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  await assert.rejects(decodeShard(first.gz, { month: '2026-10', shard }), /ARCHIVE_CORRUPT/);
  await assert.rejects(decodeShard(Buffer.from('nope'), {}), /ARCHIVE_CORRUPT/);
  for (const bad of [{ ...row('a', '2026-09-01', 1), amount: 0 }, { ...row('a', '2026-09-01', 1), provider: 'x' }, { ...row('a', '2026-9-1', 1) }, { ...row('', '2026-09-01', 1) }, { ...row('a', '2026-09-01', 1), currency: 'JPY' }, { ...row('a', '2026-09-01', 'abc') }]) assert.throws(() => normalizeArchiveRow(bad), /ARCHIVE_ROW_INVALID/);
  const wrongMonth = await encodeShard('2026-08', shard, rows);   // rows are September
  await assert.rejects(decodeShard(wrongMonth.gz, { month: '2026-08', shard }), /row outside/);
});

test('merge is a union by primary key, re-merging adds nothing, and a changed value is a conflict', () => {
  const a = [row('c', '2026-09-01', 1), row('c', '2026-09-02', 2)], b = [row('c', '2026-09-02', 2), row('c', '2026-09-03', 3)];
  const merged = mergeArchiveRows(a, b);
  assert.equal(merged.added, 1);
  assert.deepEqual(merged.rows.map(r => r.snapshot_date), ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.equal(mergeArchiveRows(merged.rows, b).added, 0);
  assert.throws(() => mergeArchiveRows(a, [row('c', '2026-09-02', 2.5)]), /ARCHIVE_CONFLICT/);
  assert.throws(() => mergeArchiveRows(a, [row('c', '2026-09-02', 2, { currency: 'USD' })]), /ARCHIVE_CONFLICT/);
});

test('storing rows writes each shard-month once, is a no-op the second time, and merges instead of overwriting', async () => {
  const storage = fakeStorage();
  const ids = Array.from({ length: 40 }, (_, i) => `card-${i}`);
  const day1 = ids.map(id => row(id, '2026-09-01', 5)), day2 = ids.map(id => row(id, '2026-09-02', 6)), october = ids.slice(0, 5).map(id => row(id, '2026-10-01', 7));
  const first = await storeRowsInArchive(storage, [...day1, ...october]);
  assert.ok(first.files > 1 && first.rowsWritten === 45 && first.rowsAlready === 0);
  const putsAfterFirst = storage.calls.filter(c => c.startsWith('put')).length;
  const again = await storeRowsInArchive(storage, [...day1, ...october]);
  assert.equal(again.rowsWritten, 0);
  assert.equal(again.rowsAlready, 45);
  assert.equal(storage.calls.filter(c => c.startsWith('put')).length, putsAfterFirst, 're-running the same rows writes nothing');
  const second = await storeRowsInArchive(storage, day2);
  assert.equal(second.rowsWritten, 40);
  const manifest = await loadManifest(storage);
  assert.deepEqual(Object.keys(manifest.months).sort(), ['2026-09', '2026-10']);
  const total = Object.values(manifest.months['2026-09']).reduce((a, b) => a + b.n, 0);
  assert.equal(total, 80, 'both days of September are in the files');
  assert.equal(Object.values(manifest.months['2026-10']).reduce((a, b) => a + b.n, 0), 5);
  assert.ok(Object.values(manifest.months['2026-10']).every(entry => /^[0-9a-f]{12}$/.test(entry.d)), 'each file is listed with its digest');
});

test('a write that does not stick (dropped, corrupted, or rejected) is detected and nothing is deleted from the database', async () => {
  for (const options of [{ dropPuts: true }, { corruptPuts: true }, { failPutAfter: 0 }]) {
    const db = fakeDb({ rows: [row('a', '2026-09-01', 5), row('a', '2026-09-08', 6)] });
    await assert.rejects(archiveDay({ db: db.db, storage: fakeStorage(options), date: '2026-09-01', log: noLog }));
    assert.equal(db.rows.length, 2, `rows kept (${JSON.stringify(options)})`);
    assert.ok(!db.calls.includes('POST /rpc/price_snapshots_archive_delete'), 'delete is never called');
  }
});

test('a crash between writing the archive and deleting the rows loses nothing, and the re-run converges', async () => {
  const storage = fakeStorage();
  const failing = fakeDb({ rows: [row('a', '2026-09-01', 5), row('b', '2026-09-01', 6), row('a', '2026-09-08', 7), row('b', '2026-09-08', 8)], deleteFails: true });
  await assert.rejects(archiveDay({ db: failing.db, storage, date: '2026-09-01', log: noLog }), /connection reset/);
  assert.equal(failing.rows.length, 4, 'database rows survive the crash');
  const archivedOnce = await storeRowsInArchive(storage, failing.rows.filter(r => r.snapshot_date === '2026-09-01'));
  assert.equal(archivedOnce.rowsWritten, 0, 'the file is already complete');
  const healthy = fakeDb({ rows: failing.rows });
  const result = await archiveDay({ db: healthy.db, storage, date: '2026-09-01', log: noLog });
  assert.equal(result.rows, 2);
  assert.equal(result.filesWritten, 0, 're-run only deletes');
  assert.deepEqual(healthy.rows.map(r => r.snapshot_date), ['2026-09-08', '2026-09-08']);
});

test('archive-then-read gives exactly the history the database alone would give (and latest rows stay in the database)', async () => {
  const cards = ['card-1', 'card-2', 'card-3', 'card-us'];
  const all = [];
  for (const [index, id] of cards.entries()) {
    for (let d = 0; d <= 80; d += 7 + index) for (const [provider, variant, currency] of [['cardmarket', 'holo', 'EUR'], ['tcgplayer', 'holofoil', 'USD'], ['tcgplayer', '', 'USD']]) {
      if (id === 'card-3' && provider === 'tcgplayer' && variant === '') continue;       // a line with a single old row
      all.push(row(id, addDays('2026-09-01', d), Math.round((1 + index + d / 10 + (variant === '' ? 1 : 0)) * 100) / 100, { provider, variant, currency }));
    }
  }
  all.push(row('card-1', '2026-08-01', 3, { provider: 'tcgplayer', variant: 'only-old', currency: 'USD' }));   // the only row of its line: stays in the database
  const db = fakeDb({ rows: all }), storage = fakeStorage(), reader = createArchiveReader({ storage });
  const fx = { rates: { EUR: 38, USD: 32 } };
  const card = { id: 'card-1', region: 'JP', printings: [{ cardId: 'card-2', region: 'JP' }, { cardId: 'card-3', region: 'US' }] };
  const build = rows => buildPriceHistory(rows, { card, requestedId: 'card-1', fx, now: NOW });
  const wanted = ['card-1', 'card-2', 'card-3'], before = build(all.filter(r => wanted.includes(r.card_id)));

  const result = await runPriceArchive({ db: db.db, storage, reader, now: () => NOW, log: noLog });
  assert.equal(result.status, 'completed');
  assert.ok(result.rows > 20 && result.deleted === result.rows, JSON.stringify(result));
  assert.ok(db.rows.length < all.length);
  assert.ok(db.rows.every(r => r.snapshot_date >= addDays(TODAY, -30) || !db.rows.some(n => n.card_id === r.card_id && n.provider === r.provider && n.variant === r.variant && n.snapshot_date > r.snapshot_date)), 'old rows left in the database are the newest of their line');
  assert.ok(db.rows.some(r => r.variant === 'only-old'), 'the only row of a line is kept');
  const fromArchive = await reader.rowsFor(wanted, { from: '2026-07-01' });
  const after = build(mergeSnapshotRows(db.rows.filter(r => wanted.includes(r.card_id)), fromArchive));
  assert.deepEqual(after, before, 'history output is identical');
  // a second run has nothing to do and touches nothing
  const putsBefore = storage.calls.filter(c => c.startsWith('put')).length;
  assert.equal((await runPriceArchive({ db: db.db, storage, reader, now: () => NOW, log: noLog })).status, 'idle');
  assert.equal(storage.calls.filter(c => c.startsWith('put')).length, putsBefore);
  // the window cuts the same way: rows before `from` are not returned
  const windowed = await reader.rowsFor(['card-1'], { from: '2026-10-01' });
  assert.ok(windowed.length && windowed.every(r => r.snapshot_date >= '2026-10-01' && r.card_id === 'card-1'));
});

test('the reader checks each file against the manifest digest: a stale CDN copy is retried at the origin, and still-wrong bytes fail loudly', async () => {
  const storage = fakeStorage();
  await storeRowsInArchive(storage, [row('card-1', '2026-09-01', 5)]);
  const path = storage.shardPath('2026-09', shardOf('card-1'));
  const old = await encodeShard('2026-09', shardOf('card-1'), [row('card-1', '2026-08-01', 1)].map(r => ({ ...r, snapshot_date: '2026-09-01', amount: 1 })));
  storage.stale.set(path, old.gz);                         // the versioned URL returns old bytes; an unversioned (origin) read returns the truth
  const reader = createArchiveReader({ storage });
  storage.gets.length = 0;
  assert.deepEqual((await reader.rowsFor(['card-1'], { from: '2026-09-01' })).map(r => r.amount), [5], 'the origin copy wins');
  assert.equal(storage.gets.filter(g => g.path === path).length, 2);
  assert.ok(storage.gets.filter(g => g.path === path)[0].version, 'first read is by version');
  reader.invalidate();
  const files = new Map(storage.files);
  storage.files.set(path, old.gz);                         // even the origin disagrees with the manifest
  await assert.rejects(reader.rowsFor(['card-1'], { from: '2026-09-01' }), /ARCHIVE_STALE/);
  assert.equal(reader.stats().entries, 0, 'a wrong file is never cached');
  storage.files = files;
});

test('a duplicate between database and archive (crash window) is one point, not two', () => {
  const dup = row('a', '2026-09-01', 5);
  assert.equal(mergeSnapshotRows([dup], [{ ...dup }]).length, 1);
  assert.equal(mergeSnapshotRows(null, null).length, 0);
});

test('the reader makes no request when nothing is archived, reads only the needed shards, and keeps its LRU bounded', async () => {
  const empty = fakeStorage(), emptyReader = createArchiveReader({ storage: empty });
  assert.deepEqual(await emptyReader.rowsFor(['card-1'], { from: '2026-07-01' }), []);
  assert.deepEqual(empty.calls, ['get v1/manifest.json'], 'one manifest read, no shard guessing');
  await emptyReader.rowsFor(['card-1'], { from: '2026-07-01' });
  assert.equal(empty.calls.length, 1, 'the manifest is cached');

  const storage = fakeStorage(), ids = Array.from({ length: 200 }, (_, i) => `card-${i}`);
  for (const month of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) await storeRowsInArchive(storage, ids.map(id => row(id, `${month}-10`, 5)));
  const reader = createArchiveReader({ storage, maxEntries: 3, maxRows: 100_000 });
  storage.calls.length = 0;
  const got = await reader.rowsFor(['card-1'], { from: '2026-07-01' });
  assert.deepEqual(got.map(r => r.snapshot_date), ['2026-07-10', '2026-08-10', '2026-09-10'], 'months before the window are not fetched');
  assert.equal(storage.calls.filter(c => c.startsWith('get v1/20')).length, 3);
  await reader.rowsFor(['card-1'], { from: '2026-07-01' });
  assert.equal(storage.calls.filter(c => c.startsWith('get v1/20')).length, 3, 'second read comes from the cache');
  for (const id of ['card-2', 'card-3', 'card-4', 'card-5', 'card-6']) await reader.rowsFor([id], { from: '2026-05-01' });
  assert.ok(reader.stats().entries <= 3, `entries ${reader.stats().entries}`);
  const tiny = createArchiveReader({ storage, maxEntries: 50, maxRows: 10 });
  await tiny.rowsFor(['card-1'], { from: '2026-05-01' });
  assert.ok(tiny.stats().rows <= 10, 'the row cap holds too');
  reader.invalidate();
  assert.equal(reader.stats().entries, 0);
});

test('a history request that needs many archive files gives up after the deadline instead of hanging', async () => {
  const storage = fakeStorage(), ids = Array.from({ length: 300 }, (_, i) => `card-${i}`);
  for (const month of ['2026-05', '2026-06', '2026-07']) await storeRowsInArchive(storage, ids.map(id => row(id, `${month}-10`, 5)));
  let clock = 0;
  const slow = { ...storage, get: async (path, options) => { clock += 5000; return storage.get(path, options); } };
  const reader = createArchiveReader({ storage: slow, now: () => clock, concurrency: 2, deadlineMs: 8000 });
  await assert.rejects(reader.rowsFor(ids, { from: '2026-05-01' }), /ARCHIVE_READ_TIMEOUT/);
});

test('concurrent reads of the same shard share one download, and a failed download is not cached', async () => {
  const storage = fakeStorage();
  await storeRowsInArchive(storage, [row('card-1', '2026-09-01', 5)]);
  const reader = createArchiveReader({ storage });
  await reader.rowsFor(['card-1'], { from: '2026-09-01' });
  reader.invalidate();
  storage.calls.length = 0;
  await Promise.all([reader.rowsFor(['card-1'], { from: '2026-09-01' }), reader.rowsFor(['card-1'], { from: '2026-09-01' })]);
  assert.equal(storage.calls.filter(c => c.startsWith('get v1/2026-09')).length, 1);
  const missing = fakeStorage();
  await storeRowsInArchive(missing, [row('card-1', '2026-09-01', 5)]);
  const stale = createArchiveReader({ storage: missing });
  for (const path of [...missing.files.keys()]) if (path.includes('2026-09/')) missing.files.delete(path);
  await assert.rejects(stale.rowsFor(['card-1'], { from: '2026-09-01' }), /ARCHIVE_FILE_MISSING/);
  assert.equal(stale.stats().entries, 0);
});

test('the archiver does not run while a snapshot round or a catalog sync is running, and two instances cannot both win', async () => {
  const base = [row('a', '2026-09-01', 5), row('a', '2026-09-08', 6)];
  const snap = fakeDb({ rows: base }), s1 = fakeStorage();
  assert.equal((await runPriceArchive({ db: snap.db, storage: s1, now: () => NOW, isBusy: () => true, log: noLog })).status, 'busy');
  assert.equal(snap.rows.length, 2);
  const sync = fakeDb({ rows: base, runs: [{ id: 1, provider: 'pokemon', scope: 'x', status: 'running', started_at: new Date(NOW - 1000).toISOString(), metadata: {} }] });
  assert.equal(await catalogSyncRunning(sync.db, { now: () => NOW }), true);
  assert.equal((await runPriceArchive({ db: sync.db, storage: fakeStorage(), now: () => NOW, log: noLog })).status, 'busy');
  const other = fakeDb({ rows: base, runs: [{ id: 1, provider: 'price-archive', scope: 'x', status: 'running', started_at: new Date(NOW - 1000).toISOString(), metadata: {} }] });
  assert.equal((await runPriceArchive({ db: other.db, storage: fakeStorage(), now: () => NOW, log: noLog })).status, 'busy');
  assert.equal(other.rows.length, 2);
  // a stale heartbeat does not block
  const stale = fakeDb({ rows: base, runs: [{ id: 1, provider: 'price-archive', scope: 'x', status: 'running', started_at: new Date(NOW - 3600_000).toISOString(), metadata: {} }] });
  assert.equal((await runPriceArchive({ db: stale.db, storage: fakeStorage(), now: () => NOW, log: noLog })).status, 'completed');
  assert.equal(stale.rows.length, 1);
  // the run is recorded: running -> completed with counts
  const done = stale.runs.at(-1);
  assert.equal(done.status, 'completed');
  assert.equal(done.rows_written, 1);
});

test('when another instance started first, this run steps aside before archiving anything', async () => {
  const db = fakeDb({ rows: [row('a', '2026-09-01', 5), row('a', '2026-09-08', 6)] });
  const racing = async (path, options = {}) => {
    const result = await db.db(path, options);
    if (path === '/catalog_sync_runs' && options.method === 'POST') db.runs.unshift({ id: 0, provider: 'price-archive', scope: 'other', status: 'running', started_at: new Date(NOW - 5).toISOString(), metadata: {} });
    return result;
  };
  const storage = fakeStorage();
  assert.equal((await runPriceArchive({ db: racing, storage, now: () => NOW, log: noLog })).status, 'busy');
  assert.equal(db.rows.length, 2);
  assert.deepEqual(storage.calls, [], 'no storage access at all');
  assert.equal(db.runs.find(r => r.id === 1).error, 'LOST_RACE');
});

test('a run with nothing to archive writes no run record; a failed run is recorded as failed and deletes nothing', async () => {
  const idle = fakeDb({ rows: [row('a', '2026-11-10', 5)] });
  assert.equal((await runPriceArchive({ db: idle.db, storage: fakeStorage(), now: () => NOW, log: noLog })).status, 'idle');
  assert.equal(idle.runs.length, 0);
  const failing = fakeDb({ rows: [row('a', '2026-09-01', 5), row('a', '2026-09-08', 6)] });
  const result = await runPriceArchive({ db: failing.db, storage: fakeStorage({ failPutAfter: 0 }), now: () => NOW, log: noLog });
  assert.equal(result.status, 'failed');
  assert.equal(failing.rows.length, 2);
  assert.equal(failing.runs[0].status, 'failed');
  assert.match(failing.runs[0].error, /ARCHIVE_STORAGE_PUT/);
});

test('the controller runs on a timer, retries soon when busy, and reports its status', async () => {
  const timers = [];
  const setTimer = (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; };
  let busy = true;
  const db = fakeDb({ rows: [row('a', '2026-09-01', 5), row('a', '2026-09-08', 6)] });
  const controller = createPriceArchiveController({ db: db.db, storage: fakeStorage(), now: () => NOW, setTimer, clearTimer() {}, isBusy: () => busy, log: noLog, intervalMs: 1000, initialDelayMs: 50, busyRetryMs: 7 });
  controller.start();
  assert.equal(timers[0].ms, 50);
  await timers[0].fn();
  assert.equal(controller.status().last.status, 'busy');
  assert.equal(timers[1].ms, 7, 'busy -> try again soon');
  busy = false;
  await timers[1].fn();
  assert.equal(controller.status().last.status, 'completed');
  assert.equal(timers[2].ms, 1000);
  assert.equal(db.rows.length, 1);
  await controller.dispose();
});

test('the Storage client: private bucket, upsert with no-cache, missing objects (404 or legacy 400) read as null, existing bucket is fine', async () => {
  const seen = [];
  const responses = [
    new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }), { status: 409 }),
    new Response(JSON.stringify({ statusCode: '404', error: 'not_found' }), { status: 400 }),
    new Response('', { status: 404 }),
    new Response('{}', { status: 200 }),
    new Response('boom', { status: 500 })
  ];
  const storage = createArchiveStorage({ baseUrl: 'https://x.supabase.co', key: 'k', fetch: async (url, init) => { seen.push({ url, init }); return responses.shift(); } });
  assert.deepEqual(await storage.ensureBucket(), { created: false });
  assert.equal(JSON.parse(seen[0].init.body).public, false);
  assert.equal(await storage.get('v1/manifest.json'), null);
  assert.equal(await storage.get('v1/2026-09/01.json.gz'), null);
  await storage.put('v1/2026-09/01.json.gz', Buffer.from('x'), 'application/gzip');
  assert.equal(seen[3].init.headers['x-upsert'], 'true');
  assert.equal(seen[3].init.headers['Cache-Control'], 'no-cache');
  assert.match(seen[1].url, /\/storage\/v1\/object\/authenticated\/price-archive\/v1\/manifest\.json\?n=[0-9a-z]+$/, 'unversioned reads carry a one-off query so the CDN cannot answer from an old copy');
  assert.equal(seen[1].init.headers.Authorization, 'Bearer k');
  await assert.rejects(storage.get('v1/x'), /ARCHIVE_STORAGE_GET_500/);
  assert.equal(createArchiveStorage({ baseUrl: '', key: '' }), null, 'no Supabase settings, no archive');
});

test('keys and months', () => {
  assert.equal(monthOf('2026-09-30'), '2026-09');
  assert.notEqual(rowKey(row('a', '2026-09-01', 1)), rowKey(row('a', '2026-09-01', 1, { variant: '' })));
  assert.equal(rowKey({ card_id: 'a', provider: 'p', variant: undefined, snapshot_date: '2026-09-01T00:00:00Z' }), rowKey({ card_id: 'a', provider: 'p', variant: '', snapshot_date: '2026-09-01' }));
});
