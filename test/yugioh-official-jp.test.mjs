import test from 'node:test';
import assert from 'node:assert/strict';
import { collectYugiohJp, konamiIdMap, orderYgoJpTargets, parseYgoJpDetail, syncYugiohJp, ygoJpImageUrl, ygoJpNamePatches, ygoJpRows } from '../providers/yugioh-official-jp.mjs';
import { catalogCollectionAllowed, imageRightsAllowDisplay } from '../providers/source-policy.mjs';

// ---- 官方詳細頁的最小片段（結構取自 2026-11-05 實際頁面）----
const detailRow = (ciid, date, number, pid, packName, ...rarities) => `<div class="t_row  pack_iid_${ciid}"><div class="inside"><div class="time">
 ${date}
 </div><div class="flex_1 contents "><div class="card_number">
 ${number}
 </div><div class="pack_name flex_1" >
 ${packName}
 </div><input type="hidden" class="link_value" value="/yugiohdb/card_search.action?ope=1&sess=1&pid=${pid}&rp=99999"></div>
 <div class="icon rarity">${rarities.map(([code, label]) => `<div class="lr_icon rid_1" style="color:#000"><p>${code}</p><span style="color:#000">${label}</span></div>`).join('')}</div></div></div>`;
const detailPage = (name, cid, enc, ciids, ...rows) => `<title>${name} | カード詳細 | 遊戯王ニューロン</title><script>${ciids.map(ciid => `$('#pop_card_image_${ciid},#update_list_card_image_${ciid}').attr('src', '/yugiohdb/get_image.action?type=2&cid=${cid}&ciid=${ciid}&enc=${enc}');`).join('\n')}</script>${rows.join('\n')}`;
const N = ['N', 'ノーマル仕様'], UR = ['UR', 'ウルトラレア仕様'], SE = ['SE', 'シークレットレア仕様'];

test('詳細頁：卡名、卡號、稀有度、發售日、圖片編號與 enc；沒有卡號的列略過，一列多個稀有度各算一筆', () => {
  const detail = parseYgoJpDetail(detailPage('青眼の白龍', '4007', 'TOKEN-a_b', ['1', '3'],
    detailRow('3', '2011-05-14', 'BE01-JP089', '3312002', "BEGINNER&#039;S EDITION 1 [ 2011 ]", UR),
    detailRow('1', '2022-04-23', '', '1000008503001', '3枚セット', SE),
    detailRow('1', '2020-12-19', 'PGB1-JP012', '3304012', 'PRISMATIC GOD BOX SPECIAL PACK', ['UL', 'アルティメットレア仕様'], ['M+UR', 'ミレニアム仕様'])));
  assert.equal(detail.name, '青眼の白龍');
  assert.deepEqual([...detail.images], [['1', 'TOKEN-a_b'], ['3', 'TOKEN-a_b']]);
  assert.equal(detail.skippedNoNumber, 1);
  assert.deepEqual(detail.printings.map(p => [p.pid, p.date, p.number, p.rarity, p.ciid, p.packName]), [
    ['3312002', '2011-05-14', 'BE01-JP089', 'UR', '3', "BEGINNER'S EDITION 1 [ 2011 ]"],
    ['3304012', '2020-12-19', 'PGB1-JP012', 'UL', '1', 'PRISMATIC GOD BOX SPECIAL PACK'],
    ['3304012', '2020-12-19', 'PGB1-JP012', 'M+UR', '1', 'PRISMATIC GOD BOX SPECIAL PACK']]);
  assert.equal(ygoJpImageUrl('4007', '3', detail.images.get('3')), 'https://www.db.yugioh-card.com/yugiohdb/get_image.action?type=1&osplang=1&cid=4007&ciid=3&enc=TOKEN-a_b');
  assert.equal(ygoJpImageUrl('4007', '9', undefined), null, '沒有 enc 官方會回替代圖，所以不給網址');
});

test('YGOPRODeck 的 konami_id 對到既有卡 id；沒有 konami_id 或只有 TCG 賽制的不收', () => {
  const map = konamiIdMap([{ id: 89631139, name: 'Blue-Eyes', misc_info: [{ konami_id: 4007, formats: ['TCG', 'OCG'] }] }, { id: 1, misc_info: [{ views: 3 }] }, { id: 2, misc_info: [{ konami_id: 0 }] },
    { id: 3, misc_info: [{ konami_id: 55, formats: ['TCG'] }] }, { id: 4, name: 'No formats', misc_info: [{ konami_id: 66 }] }]);
  assert.deepEqual([...map], [['4007', { cardId: 'yugioh-ygoprodeck-89631139', name: 'Blue-Eyes' }], ['66', { cardId: 'yugioh-ygoprodeck-4', name: 'No formats' }]]);
});

