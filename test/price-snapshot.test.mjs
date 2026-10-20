import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriceSnapshotController, listSnapshotCandidates, planNextSnapshotRun, priceSnapshotEnabled, runPriceSnapshot, snapshotDecision, snapshotRowsFromRecords } from '../providers/price-snapshot.mjs';
import { tcgdexLookupForPrinting } from '../providers/tcgdex-pricing.mjs';

const NOW = Date.parse('2026-10-15T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MIB = 1024 * 1024;
const EN_SET_MAP = { sv1: { tcgdex: 'sv01', numberFormat: 'pad3' } };
const noLog = { log() {}, warn() {}, error() {} };
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const settle = async condition => { for (let i = 0; i < 2000 && !condition(); i++) await new Promise(resolve => setImmediate(resolve)); };

// A fake clock: sleeping just moves time forward, so the throttle is measurable and tests are instant.
const makeClock = (start = NOW) => { const clock = { t: start, now: () => clock.t, sleep: async ms => { clock.t += ms; } }; return clock; };

// In-memory stand-in for the PostgREST calls the snapshot makes (printings, price_snapshots, catalog_sync_runs).
function fakeDb({ printings = [], snapshots = [], runs = [], clock = makeClock(), probeError = null, dbSizes = [380 * MIB], sizeError = null } = {}) {
  const state = { calls: [], snapshots: [...snapshots], runs: [...runs], batches: [], sizeReads: 0 };
  const codesOf = text => [...String(text).matchAll(/"([^"]*)"/g)].map(match => match[1]);
  const matches = (row, q) => {
    for (const column of ['source', 'region']) {
      const value = q.get(column);
      if (!value) continue;
      const [op, ...rest] = value.split('.'), expected = rest.join('.');
      if (op === 'eq' && row[column] !== expected) return false;
      if (op === 'neq' && row[column] === expected) return false;
    }
    return !q.get('local_set_code') || codesOf(q.get('local_set_code')).includes(row.local_set_code);
  };
  state.db = async (path, options = {}) => {
    state.calls.push({ path, method: options.method || 'GET', headers: options.headers, body: options.body });
    const [route, query = ''] = path.split('?'), q = new URLSearchParams(query);
    if (route === '/rpc/cardscope_db_size_bytes') {
      if (sizeError) throw new Error(sizeError);
      return dbSizes[Math.min(state.sizeReads++, dbSizes.length - 1)];
    }
    if (route === '/tcg_printings') {
      const after = Number(q.get('id').replace('gt.', ''));
      return printings.filter(row => row.id > after && matches(row, q)).sort((a, b) => a.id - b.id).slice(0, Number(q.get('limit')));
    }
    if (route === '/price_snapshots') {
      if (options.method === 'POST') {
        const batch = JSON.parse(options.body);
        state.batches.push(batch.length);
        for (const row of batch) if (!state.snapshots.some(s => s.card_id === row.card_id && s.provider === row.provider && s.variant === row.variant && s.snapshot_date === row.snapshot_date)) state.snapshots.push(row);
        return null;
      }
      if (probeError && !q.get('card_id')) throw new Error(probeError);
      if (!q.get('card_id')) return [];
      const ids = codesOf(q.get('card_id')), since = q.get('snapshot_date').replace('gte.', '');
      const rows = state.snapshots.filter(s => ids.includes(s.card_id) && s.snapshot_date >= since)
        .sort((a, b) => a.card_id.localeCompare(b.card_id) || a.provider.localeCompare(b.provider) || a.variant.localeCompare(b.variant) || b.snapshot_date.localeCompare(a.snapshot_date));
      return rows.slice(Number(q.get('offset') || 0), Number(q.get('offset') || 0) + Number(q.get('limit')));
    }
    if (route === '/catalog_sync_runs') {
      if (options.method === 'POST') {
        const row = { id: state.runs.length + 1, ...JSON.parse(options.body)[0], started_at: new Date(clock.now()).toISOString(), cursor: null, error: null, metadata: {} };
        state.runs.push(row);
        return [row];
      }
      if (options.method === 'PATCH') {
        const row = state.runs.find(run => run.id === Number(q.get('id').replace('eq.', '')));
        if (row && (!q.get('status') || row.status === q.get('status').replace('eq.', ''))) Object.assign(row, JSON.parse(options.body));
        return null;
      }
      return state.runs.filter(run => run.provider === q.get('provider').replace('eq.', '')).sort((a, b) => b.started_at.localeCompare(a.started_at) || b.id - a.id).slice(0, Number(q.get('limit')));
    }
    throw new Error(`unexpected ${path}`);
  };
  return state;
}

// TCGdex stand-in: cards[id] = { name, trend, low, tp, status }. Price update time is always one hour before the fake clock.
function fakeTcgdex(clock, cards) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, at: clock.now(), signal: init.signal });
    const id = decodeURIComponent(String(url).split('/cards/')[1]), entry = cards[id];
    if (entry?.throws) throw entry.throws;
    if (!entry) return new Response('', { status: 404 });
    if (entry.status) return new Response('x', { status: entry.status });
    const updated = new Date(clock.now() - HOUR).toISOString();
    const pricing = { cardmarket: entry.trend == null ? null : { updated, unit: 'EUR', idProduct: 1, trend: entry.trend, low: entry.low ?? 0.1 }, tcgplayer: entry.tp ? { updated, unit: 'USD', normal: { marketPrice: entry.tp, lowPrice: 1 } } : null };
    return jsonResponse({ id, name: entry.name, variants_detailed: [{ type: 'holo', pricing }] });
  };
  return { fetch, requests };
}

