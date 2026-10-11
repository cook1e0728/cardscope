import test from 'node:test';
import assert from 'node:assert/strict';
import { haikyuuCardRows, syncHaikyuu, syncWeissFrieren, weissCardRows, weissSetCode } from '../providers/official-ip-sync.mjs';

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
  const posts = [], runs = [];
  const db = async (path, options = {}) => {
    if (path.startsWith('/catalog_sync_runs')) { runs.push({ path, method: options.method, body: options.body && JSON.parse(options.body) }); return options.method === 'POST' ? [{ id: 1 }] : null; }
    if (options.method === 'POST') { posts.push({ path, prefer: options.headers?.Prefer, rows: JSON.parse(options.body) }); return null; }
    const table = path.split('?')[0], offset = Number(new URL(`http://x${path}`).searchParams.get('offset') || 0);
    return offset ? [] : (stored[table] || []);
  };
  return { db, posts, runs };
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
