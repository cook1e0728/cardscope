import test from 'node:test';
import assert from 'node:assert/strict';
import { collectYugiohJp, konamiIdMap, parseYgoJpDetail, parseYgoJpPackCards, parseYgoJpPacks, selectYgoJpPacks, syncYugiohJp, ygoJpImageUrl, ygoJpNamePatches, ygoJpRows } from '../providers/yugioh-official-jp.mjs';
import { catalogCollectionAllowed, imageRightsAllowDisplay } from '../providers/source-policy.mjs';

// ---- 官方頁面的最小片段（結構取自 2026-11-05 實際頁面）----
const packRow = (pid, date, name, category = '【基本ブースターパック】') => `<div class="t_row packc11 packsub1127 sff_1  new_p"><div class="inside"><div class="sub"><div class="time">
  ${date}
 </div><div class="catergory"><span class="ws_nowrap">${category}</span><span class="ws_nowrap">2026年4月～</span></div></div><div class="main"><p>${name}</p>
 <input type="hidden" class="link_value" value="/yugiohdb/card_search.action?ope=1&sess=1&pid=${pid}&rp=99999"></div></div></div>`;
const packList = (...rows) => `<div id="card_list_1">${rows.slice(0, 2).join('')}</div><div id="card_list_3">${rows.join('')}</div>`;
const packCard = (cid, name) => `<div class="t_row c_normal open t_rid_1"><div class="cardimg"><img id="card_image_0_1" alt="${name}"></div><dl><dd class="box_card_name"><span class="card_ruby">るび</span>
 <span class="card_name">
   ${name}
 </span></dd><dd class="remove_btn"><input type="hidden" class="cid" value="${cid}"></dd></dl><input type="hidden" class="link_value" value="/yugiohdb/card_search.action?ope=2&cid=${cid}&iid=1"></div>`;
const packPage = (count, ...cards) => `<div class="text">全${count}枚</div>${cards.join('')}`;
const detailRow = (ciid, date, number, pid, packName, ...rarities) => `<div class="t_row  pack_iid_${ciid}"><div class="inside"><div class="time">
 ${date}
 </div><div class="flex_1 contents "><div class="card_number">
 ${number}
 </div><div class="pack_name flex_1" >
 ${packName}
 </div><input type="hidden" class="link_value" value="/yugiohdb/card_search.action?ope=1&sess=1&pid=${pid}&rp=99999"></div>
 <div class="icon rarity">${rarities.map(([code, label]) => `<div class="lr_icon rid_1" style="color:#000"><p>${code}</p><span style="color:#000">${label}</span></div>`).join('')}</div></div></div>`;
const detailPage = (cid, enc, ciids, ...rows) => `<script>${ciids.map(ciid => `$('#pop_card_image_${ciid},#update_list_card_image_${ciid}').attr('src', '/yugiohdb/get_image.action?type=2&cid=${cid}&ciid=${ciid}&enc=${enc}');`).join('\n')}</script>${rows.join('\n')}`;
const N = ['N', 'ノーマル仕様'], UR = ['UR', 'ウルトラレア仕様'], SE = ['SE', 'シークレットレア仕様'];

test('パック一覧：同じパックが複数の分頁に並ぶので pid で去重し、由舊到新に並べる', () => {
  const packs = parseYgoJpPacks(packList(packRow('1000009611000', '2026/10/31', 'ORIGINAL ARTWORK DUEL SET－遊戯編－', '【商品同梱】'), packRow('1110001', '2007/07/21', "グラディエイターズ・アサルト [ GLADIATOR&#039;S ASSAULT ]")));
  assert.deepEqual(packs.map(pack => pack.pid), ['1110001', '1000009611000']);
  assert.deepEqual(packs[0], { pid: '1110001', date: '2007-07-21', name: "グラディエイターズ・アサルト [ GLADIATOR'S ASSAULT ]", category: '【基本ブースターパック】' });
  assert.equal(packs[1].category, '【商品同梱】');
});

test('パック頁：取出 cid 與卡名，頁面標示的張數一併回傳', () => {
  const page = parseYgoJpPackCards(packPage(2, packCard('7276', '六武衆の侍従'), packCard('7277', '雲魔物－スモークボール')));
  assert.equal(page.count, 2);
  assert.deepEqual(page.cards, [{ cid: '7276', name: '六武衆の侍従' }, { cid: '7277', name: '雲魔物－スモークボール' }]);
  assert.deepEqual(parseYgoJpPackCards('<html>改版</html>'), { count: NaN, cards: [] });
});

