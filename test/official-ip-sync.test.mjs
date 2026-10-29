import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectDragonballFw, fwCatalogRows, fwFillPatches, haikyuuCardRows, parseFwCards, parseFwCategories, parseFwProducts, parseFwRarities, syncDragonballFw, syncHaikyuu, syncWeissFrieren, weissCardRows, weissSetCode } from '../providers/official-ip-sync.mjs';

const haikyuuItem = (ID, card_no, name, extra = {}) => ({ ID: String(ID), card_no, name, name_ruby: 'ひなた しょうよう', product_type: card_no.split('-').slice(0, 2).join('-'), vobarity: 'P', image_end: 'P', category: 'CHARACTER', position: 'MB', affiliation: '烏野·1年', ...extra });

test('排球少年：欄位與首次匯入的資料相同（ID、作品層、圖片網址）', () => {
  const { card, printing } = haikyuuCardRows(haikyuuItem(1045, 'HV-PR-074', '日向 翔陽'), 'PR／特典卡');
  assert.equal(card.id, 'haikyuu-1045');
  assert.equal(card.canonical_id, 'haikyuu-hv-pr-hv-pr-074');
  assert.equal(card.series_id, 'haikyuu-hv-pr');
  assert.deepEqual(card.aliases, ['日向 翔陽', 'ひなた しょうよう', 'HV-PR', 'PR／特典卡']);
  assert.equal(card.search_text, '日向 翔陽 ひなた しょうよう HV-PR-074 HV-PR PR／特典卡');
  assert.equal(printing.image_url, 'https://www.takaratomy.co.jp/products/haikyuvobacabreak/cardlist/card/HV-PR-074-P.webp');
  assert.equal(printing.provider_id, '1045');
});

test('芙莉蓮：卡號決定系列代碼，試玩牌組為 -TD', () => {
  assert.equal(weissSetCode('SFN/S108-001'), 'S108');
  assert.equal(weissSetCode('SFN/S108-T01'), 'S108-TD');
  assert.equal(weissSetCode('SFN/S136-001S'), 'S136');
  const { card, printing } = weissCardRows({ id: 53208, card_number: 'SFN/S108-001', card_name: '大切な記憶 ヒンメル', card_name_kana: 'タイセツナキオク ヒンメル', rare: 'RR', cost: '0', card_kind: '2', color: '[[yellow.gif]]', level: '0', power: '2000', picture: 's/sfn_s108/sfn_s108_001.png' });
  assert.equal(card.id, 'weiss-53208');
  assert.equal(card.canonical_id, 'weiss-sfn/s108-001');
  assert.equal(card.series_id, 'weiss-frieren-s108');
  assert.equal(printing.image_url, 'https://ws-tcg.com/wordpress/wp-content/images/cardlist/s/sfn_s108/sfn_s108_001.png');
  assert.equal(printing.source_url, 'https://ws-tcg.com/cardlist/cardsearch/?cardno=SFN%2FS108-001');
});

function mockDb(stored) {
  const posts = [], runs = [], patches = [];
  const db = async (path, options = {}) => {
    if (path.startsWith('/catalog_sync_runs')) { runs.push({ path, method: options.method, body: options.body && JSON.parse(options.body) }); return options.method === 'POST' ? [{ id: 1 }] : null; }
    if (options.method === 'PATCH') { patches.push({ path, body: JSON.parse(options.body) }); return null; }
    if (options.method === 'POST') { posts.push({ path, prefer: options.headers?.Prefer, rows: JSON.parse(options.body) }); return null; }
    const table = path.split('?')[0], offset = Number(new URL(`http://x${path}`).searchParams.get('offset') || 0);
    return offset ? [] : (stored[table] || []);
  };
  return { db, posts, runs, patches };
}

