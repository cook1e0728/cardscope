import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUaSeries, parseUaCards, parseUaBoosters, boosterDate, buildUaRows, collectUa, UA_RARITIES } from '../scripts/import-union-arena.mjs';

const INDEX = `<select name="series" id="series"><option value="">商品</option>
<option value="570101">コードギアス 反逆のルルーシュ 【UA01BT】</option>
<option value="570702">NEW CARD SELECTION 呪術廻戦</option></select><select name="other"><option value="9">x</option></select>`;
const li = (key, alt) => `<li class="cardImgCol"><a class="modalCardDataOpen" href="./detail_iframe.php?card_no=${key}"><img class="lazy" src="/d.gif" data-src="/jp/images/cardlist/card/${key.replace('/', '_')}.png?v9" alt="${alt}"></a></li>`;
const LIST = li('UA01BT/CGH-1-004', 'UA01BT/CGH-1-004 紅月 カレン') + li('UA01BT/CGH-1-004_p1', 'UA01BT/CGH-1-004 紅月 カレン') + li('UA01BT/CGH-1-005', 'UA01BT/CGH-1-005 C.C.');

test('parses the product menu, card list and parallel suffixes', () => {
  assert.deepEqual(parseUaSeries(INDEX), [{ value: '570101', label: 'コードギアス 反逆のルルーシュ 【UA01BT】', code: 'UA01BT' }, { value: '570702', label: 'NEW CARD SELECTION 呪術廻戦', code: null }]);
  const cards = parseUaCards(LIST);
  assert.equal(cards.length, 3);
  assert.deepEqual(cards[1], { key: 'UA01BT/CGH-1-004_p1', number: 'UA01BT/CGH-1-004', parallel: 1, name: '紅月 カレン', image: 'https://www.unionarena-tcg.com/jp/images/cardlist/card/UA01BT_CGH-1-004_p1.png?v9' });
});

test('builds rows: parallels are their own card with a -p1 id and the same canonical id; a reprint stays with its first product', () => {
  const cards = parseUaCards(LIST);
  const rows = buildUaRows({ series: parseUaSeries(INDEX), cardsBySeries: { 570101: cards, 570702: [cards[2]] }, rarityByKey: { 'UA01BT/CGH-1-004': 'SR', 'UA01BT/CGH-1-004_p1': 'SR★' } });
  assert.deepEqual(rows.series.map(s => [s.id, s.official_code, s.name_ja]), [['union-arena-ua01bt', 'UA01BT', 'コードギアス 反逆のルルーシュ'], ['union-arena-570702', '570702', 'NEW CARD SELECTION 呪術廻戦']]);
  assert.deepEqual(rows.cards.map(c => [c.id, c.canonical_id, c.rarity, c.series_id]), [
    ['union-arena-ua01bt-cgh-1-004', 'union-arena-ua01bt-cgh-1-004', 'SR', 'union-arena-ua01bt'],
    ['union-arena-ua01bt-cgh-1-004-p1', 'union-arena-ua01bt-cgh-1-004', 'SR★', 'union-arena-ua01bt'],
    ['union-arena-ua01bt-cgh-1-005', 'union-arena-ua01bt-cgh-1-005', null, 'union-arena-ua01bt']]);
  assert.deepEqual(rows.missingRarity, ['UA01BT/CGH-1-005']);
  assert.equal(rows.printings.length, 3);
  assert.equal(rows.printings[1].provider_id, 'UA01BT/CGH-1-004_p1');
  assert.equal(rows.printings[1].local_set_code, 'UA01BT');
});

test('collect asks for every product and every rarity, one request at a time', async () => {
  const asked = [];
  const many = INDEX.replace('</select>', Array.from({ length: 100 }, (_, i) => `<option value="58${String(i).padStart(4, '0')}">X 【UA${i}BT】</option>`).join('') + '</select>');
  const fetchText = async (url, body) => { asked.push(body ?? url); if (url.includes('detail_iframe.php?card_no=UA01BT%2FCGH-1-004_p1')) return '<span class="rareData">SR★★★</span>'; return body === 'rare%5B%5D=SR' || body === 'series=570101' || body === 'series=570101&rare%5B%5D=R' ? LIST : url.endsWith('/cardlist/') ? many : ''; };
  const raw = await collectUa({ fetchText, delay: 0 });
  assert.equal(raw.series.length, 102);
  // SR answers site-wide; every other rarity comes back empty and is retried for the one product that has cards.
  // …then one detail page per parallel card (the star count) and the products page (release dates).
  assert.equal(asked.length, 1 + 102 + UA_RARITIES.length + (UA_RARITIES.length - 1) + 2);
  assert.equal(raw.rarityByKey['UA01BT/CGH-1-005'], 'SR|R', 'a card listed under two rarities keeps both, for the plan check');
  assert.equal(raw.cardsBySeries['570101'].length, 3);
  assert.equal(raw.rarityLabelByKey['UA01BT/CGH-1-004_p1'], 'SR★★★', 'the parallel takes its starred rarity from the detail page');
});