test('詳細頁：卡號、稀有度、發售日、圖片編號與 enc；沒有卡號的列略過，一列多個稀有度各算一筆', () => {
  const detail = parseYgoJpDetail(detailPage('4007', 'TOKEN-a_b', ['1', '3'],
    detailRow('3', '2011-05-14', 'BE01-JP089', '3312002', "BEGINNER'S EDITION 1 [ 2011 ]", UR),
    detailRow('1', '2022-04-23', '', '1000008503001', '3枚セット', SE),
    detailRow('1', '2020-12-19', 'PGB1-JP012', '3304012', 'PRISMATIC GOD BOX SPECIAL PACK', ['UL', 'アルティメットレア仕様'], ['M+UR', 'ミレニアム仕様'])));
  assert.deepEqual([...detail.images], [['1', 'TOKEN-a_b'], ['3', 'TOKEN-a_b']]);
  assert.equal(detail.skippedNoNumber, 1);
  assert.deepEqual(detail.printings.map(p => [p.pid, p.date, p.number, p.rarity, p.rarityLabel, p.ciid]), [
    ['3312002', '2011-05-14', 'BE01-JP089', 'UR', 'ウルトラレア仕様', '3'],
    ['3304012', '2020-12-19', 'PGB1-JP012', 'UL', 'アルティメットレア仕様', '1'],
    ['3304012', '2020-12-19', 'PGB1-JP012', 'M+UR', 'ミレニアム仕様', '1']]);
  assert.equal(ygoJpImageUrl('4007', '3', detail.images.get('3')), 'https://www.db.yugioh-card.com/yugiohdb/get_image.action?type=1&osplang=1&cid=4007&ciid=3&enc=TOKEN-a_b');
  assert.equal(ygoJpImageUrl('4007', '9', undefined), null, '沒有 enc 官方會回替代圖，所以不給網址');
});

test('YGOPRODeck 的 konami_id 對到既有卡 id，沒有 konami_id 的不收', () => {
  const map = konamiIdMap([{ id: 89631139, misc_info: [{ konami_id: 4007 }] }, { id: 1, misc_info: [{ views: 3 }] }, { id: 2, misc_info: [{ konami_id: 0 }] }]);
  assert.deepEqual([...map], [['4007', 'yugioh-ygoprodeck-89631139']]);
});

const newCtx = (stored = {}) => ({ packsByPid: new Map(Object.entries(stored.packs || {})), seriesByPid: new Map(), seriesCodes: new Map(), newSeries: [], knownProviderIds: new Set(stored.known || []),
  knownPairs: new Set((stored.known || []).map(id => id.split(':').slice(1, 3).join(':'))), usedKeys: new Set(stored.keys || []), stats: { skippedKeyConflict: 0 } });