test('版本列：每種卡圖一筆，卡號與稀有度取最早發售的收錄（同日取頁面第一筆），包代碼清單只放代碼', () => {
  const detail = parseYgoJpDetail(detailPage('青眼の白龍', '4007', 'T', ['1', '2', '3'],
    detailRow('1', '2024-09-07', 'SD47-JP001', '9', 'SD47', N),
    detailRow('1', '2002-05-01', 'LB-JP001', '2', 'LB', ['SR', 'スーパー'], UR),
    detailRow('1', '2002-05-01', 'LB-JP001', '3', 'LB再販', N),
    detailRow('2', '2011-05-14', 'BE01-JP089', '4', 'BE01', UR),
    detailRow('3', '2022-04-23', '', '5', '無卡號', SE)));
  const { printings, skippedKeyConflict } = ygoJpRows({ cardId: 'yugioh-ygoprodeck-89631139', seriesId: 'yugioh-ygoprodeck-lob', cid: '4007', detail });
  assert.equal(skippedKeyConflict, 0);
  assert.deepEqual(printings.map(p => [p.provider_id, p.local_set_code, p.local_card_number, p.rarity, p.release_date, p.series_id]), [
    ['jp:4007:1', 'LB', 'LB-JP001', 'SR', '2002-05-01', 'yugioh-ygoprodeck-lob'],
    ['jp:4007:2', 'BE01', 'BE01-JP089', 'UR', '2011-05-14', 'yugioh-ygoprodeck-lob']], '沒有卡號的卡圖 3 不寫；ciid 1 取 2002 年第一筆（SR）');
  assert.deepEqual(printings[0].metadata, { cid: '4007', ciid: '1', packCodes: ['SD47', 'LB'], imageLanguage: 'ja' });
  assert.ok(printings.every(p => p.region === 'JP' && p.language === 'ja-JP' && p.source === 'yugioh-neuron' && p.image_url.includes('&enc=T') && !('rights_note' in p)));
});

test('版本列：兩種卡圖卡號相同時不撞唯一鍵（後來的列加稀有度，仍衝突再加圖片編號），卡沒有系列則 series_id 為 null', () => {
  const detail = parseYgoJpDetail(detailPage('X', '1', 'T', ['1', '2', '3'],
    detailRow('1', '2020-01-01', 'AB01-JP001', '1', 'AB01', UR), detailRow('2', '2020-01-01', 'AB01-JP001', '1', 'AB01', SE), detailRow('3', '2020-01-01', 'AB01-JP001', '1', 'AB01', SE)));
  const { printings } = ygoJpRows({ cardId: 'c', cid: '1', detail });
  assert.deepEqual(printings.map(p => p.local_card_number), ['AB01-JP001', 'AB01-JP001 SE', 'AB01-JP001 SE 3']);
  assert.equal(new Set(printings.map(p => `${p.card_id}|${p.region}|${p.language}|${p.local_set_code}|${p.local_card_number}`)).size, 3);
  assert.equal(new Set(printings.map(p => p.provider_id)).size, 3);
  assert.ok(printings.every(p => p.series_id === null));
});

test('日文卡名只補 null 的欄位，已有日文名的卡不動', () => {
  const patches = ygoJpNamePatches([
    { id: 'a', name_ja: null, aliases: ['Blue-Eyes White Dragon'], search_text: 'Blue-Eyes White Dragon 89631139' },
    { id: 'b', name_ja: '既有', aliases: [], search_text: 'x' }, { id: 'c', name_ja: null, aliases: [], search_text: 'x' }],
  new Map([['a', '青眼の白龍'], ['b', '青眼の白龍'], ['d', '無關']]));
  assert.deepEqual(patches, [{ id: 'a', guard: 'name_ja=is.null', body: { name_ja: '青眼の白龍', aliases: ['Blue-Eyes White Dragon', '青眼の白龍'], search_text: 'Blue-Eyes White Dragon 89631139 青眼の白龍' } }]);
});

test('待處理的 cid：游標之後的先做（由小到大），再回頭做游標之前的', () => {
  assert.deepEqual(orderYgoJpTargets(['30', '4', '100', '7'], null), ['4', '7', '30', '100']);
  assert.deepEqual(orderYgoJpTargets(['30', '4', '100', '7'], '7'), ['30', '100', '4', '7']);
});

test('來源政策：日版遊戲王官方 DB 已啟用，圖片顯示為 risk-accepted', () => {
  assert.equal(catalogCollectionAllowed('yugiohJp'), true);
  assert.equal(imageRightsAllowDisplay('not-provided', null, 'yugioh-neuron'), true);
});