const printing = (id, over = {}) => ({ id, card_id: `card-${id}`, source: 'tcgdex-ja', provider_id: `SV6a-${String(id).padStart(3, '0')}`, region: 'JP', local_set_code: 'SV6a', local_card_number: String(id), card: { game_id: 'pokemon', name_ja: `名前${id}`, name_en: null }, ...over });
const baseOptions = (clock, state, tcgdex, extra = {}) => ({ db: state.db, fetch: tcgdex.fetch, now: clock.now, sleep: clock.sleep, enSetMap: EN_SET_MAP, env: {}, collectionAllowed: () => true, log: noLog, ...extra });

test('candidates follow the detail page rules: tcgdex-ja, approved official JP series (no version cards), mapped US sets, Pokemon only', async () => {
  const printings = [
    printing(1),
    printing(2, { card_id: 'off-1', source: 'pokemon-card-official-jp', provider_id: null, local_set_code: 'SV4a', local_card_number: '012', card: { game_id: 'pokemon', name_ja: 'ピカチュウ', name_en: null } }),
    printing(3, { card_id: 'off-1-v2', source: 'pokemon-card-official-jp', provider_id: null, local_set_code: 'SV4a', local_card_number: '012', card: { game_id: 'pokemon', name_ja: 'ピカチュウ', name_en: null } }),
    printing(4, { card_id: 'off-other', source: 'pokemon-card-official-jp', provider_id: null, local_set_code: 'SV1', local_card_number: '001', card: { game_id: 'pokemon', name_ja: 'ゼニガメ', name_en: null } }),
    printing(5, { card_id: 'off-noname', source: 'pokemon-card-official-jp', provider_id: null, local_set_code: 'SV-P', local_card_number: '001', card: { game_id: 'pokemon', name_ja: null, name_en: null } }),
    printing(6, { card_id: 'us-1', source: 'pokemontcg', provider_id: 'sv1-5', region: 'US', local_set_code: 'sv1', local_card_number: '5', card: { game_id: 'pokemon', name_ja: null, name_en: 'Pikachu' } }),
    printing(7, { card_id: 'us-unmapped', source: 'pokemontcg', provider_id: 'zzz-5', region: 'US', local_set_code: 'zzz', local_card_number: '5', card: { game_id: 'pokemon', name_ja: null, name_en: 'Raichu' } }),
    printing(8, { card_id: 'ygo', card: { game_id: 'yugioh', name_ja: 'x', name_en: null } })
  ];
  const state = fakeDb({ printings });
  const seen = [];
  for await (const page of listSnapshotCandidates(state.db, { enSetMap: EN_SET_MAP, pageSize: 2 })) seen.push(...page.items);
  assert.deepEqual(seen.map(item => [item.cardId, item.id, item.expectedName, item.language]), [
    ['card-1', 'SV6a-001', null, 'ja'],
    ['off-1', 'SV4a-012', 'ピカチュウ', 'ja'],
    ['us-1', 'sv01-005', 'Pikachu', 'en']
  ]);
  const printingCalls = state.calls.filter(call => call.path.startsWith('/tcg_printings'));
  assert.ok(printingCalls.length > 3, 'paged with a small page size');
  for (const call of printingCalls) {
    const q = new URLSearchParams(call.path.split('?')[1]);
    assert.ok(Number(q.get('limit')) <= 1000);
    assert.match(q.get('id'), /^gt\.\d+$/, 'keyset on the printing id');
    assert.equal(q.get('order'), 'id.asc');
  }
  assert.ok(state.calls.every(call => call.method === 'GET'), 'listing is read-only');
});