test('排球少年同步只新增資料庫沒有的卡，既有卡不寫入，官方值不同只回報', async () => {
  const items = [haikyuuItem(1, 'HV-P01-001', '日向 翔陽', { vobarity: '秘' }), haikyuuItem(1045, 'HV-PR-074', '日向 翔陽')];
  const fetchJson = async url => url.includes('master.php') ? { series: [{ id: '1', product_type: 'HV-P01', product_name: 'ブースターパック' }, { id: '6', product_type: 'HV-PR', product_name: 'プロモカード' }] } : { items, count: 2 };
  const { db, posts, runs } = mockDb({
    '/tcg_series': [{ id: 'haikyuu-hv-p01', name_zh: '補充包 垃圾場的決戰' }, { id: 'haikyuu-hv-pr', name_zh: 'PR／特典卡' }],
    '/tcg_cards': [{ id: 'haikyuu-1', official_card_number: 'HV-P01-001', name_ja: '日向 翔陽', rarity: '頂' }],
    '/tcg_printings': [{ id: 9, provider_id: '1' }]
  });
  const stats = await syncHaikyuu(db, { fetchJson, delay: 0 });
  assert.deepEqual(posts.map(p => [p.path.split('?')[0], p.rows.map(r => r.id || r.provider_id)]), [['/tcg_cards', ['haikyuu-1045']], ['/tcg_printings', ['1045']]]);
  assert.ok(posts.every(p => p.prefer.includes('resolution=ignore-duplicates')));
  assert.deepEqual(stats.metadata.differences, [{ id: 'haikyuu-1', field: 'rarity', stored: '頂', official: '秘' }]);
  assert.equal(runs.at(-1).body.status, 'completed');
});

test('官方總數與實際取得張數不同時停止，不寫入', async () => {
  const fetchJson = async url => url.includes('master.php') ? { series: [] } : { items: [haikyuuItem(1, 'HV-P01-001', 'A')], count: 21 };
  const { db, posts, runs } = mockDb({});
  await assert.rejects(syncHaikyuu(db, { fetchJson, delay: 0 }), /HAIKYUU_COUNT_MISMATCH|HAIKYUU_ITEMS_MISSING/);
  assert.equal(posts.length, 0);
  assert.equal(runs.at(-1).body.status, 'failed');
});

test('芙莉蓮同步只讀作品編號 147 的擴充包，新系列與新卡只新增', async () => {
  const fetchJson = async url => {
    if (url.endsWith('/filter-options')) return { expansions: [{ id: 563, name: '葬送のフリーレン Vol.2', title_name: '147' }, { id: 1, name: 'D.C.', title_name: '1' }] };
    assert.match(url, /expansion=563/);
    return { items: [{ id: 70000, card_number: 'SFN/S136-001', card_name: 'フリーレン', rare: 'RR', picture: 's/x.png' }], total: 1, page_count: 1 };
  };
  const { db, posts } = mockDb({ '/tcg_series': [], '/tcg_cards': [], '/tcg_printings': [] });
  const stats = await syncWeissFrieren(db, { fetchJson, delay: 0 });
  assert.deepEqual(posts.map(p => p.path.split('?')[0]), ['/tcg_series', '/tcg_cards', '/tcg_printings']);
  assert.equal(posts[0].rows[0].id, 'weiss-frieren-s136');
  assert.deepEqual(stats.metadata.perExpansion, { 563: 1 });
});

// ---- 七龍珠超 Fusion World ----

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const fwLi = (no, variant, name) => `<li class="cardItem"><a href="javascript:void(0);" data-src="detail.php?card_no=${no}${variant ? `&p=${variant}` : ''}" class="cardStr"><img class="lazy" src="../../images/cards/card/noimage.webp" data-src="../../images/cards/card/jp/${no}${variant}.webp" alt="${no} ${name}"></a></li>`;
const fwPage = items => `<ul>${items.map(([no, variant, name]) => fwLi(no, variant || '', name)).join('\n')}</ul>`;

test('七龍珠超：收錄彈選項取出系列代碼，推廣卡沒有代碼用 PR，稀有度取自篩選選項', async () => {
  const root = await fixture('fw-cardlist-root.html');
  assert.deepEqual(parseFwCategories(root), [
    { id: '596011', code: 'FB11', name: '補充包 BRIGHTNESS OF HOPE' },
    { id: '596201', code: 'SB01', name: 'MANGA BOOSTER 01' },
    { id: '596108', code: 'FS08', name: '起始牌組 -達爾(迷你) 超級賽亞人3-' },
    { id: '596901', code: 'PR', name: '推廣卡' }
  ]);
  assert.deepEqual(parseFwRarities(root), ['L', 'C', 'PR']);
});