test('booster release dates match the products page by name; precious boosters only match PC products', () => {
  const html = ['ブースターパック <br>コードギアス 反逆のルルーシュ Vol.2', 'プレシャスブースターパック <br>勝利の女神：NIKKE', 'ブースターパック <br>勝利の女神：NIKKE'].map((title, i) =>
    `<li class="productsDetail"><a href="./boosters/x${i}.php"><dt class="productsTit"><span class="js_productsTit">${title}</span></dt><dd class="productsDate"><span class="productsHeadTit">発売日</span><br>202${i}.03.2${i}</dd></a></li>`).join('');
  const boosters = parseUaBoosters(html);
  assert.deepEqual(boosters.map(b => [b.name, b.date, b.precious]), [['コードギアス 反逆のルルーシュ Vol.2', '2020-03-20', false], ['勝利の女神：NIKKE', '2021-03-21', true], ['勝利の女神：NIKKE', '2022-03-22', false]]);
  assert.equal(boosterDate({ code: 'EX02BT', label: 'コードギアス 反逆のルルーシュ Vol.2 【EX02BT】' }, boosters), '2020-03-20');
  assert.equal(boosterDate({ code: 'PC02BT', label: '勝利の女神：NIKKE【PC02BT】' }, boosters), '2021-03-21');
  assert.equal(boosterDate({ code: 'UA18BT', label: '勝利の女神：NIKKE 【UA18BT】' }, boosters), '2022-03-22');
  assert.equal(boosterDate({ code: 'UA18ST', label: '勝利の女神：NIKKE 【UA18ST】' }, boosters), null, 'start decks get no date');
});

test('a rerun resumes from saved progress', async () => {
  const cards = parseUaCards(LIST), series = parseUaSeries(INDEX);
  const progress = { series: Array.from({ length: 100 }, (_, i) => ({ value: String(i), label: 'x', code: null })).concat(series), cardsBySeries: { 570101: cards, 570702: [] }, rarityByKey: {}, raritiesDone: [...UA_RARITIES], rarityLabelByKey: {} };
  for (let i = 0; i < 100; i++) progress.cardsBySeries[String(i)] = [];
  const asked = [], saved = [];
  const fetchText = async url => { asked.push(url); return url.includes('detail_iframe') ? '<span class="rareData">SR★</span>' : ''; };
  const raw = await collectUa({ fetchText, delay: 0, progress, save: value => saved.push(Object.keys(value.rarityLabelByKey).length) });
  assert.deepEqual(asked.map(url => url.replace(/\?.*/, '').split('/').at(-1)), ['detail_iframe.php', ''], 'only the missing parallel and the products page');
  assert.equal(raw.rarityLabelByKey['UA01BT/CGH-1-004_p1'], 'SR★');
  assert.ok(saved.length >= 2);
});

test('action point cards get an AP group; a starred AP card is its own id; duplicate ids stop the build', () => {
  const ap = (key, name = 'アクションポイントカード') => ({ key, number: key, parallel: 0, name, image: 'https://x/i.png' });
  const series = [{ value: '570115', label: 'ソードアート・オンライン 【UA15BT】', code: 'UA15BT' }];
  const rows = buildUaRows({ series, cardsBySeries: { 570115: [ap('UA15BT/SAO-1-AP01'), ap('UA15BT/SAO-1-AP01★'), ap('UAPR/IMS_AP04')] }, rarityByKey: {} });
  assert.deepEqual(rows.cards.map(c => [c.id, c.rarity]), [['union-arena-ua15bt-sao-1-ap01', 'AP'], ['union-arena-ua15bt-sao-1-ap01-star', 'AP★'], ['union-arena-uapr-ims-ap04', 'AP']]);
  assert.deepEqual(rows.missingRarity, []);
  assert.throws(() => buildUaRows({ series, cardsBySeries: { 570115: [ap('UA15BT/SAO-1-AP01'), ap('UA15BT/SAO 1 AP01')] }, rarityByKey: {} }), /UA_DUPLICATE_ID/);
});

test('a card name with unescaped quotes is read whole', () => {
  assert.equal(parseUaCards(li('UA12BT/BLK-1-029', 'UA12BT/BLK-1-029 "潰す"一択だ'))[0].name, '"潰す"一択だ');
});
