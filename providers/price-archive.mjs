// ADR 0046: price_snapshots keeps only the last 30 days. Older rows are written to the private Storage bucket `price-archive`, read back and verified, and only then deleted from the database.
// Layout: v1/manifest.json plus v1/<YYYY-MM>/<shard>.json.gz, shard = a stable hash of card_id modulo 32. A price-history request touches at most (months in the window) x (distinct shards of the card's ids) small files.
import { createHash } from 'node:crypto';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip), gunzipAsync = promisify(gunzip);

export const ARCHIVE_PROVIDER = 'price-archive';
export const ARCHIVE_BUCKET = 'price-archive';
export const ARCHIVE_PREFIX = 'v1';
export const ARCHIVE_SHARDS = 32;
export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_KEEP_DAYS = 30;              // enforced again inside the SQL functions
export const ARCHIVE_MAX_DAYS_PER_RUN = 40;
export const ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const ARCHIVE_INITIAL_DELAY_MS = 20 * 60 * 1000;
export const ARCHIVE_BUSY_RETRY_MS = 30 * 60 * 1000;
export const ARCHIVE_FILE_MAX_BYTES = 5 * 1024 * 1024;          // bucket limit; a shard-month is about 60 KB today
export const ARCHIVE_DECODED_MAX_BYTES = 64 * 1024 * 1024;      // gunzip output cap
export const ARCHIVE_CACHE_MAX_ENTRIES = 16;
export const ARCHIVE_CACHE_MAX_ROWS = 120_000;
export const ARCHIVE_CACHE_TTL_MS = 60 * 60 * 1000;
export const ARCHIVE_MANIFEST_TTL_MS = 5 * 60 * 1000;
export const ARCHIVE_STORAGE_TIMEOUT_MS = 20_000;
export const ARCHIVE_READ_DEADLINE_MS = 8_000;                  // one history request never waits longer than this for archive files (the caller then serves the database rows and says so)

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROVIDERS = new Set(['cardmarket', 'tcgplayer']);
const CURRENCIES = new Set(['EUR', 'USD']);
const archiveError = (code, detail) => new Error(detail ? `${code}: ${detail}` : code);
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pad = shard => String(shard).padStart(2, '0');

export const shardOf = (cardId, shards = ARCHIVE_SHARDS) => createHash('sha1').update(String(cardId)).digest().readUInt32BE(0) % shards;
export const monthOf = date => String(date).slice(0, 7);
export const rowKey = row => `${row.card_id}\u0000${row.provider}\u0000${row.variant ?? ''}\u0000${String(row.snapshot_date).slice(0, 10)}`;
const compareRows = (a, b) => cmp(a.card_id, b.card_id) || cmp(a.provider, b.provider) || cmp(a.variant, b.variant) || cmp(a.snapshot_date, b.snapshot_date);

// Trust boundary for rows coming from the database or from a downloaded file: strict shape, otherwise throw (never archive or serve a malformed row).
export function normalizeArchiveRow(row) {
  const amount = Number(row?.amount), date = String(row?.snapshot_date ?? '').slice(0, 10);
  if (!row || typeof row.card_id !== 'string' || !row.card_id || row.card_id.length > 200 || !PROVIDERS.has(row.provider) || typeof (row.variant ?? '') !== 'string'
    || !CURRENCIES.has(row.currency) || !DATE.test(date) || !Number.isFinite(amount) || !(amount > 0)) throw archiveError('ARCHIVE_ROW_INVALID', JSON.stringify(row)?.slice(0, 120));
  return { card_id: row.card_id, provider: row.provider, variant: row.variant ?? '', currency: row.currency, snapshot_date: date, amount: Math.round(amount * 100) / 100 };
}

const toTuple = row => [row.card_id, row.provider, row.variant, row.currency, row.snapshot_date, row.amount];
const fromTuple = tuple => normalizeArchiveRow({ card_id: tuple?.[0], provider: tuple?.[1], variant: tuple?.[2], currency: tuple?.[3], snapshot_date: tuple?.[4], amount: tuple?.[5] });