test('the shared lookup function gives the same answers the detail page expects', () => {
  assert.deepEqual(tcgdexLookupForPrinting({ source: 'tcgdex-ja', providerId: 'SV6a-039' }), { id: 'SV6a-039', expectedName: null, language: 'ja' });
  assert.equal(tcgdexLookupForPrinting({ source: 'tcgdex-ja' }), null);
  assert.equal(tcgdexLookupForPrinting({ region: 'JP', cardId: 'x', localSetCode: 'SV4a', localCardNumber: '1' }), null, 'no Japanese name, no lookup');
  assert.deepEqual(tcgdexLookupForPrinting({ source: 'pokemontcg', region: 'US', localSetCode: 'sv1', localCardNumber: '5', providerId: 'sv1-5' }, { nameEn: 'Pikachu' }, { enSetMap: EN_SET_MAP }), { id: 'sv01-005', expectedName: 'Pikachu', language: 'en' });
  assert.equal(tcgdexLookupForPrinting({ source: 'pokemontcg', region: 'US', localSetCode: 'sv1', localCardNumber: '5' }, null, { enSetMap: {} }), null);
});

test('only market prices are stored, per provider and variant, and nothing under 0.5', () => {
  const record = (market, priceType, amount, variant = 'holo', currency = market === 'TCGplayer' ? 'USD' : 'EUR') => ({ market, priceType, amount, variant, currency, observedAt: '2026-10-14T23:00:00.000Z' });
  const { rows, belowThreshold } = snapshotRowsFromRecords('c1', [
    record('Cardmarket', 'market', 1.234), record('Cardmarket', 'listing', 0.9),
    record('Cardmarket', 'market', 0.49, 'reverse'), record('Cardmarket', 'market', 0.5, 'normal'),
    record('TCGplayer', 'market', 3.2, 'normal'), record('TCGplayer', 'listing', 1, 'normal'),
    record('Other', 'market', 9, 'x')
  ], '2026-10-15');
  assert.equal(belowThreshold, 1);
  assert.deepEqual(rows.map(row => [row.provider, row.variant, row.currency, row.amount]), [['cardmarket', 'holo', 'EUR', 1.23], ['cardmarket', 'normal', 'EUR', 0.5], ['tcgplayer', 'normal', 'USD', 3.2]]);
  assert.ok(rows.every(row => row.card_id === 'c1' && row.snapshot_date === '2026-10-15' && row.observed_at === '2026-10-14T23:00:00.000Z'));
  assert.deepEqual(snapshotRowsFromRecords('c1', [{ market: 'Cardmarket', priceType: 'market', amount: 2, variant: null, currency: 'EUR' }], 'd').rows[0].variant, '', 'no variant is stored as an empty string');
});

test('store when there is no previous value, a move of 2% or more, or 7 days; never twice on one day', () => {
  const prev = (amount, date) => ({ amount, snapshot_date: date });
  assert.equal(snapshotDecision(null, 5, '2026-10-15').store, true);
  assert.equal(snapshotDecision(prev(10, '2026-10-14'), 10.19, '2026-10-15').store, false, '1.9% is not enough');
  assert.equal(snapshotDecision(prev(10, '2026-10-14'), 10.2, '2026-10-15').store, true, 'exactly 2% counts');
  assert.equal(snapshotDecision(prev(10, '2026-10-14'), 9.8, '2026-10-15').store, true, 'drops count too');
  assert.equal(snapshotDecision(prev(10, '2026-10-09'), 10, '2026-10-15').store, false, 'six days old and unchanged');
  assert.deepEqual(snapshotDecision(prev(10, '2026-10-08'), 10, '2026-10-15'), { store: true, reason: 'age' });
  assert.deepEqual(snapshotDecision(prev(10, '2026-10-15'), 50, '2026-10-15'), { store: false, reason: 'sameDay' });
});