test('版本列：provider_id 不重複、同卡號多稀有度不撞唯一鍵、同前綴的別個パック不互相衝突、已收錄的不再產生', () => {
  const ctx = newCtx({ packs: { 1: { pid: '1', date: '2011-05-14', name: 'BEGINNER 1', category: '【構築済みデッキ】' } } });
  const detail = parseYgoJpDetail(detailPage('4007', 'T', ['1', '2', '3'],
    detailRow('3', '2011-05-14', 'BE01-JP089', '1', 'BEGINNER 1', UR, SE),
    detailRow('2', '2011-05-14', 'BE01-JP089', '1', 'BEGINNER 1', UR),
    detailRow('1', '2012-01-01', 'BE01-JP089', '2', '別のパック', N)));
  const rows = ygoJpRows({ cardId: 'yugioh-ygoprodeck-1', cid: '4007', detail, ctx });
  assert.equal(rows.length, 3, 'パック、卡號、稀有度相同的列只留一筆（圖片編號取最小）');
  assert.deepEqual(rows.map(row => [row.series_id, row.local_set_code, row.local_card_number, row.rarity, row.metadata.ciid]), [
    ['yugioh-jp-be01', 'BE01', 'BE01-JP089', 'SE', '3'],
    ['yugioh-jp-be01', 'BE01', 'BE01-JP089 UR', 'UR', '2'],
    ['yugioh-jp-be01-2', 'BE01-2', 'BE01-JP089', 'N', '1']]);
  assert.equal(new Set(rows.map(row => row.provider_id)).size, 3);
  assert.equal(new Set(rows.map(row => `${row.card_id}|${row.region}|${row.language}|${row.local_set_code}|${row.local_card_number}`)).size, 3);
  assert.ok(rows.every(row => row.region === 'JP' && row.language === 'ja-JP' && row.source === 'yugioh-neuron' && row.provider_id.startsWith('jp:4007:') && row.image_url.includes('&enc=T')));
  assert.deepEqual(ctx.newSeries.map(series => [series.id, series.official_code, series.region, series.name_ja, series.release_date, series.provider_id]), [
    ['yugioh-jp-be01', 'BE01', 'JP', 'BEGINNER 1', '2011-05-14', '1'], ['yugioh-jp-be01-2', 'BE01-2', 'JP', '別のパック', '2012-01-01', '2']]);
  // 同一輪再讀同一張詳細頁（或下一輪資料庫已有這些列）時不再產生
  assert.equal(ygoJpRows({ cardId: 'yugioh-ygoprodeck-1', cid: '4007', detail, ctx }).length, 0);
});

test('版本列：資料庫已有的唯一鍵被佔用時改用「卡號 稀有度」，仍衝突再加 pid，最後仍衝突就略過並計數', () => {
  const detail = parseYgoJpDetail(detailPage('1', 'T', ['1'], detailRow('1', '2020-01-01', 'AB01-JP001', '5', 'P', UR)));
  const stored = ['yugioh-ygoprodeck-1|AB01|AB01-JP001'];
  const ctx = newCtx({ keys: stored });
  ctx.seriesByPid.set('5', { id: 'yugioh-jp-ab01', code: 'AB01' });
  assert.equal(ygoJpRows({ cardId: 'yugioh-ygoprodeck-1', cid: '1', detail, ctx })[0].local_card_number, 'AB01-JP001 UR');
  const both = newCtx({ keys: [...stored, 'yugioh-ygoprodeck-1|AB01|AB01-JP001 UR', 'yugioh-ygoprodeck-1|AB01|AB01-JP001 UR 5'] });
  both.seriesByPid.set('5', { id: 'yugioh-jp-ab01', code: 'AB01' });
  assert.equal(ygoJpRows({ cardId: 'yugioh-ygoprodeck-1', cid: '1', detail, ctx: both }).length, 0);
  assert.equal(both.stats.skippedKeyConflict, 1);
});

test('日文卡名只補 null 的欄位，已有日文名的卡不動', () => {
  const patches = ygoJpNamePatches([
    { id: 'a', name_ja: null, aliases: ['Blue-Eyes White Dragon'], search_text: 'Blue-Eyes White Dragon 89631139' },
    { id: 'b', name_ja: '既有', aliases: [], search_text: 'x' }, { id: 'c', name_ja: null, aliases: [], search_text: 'x' }],
  new Map([['a', '青眼の白龍'], ['b', '青眼の白龍'], ['d', '無關']]));
  assert.deepEqual(patches, [{ id: 'a', guard: 'name_ja=is.null', body: { name_ja: '青眼の白龍', aliases: ['Blue-Eyes White Dragon', '青眼の白龍'], search_text: 'Blue-Eyes White Dragon 89631139 青眼の白龍' } }]);
});

test('這一輪的パック：游標之後全部，加上最近 60 天內（含未來）的', () => {
  const packs = [['1', '2000-01-01'], ['2', '2026-05-01'], ['3', '2026-09-20'], ['4', '2026-12-25']].map(([pid, date]) => ({ pid, date, name: pid }));
  assert.deepEqual(selectYgoJpPacks(packs, null, '2026-11-05').map(p => p.pid), ['1', '2', '3', '4']);
  assert.deepEqual(selectYgoJpPacks(packs, '2026-05-01|2', '2026-11-05').map(p => p.pid), ['3', '4']);
  assert.deepEqual(selectYgoJpPacks(packs, '2026-12-25|4', '2026-11-05').map(p => p.pid), ['3', '4'], '補完後只重看最近 60 天內與未來的');
});