test('七龍珠超：卡表頁解出卡號、版本、繁中名稱與絕對圖片網址（領袖卡取正面）', async () => {
  const cards = parseFwCards(await fixture('fw-cardlist-fb11.html'));
  assert.deepEqual(cards.map(c => [c.cardNo, c.variant, c.name]), [['FB11-001', '', '孫悟空'], ['FB11-001', '_p1', '孫悟空'], ['FB11-002', '', '賽亞超人'], ['FB09-071', '', '神龍の"オマケ"']]);
  assert.equal(cards[1].image, 'https://www.dbs-cardgame.com/fw/images/cards/card/jp/FB11-001_f_p1.webp');
  assert.deepEqual(parseFwCards('<li class="cardItem"><a data-src="detail.php?card_no=FB11-003&amp;p=_p2"><img data-src="../../images/cards/card/jp/FB11-003_p2.webp" alt="FB11-003 A"></a></li>').map(c => [c.cardNo, c.variant]), [['FB11-003', '_p2']]);
});

const fwSources = () => ({
  categories: [{ id: '1', code: 'FB01', name: '補充包 覺醒的心跳' }, { id: '2', code: 'SB01', name: 'MANGA BOOSTER 01' }, { id: '9', code: 'PR', name: '推廣卡' }],
  jaCategories: [{ id: '5', code: 'FB01', name: 'ブースターパック　覚醒の鼓動' }],
  categoryCards: new Map([
    ['1', parseFwCards(fwPage([['FB01-001', '', '孫悟空'], ['FB01-001', '_p1', '孫悟空']]))],
    ['2', parseFwCards(fwPage([['FB01-005', '', '龜仙人'], ['E-42', '', '能量標記'], ['E01-01', '', '能量標記']]))],
    ['9', parseFwCards(fwPage([['FP-001', '', '孫悟空'], ['FB01-005', '_p1', '龜仙人']]))]
  ]),
  rarityByKey: new Map([['FB01-001', 'L'], ['FB01-001_p1', 'SCR'], ['FB01-005', 'C'], ['FB01-005_p1', 'PR'], ['FP-001', 'PR']]),
  jaNameByNo: new Map([['FB01-001', '孫悟空'], ['FB01-005', '亀仙人'], ['FP-001', '孫悟空']])
});