test('a full run over several days stores first value, then only changes, then the weekly refresh', async () => {
  const clock = makeClock();
  const cards = { 'SV6a-001': { name: '名前1', trend: 10 } };
  const state = fakeDb({ printings: [printing(1)], clock });
  const tcgdex = fakeTcgdex(clock, cards);
  const run = async () => runPriceSnapshot(baseOptions(clock, state, tcgdex));
  const stored = () => state.snapshots.map(row => [row.snapshot_date, row.amount]);

  let result = await run();
  assert.equal(result.status, 'completed');
  assert.equal(result.written, 1);
  assert.deepEqual(stored(), [['2026-10-15', 10]]);

  clock.t += DAY; cards['SV6a-001'].trend = 10.1;           // +1%
  result = await run();
  assert.equal(result.written, 0);
  assert.equal(result.skipped.unchanged, 1);

  clock.t += DAY; cards['SV6a-001'].trend = 10.2;           // +2% against the stored 10.00
  result = await run();
  assert.equal(result.written, 1);
  assert.deepEqual(stored().at(-1), ['2026-10-17', 10.2]);

  clock.t += 6 * DAY;                                         // six days after the last stored value, unchanged
  assert.equal((await run()).written, 0);
  clock.t += DAY;                                             // seven days
  result = await run();
  assert.equal(result.written, 1);
  assert.deepEqual(stored().at(-1), ['2026-10-24', 10.2]);
});

test('running twice on the same day does not duplicate rows, and the insert ignores key conflicts', async () => {
  const clock = makeClock();
  const state = fakeDb({ printings: [printing(1), printing(2)], clock });
  const tcgdex = fakeTcgdex(clock, { 'SV6a-001': { name: '名前1', trend: 4 }, 'SV6a-002': { name: '名前2', trend: 6, tp: 8 } });
  assert.equal((await runPriceSnapshot(baseOptions(clock, state, tcgdex))).written, 3);
  const again = await runPriceSnapshot(baseOptions(clock, state, tcgdex, { }));
  assert.equal(again.written, 0);
  assert.equal(again.skipped.sameDay, 3);
  assert.equal(state.snapshots.length, 3);
  const insert = state.calls.find(call => call.method === 'POST' && call.path.startsWith('/price_snapshots'));
  assert.match(insert.path, /on_conflict=card_id,provider,variant,snapshot_date/);
  assert.match(insert.headers.Prefer, /resolution=ignore-duplicates/);
});

test('a name that does not match is not stored; a card TCGdex does not know is skipped', async () => {
  const clock = makeClock();
  const official = printing(2, { card_id: 'off-1', source: 'pokemon-card-official-jp', provider_id: null, local_set_code: 'SV4a', local_card_number: '012', card: { game_id: 'pokemon', name_ja: 'ピカチュウ', name_en: null } });
  const state = fakeDb({ printings: [official, printing(3, { card_id: 'off-2', source: 'pokemon-card-official-jp', provider_id: null, local_set_code: 'SV4a', local_card_number: '013', card: { game_id: 'pokemon', name_ja: 'ライチュウ', name_en: null } })], clock });
  const tcgdex = fakeTcgdex(clock, { 'SV4a-012': { name: 'ゼニガメ', trend: 20 } });
  const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex));
  assert.equal(result.status, 'completed');
  assert.equal(result.written, 0);
  assert.equal(state.snapshots.length, 0);
  assert.equal(result.skipped.noPrice, 1, 'mismatching name');
  assert.equal(result.skipped.notFound, 1, '404');
  assert.equal(result.requests, 2);
});

test('prices under 0.5 are counted but not stored, and listing prices never are', async () => {
  const clock = makeClock();
  const state = fakeDb({ printings: [printing(1), printing(2)], clock });
  const tcgdex = fakeTcgdex(clock, { 'SV6a-001': { name: '名前1', trend: 0.49, low: 0.4 }, 'SV6a-002': { name: '名前2', trend: 0.5, low: 0.1 } });
  const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex));
  assert.equal(result.belowThreshold, 1);
  assert.deepEqual(state.snapshots.map(row => [row.card_id, row.provider, row.amount]), [['card-2', 'cardmarket', 0.5]]);
});

test('one request at a time, at most one per second', async () => {
  const clock = makeClock();
  const printings = Array.from({ length: 6 }, (_, i) => printing(i + 1));
  const cards = Object.fromEntries(printings.map(p => [p.provider_id, { name: p.card.name_ja, trend: 3 }]));
  const state = fakeDb({ printings, clock });
  const tcgdex = fakeTcgdex(clock, cards);
  let active = 0, peak = 0;
  const inner = tcgdex.fetch;
  const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex, { fetch: async (...args) => { active++; peak = Math.max(peak, active); try { return await inner(...args); } finally { active--; } } }));
  assert.equal(result.requests, 6);
  assert.equal(peak, 1);
  for (let i = 1; i < tcgdex.requests.length; i++) assert.ok(tcgdex.requests[i].at - tcgdex.requests[i - 1].at >= 1000, 'requests are spaced by a second');
});