// ---- 整輪同步 ----
const ygoCards = [
  { id: 89631139, name: 'Blue-Eyes', misc_info: [{ konami_id: 4007, formats: ['TCG', 'OCG'] }] },
  { id: 44430454, name: 'Footsoldier', misc_info: [{ konami_id: 7276, formats: ['OCG'] }] },
  { id: 555, name: 'OCG only', misc_info: [{ konami_id: 9999, formats: ['OCG'] }] },
  { id: 777, name: 'Already', misc_info: [{ konami_id: 1234, formats: ['OCG'] }] }];
function ygoFetch({ status = {}, emptyAll = false } = {}) {
  const seen = [];
  const pages = {
    'cid=7276': detailPage('六武衆の侍従', '7276', 'E1', ['1'], detailRow('1', '2007-07-21', 'GLAS-JP001', '1110001', 'GLAS', N)),
    'cid=4007': detailPage('青眼の白龍', '4007', 'E2', ['1', '2'], detailRow('1', '2007-07-21', 'GLAS-JP002', '1110001', 'GLAS', UR), detailRow('2', '2026-10-31', 'YAS1-JP001', '1000009611000', 'YAS1', UR))
  };
  const fetchText = async url => { seen.push(url); const key = Object.keys(pages).find(k => url.includes(k)); if (status[key]) throw new Error(`www.db.yugioh-card.com_${status[key]}`); return emptyAll ? '<html>改版</html>' : pages[key]; };
  return { fetchText, fetchJson: async () => ({ data: ygoCards }), seen };
}
function mockDb(stored, { cursor = null } = {}) {
  const posts = [], runs = [], patches = [];
  const db = async (path, options = {}) => {
    if (path.startsWith('/catalog_sync_runs')) { runs.push({ path, method: options.method, body: options.body && JSON.parse(options.body) }); return options.method === 'POST' ? [{ id: 1 }] : options.method ? null : (cursor ? [{ cursor }] : []); }
    if (options.method === 'PATCH') { patches.push({ path, body: JSON.parse(options.body) }); return null; }
    if (options.method === 'POST') { posts.push({ path, prefer: options.headers?.Prefer, rows: JSON.parse(options.body) }); return null; }
    const table = path.split('?')[0], offset = Number(new URL(`http://x${path}`).searchParams.get('offset') || 0);
    return offset ? [] : (stored[table] || []);
  };
  return { db, posts, runs, patches };
}
const storedCards = [{ id: 'yugioh-ygoprodeck-89631139', series_id: 'yugioh-ygoprodeck-lob', name_ja: null, aliases: [], search_text: 'Blue-Eyes' },
  { id: 'yugioh-ygoprodeck-44430454', series_id: null, name_ja: '既有名', aliases: [], search_text: 'Footsoldier' }, { id: 'yugioh-ygoprodeck-777', series_id: null, name_ja: null, aliases: [], search_text: 'Already' }];
const storedPrinting = { provider_id: 'jp:1234:1' };

test('同步：只開還沒有日版版本的卡一次，只新增版本（不建系列）、記為 yugioh-neuron，日文名只補空的，OCG 獨有的卡只回報', async () => {
  const { fetchText, fetchJson, seen } = ygoFetch();
  const { db, posts, runs, patches } = mockDb({ '/tcg_cards': storedCards, '/tcg_printings': [storedPrinting] });
  const stats = await syncYugiohJp(db, { fetchText, fetchJson, delay: 0 });
  assert.deepEqual(posts.map(p => p.path.split('?')[0]), ['/tcg_printings']);
  assert.ok(posts[0].prefer.includes('resolution=ignore-duplicates'));
  assert.deepEqual(posts[0].rows.map(r => [r.provider_id, r.card_id, r.series_id]), [
    ['jp:4007:1', 'yugioh-ygoprodeck-89631139', 'yugioh-ygoprodeck-lob'], ['jp:4007:2', 'yugioh-ygoprodeck-89631139', 'yugioh-ygoprodeck-lob'], ['jp:7276:1', 'yugioh-ygoprodeck-44430454', null]]);
  assert.deepEqual(seen, ['https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=4007&request_locale=ja', 'https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=7276&request_locale=ja'],
    '已有日版版本的 1234 與資料庫沒有的 9999 都不開，也不讀パック頁');
  assert.deepEqual(patches.map(p => [decodeURIComponent(p.path), p.body.name_ja]), [['/tcg_cards?id=eq.yugioh-ygoprodeck-89631139&name_ja=is.null', '青眼の白龍']], '44430454 已有日文名不動；777 沒開頁不補');
  assert.equal(runs[0].body[0].provider, 'yugioh-neuron');
  assert.equal(runs.at(-1).body.status, 'completed');
  assert.equal(runs.at(-1).body.cursor, '7276');
  assert.equal(stats.metadata.complete, true);
  assert.equal(stats.metadata.newPrintings, 3);
  assert.equal(stats.metadata.missingCardCids, 1);
  assert.deepEqual(stats.metadata.missingCardSample, [{ cid: '9999', cardId: 'yugioh-ygoprodeck-555', name: 'OCG only' }]);
});