test('七龍珠超：平行版和航海王一樣各自一張卡（-p1），canonical 指回基本卡；版本掛在列出它的收錄彈', () => {
  const { series, cards, printings } = fwCatalogRows(fwSources());
  assert.deepEqual(series.map(s => [s.id, s.official_code, s.name_ja]), [['dragonball-fw-fb01', 'FB01', 'ブースターパック　覚醒の鼓動'], ['dragonball-fw-sb01', 'SB01', null], ['dragonball-fw-pr', 'PR', null]]);
  assert.ok(series.every(s => s.game_id === 'dragonball-fw' && s.region === 'TW' && s.source === 'dbs-fw-official'));
  assert.deepEqual(cards.map(c => [c.id, c.series_id, c.rarity, c.name_ja]), [
    ['dragonball-fw-fb01-001', 'dragonball-fw-fb01', 'L', '孫悟空'],
    ['dragonball-fw-fb01-001-p1', 'dragonball-fw-fb01', 'SCR', '孫悟空'],
    ['dragonball-fw-fb01-005', 'dragonball-fw-fb01', 'C', '亀仙人'],
    ['dragonball-fw-e-42', 'dragonball-fw-sb01', '能量標記', null],
    ['dragonball-fw-e01-01', 'dragonball-fw-sb01', '能量標記', null],
    ['dragonball-fw-fp-001', 'dragonball-fw-pr', 'PR', '孫悟空'],
    ['dragonball-fw-fb01-005-p1', 'dragonball-fw-fb01', 'PR', '亀仙人']
  ]);
  assert.equal(cards.find(c => c.id === 'dragonball-fw-fb01-001-p1').canonical_id, 'dragonball-fw-fb01-001');
  const keys = printings.map(p => [p.card_id, p.region, p.language, p.local_set_code, p.local_card_number].join('|'));
  assert.equal(new Set(keys).size, keys.length, '版本唯一鍵不重複');
  assert.deepEqual(printings.map(p => [p.provider_id, p.series_id, p.rarity]), [
    ['FB01-001', 'dragonball-fw-fb01', 'L'], ['FB01-001_p1', 'dragonball-fw-fb01', 'SCR'], ['FB01-005', 'dragonball-fw-sb01', 'C'], ['E-42', 'dragonball-fw-sb01', '能量標記'], ['E01-01', 'dragonball-fw-sb01', '能量標記'],
    ['FP-001', 'dragonball-fw-pr', 'PR'], ['FB01-005_p1', 'dragonball-fw-pr', 'PR']
  ]);
  const promoVariant = printings.find(p => p.provider_id === 'FB01-005_p1');
  assert.equal(promoVariant.card_id, 'dragonball-fw-fb01-005-p1');
  assert.equal(promoVariant.local_set_code, 'PR');
  assert.equal(promoVariant.source_url, 'https://www.dbs-cardgame.com/fw/asia-tc/cardlist/detail.php?card_no=FB01-005&p=_p1');
  assert.equal(promoVariant.image_url, 'https://www.dbs-cardgame.com/fw/images/cards/card/jp/FB01-005_p1.webp');
  assert.equal(promoVariant.region, 'TW');
  assert.equal(promoVariant.image_rehost_required, false);
});

const fwProducts = `<ul class="prpductList"><li class="prpductListItem cardCol"><a href="https://www.dbs-cardgame.com/fw/asia-tc/products/01_422.html" class="cardLink"><div class="cardThumb"><img class="lazy" src="/fw/images/products/item/noimage2.webp" data-src="/fw/bccard/asia-tc/news/2026/07/13/x/FB11_jp.png" alt=""></div><div class="cardDetail"><h3 class="cardText">補充包 BRIGHTNESS OF HOPE [FB11]</h3><div class="cardInfo"><dl class="cardInfoBox"><dt class="cardInfoTit">發售日期</dt><dd class="cardInfoTxt">2026.9.12</dd></dl></div></div></a></li>
<li class="prpductListItem cardCol"><a href="#" class="cardLink"><div class="cardThumb"><img class="lazy" data-src="/fw/x/sleeve.png" alt=""></div><div class="cardDetail"><h3 class="cardText">官方卡套01</h3><div class="cardInfo"><dl class="cardInfoBox"><dt class="cardInfoTit">發售日期</dt><dd class="cardInfoTxt">2024.02.16</dd></dl></div></div></a></li></ul>`;

test('七龍珠超：商品頁只取帶系列代碼的商品，補發售日與包裝圖', () => {
  assert.deepEqual(parseFwProducts(fwProducts), [{ code: 'FB11', name: '補充包 BRIGHTNESS OF HOPE [FB11]', releaseDate: '2026-09-12', image: 'https://www.dbs-cardgame.com/fw/bccard/asia-tc/news/2026/07/13/x/FB11_jp.png' }]);
});

function fwFetch({ emptyCategory = null, energy = false } = {}) {
  const seen = [];
  const fetchText = async url => {
    seen.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith('/products/')) return u.searchParams.get('page') === '1' ? fwProducts : '<ul class="prpductList"></ul>';
    if (!u.searchParams.has('category[0]') && !u.searchParams.has('rarity[0]')) return fixture('fw-cardlist-root.html');
    if (u.searchParams.has('category[0]')) {
      const id = u.searchParams.get('category[0]'), jp = u.pathname.includes('/fw/jp/');
      return id === emptyCategory ? '<ul></ul>' : fwPage([[`FB11-${id.slice(-3)}`, '', jp ? '日文類別名' : '孫悟空'], ...(energy && id.endsWith('901') ? [['E-42', '', jp ? 'エナジーマーカー' : '能量標記']] : [])]);
    }
    return fwPage(u.searchParams.get('rarity[0]') === 'L' ? ['011', '201', '108', '901'].map(n => ['FB11-' + n, '', '孫悟空']) : [['FB11-011', '_p1', '孫悟空']]);
  };
  return { fetchText, seen };
}