test('20 failures in a row stop the round; a success in between resets the count; timeouts and non-200 only skip the card', async () => {
  const stop = async cards => {
    const clock = makeClock(), printings = Array.from({ length: 40 }, (_, i) => printing(i + 1)), state = fakeDb({ printings, clock }), tcgdex = fakeTcgdex(clock, cards(printings));
    return { result: await runPriceSnapshot(baseOptions(clock, state, tcgdex)), state, tcgdex };
  };
  const failing = await stop(printings => Object.fromEntries(printings.map(p => [p.provider_id, { status: 403 }])));
  assert.equal(failing.result.status, 'failed');
  assert.equal(failing.result.error, 'CONSECUTIVE_FAILURES');
  assert.equal(failing.result.requests, 20);
  assert.equal(failing.result.skipped.httpError, 20);
  assert.equal(failing.state.runs[0].status, 'failed');
  assert.equal(failing.state.runs[0].error, 'CONSECUTIVE_FAILURES');

  // 19 failures, one success, 19 failures, one success: never 20 in a row.
  const mixed = await stop(printings => Object.fromEntries(printings.map((p, i) => [p.provider_id, i === 19 || i === 39 ? { name: p.card.name_ja, trend: 2 } : { throws: Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }])));
  assert.equal(mixed.result.status, 'completed');
  assert.equal(mixed.result.skipped.timeout, 38);
  assert.equal(mixed.result.written, 2);
  assert.equal(mixed.state.runs[0].status, 'completed');
});

test('a round can be aborted; it is recorded as failed/ABORTED with a cursor', async () => {
  const clock = makeClock(), controller = new AbortController();
  const printings = Array.from({ length: 10 }, (_, i) => printing(i + 1));
  const cards = Object.fromEntries(printings.map(p => [p.provider_id, { name: p.card.name_ja, trend: 3 }]));
  const state = fakeDb({ printings, clock }), tcgdex = fakeTcgdex(clock, cards);
  let count = 0;
  const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex, { signal: controller.signal, fetch: async (...args) => { const response = await tcgdex.fetch(...args); if (++count === 3) controller.abort(); return response; } }));
  assert.equal(result.status, 'aborted');
  assert.equal(result.requests, 3);
  assert.equal(result.written, 3, 'what was priced before the stop is kept');
  assert.equal(state.runs[0].status, 'failed');
  assert.equal(state.runs[0].error, 'ABORTED');
  assert.match(state.runs[0].cursor, /^0:\d+$/);
});

test('inserts go out in batches of at most 200 and the round is recorded in catalog_sync_runs', async () => {
  const clock = makeClock();
  const printings = Array.from({ length: 450 }, (_, i) => printing(i + 1));
  const cards = Object.fromEntries(printings.map(p => [p.provider_id, { name: p.card.name_ja, trend: 5 }]));
  const state = fakeDb({ printings, clock }), tcgdex = fakeTcgdex(clock, cards);
  const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex, { chunkSize: 300 }));
  assert.equal(result.written, 450);
  assert.equal(state.snapshots.length, 450);
  assert.deepEqual(state.batches, [200, 100, 150]);
  assert.ok(state.batches.every(size => size <= 200));
  const [run] = state.runs;
  assert.equal(run.provider, 'price-snapshot');
  assert.equal(run.scope, 'daily-2026-10-15');
  assert.equal(run.status, 'completed');
  assert.equal(run.rows_seen, 450);
  assert.equal(run.rows_written, 450);
  assert.equal(run.cursor, null);
  assert.equal(run.metadata.requests, 450);
  assert.equal(result.skippedTotal, 0);
});