// Deterministic bytes for a shard-month (rows sorted), so the same rows always give the same digest.
export function encodeShardBytes(month, shard, rows) {
  const sorted = [...rows].sort(compareRows);
  return Buffer.from(JSON.stringify({ v: ARCHIVE_FORMAT_VERSION, month, shard, shards: ARCHIVE_SHARDS, rows: sorted.map(toTuple) }));
}
export async function encodeShard(month, shard, rows) {
  const bytes = encodeShardBytes(month, shard, rows);
  return { bytes, digest: sha256(bytes), gz: await gzipAsync(bytes, { level: 9 }) };
}
export async function decodeShard(gz, { month, shard } = {}) {
  let bytes;
  try { bytes = await gunzipAsync(gz, { maxOutputLength: ARCHIVE_DECODED_MAX_BYTES }); } catch (error) { throw archiveError('ARCHIVE_CORRUPT', `gunzip ${error.message}`); }
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch { throw archiveError('ARCHIVE_CORRUPT', 'json'); }
  if (doc?.v !== ARCHIVE_FORMAT_VERSION || !Array.isArray(doc.rows) || doc.shards !== ARCHIVE_SHARDS) throw archiveError('ARCHIVE_CORRUPT', 'header');
  if ((month != null && doc.month !== month) || (shard != null && doc.shard !== shard)) throw archiveError('ARCHIVE_CORRUPT', `expected ${month}/${shard}, got ${doc.month}/${doc.shard}`);
  const rows = doc.rows.map(fromTuple);
  for (const row of rows) if (monthOf(row.snapshot_date) !== doc.month || shardOf(row.card_id) !== doc.shard) throw archiveError('ARCHIVE_CORRUPT', `row outside ${doc.month}/${doc.shard}`);
  return { rows, digest: sha256(bytes), month: doc.month, shard: doc.shard };
}

// Union by primary key. The same key with a different value is a conflict: stop (never overwrite an archived value silently).
export function mergeArchiveRows(existing, incoming) {
  const map = new Map(existing.map(row => [rowKey(row), row]));
  let added = 0;
  for (const row of incoming) {
    const key = rowKey(row), hit = map.get(key);
    if (!hit) { map.set(key, row); added++; continue; }
    if (hit.amount !== row.amount || hit.currency !== row.currency) throw archiveError('ARCHIVE_CONFLICT', `${row.card_id} ${row.provider} ${row.variant} ${row.snapshot_date}: archived ${hit.amount} ${hit.currency}, database ${row.amount} ${row.currency}`);
  }
  return { rows: [...map.values()].sort(compareRows), added };
}

// Reader side: archive rows plus database rows, one row per primary key (the database wins), in the database's own order.
export function mergeSnapshotRows(dbRows, archiveRows) {
  const map = new Map();
  for (const row of archiveRows || []) map.set(rowKey(row), row);
  for (const row of dbRows || []) map.set(rowKey(row), row);
  return [...map.values()].sort(compareRows);
}

