import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// ADR 0045: browser-only collection. Pure store functions (import validator, merge, legacy migration, reference total) plus wiring checks.

const [source, ui, html] = await Promise.all(['../collection-store.js', '../ui-enhancements.js', '../index.html'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
const win = {};
new Function('window', source)(win); // same realm, so deepEqual compares plain objects
const CS = win.CollectionStore;
const item = (over = {}) => ({ id: 'tw-1', canonicalId: 'pokemon-1', favorite: false, quantity: 2, condition: 'NM', finish: 'holo', note: '', ...over });
const backup = items => JSON.stringify({ app: 'cardscope-collection', version: 1, exportedAt: '2026-10-19T00:00:00.000Z', items });

test('import validator: whole-file problems reject, bad items are skipped and counted, ids stay strings', () => {
  for (const text of ['', '   ', 'not json', '[]', '"x"', 'null', JSON.stringify({ app: 'other', version: 1, items: [] }), JSON.stringify({ app: 'cardscope-collection', version: 3, items: [] }), JSON.stringify({ app: 'cardscope-collection', version: 1 }), JSON.stringify({ app: 'cardscope-collection', version: 1, items: {} })]) {
    assert.ok(CS.parseBackup(text).error, `rejects ${text.slice(0, 30)}`);
  }
  assert.ok(CS.parseBackup('x'.repeat(CS.LIMITS.fileMaxChars + 1)).error, 'size cap');
  assert.ok(CS.parseBackup(backup(Array.from({ length: CS.LIMITS.itemsMax + 1 }, (_, i) => item({ id: `c${i}` })))).error, 'item count cap');
  assert.equal(CS.parseBackup(backup(Array.from({ length: CS.LIMITS.itemsMax }, (_, i) => item({ id: `c${i}` })))).items.length, CS.LIMITS.itemsMax);

  const bad = [null, 5, 'x', [], {}, item({ id: 12 }), item({ id: '' }), item({ id: 'a'.repeat(129) }), item({ id: 'a\nb' }), item({ quantity: 0, favorite: false }), item({ quantity: -1 }), item({ quantity: 1000 }), item({ quantity: 1.5 }), item({ quantity: '2' }),
    item({ quantity: 1e9 }), item({ condition: 'MINT' }), item({ finish: 'a b' }), item({ finish: 'x'.repeat(61) }), item({ note: 'n'.repeat(201) }), item({ note: 5 }), item({ favorite: 'yes' }), item({ canonicalId: 5 })];
  const out = CS.parseBackup(backup([...bad, item({ id: 'good' })]));
  assert.deepEqual(out.items.map(x => x.id), ['good']);
  assert.equal(out.skipped, bad.length);
  assert.deepEqual(out.items[0], { id: 'good', canonicalId: 'pokemon-1', favorite: false, quantity: 2, condition: 'NM', finish: 'holo', note: '' });
  assert.equal(CS.parseBackup(backup([item({ id: '__proto__' })])).items[0].id, '__proto__', 'a weird id is just a string, never a key on a shared object');
  assert.equal(CS.parseBackup(backup([item({ note: 'a\u0000b\tc' })])).items[0].note, 'a b c', 'control characters are stripped from notes');
  assert.deepEqual(CS.parseBackup(backup([item({ id: 'k', quantity: 1 }), item({ id: 'k', quantity: 5, note: 'dup' })])).items.map(x => [x.id, x.quantity, x.note]), [['k', 5, 'dup']], 'duplicates inside the file merge');
  assert.equal(CS.parseBackup(backup([{ id: 'only-star', favorite: true }])).items[0].quantity, 0, 'missing optional fields default');
});

test('export then import round trip keeps every field; merging twice never doubles quantities and never drops existing data', () => {
  const items = [item(), item({ id: 'star', canonicalId: '', favorite: true, quantity: 0, condition: '', finish: '', note: '角落有折痕' })];
  const file = JSON.stringify(CS.exportBackup(items, new Date('2026-10-19T00:00:00Z')));
  assert.deepEqual(CS.parseBackup(file).items, items);
  assert.equal(JSON.parse(file).app, 'cardscope-collection');
  assert.equal(JSON.parse(file).version, 2);
  const first = CS.mergeItems([], items);
  assert.deepEqual([first.added, first.merged], [2, 0]);
  const again = CS.mergeItems(first.items, items);
  assert.deepEqual([again.added, again.merged], [0, 0]);
  assert.deepEqual(again.items, first.items);
  const local = [item({ quantity: 3, condition: '', note: 'mine' })];
  const merged = CS.mergeItems(local, [item({ quantity: 1, condition: 'LP', note: 'theirs', favorite: true })]);
  assert.deepEqual(merged.items[0], { id: 'tw-1', canonicalId: 'pokemon-1', favorite: true, quantity: 3, condition: 'LP', finish: 'holo', note: 'mine' }, 'larger quantity, existing text wins unless empty, star is kept');
  assert.equal(merged.merged, 1);
});

test('legacy migration: old favorites/watchlist/meta become items without losing an entry, even odd ones', () => {
  const items = CS.itemsFromLegacy(new Set(['a', 'b']), { b: 3, c: 2, d: 'x', e: 5000 }, { b: { canonicalId: 'canon-b', condition: 'LP', note: 'n' }, c: { finish: 'bad finish!' } });
  assert.deepEqual(items.map(x => [x.id, x.favorite, x.quantity]), [['a', true, 0], ['b', true, 3], ['c', false, 2], ['d', false, 0], ['e', false, 999]]);
  assert.equal(items.find(x => x.id === 'b').condition, 'LP');
  assert.equal(items.find(x => x.id === 'c').finish, '', 'an invalid stored finish is dropped, the entry stays');
  assert.equal(items.find(x => x.id === 'c').quantity, 2);
  assert.equal(CS.itemsFromLegacy([], {}, {}).length, 0);
  assert.deepEqual(CS.itemsFromLegacy(['arr'], {}, {}).map(x => x.id), ['arr'], 'a plain array of ids works too');
});

test('legacy id resolution: physical id stays, a single physical card replaces the canonical id, several versions are never guessed', () => {
  const printing = (cardId, region, over = {}) => ({ cardId, region, localSetCode: 'SV6a', localCardNumber: '039', metadata: {}, ...over });
  const single = { id: 'canon', canonicalId: 'canon', printings: [printing('phys-jp', 'JP')], physicalCardIds: ['phys-jp'] };
  assert.deepEqual(CS.locateCard('phys-jp', single), { id: 'phys-jp', canonicalId: 'canon' }, 'already a physical id');
  assert.deepEqual(CS.locateCard('canon', single), { id: 'phys-jp', canonicalId: 'canon' }, 'canonical id with exactly one physical card');
  const multi = { id: 'canon', canonicalId: 'canon', printings: [printing('phys-jp', 'JP'), printing('phys-tw', 'TW', { metadata: { variantName: '版本 2' } }), printing('phys-jp', 'JP')], physicalCardIds: ['phys-jp', 'phys-tw'] };
  assert.deepEqual(CS.locateCard('phys-tw', multi), { id: 'phys-tw', canonicalId: 'canon' });
  const ambiguous = CS.locateCard('canon', multi);
  assert.equal(ambiguous.id, 'canon', 'kept as is');
  assert.equal(ambiguous.ambiguous, true);
  assert.deepEqual(ambiguous.choices.map(c => [c.cardId, c.region, c.variant]), [['phys-jp', 'JP', ''], ['phys-tw', 'TW', '版本 2']], 'unique choices to let the user pick');
  assert.deepEqual(CS.locateCard('bare', { id: 'bare' }), { id: 'bare', canonicalId: 'bare' }, 'a card without printings is its own physical card');
});

const price = (provider, variant, amount, amountTwd, snapshotDate = '2026-10-18', currency = provider === 'cardmarket' ? 'EUR' : 'USD') => ({ provider, variant, currency, amount, amountTwd, snapshotDate });

test('reference total: per source, finish must match, several variants need a choice, slabs and unpriced cards are 未計入, sources never add up', () => {
  const prices = {
    one: [price('cardmarket', 'holo', 5, 200)],
    both: [price('cardmarket', 'holo', 5, 200, '2026-10-10'), price('tcgplayer', 'holofoil', 10, 320, '2026-10-18')],
    multi: [price('cardmarket', 'holo', 5, 200), price('cardmarket', 'reverse', 2, 80)],
    slab: [price('cardmarket', 'holo', 100, 4000)]
  };
  const v = CS.valuate([
    { id: 'one', quantity: 2, condition: 'NM', finish: '' },
    { id: 'both', quantity: 1, condition: '', finish: '' },
    { id: 'multi', quantity: 1, condition: '', finish: '' },
    { id: 'multi2', quantity: 1, condition: '', finish: '' },
    { id: 'slab', quantity: 1, condition: 'SLAB', finish: '' },
    { id: 'none', quantity: 4, condition: '', finish: '' },
    { id: 'picked', quantity: 3, condition: 'HP', finish: 'reverse' },
    { id: 'wrong', quantity: 1, condition: '', finish: 'reverse' },
    { id: 'alias', quantity: 1, condition: '', finish: 'holo' }
  ], { ...prices, multi2: prices.multi, picked: prices.multi, wrong: prices.one, alias: prices.both });
  assert.deepEqual(v.byProvider.cardmarket, { twd: 200 * 2 + 200 + 80 * 3 + 200, entries: 4, missingFx: 0 });
  assert.deepEqual(v.byProvider.tcgplayer, { twd: 320 + 320, entries: 2, missingFx: 0 }, 'finish holo also matches TCGplayer holofoil (same finish, different source vocabulary)');
  assert.deepEqual(Object.fromEntries(v.uncounted.map(x => [x.id, x.reason])), { multi: 'choose', multi2: 'choose', slab: 'slab', none: 'none', wrong: 'no-match' });
  assert.equal(v.counted, 4);
  assert.equal(v.total, 9);
  assert.equal(v.dateFrom, '2026-10-10');
  assert.equal(v.dateTo, '2026-10-18');
  assert.equal(v.perEntry.both.counted.length, 2, 'both sources counted separately, never merged into one number');
  assert.equal(v.perEntry.one.counted[0].qty, 2);
  assert.deepEqual(['holofoil', 'reverse-holofoil', 'reverseHolofoil', 'Holo', 'normal', ''].map(CS.finishKey), ['holo', 'reverse', 'reverse', 'holo', 'normal', '']);
  const noFx = CS.valuate([{ id: 'x', quantity: 1, condition: '', finish: '' }], { x: [price('cardmarket', '', 5, null)] });
  assert.deepEqual(noFx.byProvider.cardmarket, { twd: 0, entries: 1, missingFx: 1 }, 'a price without a TWD rate is flagged, not counted as 0 silently');
  assert.deepEqual(CS.valuate([], {}), { byProvider: {}, perEntry: {}, uncounted: [], counted: 0, total: 0, dateFrom: '', dateTo: '' });
});

test('wiring: store loads before the UI, keys are the physical card id, the dialog says 只存在這台裝置, reference prices come only from our endpoint', () => {
  assert.ok(html.indexOf('/collection-store.js') > 0 && html.indexOf('/collection-store.js') < html.indexOf('/ui-enhancements.js'));
  assert.match(ui, /只存在這台裝置/);
  assert.match(ui, /fetch\('\/api\/prices\/reference',\{method:'POST'/);
  assert.match(ui, /slice\(index,index\+100\)/, 'batches of 100');
  assert.match(ui, /const key=entryKey\(card\)/, 'tile buttons use the physical card id (or the legacy key already stored)');
  assert.match(ui, /function toggleFavorite\(id\)\{[\s\S]*?confirm\(`從「我的收藏」移除/, 'removal asks first (the star, ± and the side panel all go through toggleFavorite)');
  assert.doesNotMatch(ui, /api\.tcgdex\.net/, 'no external price call from the browser');
  for (const field of ['condition', 'finish', 'note']) assert.match(ui, new RegExp(`data-coll-field="${field}"`));
  assert.match(ui, /<label>品況<select/);
  assert.match(ui, /<label>閃卡版本<select/);
  assert.match(ui, /filename=`cardscope-collection-[^`]*\.json`;downloadFile\(filename,/, 'JSON export');
  assert.match(ui, /id="collectionCsv"/, 'CSV export stays');
  assert.match(ui, /type="file" id="collFile" accept="application\/json,\.json,text\/csv,\.csv" hidden/);
});

test('favorites unification: a star becomes quantity 1 once, existing counts stay, nothing is mutated or lost', () => {
  const watchlist = { b: 3, c: 'x' };
  const out = CS.migrateFavorites(new Set(['a', 'b', 'c', 'bad\u0000id']), watchlist);
  assert.deepEqual(out.watchlist, { a: 1, b: 3, c: 1 }, 'starred without a count -> 1; a valid count is kept; an invalid count of a starred card -> 1; an unusable id is skipped');
  assert.equal(out.added, 2);
  assert.deepEqual(watchlist, { b: 3, c: 'x' }, 'the input is not changed');
  assert.deepEqual(CS.migrateFavorites(['a'], out.watchlist).watchlist, out.watchlist, 'running it again changes nothing');
  assert.equal(CS.migrateFavorites([], { z: 2 }).added, 0);
});

test('collected quantity: owning a card is quantity > 0; a star-only item from an old backup counts as 1', () => {
  assert.equal(CS.collectedQuantity(item({ quantity: 4, favorite: true })), 4);
  assert.equal(CS.collectedQuantity(item({ quantity: 0, favorite: true })), 1);
  assert.equal(CS.collectedQuantity(item({ quantity: 0, favorite: false })), 0);
});

test('sole finish: a card with one price version has it as the default version, several or none do not', () => {
  const row = (provider, variant) => ({ provider, variant });
  assert.equal(CS.soleFinish([row('cardmarket', 'holo')]), 'holo');
  assert.equal(CS.soleFinish([row('cardmarket', 'holo'), row('tcgplayer', 'holofoil')]), 'holo', 'Cardmarket holo and TCGplayer holofoil are the same finish');
  assert.equal(CS.soleFinish([row('cardmarket', 'holo'), row('cardmarket', 'reverse')]), '');
  assert.equal(CS.soleFinish([row('cardmarket', 'holo'), row('tcgplayer', '')]), '', 'a blank variant next to a named one is not "one version"');
  assert.equal(CS.soleFinish([]), '');
  assert.equal(CS.soleFinish(undefined), '');
});

test('collection page: the 管理 menu holds backup, import, CSV and series progress; export says what it saved; the status line sits above the wall', () => {
  assert.match(ui, /aria-haspopup="menu" aria-expanded="false" aria-controls="collMenu">管理/);
  assert.match(ui, /role="menu" aria-label="管理我的收藏" hidden>/);
  for (const attr of ['data-coll-export', 'data-coll-import', 'id="collectionCsv"', 'data-coll-series-toggle']) assert.ok(ui.includes(attr), attr);
  assert.ok(ui.indexOf('id="collStatus"') < ui.indexOf('id="collImportHost"'), 'the status line comes before the import preview');
  assert.match(ui, /collectionStatus\(`已匯出 \$\{items\.length\} 款、\$\{collectionTotal\(\)\} 張，備份檔 \$\{filename\}/);
  assert.match(ui, /<label>品況<select data-coll-field="condition">/, 'condition, finish and note are edited in the side panel');
  assert.doesNotMatch(ui, /collectionDialog|collectionUi\.editOpen/, 'the old dialog is gone (cloud sync has its own native dialog)');
});

// ---- 雲端同步合併（Y3）----
const T = n => new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString(); // T(n) = 2026-11-01 00:00:nn
const live = (id, quantity, at, over = {}) => ({ ...item({ id, canonicalId: '', condition: '', finish: '', ...over }), quantity, updatedAt: at });
const tomb = (id, at) => ({ id, deleted: true, updatedAt: at });
const NOW = Date.UTC(2026, 10, 2);

test('mergeSync: two devices add, edit and delete in turn; either merge order gives the same collection', () => {
  const base = [live('x', 1, T(1)), live('z', 2, T(1))];
  const a = [live('x', 3, T(2)), live('z', 2, T(1)), live('a', 1, T(3))];           // A edits x, adds a
  const b = [live('x', 5, T(4)), tomb('z', T(2)), live('b', 4, T(3))];              // B deletes z, edits x later, adds b
  const ab = CS.mergeSync(a, b, NOW), ba = CS.mergeSync(b, a, NOW);
  assert.deepEqual(ab, ba);
  assert.deepEqual(ab.map(e => [e.id, e.deleted ? 'deleted' : e.quantity]), [['a', 1], ['b', 4], ['x', 5], ['z', 'deleted']], 'newest edit wins per card; the deletion is kept as a tombstone; both additions survive');
  assert.deepEqual(CS.mergeSync(ab, base, NOW), ab, 'merging an older copy back in changes nothing');
  assert.deepEqual(CS.mergeSync(ab, ab, NOW), ab, 'idempotent');
  // a delete is undone by a later re-add on the other device
  assert.equal(CS.mergeSync([tomb('z', T(5))], [live('z', 1, T(6))], NOW)[0].quantity, 1);
  assert.equal(CS.mergeSync([live('z', 1, T(6))], [tomb('z', T(5))], NOW)[0].quantity, 1);
  // inputs are not touched
  const frozen = [Object.freeze(live('q', 1, T(1)))];
  assert.doesNotThrow(() => CS.mergeSync(frozen, [tomb('q', T(2))], NOW));
});

test('mergeSync: equal times and missing times are decided the same way in both orders', () => {
  const same = T(7);
  for (const [p, q] of [[live('m', 1, same), tomb('m', same)], [live('m', 1, same), live('m', 2, same)], [live('m', 1), live('m', 2)], [live('m', 1), live('m', 2, T(1))]]) {
    assert.deepEqual(CS.mergeSync([p], [q], NOW), CS.mergeSync([q], [p], NOW));
  }
  assert.equal(CS.mergeSync([live('m', 1, same)], [tomb('m', same)], NOW)[0].deleted, true, 'on a tie the deletion wins');
  assert.equal(CS.mergeSync([live('m', 1)], [live('m', 2, T(1))], NOW)[0].quantity, 2, 'an entry with no updatedAt is the oldest');
  assert.deepEqual(CS.mergeSync(null, undefined, NOW), []);
  assert.deepEqual(CS.mergeSync([null, 5, { id: '' }, { id: '__proto__', updatedAt: same }, live('ok', 1, same)], [], NOW).map(e => e.id), ['ok'], 'rows without a usable id are dropped');
});

test('mergeSync: tombstones older than 30 days are dropped, younger ones are kept', () => {
  const day = 86400000, at = ms => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  const kept = tomb('keep', at(NOW - 29 * day)), old = tomb('old', at(NOW - 31 * day));
  assert.deepEqual(CS.mergeSync([kept, old, live('a', 1, T(1))], [], NOW).map(e => e.id), ['a', 'keep']);
  assert.deepEqual(CS.mergeSync([], [old], NOW), [], 'an old tombstone arriving from the other side is dropped too');
  assert.deepEqual(CS.mergeSync([live('old', 1, at(NOW - 40 * day))], [old], NOW), [], 'the deletion won first, then it expired: the card stays deleted');
  assert.equal(CS.SYNC_TOMBSTONE_DAYS, 30);
  assert.deepEqual(CS.mergeSync([kept], [], new Date(NOW + 2 * day)).map(e => e.id), [], 'now may be a Date');
});

test('normalizeSyncEntry: live items pass the import check, tombstones carry only id, deleted and updatedAt', () => {
  const ok = CS.normalizeSyncEntry({ ...item({ id: 'c1' }), updatedAt: T(1) });
  assert.equal(ok.id, 'c1'); assert.equal(ok.updatedAt, T(1)); assert.equal(ok.quantity, 2);
  assert.deepEqual(CS.normalizeSyncEntry(tomb('c2', T(2))), tomb('c2', T(2)));
  for (const bad of [null, 5, [], {}, item(), { ...item(), updatedAt: 'yesterday' }, { ...item(), updatedAt: '2026-11-01' }, { ...item(), updatedAt: 5 }, { ...item({ quantity: 0, favorite: false }), updatedAt: T(1) },
    { ...item({ quantity: 1000 }), updatedAt: T(1) }, { ...item({ id: '__proto__' }), updatedAt: T(1) }, { ...item({ id: 'a\nb' }), updatedAt: T(1) },
    { ...tomb('x', T(1)), quantity: 1 }, { ...tomb('x', T(1)), note: 'hi' }, { id: 'x', deleted: false, updatedAt: T(1) }, { id: 'x', deleted: 'true', updatedAt: T(1) }, { id: '', deleted: true, updatedAt: T(1) }, { deleted: true, updatedAt: T(1) }, { id: 'x', deleted: true }]) {
    assert.equal(CS.normalizeSyncEntry(bad), null, `rejects ${JSON.stringify(bad)?.slice(0, 60)}`);
  }
  const dirty = CS.normalizeSyncEntry({ ...item({ id: 'c3', note: 'a\nb' }), updatedAt: T(1), extra: 'x' });
  assert.equal(dirty.note, 'a b', 'text is cleaned like an import'); assert.equal('extra' in dirty, false, 'unknown fields are dropped');
});

test('normalizeSyncEntry: legacy {favorite:true, quantity:0} normalizes to {quantity:1, favorite:false}; {favorite:false, quantity:0} is strictly null; unsafe canonicalId is rejected', () => {
  const legacyStar = CS.normalizeSyncEntry({ ...item({ id: 'legacy-star', favorite: true, quantity: 0 }), updatedAt: T(1) });
  assert.ok(legacyStar);
  assert.equal(legacyStar.quantity, 1);
  assert.equal(legacyStar.favorite, false);
  assert.equal(legacyStar.updatedAt, T(1));
  assert.strictEqual(CS.normalizeSyncEntry({ ...item({ id: 'zero', favorite: false, quantity: 0 }), updatedAt: T(1) }), null);
  for (const unsafe of ['__proto__', 'constructor', 'prototype']) {
    assert.strictEqual(CS.normalizeSyncEntry({ ...item({ id: 'ok', canonicalId: unsafe }), updatedAt: T(1) }), null);
  }
});

test('normalizeSyncCode: 26+ characters of 0-9 A-Z, grouping and case ignored, nothing shorter', () => {
  const code = 'K3M9T7Q2XB4V8ZD6N1HW5RPJ0C';
  assert.equal(code.length, 26); assert.equal(CS.normalizeSyncCode(code), code);
  assert.equal(CS.normalizeSyncCode('k3m9-t7q2 xb4v-8zd6 n1hw-5rpj-0c'), code, 'hyphens, spaces and lower case are fine');
  for (const bad of [undefined, null, 5, '', 'ABC', code.slice(1), `${code}!`, `${code}é`, 'A'.repeat(65), 'x'.repeat(300), { toString: () => code }]) assert.equal(CS.normalizeSyncCode(bad), '', `rejects ${String(bad)?.slice(0, 20)}`);
});

test('generateSyncCode: 28 random 0-9 A-Z characters from crypto.getRandomValues, no modulo bias, and formatSyncCode groups by four', () => {
  const codes = new Set();
  for (let i = 0; i < 50; i++) { const code = CS.generateSyncCode({ getRandomValues: array => globalThis.crypto.getRandomValues(array) }); assert.match(code, /^[0-9A-Z]{28}$/); assert.equal(CS.normalizeSyncCode(code), code, 'the generated code passes the server rule'); codes.add(code); }
  assert.equal(codes.size, 50);
  // Bytes 252-255 would favour the first four characters if reduced modulo 36, so they are skipped: a source that starts with them still yields a full code.
  const bytes = [255, 254, 253, 252, ...Array.from({ length: 36 }, (_, i) => i)];
  let calls = 0;
  const code = CS.generateSyncCode({ getRandomValues: array => { calls++; array.fill(0); if (calls === 1) bytes.forEach((byte, i) => { array[i] = byte; }); else array.fill(35); return array; } });
  assert.equal(code.length, 28); assert.ok(code.startsWith('0123456789ABCDEFGHIJKLMNOPQRSTUV'.slice(0, 28)), 'skipped bytes never become characters');
  assert.equal(CS.formatSyncCode('k3m9t7q2xb4v8zd6n1hw5rpj0c'), 'K3M9-T7Q2-XB4V-8ZD6-N1HW-5RPJ-0C');
  assert.equal(CS.formatSyncCode(code), code.replace(/(.{4})(?=.)/g, '$1-'));
  assert.equal(CS.formatSyncCode('nope'), '');
  assert.equal(CS.normalizeSyncCode(CS.formatSyncCode(code)), code, 'what is shown can be typed back in');
});
