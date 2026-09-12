import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PORT = '0';
process.env.CATALOG_SYNC_ON_START = 'false';
const { buildBrowsePage, rarityCanonicalCode, rarityDisplayLabel, server } = await import('../server.mjs?rarity-normalization-contract');

test.after(async () => {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

const printingByCard = new Map();
const rows = [
  { id: 'op-en', canonicalId: 'op-001', game: 'onepiece', officialCardNumber: 'OP01-001', rarity: 'SP CARD' },
  { id: 'op-tw', canonicalId: 'op-001', game: 'onepiece', officialCardNumber: 'OP01-001-TW', rarity: 'SP卡' },
  { id: 'op-special', canonicalId: 'op-002', game: 'onepiece', officialCardNumber: 'OP02-001', rarity: 'Special Card' },
  { id: 'op-sec', canonicalId: 'op-003', game: 'onepiece', officialCardNumber: 'OP03-001', rarity: 'SEC' },
  { id: 'op-unknown-a', canonicalId: 'op-004', game: 'onepiece', officialCardNumber: 'OP04-001', rarity: 'Mystery A' },
  { id: 'op-unknown-b', canonicalId: 'op-005', game: 'onepiece', officialCardNumber: 'OP05-001', rarity: 'Mystery B' }
];

test('ONE PIECE rarity aliases resolve to one canonical SP code and label', () => {
  for (const value of ['SP', 'SP CARD', 'SP卡', 'Special Card']) assert.equal(rarityCanonicalCode('onepiece', value), 'SP');
  assert.equal(rarityDisplayLabel('onepiece', 'SP CARD'), 'SP 卡');
});

test('facets deduplicate canonical cards and keep all rarity choices after SP is selected', () => {
  const all = buildBrowsePage(rows, { limit: 100, printingByCard });
  assert.deepEqual(all.facets.rarity, { SP: 2, SEC: 1, 'Mystery A': 1, 'Mystery B': 1 });
  assert.equal(all.facets.rarityLabels.SP, 'SP 卡');

  const selected = buildBrowsePage(rows, { rarity: 'SP', limit: 100, printingByCard });
  assert.equal(selected.total, 3);
  assert.deepEqual(selected.data.map(card => card.id), ['op-en', 'op-tw', 'op-special']);
  assert.deepEqual(selected.facets.rarity, all.facets.rarity);
  assert.equal('SP CARD' in selected.facets.rarity, false);
  assert.equal('SP卡' in selected.facets.rarity, false);
  assert.equal('Special Card' in selected.facets.rarity, false);
});

test('unknown rarity labels remain separate and known rarity sorting stays configured', () => {
  const page = buildBrowsePage(rows, { rarity: 'SP', sort: 'rarity-desc', limit: 100, printingByCard });
  assert.equal(page.data[0].rarity, 'SP CARD');
  assert.equal(page.data.at(-1).rarity, 'Special Card');
  assert.equal(Object.keys(page.facets.rarity).filter(value => value.startsWith('Mystery')).length, 2);
});

test('punctuation-bearing canonical codes remain distinct for future IP configurations', () => {
  const weissRows = [
    { id: 'ws-sec-plus', canonicalId: 'ws-sec-plus', game: 'weiss-schwarz', rarity: 'SEC+' },
    { id: 'ws-sec', canonicalId: 'ws-sec', game: 'weiss-schwarz', rarity: 'SEC' }
  ];
  const page = buildBrowsePage(weissRows, { rarity: 'SEC+', limit: 100, printingByCard: new Map() });
  assert.deepEqual(page.data.map(card => card.id), ['ws-sec-plus']);
  assert.deepEqual(page.facets.rarity, { 'SEC+': 1, SEC: 1 });
});

test('sorting peers are not merged unless explicitly declared as aliases', () => {
  assert.equal(rarityCanonicalCode('pokemon', 'Amazing Rare'), 'Amazing Rare');
  assert.equal(rarityCanonicalCode('yugioh', 'Platinum Secret Rare'), 'Platinum Secret Rare');
  assert.equal(rarityCanonicalCode('yugioh', 'Gold Secret Rare'), 'Gold Secret Rare');
});