test('來源政策：日版遊戲王官方 DB 已啟用，圖片顯示為 risk-accepted', () => {
  assert.equal(catalogCollectionAllowed('yugiohJp'), true);
  assert.equal(imageRightsAllowDisplay('not-provided', null, 'yugioh-neuron'), true);
});

// ---- 整輪同步 ----
const ygoCards = [{ id: 89631139, name: 'Blue-Eyes', misc_info: [{ konami_id: 4007 }], card_sets: [{}] }, { id: 44430454, name: 'Footsoldier', misc_info: [{ konami_id: 7276 }], card_sets: [{}] },
  { id: 555, name: 'OCG only', misc_info: [{ konami_id: 9999 }] }];
function ygoFetch({ emptyPack = false, zeroCards = false, wrongCount = false, status = {} } = {}) {
  const seen = [];
  const pages = {
    'card_list.action': packList(packRow('1110001', '2007/07/21', 'GLAS'), packRow('1000009611000', '2026/10/31', 'YAS1', '【商品同梱】')),
    'pid=1110001': zeroCards ? packPage(2) : emptyPack ? packPage(0) : packPage(wrongCount ? 3 : 2, packCard('7276', '六武衆の侍従'), packCard('4007', '青眼の白龍')),
    'pid=1000009611000': packPage(3, packCard('4007', '青眼の白龍'), packCard('9999', 'OCGだけ'), packCard('31337', '密碼不明')),
    'cid=7276': detailPage('7276', 'E1', ['1'], detailRow('1', '2007-07-21', 'GLAS-JP001', '1110001', 'GLAS', N)),
    'cid=4007': detailPage('4007', 'E2', ['1', '2'], detailRow('1', '2007-07-21', 'GLAS-JP002', '1110001', 'GLAS', UR), detailRow('2', '2026-10-31', 'YAS1-JP001', '1000009611000', 'YAS1', UR))
  };
  const fetchText = async url => { seen.push(url); const key = Object.keys(pages).find(k => url.includes(k)); if (status[key]) throw new Error(`www.db.yugioh-card.com_${status[key]}`); return pages[key]; };
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
const storedCards = [{ id: 'yugioh-ygoprodeck-89631139', name_ja: null, aliases: [], search_text: 'Blue-Eyes' }, { id: 'yugioh-ygoprodeck-44430454', name_ja: '既有名', aliases: [], search_text: 'Footsoldier' }];

test('同步：一張卡只開一次詳細頁，系列與版本只新增、記為 yugioh-neuron，日文名只補空的，對不到的 cid 只回報', async () => {
  const { fetchText, fetchJson, seen } = ygoFetch();
  const { db, posts, runs, patches } = mockDb({ '/tcg_cards': storedCards });
  const stats = await syncYugiohJp(db, { fetchText, fetchJson, delay: 0, today: '2026-11-05' });
  assert.deepEqual(posts.map(p => p.path.split('?')[0]), ['/tcg_series', '/tcg_printings']);
  assert.ok(posts.every(p => p.prefer.includes('resolution=ignore-duplicates')));
  assert.deepEqual(posts[1].rows.map(r => r.provider_id).sort(), ['jp:4007:1000009611000:YAS1-JP001:UR', 'jp:4007:1110001:GLAS-JP002:UR', 'jp:7276:1110001:GLAS-JP001:N']);
  assert.equal(seen.filter(url => url.includes('cid=4007')).length, 1, '同一張卡在兩個パック出現，詳細頁只開一次');
  assert.equal(seen.length, 1 + 2 + 2, '一覽、2 個パック、2 張卡的詳細頁（OCG 獨有與密碼不明的 cid 不開）');
  assert.ok(seen.every(url => url.startsWith('https://www.db.yugioh-card.com/yugiohdb/')));
  assert.deepEqual(patches.map(p => [decodeURIComponent(p.path), p.body.name_ja]), [['/tcg_cards?id=eq.yugioh-ygoprodeck-89631139&name_ja=is.null', '青眼の白龍']]);
  assert.equal(runs[0].body[0].provider, 'yugioh-neuron');
  assert.equal(runs.at(-1).body.status, 'completed');
  assert.equal(runs.at(-1).body.cursor, '2026-10-31|1000009611000');
  assert.equal(stats.metadata.complete, true);
  assert.equal(stats.metadata.unmappedCids, 1);
  assert.deepEqual(stats.metadata.unmappedSample, [{ cid: '31337', name: '密碼不明', pid: '1000009611000' }]);
  assert.equal(stats.metadata.missingCardCids, 1, 'YGOPRODeck 有 konami_id、但資料庫沒有這張卡（OCG 獨有）');
  assert.equal(stats.metadata.filledNames, 1);
});

test('同步：資料庫已有的（cid, パック）不再開詳細頁；游標之後沒有新パック就只看最近 60 天內的', async () => {
  const { fetchText, fetchJson, seen } = ygoFetch();
  const known = [{ provider_id: 'jp:4007:1000009611000:YAS1-JP001:UR', card_id: 'yugioh-ygoprodeck-89631139', local_set_code: 'YAS1', local_card_number: 'YAS1-JP001' }];
  const { db, posts, runs } = mockDb({ '/tcg_cards': storedCards, '/tcg_series': [{ id: 'yugioh-jp-yas1', official_code: 'YAS1', provider_id: '1000009611000' }], '/tcg_printings': known }, { cursor: '2026-10-31|1000009611000' });
  const stats = await syncYugiohJp(db, { fetchText, fetchJson, delay: 0, today: '2026-11-05' });
  assert.equal(stats.metadata.packsProcessed, 1, '只剩最近 60 天內的パック');
  assert.equal(seen.length, 2, '只有一覽與 1 個パック頁：已收錄的 cid 4007 不開，OCG 獨有與密碼不明的 cid 也不開');
  assert.equal(posts.length, 0);
  assert.equal(runs.at(-1).body.cursor, '2026-10-31|1000009611000');
});

test('同步：請求超過上限時在パック之間停下，游標停在最後處理完的パック，complete=false 讓排程續跑', async () => {
  const { fetchText, fetchJson } = ygoFetch();
  const { db, runs } = mockDb({ '/tcg_cards': storedCards });
  const stats = await syncYugiohJp(db, { fetchText, fetchJson, delay: 0, maxRequests: 3, today: '2026-11-05' });
  assert.equal(stats.metadata.packsProcessed, 1);
  assert.equal(stats.metadata.complete, false);
  assert.equal(runs.at(-1).body.cursor, '2007-07-21|1110001');
});

test('同步：パック頁解析不到卡（或張數與標示不同）就整輪失敗，不寫入；標示 0 枚的パック略過', async () => {
  const wrong = ygoFetch({ wrongCount: true }), { db, posts, runs } = mockDb({ '/tcg_cards': storedCards });
  await assert.rejects(syncYugiohJp(db, { fetchText: wrong.fetchText, fetchJson: wrong.fetchJson, delay: 0, today: '2026-11-05' }), /YGO_JP_PACK_PARSE:1110001:2\/3/);
  assert.equal(posts.length, 0);
  assert.equal(runs.at(-1).body.status, 'failed');
  const zero = ygoFetch({ zeroCards: true });
  await assert.rejects(syncYugiohJp(mockDb({ '/tcg_cards': storedCards }).db, { fetchText: zero.fetchText, fetchJson: zero.fetchJson, delay: 0, today: '2026-11-05' }), /YGO_JP_PACK_PARSE:1110001:0\/2/);
  const { fetchText, fetchJson } = ygoFetch({ emptyPack: true });
  const rows = await collectYugiohJp({ fetchText, fetchJson, delay: 0, today: '2026-11-05', stored: { cards: storedCards, series: [], printings: [] } });
  assert.equal(rows.emptyPacks, 1);
});

test('同步：非 200 停止（不重試 404），整輪不寫入', async () => {
  const { fetchText, fetchJson } = ygoFetch({ status: { 'cid=4007': 404 } });
  const { db, posts, runs } = mockDb({ '/tcg_cards': storedCards });
  await assert.rejects(syncYugiohJp(db, { fetchText, fetchJson, delay: 0, today: '2026-11-05' }), /yugioh-card\.com_404/);
  assert.equal(posts.length, 0);
  assert.equal(runs.at(-1).body.status, 'failed');
});