// ---- Storage (Supabase Storage REST API, service key, server side only) ----
export function createArchiveStorage({ baseUrl = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY, fetch: fetchImpl = (...args) => globalThis.fetch(...args), bucket = ARCHIVE_BUCKET, prefix = ARCHIVE_PREFIX, timeoutMs = ARCHIVE_STORAGE_TIMEOUT_MS } = {}) {
  if (!baseUrl || !key) return null;
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  const objectUrl = (path, mode = '') => `${baseUrl}/storage/v1/object/${mode ? `${mode}/` : ''}${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const isMissing = async response => {
    if (response.status === 404) return true;
    if (response.status !== 400) return false;   // older Storage versions answer a missing object with 400 + {"statusCode":"404"}
    const text = await response.clone().text().catch(() => '');
    return /"statusCode"\s*:\s*"?404/.test(text) || /not[_ ]found/i.test(text);
  };
  const call = (url, init = {}) => fetchImpl(url, { ...init, headers: { ...auth, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
  const storage = {
    bucket, prefix,
    shardPath: (month, shard) => `${prefix}/${month}/${pad(shard)}.json.gz`,
    manifestPath: `${prefix}/manifest.json`,
    // Idempotent: an existing bucket is fine. The bucket is private; only the service key reaches it.
    async ensureBucket() {
      const response = await call(`${baseUrl}/storage/v1/bucket`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: ARCHIVE_FILE_MAX_BYTES }) });
      if (response.ok) return { created: true };
      const text = await response.text().catch(() => '');
      if (response.status === 409 || /already exists|duplicate/i.test(text)) return { created: false };
      throw archiveError(`ARCHIVE_STORAGE_BUCKET_${response.status}`, text.slice(0, 160));
    },
    // Returns a Buffer, or null when the object (or the whole bucket) does not exist yet.
    // Supabase's CDN keeps serving the previous bytes of an overwritten object (measured: still stale after 4 s), so a read never uses the plain URL:
    // { version } (a content digest from the manifest) gives an immutable, cacheable URL; without it a one-off query string forces the origin.
    async get(path, { version } = {}) {
      const bust = version ? `?v=${encodeURIComponent(version)}` : `?n=${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      const response = await call(objectUrl(path, 'authenticated') + bust, { headers: { 'Cache-Control': 'no-cache' } });
      if (await isMissing(response)) return null;
      if (!response.ok) throw archiveError(`ARCHIVE_STORAGE_GET_${response.status}`, (await response.text().catch(() => '')).slice(0, 160));
      return Buffer.from(await response.arrayBuffer());
    },
    async put(path, bytes, contentType) {
      if (bytes.length > ARCHIVE_FILE_MAX_BYTES) throw archiveError('ARCHIVE_FILE_TOO_LARGE', `${path} ${bytes.length}`);
      const response = await call(objectUrl(path), { method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'no-cache' }, body: bytes });
      if (!response.ok) throw archiveError(`ARCHIVE_STORAGE_PUT_${response.status}`, (await response.text().catch(() => '')).slice(0, 160));
    },
    async remove(paths) {
      const response = await call(`${baseUrl}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
      if (!response.ok) throw archiveError(`ARCHIVE_STORAGE_DELETE_${response.status}`, (await response.text().catch(() => '')).slice(0, 160));
    }
  };
  return storage;
}

// ---- Manifest: which shard-months exist and the digest of each file, so a reader never guesses, never makes a request when nothing is archived, and can tell a stale or corrupt file ----
export const DIGEST_LENGTH = 12;
export const shortDigest = digest => String(digest).slice(0, DIGEST_LENGTH);
const emptyManifest = () => ({ v: ARCHIVE_FORMAT_VERSION, months: {} });
function parseManifest(buffer) {
  if (!buffer) return emptyManifest();
  let doc;
  try { doc = JSON.parse(buffer.toString('utf8')); } catch { throw archiveError('ARCHIVE_MANIFEST_CORRUPT', 'json'); }
  if (doc?.v !== ARCHIVE_FORMAT_VERSION || !doc.months || typeof doc.months !== 'object') throw archiveError('ARCHIVE_MANIFEST_CORRUPT', 'header');
  return doc;
}
export const loadManifest = async storage => parseManifest(await storage.get(storage.manifestPath));
async function saveManifest(storage, manifest) {
  const bytes = Buffer.from(JSON.stringify({ v: ARCHIVE_FORMAT_VERSION, updatedAt: new Date().toISOString(), months: manifest.months }));
  await storage.put(storage.manifestPath, bytes, 'application/json');
  const back = parseManifest(await storage.get(storage.manifestPath));
  if (JSON.stringify(back.months) !== JSON.stringify(manifest.months)) throw archiveError('ARCHIVE_VERIFY_FAILED', 'manifest');
}

// Write rows (any dates; typically one day) into their shard-month files: read existing, merge, write only if something is new, re-read and verify.
// Returns { files, rowsWritten, rowsAlready, manifest }. Throws on any mismatch; the caller must not delete database rows unless this resolved.
export async function storeRowsInArchive(storage, rows) {
  const groups = new Map();
  for (const raw of rows) {
    const row = normalizeArchiveRow(raw), month = monthOf(row.snapshot_date), shard = shardOf(row.card_id), id = `${month}|${shard}`;
    if (!groups.has(id)) groups.set(id, { month, shard, rows: [] });
    groups.get(id).rows.push(row);
  }
  const manifest = await loadManifest(storage), result = { files: 0, filesWritten: 0, rowsWritten: 0, rowsAlready: 0, manifest };
  let manifestChanged = false;
  for (const { month, shard, rows: incoming } of groups.values()) {
    const path = storage.shardPath(month, shard), current = await storage.get(path);
    const existingDecoded = current ? await decodeShard(current, { month, shard }) : null, existing = existingDecoded?.rows || [];
    const merged = mergeArchiveRows(existing, incoming);
    let verified;
    if (merged.added > 0 || !current) {
      const encoded = await encodeShard(month, shard, merged.rows);
      await storage.put(path, encoded.gz, 'application/gzip');
      const back = await storage.get(path);
      if (!back) throw archiveError('ARCHIVE_VERIFY_FAILED', `${path} missing after write`);
      verified = await decodeShard(back, { month, shard });
      if (verified.digest !== encoded.digest || verified.rows.length !== merged.rows.length) throw archiveError('ARCHIVE_VERIFY_FAILED', `${path} digest or row count differs after write`);
      result.filesWritten++;
    } else verified = existingDecoded;
    const have = new Set(verified.rows.map(rowKey));
    for (const row of incoming) if (!have.has(rowKey(row))) throw archiveError('ARCHIVE_VERIFY_FAILED', `${path} lacks ${row.card_id}`);
    result.files++; result.rowsWritten += merged.added; result.rowsAlready += incoming.length - merged.added;
    const key = pad(shard), entry = { n: verified.rows.length, d: shortDigest(verified.digest) }, listed = manifest.months[month]?.[key];
    if (listed?.n !== entry.n || listed?.d !== entry.d) { manifest.months[month] = { ...(manifest.months[month] || {}), [key]: entry }; manifestChanged = true; }
  }
  if (manifestChanged) await saveManifest(storage, manifest);
  return result;
}

// Archive one calendar day: the database says which rows are archivable (older than 30 days and not the newest of their line), they are stored and verified, and only then deleted.
export async function archiveDay({ db, storage, date, onStored, log = console }) {
  const rows = (await db('/rpc/price_snapshots_archivable', { method: 'POST', body: JSON.stringify({ p_date: date }) })) || [];
  if (!Array.isArray(rows)) throw archiveError('ARCHIVE_RPC_SHAPE', 'archivable');
  if (!rows.length) return { date, rows: 0, deleted: 0, files: 0, filesWritten: 0 };
  const stored = await storeRowsInArchive(storage, rows);
  onStored?.();   // the reader's caches must not outlive the move
  const deleted = await db('/rpc/price_snapshots_archive_delete', { method: 'POST', body: JSON.stringify({ p_date: date, p_expected: rows.length }) });
  if (Number(deleted) !== rows.length) throw archiveError('ARCHIVE_DELETE_MISMATCH', `${date} archived ${rows.length}, deleted ${deleted}`);
  log.log?.('price archive day', JSON.stringify({ date, rows: rows.length, files: stored.files, filesWritten: stored.filesWritten }));
  return { date, rows: rows.length, deleted: Number(deleted), files: stored.files, filesWritten: stored.filesWritten };
}

// ---- Reader with a bounded LRU ----
export function createArchiveReader({ storage, now = Date.now, ttlMs = ARCHIVE_CACHE_TTL_MS, manifestTtlMs = ARCHIVE_MANIFEST_TTL_MS, maxEntries = ARCHIVE_CACHE_MAX_ENTRIES, maxRows = ARCHIVE_CACHE_MAX_ROWS, concurrency = 8, deadlineMs = ARCHIVE_READ_DEADLINE_MS } = {}) {
  const cache = new Map(), pending = new Map();
  let manifestEntry = null, manifestPending = null, generation = 0, cachedRows = 0;
  const evict = () => { while (cache.size > maxEntries || (cachedRows > maxRows && cache.size)) { const [key, value] = cache.entries().next().value; cache.delete(key); cachedRows -= value.rowCount; } };
  const drop = key => { const hit = cache.get(key); if (hit) { cache.delete(key); cachedRows -= hit.rowCount; } };

  async function manifest() {
    if (manifestEntry && now() - manifestEntry.at < manifestTtlMs) return manifestEntry.value;
    if (manifestPending) return manifestPending;
    const started = generation;
    manifestPending = loadManifest(storage).then(value => { if (started === generation) manifestEntry = { at: now(), value }; return value; }).finally(() => { manifestPending = null; });
    return manifestPending;
  }
  async function shardRows(month, shard, expected) {
    const key = `${month}|${shard}|${expected}`, hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) { cache.delete(key); cache.set(key, hit); return hit.byCard; }
    if (hit) drop(key);
    if (pending.has(key)) return pending.get(key);
    const started = generation;
    const load = (async () => {
      const path = storage.shardPath(month, shard);
      let buffer = await storage.get(path, { version: expected });
      if (!buffer) throw archiveError('ARCHIVE_FILE_MISSING', `${month}/${pad(shard)} is in the manifest but not in the bucket`);
      let decoded = await decodeShard(buffer, { month, shard });
      if (shortDigest(decoded.digest) !== expected) {   // not the version the manifest names: try the origin once, then give up loudly
        buffer = await storage.get(path);
        decoded = buffer ? await decodeShard(buffer, { month, shard }) : decoded;
        if (shortDigest(decoded.digest) !== expected) throw archiveError('ARCHIVE_STALE', `${month}/${pad(shard)} expected ${expected}, got ${shortDigest(decoded.digest)}`);
      }
      const { rows } = decoded, byCard = new Map();
      for (const row of rows) { const list = byCard.get(row.card_id); if (list) list.push(row); else byCard.set(row.card_id, [row]); }
      if (started === generation && rows.length <= maxRows) { cache.set(key, { at: now(), rowCount: rows.length, byCard }); cachedRows += rows.length; evict(); }
      return byCard;
    })().finally(() => pending.delete(key));
    pending.set(key, load);
    return load;
  }

  return {
    // Archive rows of the given cards on or after `from` (YYYY-MM-DD), in database row shape.
    async rowsFor(cardIds, { from } = {}) {
      if (!storage || !cardIds?.length) return [];
      const ids = [...new Set(cardIds)], wanted = new Set(ids), fromMonth = from ? monthOf(from) : '0000-00', plan = [];
      const doc = await manifest();
      for (const month of Object.keys(doc.months).sort()) {
        if (month < fromMonth) continue;
        for (const shard of new Set(ids.map(id => shardOf(id)))) { const entry = doc.months[month][pad(shard)]; if (entry) plan.push([month, shard, entry.d]); }
      }
      const out = [], started = now();
      for (let i = 0; i < plan.length; i += concurrency) {
        if (now() - started > deadlineMs) throw archiveError('ARCHIVE_READ_TIMEOUT', `${i} of ${plan.length} files read`);
        const loaded = await Promise.all(plan.slice(i, i + concurrency).map(([month, shard, digest]) => shardRows(month, shard, digest)));
        for (const byCard of loaded) for (const id of wanted) for (const row of byCard.get(id) || []) if (!from || row.snapshot_date >= from) out.push(row);
      }
      return out;
    },
    invalidate() { generation++; cache.clear(); pending.clear(); cachedRows = 0; manifestEntry = null; },
    stats() { return { entries: cache.size, rows: cachedRows, maxEntries, maxRows, keys: [...cache.keys()] }; }
  };
}

// ---- One archive run and its scheduler ----
const patchRun = (db, id, body, extra = '') => db(`/catalog_sync_runs?id=eq.${id}${extra}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
async function fetchRunning(db, { now, staleMs }) {
  const since = new Date(now() - staleMs).toISOString();
  const params = new URLSearchParams({ select: 'id,started_at,metadata', provider: `eq.${ARCHIVE_PROVIDER}`, status: 'eq.running', started_at: `gte.${since}`, order: 'started_at.asc,id.asc', limit: '20' });
  return ((await db(`/catalog_sync_runs?${params}`)) || []).filter(row => now() - Date.parse(row.metadata?.heartbeatAt || row.started_at) < staleMs);
}

// A catalog sync holds tens of MB (HANDOFF 99); the archiver waits while one is running. Read from the shared run table, so it also covers admin-triggered syncs.
export async function catalogSyncRunning(db, { now = Date.now, windowMs = 3 * 60 * 60 * 1000 } = {}) {
  const params = new URLSearchParams({ select: 'id', status: 'eq.running', provider: 'not.in.(price-snapshot,price-archive)', started_at: `gte.${new Date(now() - windowMs).toISOString()}`, limit: '1' });
  return ((await db(`/catalog_sync_runs?${params}`)) || []).length > 0;
}

export async function runPriceArchive({ db, storage, reader, now = Date.now, log = console, isBusy = () => false, maxDays = ARCHIVE_MAX_DAYS_PER_RUN, staleMs = 10 * 60 * 1000, signal } = {}) {
  const stats = { status: 'running', days: 0, rows: 0, deleted: 0, filesWritten: 0, dates: [], error: null, startedAt: new Date(now()).toISOString(), finishedAt: null };
  if (!db) throw new Error('PRICE_ARCHIVE_DB_REQUIRED');
  if (!storage) return { ...stats, status: 'disabled', finishedAt: new Date(now()).toISOString() };
  let runId = null;
  try {
    const dates = (await db('/rpc/price_snapshots_archivable_dates', { method: 'POST', body: JSON.stringify({ p_limit: maxDays }) })) || [];
    if (!dates.length) return { ...stats, status: 'idle', finishedAt: new Date(now()).toISOString() };
    if (await isBusy() || await catalogSyncRunning(db, { now })) return { ...stats, status: 'busy', finishedAt: new Date(now()).toISOString() };
    if ((await fetchRunning(db, { now, staleMs })).length) return { ...stats, status: 'busy', finishedAt: new Date(now()).toISOString() };
    const created = await db('/catalog_sync_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ provider: ARCHIVE_PROVIDER, scope: `archive-${dates[0]}..${dates.at(-1)}`, status: 'running' }]) });
    runId = created?.[0]?.id;
    // Two instances may both see "not busy": the earliest started run keeps going, the other steps aside before it touches anything.
    const running = await fetchRunning(db, { now, staleMs });
    if (running.length && String(running[0].id) !== String(runId)) { await patchRun(db, runId, { status: 'skipped', error: 'LOST_RACE', finished_at: new Date(now()).toISOString() }); return { ...stats, status: 'busy', finishedAt: new Date(now()).toISOString() }; }
    await storage.ensureBucket();
    for (const date of dates) {
      if (signal?.aborted) { stats.error = 'ABORTED'; break; }
      const day = await archiveDay({ db, storage, date, onStored: () => reader?.invalidate(), log });
      stats.days++; stats.rows += day.rows; stats.deleted += day.deleted; stats.filesWritten += day.filesWritten; stats.dates.push(date);
      await patchRun(db, runId, { rows_seen: stats.rows, rows_written: stats.deleted, metadata: { heartbeatAt: new Date(now()).toISOString(), dates: stats.dates } }).catch(() => {});
    }
    stats.status = stats.error ? 'aborted' : 'completed';
  } catch (error) {
    stats.status = 'failed';
    stats.error = String(error?.message || error).slice(0, 300);
    log.error?.('price archive failed', stats.error);
  }
  stats.finishedAt = new Date(now()).toISOString();
  if (runId) await patchRun(db, runId, { status: stats.status === 'completed' ? 'completed' : 'failed', rows_seen: stats.rows, rows_written: stats.deleted, error: stats.error, metadata: { dates: stats.dates, filesWritten: stats.filesWritten }, finished_at: stats.finishedAt }).catch(error => log.error?.('price archive run record failed', error.message));
  return stats;
}

// What server.mjs wires in: a daily look (cheap when nothing is old enough), status / run-now for the admin endpoints. Runs never overlap with themselves or with a snapshot round (isBusy).
export function createPriceArchiveController({ db, storage, reader, log = console, intervalMs = ARCHIVE_INTERVAL_MS, initialDelayMs = ARCHIVE_INITIAL_DELAY_MS, busyRetryMs = ARCHIVE_BUSY_RETRY_MS, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, isBusy, enabled = () => true } = {}) {
  let timer = null, running = null, abort = null, last = null, nextRunAt = null, disposed = false;
  const execute = () => {
    abort = new AbortController();
    running = runPriceArchive({ db, storage, reader, now, log, isBusy, signal: abort.signal })
      .then(result => { last = result; if (result.status !== 'idle') log.log?.('price archive', JSON.stringify(result)); return result; })
      .catch(error => { last = { status: 'failed', error: String(error?.message || error) }; log.error?.('price archive failed', last.error); return last; })
      .finally(() => { running = null; abort = null; });
    return running;
  };
  function schedule(delayMs) {
    if (disposed) return;
    nextRunAt = new Date(now() + delayMs).toISOString();
    timer = setTimer(tick, delayMs);
    timer?.unref?.();
  }
  async function tick() {
    timer = null; nextRunAt = null;
    let delay = intervalMs;
    try {
      if (running) delay = busyRetryMs;
      else if (enabled()) { const result = await execute(); delay = result.status === 'busy' ? busyRetryMs : intervalMs; }
    } catch (error) { log.error?.('price archive scheduler failed', error.message); delay = 60 * 60 * 1000; }
    schedule(delay);
  }
  return {
    start() { if (!timer && !disposed) schedule(initialDelayMs); return this; },
    async runNow() { if (running) return { started: false, reason: 'already-running' }; if (!enabled()) return { started: false, reason: 'disabled' }; execute(); return { started: true }; },
    stop() { if (!running) return { stopped: false, reason: 'not-running' }; abort.abort(); return { stopped: true }; },
    status() { return { enabled: enabled(), running: Boolean(running), schedulerActive: Boolean(timer) || Boolean(running), nextRunAt, last, cache: reader?.stats?.() ?? null }; },
    dispose() { disposed = true; if (timer) clearTimer(timer); timer = null; abort?.abort(); return running ?? Promise.resolve(); }
  };
}
