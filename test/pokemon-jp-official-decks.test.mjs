import test from 'node:test';
import assert from 'node:assert/strict';
import { groupOfficialJpDecks, parseOfficialJpProducts } from '../providers/pokemon-jp-official-decks.mjs';
import { buildOfficialJpSeriesPlans } from '../providers/pokemon-jp-official-series-plan.mjs';

const page = (cardId, number, nameJa) => ({ cardId, setMark: 'SA', number, nameJa, rarityIcon: null, total: '023', list: 'SA', fetchedAt: '2026-10-08T00:00:00Z' });

test('収録商品：只取 SubSection 內的商品連結並保留官方原字串', () => {
  const html = '<a href="/x" class="Link Link-arrow">導覽</a><section class="SubSection"><ul class="List"><li class="List_item">'
    + '<a href="/ex/sa/" class="Link Link-arrow">スターターセットV　草</a></li><li><a href="/ex/sb/" class="Link Link-arrow">A &amp; B</a></li></ul></section>';
  assert.deepEqual(parseOfficialJpProducts(html), [{ name: 'スターターセットV　草', path: '/ex/sa/' }, { name: 'A & B', path: '/ex/sb/' }]);
  assert.deepEqual(parseOfficialJpProducts('<section class="SubSection"></section>'), []);
});

test('分盒：依最小官方卡片 ID 排序，第 1 盒沿用原代碼，其餘為 <代碼>-<k>', () => {
  const pages = [page('20', '001', 'ロコン'), page('10', '001', 'セレビィV'), page('11', '002', 'ロゼリア'), page('21', '002', 'キュウコン'), page('12', null, '基本草エネルギー')];
  const cache = { lists: { SA: { hitCount: 5, cardIds: pages.map(p => p.cardId) } }, details: Object.fromEntries(pages.map(p => [p.cardId, p])) };
  const products = { cards: { 10: { products: [{ name: '草', path: '/ex/sa/' }] }, 11: { products: [{ name: '草', path: '/ex/sa/' }] }, 12: { products: [{ name: '草', path: '/ex/sa/' }] },
    20: { products: [{ name: '炎', path: '/ex/sa/' }] }, 21: { products: [{ name: '炎', path: '/ex/sa/' }] } } };
  const decks = groupOfficialJpDecks({ code: 'SA', cache, products });
  assert.deepEqual(decks.map(d => [d.deckCode, d.productName, d.cardIds]), [['SA', '草', ['10', '11', '12']], ['SA-2', '炎', ['20', '21']]]);

  const deckCache = { lists: { 'SA-2': { hitCount: 2, cardIds: decks[1].cardIds } }, details: cache.details };
  const { plans } = buildOfficialJpSeriesPlans({ code: 'SA-2', seriesMeta: { name_ja: '炎' }, cache: deckCache, printedSetMark: 'SA' });
  assert.deepEqual(plans[0].cards.map(c => c.id), ['pokemon-official-ja-sa-2-001', 'pokemon-official-ja-sa-2-002']);
  assert.equal(plans[0].cards[0].metadata.printedSetMark, 'SA');
  assert.match(plans[0].cards[0].search_text, / SA-001$/);
});

test('分盒：商品不唯一、只有一盒或盒內重號都停止，不猜', () => {
  const pages = [page('10', '001', 'A'), page('20', '001', 'B')];
  const cache = { lists: { SA: { cardIds: ['10', '20'] } }, details: Object.fromEntries(pages.map(p => [p.cardId, p])) };
  const one = name => ({ products: [{ name, path: '/p' }] });
  assert.throws(() => groupOfficialJpDecks({ code: 'SA', cache, products: { cards: { 10: one('X') } } }), /OFFICIAL_PRODUCTS_MISSING:SA:20/);
  assert.throws(() => groupOfficialJpDecks({ code: 'SA', cache, products: { cards: { 10: one('X'), 20: { products: [] } } } }), /OFFICIAL_PRODUCTS_NOT_SINGLE/);
  assert.throws(() => groupOfficialJpDecks({ code: 'SA', cache, products: { cards: { 10: one('X'), 20: one('X') } } }), /NOT_MULTI_DECK/);
  const three = { ...cache, lists: { SA: { cardIds: ['10', '20', '30'] } }, details: { ...cache.details, 30: page('30', '001', 'C') } };
  assert.throws(() => groupOfficialJpDecks({ code: 'SA', cache: three, products: { cards: { 10: one('X'), 20: one('Y'), 30: one('Y') } } }), /DECK_NUMBER_REPEATED:SA:Y/);
});