test('the switches: PRICE_SNAPSHOT_ENABLED=false or the registry flag stop the round before any request', async () => {
  assert.equal(priceSnapshotEnabled({ env: {} }), true, 'on by default with the shipped registry');
  assert.equal(priceSnapshotEnabled({ env: { PRICE_SNAPSHOT_ENABLED: 'FALSE' } }), false);
  assert.equal(priceSnapshotEnabled({ env: {}, collectionAllowed: provider => provider !== 'tcgdexPricing' }), false);
  for (const extra of [{ env: { PRICE_SNAPSHOT_ENABLED: 'false' } }, { collectionAllowed: () => false }]) {
    const clock = makeClock(), state = fakeDb({ printings: [printing(1)], clock }), tcgdex = fakeTcgdex(clock, { 'SV6a-001': { name: '名前1', trend: 5 } });
    const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex, extra));
    assert.equal(result.status, 'disabled');
    assert.equal(state.calls.length, 0);
    assert.equal(tcgdex.requests.length, 0);
  }
  const clock = makeClock(), state = fakeDb({ clock }), controller = createPriceSnapshotController({ db: state.db, env: { PRICE_SNAPSHOT_ENABLED: 'false' }, log: noLog });
  assert.deepEqual(await controller.runNow(), { started: false, reason: 'disabled' });
  assert.equal(controller.status().enabled, false);
});

test('a missing price_snapshots table fails the round before any TCGdex request', async () => {
  const clock = makeClock(), state = fakeDb({ printings: [printing(1)], clock, probeError: 'SUPABASE_404' }), tcgdex = fakeTcgdex(clock, { 'SV6a-001': { name: '名前1', trend: 5 } });
  const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex));
  assert.equal(result.status, 'failed');
  assert.match(result.error, /SUPABASE_404/);
  assert.equal(tcgdex.requests.length, 0);
  assert.equal(state.runs[0].status, 'failed');
});

test('the scheduler waits after a recent round, resumes an interrupted one, and leaves a live one alone', async () => {
  const at = ms => new Date(NOW - ms).toISOString();
  const plan = async runs => planNextSnapshotRun(fakeDb({ runs, clock: makeClock() }).db, { now: () => NOW });
  const run = over => ({ id: 7, provider: 'price-snapshot', status: 'completed', cursor: null, error: null, started_at: at(2 * HOUR), metadata: {}, ...over });
  assert.deepEqual(await plan([]), { action: 'run' });
  assert.deepEqual(await plan([run()]), { action: 'wait', waitMs: 22 * HOUR });
  assert.deepEqual(await plan([run({ started_at: at(25 * HOUR) })]), { action: 'run' });
  assert.equal((await plan([run({ status: 'running', metadata: { heartbeatAt: at(2 * 60 * 1000) } })])).action, 'busy');
  assert.deepEqual(await plan([run({ status: 'running', cursor: '0:500', metadata: { heartbeatAt: at(HOUR) } })]), { action: 'run', cursor: '0:500', resumedFrom: 7 });
  assert.deepEqual(await plan([run({ status: 'failed', error: 'CONSECUTIVE_FAILURES', cursor: '1:20' })]), { action: 'run', cursor: '1:20', resumedFrom: 7 });
  assert.deepEqual(await plan([run({ status: 'failed', error: 'ABORTED', cursor: '1:20' })]), { action: 'run' }, 'an admin stop is not resumed');
  assert.deepEqual(await plan([run({ status: 'running', cursor: '0:500', started_at: at(20 * HOUR), metadata: {} })]), { action: 'run' }, 'too old to resume');
});

test('resuming continues after the stored cursor and closes the interrupted run', async () => {
  const clock = makeClock();
  const printings = Array.from({ length: 6 }, (_, i) => printing(i + 1));
  const cards = Object.fromEntries(printings.map(p => [p.provider_id, { name: p.card.name_ja, trend: 3 }]));
  const state = fakeDb({ printings, clock, runs: [{ id: 1, provider: 'price-snapshot', scope: 'daily-2026-10-14', status: 'running', cursor: '0:4', started_at: new Date(NOW - 2 * HOUR).toISOString(), metadata: {} }] }), tcgdex = fakeTcgdex(clock, cards);
  const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex, { cursor: '0:4', resumedFrom: 1 }));
  assert.deepEqual(state.snapshots.map(row => row.card_id), ['card-5', 'card-6']);
  assert.equal(result.requests, 2);
  assert.equal(state.runs[0].status, 'failed');
  assert.equal(state.runs[0].error, 'INTERRUPTED');
});