test('七龍珠超同步：只新增資料庫沒有的列，紀錄為 dbs-fw-official，請求只打官方卡表', async () => {
  const { fetchText, seen } = fwFetch();
  const { db, posts, runs } = mockDb({ '/tcg_series': [{ id: 'dragonball-fw-fb11' }], '/tcg_cards': [], '/tcg_printings': [] });
  const stats = await syncDragonballFw(db, { fetchText, delay: 0 });
  assert.deepEqual(posts.map(p => p.path.split('?')[0]), ['/tcg_series', '/tcg_cards', '/tcg_printings']);
  assert.ok(!posts[0].rows.some(r => r.id === 'dragonball-fw-fb11'), '已存在的系列不再寫入');
  assert.ok(posts.every(p => p.prefer.includes('resolution=ignore-duplicates')));
  assert.equal(runs[0].body[0].provider, 'dbs-fw-official');
  assert.equal(runs.at(-1).body.status, 'completed');
  assert.equal(stats.metadata.cards, 4);
  assert.equal(stats.metadata.officialCount, 4);
  assert.ok(seen.every(url => /^https:\/\/www\.dbs-cardgame\.com\/fw\/(asia-tc|jp)\/cardlist\/|^https:\/\/www\.dbs-cardgame\.com\/fw\/asia-tc\/products\//.test(url)));
  assert.equal(seen.length, 1 + 1 + 4 + 3 * 2 + 4 + 2, '根頁、日文根頁、4 個收錄彈、3 個稀有度各查中日文、4 個日文收錄彈、商品頁 2 頁（第 2 頁沒有新商品就停）');
});

test('七龍珠超同步：某個收錄彈解析不到卡時停止並記為失敗，不寫入', async () => {
  const { fetchText } = fwFetch({ emptyCategory: '596201' });
  const { db, posts, runs } = mockDb({});
  await assert.rejects(syncDragonballFw(db, { fetchText, delay: 0 }), /FW_CATEGORY_EMPTY:596201/);
  assert.equal(posts.length, 0);
  assert.equal(runs.at(-1).body.status, 'failed');
});

test('七龍珠超：沒有稀有度的卡（能量標記）用日文收錄彈卡表補日文名，稀有度頁已有的日文名不被覆蓋；日文收錄彈依系列代碼對應', async () => {
  const { fetchText, seen } = fwFetch({ energy: true });
  const rows = await collectDragonballFw({ fetchText, delay: 0 });
  const energy = rows.cards.find(c => c.official_card_number === 'E-42');
  assert.deepEqual([energy.rarity, energy.name_ja, energy.aliases, energy.search_text], ['能量標記', 'エナジーマーカー', ['能量標記', 'エナジーマーカー'], '能量標記 エナジーマーカー E-42']);
  assert.equal(rows.cards.find(c => c.official_card_number === 'FB11-011').name_ja, '孫悟空', '稀有度頁的日文名優先');
  assert.equal(rows.missingJa, 0);
  assert.ok(seen.some(url => url.includes('/fw/jp/cardlist/?search=true&category%5B0%5D=596901')));
});

const fwStoredRows = rows => ({ series: rows.series, cards: rows.cards });

test('七龍珠超補空白：只補目前是 null 的系列發售日／包裝圖與卡片日文名，已有的值一律不動', () => {
  const rows = fwCatalogRows({ ...fwSources(), products: [{ code: 'FB01', releaseDate: '2024-11-22', image: 'https://img/fb01.png' }, { code: 'SB01', releaseDate: '2025-01-01', image: 'https://img/sb01.png' }] });
  const { seriesPatches, cardPatches } = fwFillPatches(fwStoredRows(rows), [
    { id: 'dragonball-fw-fb01', release_date: null, image_url: null, image_kind: null },
    { id: 'dragonball-fw-sb01', release_date: '2025-02-02', image_url: null, image_kind: null },
    { id: 'dragonball-fw-pr', release_date: null, image_url: 'https://manual/pr.png', image_kind: 'series-logo' },
    { id: 'dragonball-fw-gone', release_date: null, image_url: null }
  ], [
    { id: 'dragonball-fw-fb01-001', name_ja: null, aliases: ['孫悟空', '悟空'], search_text: '孫悟空 FB01-001' },
    { id: 'dragonball-fw-fb01-005', name_ja: '手動日文名', aliases: [], search_text: '' },
    { id: 'dragonball-fw-e-42', name_ja: null, aliases: [], search_text: '' },
    { id: 'dragonball-fw-fp-001', name_ja: null, aliases: ['孫悟空'], search_text: '手動整理的搜尋字 孫悟空' }
  ]);
  assert.deepEqual(seriesPatches, [
    { id: 'dragonball-fw-fb01', guard: 'release_date=is.null', body: { release_date: '2024-11-22' } },
    { id: 'dragonball-fw-fb01', guard: 'image_url=is.null', body: { image_url: 'https://img/fb01.png', image_kind: 'series-logo' } },
    { id: 'dragonball-fw-sb01', guard: 'image_url=is.null', body: { image_url: 'https://img/sb01.png', image_kind: 'series-logo' } }
  ]);
  assert.deepEqual(cardPatches.map(p => [p.id, p.guard, p.body]), [
    ['dragonball-fw-fb01-001', 'name_ja=is.null', { name_ja: '孫悟空', aliases: ['孫悟空', '悟空'], search_text: '孫悟空 孫悟空 FB01-001' }],
    ['dragonball-fw-fp-001', 'name_ja=is.null', { name_ja: '孫悟空', aliases: ['孫悟空'], search_text: '手動整理的搜尋字 孫悟空' }]
  ], '手動日文名不覆蓋；官方沒有日文名的卡不動；搜尋字已有日文名就不重複');
});

test('七龍珠超同步：補空白以 PATCH 寫入並帶 is.null 條件，數量記在執行紀錄；沒有可補的就不送 PATCH', async () => {
  const { fetchText } = fwFetch({ energy: true });
  const stored = { '/tcg_series': [{ id: 'dragonball-fw-fb11', release_date: null, image_url: null, image_kind: null }], '/tcg_cards': [{ id: 'dragonball-fw-e-42', name_ja: null, aliases: ['能量標記'], search_text: '能量標記 E-42' }], '/tcg_printings': [] };
  const first = mockDb(stored);
  const stats = await syncDragonballFw(first.db, { fetchText, delay: 0 });
  assert.deepEqual(first.patches.map(p => [p.path, p.body]), [
    ['/tcg_series?id=eq.dragonball-fw-fb11&release_date=is.null', { release_date: '2026-09-12' }],
    ['/tcg_series?id=eq.dragonball-fw-fb11&image_url=is.null', { image_url: 'https://www.dbs-cardgame.com/fw/bccard/asia-tc/news/2026/07/13/x/FB11_jp.png', image_kind: 'series-logo' }],
    ['/tcg_cards?id=eq.dragonball-fw-e-42&name_ja=is.null', { name_ja: 'エナジーマーカー', aliases: ['能量標記', 'エナジーマーカー'], search_text: '能量標記 エナジーマーカー E-42' }]
  ]);
  assert.deepEqual([stats.metadata.filledSeries, stats.metadata.filledJa], [2, 1]);
  const second = mockDb({ '/tcg_series': [{ id: 'dragonball-fw-fb11', release_date: '2026-01-01', image_url: 'https://manual', image_kind: 'series-logo' }], '/tcg_cards': [{ id: 'dragonball-fw-e-42', name_ja: 'x' }], '/tcg_printings': [] });
  const again = await syncDragonballFw(second.db, { fetchText: fwFetch({ energy: true }).fetchText, delay: 0 });
  assert.equal(second.patches.length, 0);
  assert.deepEqual([again.metadata.filledSeries, again.metadata.filledJa], [0, 0]);
});