test('同步：游標之後的卡先做；請求超過上限時停下，游標停在最後處理的 cid，complete=false 讓排程續跑', async () => {
  const { fetchText, fetchJson, seen } = ygoFetch();
  const { db, runs } = mockDb({ '/tcg_cards': storedCards, '/tcg_printings': [storedPrinting] }, { cursor: '4007' });
  const stats = await syncYugiohJp(db, { fetchText, fetchJson, delay: 0, maxRequests: 1 });
  assert.ok(seen[0].includes('cid=7276'), '游標 4007 之後的 7276 先做');
  assert.equal(seen.length, 1);
  assert.equal(stats.metadata.complete, false);
  assert.equal(stats.metadata.cardsPending, 2);
  assert.equal(runs.at(-1).body.cursor, '7276');
});

test('同步：沒有日版收錄的卡不寫列、記在 noJpRows；連續讀到沒有任何收錄列的頁面就整輪失敗，不寫入', async () => {
  const empty = { fetchText: async () => detailPage('無收錄', '1', 'T', []), fetchJson: async () => ({ data: ygoCards }) };
  const first = mockDb({ '/tcg_cards': storedCards, '/tcg_printings': [storedPrinting] });
  const stats = await syncYugiohJp(first.db, { ...empty, delay: 0 });
  assert.equal(first.posts.length, 0);
  assert.equal(stats.metadata.noJpRowsCount, 2);
  const { fetchText } = ygoFetch({ emptyAll: true });
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 1000 + i, name: `c${i}`, misc_info: [{ konami_id: 2000 + i, formats: ['OCG'] }] }));
  const { db, posts, runs } = mockDb({ '/tcg_cards': many.map(card => ({ id: `yugioh-ygoprodeck-${card.id}`, series_id: null, name_ja: null })), '/tcg_printings': [] });
  await assert.rejects(syncYugiohJp(db, { fetchText, fetchJson: async () => ({ data: many }), delay: 0 }), /YGO_JP_DETAIL_EMPTY:2009/);
  assert.equal(posts.length, 0);
  assert.equal(runs.at(-1).body.status, 'failed');
});

test('同步：非 200 停止（不重試 404），整輪不寫入', async () => {
  const { fetchText, fetchJson } = ygoFetch({ status: { 'cid=7276': 404 } });
  const { db, posts, runs } = mockDb({ '/tcg_cards': storedCards, '/tcg_printings': [] });
  await assert.rejects(syncYugiohJp(db, { fetchText, fetchJson, delay: 0 }), /yugioh-card\.com_404/);
  assert.equal(posts.length, 0);
  assert.equal(runs.at(-1).body.status, 'failed');
});

test('乾跑用的 only 只處理指定的 cid，不寫資料庫', async () => {
  const { fetchText, fetchJson, seen } = ygoFetch();
  const rows = await collectYugiohJp({ fetchText, fetchJson, delay: 0, only: ['7276'], stored: { cards: storedCards, printings: [] } });
  assert.equal(seen.length, 1);
  assert.deepEqual(rows.printings.map(p => p.provider_id), ['jp:7276:1']);
});

test('官方沒有的 cid（衍生物、只有英文版）標題是「カード詳細」：不當卡名、連續出現不算被擋；YGOPRODeck 的衍生物不收', async () => {
  const missingPage = '<html><head><title>カード詳細 | 遊戯王ニューロン(オフィシャルカードゲーム カードデータベース)</title></head><body></body></html>';
  assert.deepEqual([parseYgoJpDetail(missingPage).name, parseYgoJpDetail(missingPage).missing], [null, true]);
  assert.equal(konamiIdMap([{ id: 11050416, frameType: 'token', misc_info: [{ konami_id: 3987, formats: ['OCG'] }] }]).size, 0);
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 1000 + i, name: `c${i}`, misc_info: [{ konami_id: 2000 + i, formats: ['OCG'] }] }));
  const { db, posts, patches } = mockDb({ '/tcg_cards': many.map(card => ({ id: `yugioh-ygoprodeck-${card.id}`, series_id: null, name_ja: null })), '/tcg_printings': [] });
  const stats = await syncYugiohJp(db, { fetchText: async () => missingPage, fetchJson: async () => ({ data: many }), delay: 0 });
  assert.equal(posts.length, 0);
  assert.equal(patches.length, 0);
  assert.equal(stats.metadata.noJpRowsCount, 12);
});