test('the controller never overlaps rounds, reports status, and can be stopped', async () => {
  const clock = makeClock(), state = fakeDb({ printings: [printing(1), printing(2)], clock });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tcgdex = fakeTcgdex(clock, { 'SV6a-001': { name: '名前1', trend: 3 }, 'SV6a-002': { name: '名前2', trend: 3 } });
  const controller = createPriceSnapshotController({ db: state.db, fetch: async (url, init) => { await Promise.race([gate, new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))]); return tcgdex.fetch(url, init); }, now: clock.now, sleep: clock.sleep, enSetMap: EN_SET_MAP, env: {}, collectionAllowed: () => true, log: noLog });
  assert.deepEqual(controller.stop(), { stopped: false, reason: 'not-running' });
  assert.deepEqual(await controller.runNow(), { started: true });
  assert.deepEqual(await controller.runNow(), { started: false, reason: 'already-running' });
  assert.equal(controller.status().running, true);
  assert.deepEqual(controller.stop(), { stopped: true });
  await settle(() => !controller.status().running);
  assert.equal(controller.status().last.status, 'aborted');
  release();
  assert.deepEqual(await controller.runNow(), { started: true }, 'a new round can start after a stop');
  await settle(() => !controller.status().running);
  assert.equal(controller.status().last.status, 'completed');
  assert.equal(controller.status().last.written, 2);
});

test('the daily scheduler starts after a delay, runs one round, and then waits out the rest of the day', async () => {
  const clock = makeClock(), state = fakeDb({ printings: [printing(1)], clock }), tcgdex = fakeTcgdex(clock, { 'SV6a-001': { name: '名前1', trend: 3 } });
  const timers = [];
  const controller = createPriceSnapshotController({ db: state.db, fetch: tcgdex.fetch, now: clock.now, sleep: clock.sleep, enSetMap: EN_SET_MAP, env: {}, collectionAllowed: () => true, log: noLog, initialDelayMs: 5 * 60 * 1000, setTimer: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; }, clearTimer() {} });
  controller.start();
  controller.start();
  assert.equal(timers.length, 1, 'start is idempotent');
  assert.equal(timers[0].ms, 5 * 60 * 1000);
  await timers[0].fn();
  assert.equal(state.runs.length, 1);
  assert.equal(state.snapshots.length, 1);
  assert.equal(timers.length, 2);
  assert.ok(timers[1].ms > 23 * HOUR && timers[1].ms <= DAY, 'next round about a day after this one started');
  clock.t += timers[1].ms - 10 * 60 * 1000;         // woken early (e.g. after a restart): the last round is still within the day
  await timers[1].fn();
  assert.equal(state.runs.length, 1, 'no second round yet');
  assert.ok(timers[2].ms >= 10 * 60 * 1000);
  await controller.dispose();
  assert.equal(timers.length, 3, 'nothing is scheduled after dispose');
});

test('429 and 5xx back off for a minute instead of counting toward the stop limit; a long outage stops the round', async () => {
  const run = async cards => {
    const clock = makeClock(), printings = Array.from({ length: 40 }, (_, i) => printing(i + 1)), state = fakeDb({ printings, clock }), tcgdex = fakeTcgdex(clock, cards(printings));
    const started = clock.now();
    return { result: await runPriceSnapshot(baseOptions(clock, state, tcgdex)), elapsed: clock.now() - started };
  };
  // 25 cards in a row answer 503 (more than the 20-failure limit), then TCGdex recovers.
  const burst = await run(printings => Object.fromEntries(printings.map((p, i) => [p.provider_id, i < 25 ? { status: i % 2 ? 429 : 503 } : { name: p.card.name_ja, trend: 2 }])));
  assert.equal(burst.result.status, 'completed');
  assert.equal(burst.result.skipped.httpError, 25);
  assert.deepEqual(burst.result.errorCodes, { 503: 13, 429: 12 });
  assert.equal(burst.result.written, 15);
  assert.ok(burst.elapsed >= 25 * 60 * 1000, 'each 503/429 waited a minute');
  // 30 back-offs in a row (about half an hour of outage) stop the round.
  const outage = await run(printings => Object.fromEntries(printings.map(p => [p.provider_id, { status: 503 }])));
  assert.equal(outage.result.status, 'failed');
  assert.equal(outage.result.error, 'UPSTREAM_UNAVAILABLE');
  assert.equal(outage.result.requests, 30);
});

test('a price that drops under 0.5 is written once so the trend follows it down, then no more', async () => {
  const clock = makeClock();
  const cards = { 'SV6a-001': { name: '名前1', trend: 3 } };
  const state = fakeDb({ printings: [printing(1)], clock });
  const tcgdex = fakeTcgdex(clock, cards);
  const run = async () => runPriceSnapshot(baseOptions(clock, state, tcgdex));
  assert.equal((await run()).written, 1);
  clock.t += DAY; cards['SV6a-001'].trend = 0.3;
  const dropped = await run();
  assert.equal(dropped.written, 1);
  assert.equal(dropped.droppedBelow, 1);
  clock.t += DAY; cards['SV6a-001'].trend = 0.2;
  assert.equal((await run()).written, 0, 'already under the threshold: nothing more');
  clock.t += 8 * DAY;
  assert.equal((await run()).written, 0, 'no weekly refresh under the threshold either');
  assert.deepEqual(state.snapshots.map(row => row.amount), [3, 0.3]);
  // A card that was never above the threshold is never stored.
  const fresh = fakeDb({ printings: [printing(2)], clock });
  assert.equal((await runPriceSnapshot(baseOptions(clock, fresh, fakeTcgdex(clock, { 'SV6a-002': { name: '名前2', trend: 0.2 } })))).written, 0);
});

// ADR 0046: the automatic brake at 440 MB.
test('the database size brake: at 440 MB a round makes no TCGdex request, writes nothing, and leaves a run note', async () => {
  const clock = makeClock(), state = fakeDb({ printings: [printing(1)], clock, dbSizes: [440 * MIB] }), tcgdex = fakeTcgdex(clock, { 'SV6a-001': { name: '名前1', trend: 10 } });
  const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex));
  assert.equal(result.status, 'paused');
  assert.equal(result.error, 'DB_SIZE_BRAKE');
  assert.equal(result.dbSizeBytes, 440 * MIB);
  assert.equal(tcgdex.requests.length, 0);
  assert.equal(state.snapshots.length, 0);
  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0].status, 'skipped');
  assert.equal(state.runs[0].error, 'DB_SIZE_BRAKE');
  assert.equal(state.runs[0].metadata.dbSizeBytes, 440 * MIB);
});

test('just under 440 MB the round runs; a probe that cannot be read does not stop it (fails open)', async () => {
  for (const options of [{ dbSizes: [440 * MIB - 1] }, { sizeError: 'function missing' }]) {
    const clock = makeClock(), state = fakeDb({ printings: [printing(1)], clock, ...options }), tcgdex = fakeTcgdex(clock, { 'SV6a-001': { name: '名前1', trend: 10 } });
    const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex));
    assert.equal(result.status, 'completed', JSON.stringify(options));
    assert.equal(result.written, 1);
  }
});

test('the brake is checked again while a round runs and stops it after the current chunk, keeping the cursor', async () => {
  const clock = makeClock(), cards = {}, printings = [];
  for (let id = 1; id <= 6; id++) { printings.push(printing(id)); cards[`SV6a-${String(id).padStart(3, '0')}`] = { name: `名前${id}`, trend: 10 + id }; }
  const state = fakeDb({ printings, clock, dbSizes: [380 * MIB, 380 * MIB, 441 * MIB] }), tcgdex = fakeTcgdex(clock, cards);
  const result = await runPriceSnapshot(baseOptions(clock, state, tcgdex, { chunkSize: 1, brakeCheckChunks: 2 }));
  assert.equal(result.status, 'paused');
  assert.equal(result.candidates, 4, 'start, then checks after chunk 2 (ok) and chunk 4 (over)');
  assert.equal(state.snapshots.length, 4);
  assert.equal(state.runs[0].status, 'skipped');
  assert.ok(state.runs[0].cursor, 'the cursor stays so the round can resume');
});

test('the controller does not start a round while the archiver is running', async () => {
  const timers = [];
  let blocked = true;
  const clock = makeClock(), state = fakeDb({ printings: [printing(1)], clock }), tcgdex = fakeTcgdex(clock, { 'SV6a-001': { name: '名前1', trend: 10 } });
  const controller = createPriceSnapshotController({ ...baseOptions(clock, state, tcgdex), isBlocked: () => blocked, intervalMs: DAY, initialDelayMs: 1, minGapMs: 5, setTimer: (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; }, clearTimer() {} });
  controller.start();
  await timers[0].fn();
  assert.equal(state.runs.length, 0, 'no round started');
  assert.equal(timers[1].ms, 5, 'looks again soon');
  blocked = false;
  await timers[1].fn();
  assert.equal(state.runs.length, 1);
  await controller.dispose();
});
