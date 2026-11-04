// 遊戲王日版（region JP）：官方卡片資料庫 Neuron 日文版（db.yugioh-card.com，request_locale=ja）的定時同步。
// 使用者 2026-11-05 同意收錄並接受條款未確認的風險；只收文字事實與官方圖片網址（外連，不轉存）。
// 單一連線、每個請求間隔至少 1.1 秒、非 200 重試兩次後停止；只新增（既有列不改），只補既有卡「目前是 null」的日文卡名。
//
// 讀法：收錄パック一覧（1 個請求，約 1,500 個パック）→ 每個パック一頁（含整包卡的 cid 與卡名，沒有卡號）→
// 卡片詳細頁（含該卡所有日版收錄：パック、卡號、稀有度、發售日、圖片編號與 enc）。卡號只在詳細頁，
// 所以每個「已對到既有卡、且這個パック還沒收錄」的 cid 要開一次詳細頁（同一輪內同一張卡只開一次，詳細頁已含它的所有パック）。
// cid 用 YGOPRODeck 的 misc_info.konami_id 對到既有卡（`yugioh-ygoprodeck-<密碼>`）。
// 進度：catalog_sync_runs.cursor 記「已處理到的パック」（發售日|pid，由舊到新）；每輪最多約 YGO_JP_MAX_REQUESTS 個請求，
// 沒處理完時 metadata.complete=false，排程下個小時續跑；補完後每輪只重看最近 60 天內與尚未處理的パック。

export const YGO_JP_SOURCE = 'yugioh-neuron';
export const YGO_JP_BASE = 'https://www.db.yugioh-card.com/yugiohdb/';
export const YGO_JP_PACK_LIST = `${YGO_JP_BASE}card_list.action?request_locale=ja`;
export const YGOPRODECK_MISC = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes';
const PAGE_DELAY_MS = 1100;
const MAX_REQUESTS = 1200;
const RECENT_DAYS = 60;
const YGOPRODECK_SOURCE = 'ygoprodeck';

const lower = value => String(value || '').toLowerCase();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const decodeEntities = text => String(text).replace(/&(quot|amp|lt|gt|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (_, name) => {
  if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  return ({ quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' })[name.toLowerCase()];
}).trim();

async function officialGet(url, accept, read, { attempts = 3, timeout = 60000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url, { headers: { Accept: accept, 'User-Agent': 'CardScope/1.0 (catalog sync; low rate)' }, signal: AbortSignal.timeout(timeout) });
    if (response.ok) return read(response);
    if (attempt === attempts || ![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`${new URL(url).hostname}_${response.status}`);
    await pause(attempt * 1500);
  }
}
const officialText = url => officialGet(url, 'text/html', response => response.text());
const ygoprodeckJson = url => officialGet(url, 'application/json', response => response.json(), { timeout: 120000 });

// ---- 解析 ----

/** 收錄パック一覧 → [{ pid, date: YYYY-MM-DD, name, category }]（頁面把同一批パック列在不同分頁，以 pid 去重；由舊到新）。 */
export function parseYgoJpPacks(html) {
  const packs = new Map();
  for (const [, body, link] of String(html).matchAll(/<div class="t_row[^"]*"[^>]*>([\s\S]*?)<input type="hidden" class="link_value" value="([^"]+)"/g)) {
    const pid = link.match(/[?&]pid=(\d+)/)?.[1], date = body.match(/class="time">\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/), name = body.match(/<p>([^<]+)<\/p>/)?.[1];
    if (!pid || !date || !name || packs.has(pid)) continue;
    packs.set(pid, { pid, date: `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`, name: decodeEntities(name), category: decodeEntities(body.match(/class="catergory">\s*<span[^>]*>([^<]*)</)?.[1] || '') || null });
  }
  return sortPacks([...packs.values()]);
}

export const packKey = pack => `${pack.date}|${pack.pid}`;
const comparePacks = (a, b) => a.date.localeCompare(b.date) || Number(a.pid) - Number(b.pid);
export const sortPacks = packs => [...packs].sort(comparePacks);

/** パック頁 → { count: 頁面標示的全 N 枚, cards: [{ cid, name }] }；解析張數與標示不同時由呼叫端視為失敗。 */
export function parseYgoJpPackCards(html) {
  const count = Number(String(html).match(/全(\d+)枚/)?.[1] ?? NaN);
  const cards = [...String(html).matchAll(/<div class="t_row c_normal[^"]*">[\s\S]*?<span class="card_name">\s*([^<]*?)\s*<\/span>[\s\S]*?<input type="hidden" class="cid" value="(\d+)">/g)]
    .map(([, name, cid]) => ({ cid, name: decodeEntities(name) }));
  return { count, cards };
}

/**
 * 卡片詳細頁 → { images: Map(ciid → enc), printings: [{ pid, date, number, rarity, rarityLabel, ciid, packName }] }。
 * 一列收錄可有多個稀有度圖示（各算一筆）；沒有卡號的列（單賣組合、同梱特典）略過，數量由 skippedNoNumber 回報。
 */
export function parseYgoJpDetail(html) {
  const images = new Map();
  for (const [, ciid, enc] of String(html).matchAll(/get_image\.action\?type=2&cid=\d+&ciid=(\d+)&enc=([\w-]+)/g)) images.set(ciid, enc);
  const parts = String(html).split(/<div class="t_row\s+pack_iid_(\d+)">/), printings = [];
  let skippedNoNumber = 0;
  for (let index = 1; index < parts.length; index += 2) {
    const ciid = parts[index], body = parts[index + 1], pid = body.match(/pid=(\d+)/)?.[1], date = body.match(/class="time">\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    const number = decodeEntities(body.match(/class="card_number">\s*([^<]*?)\s*</)?.[1] || ''), packName = decodeEntities(body.match(/class="pack_name[^"]*"\s*>\s*([^<]*?)\s*</)?.[1] || '');
    const rarities = [...body.matchAll(/<div class="lr_icon[^"]*"[^>]*>\s*<p>([^<]*)<\/p>\s*<span[^>]*>\s*([^<]*?)\s*<\/span>/g)].map(([, code, label]) => ({ code: decodeEntities(code), label: decodeEntities(label) })).filter(r => r.code);
    if (!pid || !date) continue;
    if (!number) { skippedNoNumber++; continue; }
    for (const rarity of rarities.length ? rarities : [{ code: null, label: null }]) printings.push({ pid, date, number, rarity: rarity.code, rarityLabel: rarity.label, ciid, packName });
  }
  return { images, printings, skippedNoNumber };
}

/** 官方圖片網址（外連）；enc 取自詳細頁，沒帶 enc 官方會回另一張替代圖，所以沒有 enc 就不給網址。 */
export const ygoJpImageUrl = (cid, ciid, enc) => enc ? `${YGO_JP_BASE}get_image.action?type=1&osplang=1&cid=${cid}&ciid=${ciid}&enc=${enc}` : null;
export const ygoJpDetailUrl = cid => `${YGO_JP_BASE}card_search.action?ope=2&cid=${cid}&request_locale=ja`;
export const ygoJpPackUrl = pid => `${YGO_JP_BASE}card_search.action?ope=1&sess=1&pid=${pid}&rp=99999&request_locale=ja`;

/** YGOPRODeck（misc=yes）的卡 → Map(官方 cid → 既有卡 id)。 */
export function konamiIdMap(cards) {
  const map = new Map();
  for (const card of cards || []) {
    const cid = Number(card?.misc_info?.[0]?.konami_id);
    if (cid > 0 && card.id != null) map.set(String(cid), `yugioh-ygoprodeck-${card.id}`);
  }
  return map;
}

// ---- 列 ----

const setPrefix = number => String(number).split('-')[0];
const slugCode = code => lower(code).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
export const ygoJpProviderId = (cid, row) => `jp:${cid}:${row.pid}:${row.number}:${row.rarity || '-'}`;

/**
 * 一張卡的詳細頁 → 新的版本列與系列列。
 * ctx: { packsByPid, seriesByPid（pid → { id, code }，會被補上新系列）, seriesCodes（已用的 official_code → series id）, newSeries（陣列）, knownProviderIds, knownPairs, usedKeys（card_id|set|number）, stats }。
 * 同一パック、卡號、稀有度只留一筆（圖片編號取最小）；唯一鍵 (card_id, region, language, local_set_code, local_card_number) 不含稀有度，
 * local_set_code 用該パック的系列代碼（通常等於卡號前綴；前綴被別的パック用過時是「前綴-pid」，所以不同パック不會互相衝突）；
 * 同一パック、同卡號有多個稀有度時，後來的列在卡號後加上「 稀有度」（仍衝突再加 pid，最後還是衝突就略過並記數）。
 */
export function ygoJpRows({ cardId, cid, detail, ctx }) {
  const picked = new Map();
  for (const row of detail.printings) {
    const key = ygoJpProviderId(cid, row), current = picked.get(key);
    if (!current || Number(row.ciid) < Number(current.ciid)) picked.set(key, row);
  }
  const rows = [...picked.values()].sort((a, b) => a.date.localeCompare(b.date) || Number(a.pid) - Number(b.pid) || a.number.localeCompare(b.number) || String(a.rarity).localeCompare(String(b.rarity)));
  const printings = [];
  for (const row of rows) {
    const providerId = ygoJpProviderId(cid, row);
    if (ctx.knownProviderIds.has(providerId)) continue;
    if (!ctx.seriesByPid.has(row.pid)) {
      const pack = ctx.packsByPid.get(row.pid), name = pack?.name || row.packName || null, prefix = setPrefix(row.number);
      const code = ctx.seriesCodes.has(prefix) ? `${prefix}-${row.pid}` : prefix, id = `yugioh-jp-${slugCode(code)}`;
      ctx.seriesCodes.set(code, id);
      ctx.seriesByPid.set(row.pid, { id, code });
      ctx.newSeries.push({ id, game_id: 'yugioh', official_code: code, name_ja: name, name_zh: null, name_en: null, name_ko: null, region: 'JP', language: 'ja-JP',
        release_date: pack?.date || row.date, aliases: [code], source_url: ygoJpPackUrl(row.pid), image_url: null, image_kind: null, source: YGO_JP_SOURCE, provider_id: row.pid,
        metadata: { category: pack?.category || null } });
    }
    const { id: seriesId, code: set } = ctx.seriesByPid.get(row.pid), candidates = [row.number, `${row.number} ${row.rarity || ''}`.trim(), `${row.number} ${row.rarity || ''} ${row.pid}`.trim()];
    const number = candidates.find(candidate => !ctx.usedKeys.has(`${cardId}|${set}|${candidate}`));
    if (!number) { ctx.stats.skippedKeyConflict++; continue; }
    ctx.usedKeys.add(`${cardId}|${set}|${number}`);
    ctx.knownProviderIds.add(providerId);
    ctx.knownPairs.add(`${cid}:${row.pid}`);
    printings.push({ card_id: cardId, series_id: seriesId, region: 'JP', language: 'ja-JP', local_set_code: set, local_card_number: number,
      rarity: row.rarity, image_url: ygoJpImageUrl(cid, row.ciid, detail.images.get(row.ciid)), source_url: ygoJpDetailUrl(cid), release_date: row.date,
      source: YGO_JP_SOURCE, provider_id: providerId, image_rehost_required: false, image_rights_status: 'not-provided',
      metadata: { cid, ciid: row.ciid, packId: row.pid, rarityLabelJa: row.rarityLabel || null, officialNumber: row.number, imageLanguage: 'ja' }, data_status: 'incomplete' });
  }
  return printings;
}

/** 既有卡 name_ja 是 null 才補日文名（並補進 aliases、search_text）；每筆 patch 帶 guard，伺服器端再擋一次 null 條件。 */
export function ygoJpNamePatches(storedCards, nameByCardId) {
  const patches = [];
  for (const stored of storedCards) {
    const nameJa = nameByCardId.get(stored.id);
    if (!nameJa || stored.name_ja != null) continue;
    patches.push({ id: stored.id, guard: 'name_ja=is.null', body: { name_ja: nameJa, aliases: [...new Set([...(stored.aliases || []), nameJa])],
      search_text: !stored.search_text ? nameJa : stored.search_text.includes(nameJa) ? stored.search_text : `${stored.search_text} ${nameJa}` } });
  }
  return patches;
}

/**
 * 這一輪要看的パック：游標之後的全部，加上發售日在最近 recentDays 天內（含未來）的（補完後只剩這些）。由舊到新。
 * cursor 是上一輪處理到的 packKey；沒有就從頭。
 */
export function selectYgoJpPacks(packs, cursor, today, recentDays = RECENT_DAYS) {
  const since = new Date(Date.parse(today) - recentDays * 86400000).toISOString().slice(0, 10);
  return sortPacks(packs).filter(pack => !cursor || packKey(pack) > cursor || pack.date >= since);
}

// ---- 資料庫 ----

async function startRun(db, provider) {
  const rows = await db('/catalog_sync_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ provider, scope: 'catalog', status: 'running' }]) });
  return rows?.[0]?.id;
}
async function finishRun(db, id, status, stats, error = null) {
  if (!id) return;
  await db(`/catalog_sync_runs?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status, rows_seen: stats.seen || 0, rows_written: stats.written || 0, cursor: stats.cursor || null, error: error ? String(error).slice(0, 1000) : null, metadata: stats.metadata || {}, finished_at: new Date().toISOString() }) });
}
async function insertOnly(db, path, rows, onConflict) {
  for (let index = 0; index < rows.length; index += 200) {
    await db(`${path}?on_conflict=${onConflict}`, { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(index, index + 200)) });
  }
  return rows.length;
}
async function storedRows(db, path, source, select) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db(`${path}?select=${select}&source=eq.${source}&order=id&limit=1000&offset=${offset}`);
    if (!Array.isArray(page)) throw new Error(`STORED_ROWS_UNAVAILABLE:${path}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
async function patchRows(db, path, patches, concurrency = 6) {
  const queue = [...patches];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let patch; (patch = queue.shift());) await db(`${path}?id=eq.${encodeURIComponent(patch.id)}&${patch.guard}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch.body) });
  }));
  return patches.length;
}

/**
 * 讀官方資料並組成列（不寫資料庫）；`syncYugiohJp` 與乾跑共用。
 * stored: { cards: [{ id, name_ja, aliases, search_text }], series: [{ id, official_code, provider_id }], printings: [{ provider_id, card_id, local_set_code, local_card_number }] }
 */
export async function collectYugiohJp({ fetchText = officialText, fetchJson = ygoprodeckJson, delay = PAGE_DELAY_MS, maxRequests = MAX_REQUESTS, today = new Date().toISOString().slice(0, 10), cursor = null, only = null, stored }) {
  let requests = 0;
  const get = async url => { if (requests++) await pause(delay); return fetchText(url); };
  const packs = parseYgoJpPacks(await get(YGO_JP_PACK_LIST));
  if (!packs.length) throw new Error('YGO_JP_PACK_LIST_EMPTY');
  const cidToCard = konamiIdMap((await fetchJson(YGOPRODECK_MISC))?.data);
  if (!cidToCard.size) throw new Error('YGO_JP_KONAMI_ID_MISSING');
  const storedCardIds = new Set(stored.cards.map(card => card.id)), packsByPid = new Map(packs.map(pack => [pack.pid, pack]));
  const ctx = { packsByPid, seriesByPid: new Map(stored.series.filter(row => row.provider_id).map(row => [String(row.provider_id), { id: row.id, code: row.official_code }])), seriesCodes: new Map(stored.series.map(row => [row.official_code, row.id])),
    newSeries: [], knownProviderIds: new Set(stored.printings.map(row => row.provider_id)),
    // 這個（cid, パック）已經收錄過就不再開詳細頁；provider_id 是 jp:<cid>:<pid>:…
    knownPairs: new Set(stored.printings.map(row => String(row.provider_id).split(':').slice(1, 3).join(':'))), usedKeys: new Set(stored.printings.map(row => `${row.card_id}|${row.local_set_code}|${row.local_card_number}`)), stats: { skippedKeyConflict: 0 } };
  const scope = only ? sortPacks(packs.filter(pack => only.includes(pack.pid))) : selectYgoJpPacks(packs, cursor, today);
  const printings = [], nameByCardId = new Map(), unmapped = new Map(), missingCard = new Map(), details = new Map(), processed = [];
  let skippedNoNumber = 0, packMissingInDetail = 0, emptyPacks = 0;
  for (const pack of scope) {
    if (processed.length && requests >= maxRequests) break;
    const page = parseYgoJpPackCards(await get(ygoJpPackUrl(pack.pid)));
    // 頁面標示 0 枚的パック（還沒公開卡表的新商品）略過；標示張數與解析張數不同代表改版或讀壞，整輪失敗
    if (page.count === 0 && !page.cards.length) emptyPacks++;
    else if (!page.cards.length || page.cards.length !== page.count) throw new Error(`YGO_JP_PACK_PARSE:${pack.pid}:${page.cards.length}/${page.count}`);
    for (const { cid, name } of page.cards) {
      const cardId = cidToCard.get(cid);
      if (!cardId) { if (!unmapped.has(cid)) unmapped.set(cid, { cid, name, pid: pack.pid }); continue; }
      if (!storedCardIds.has(cardId)) { if (!missingCard.has(cid)) missingCard.set(cid, { cid, cardId, name, pid: pack.pid }); continue; }
      if (!nameByCardId.has(cardId) && name) nameByCardId.set(cardId, name);
      if (ctx.knownPairs.has(`${cid}:${pack.pid}`) || details.has(cid)) continue;
      const detail = parseYgoJpDetail(await get(ygoJpDetailUrl(cid)));
      if (!detail.printings.length && !detail.skippedNoNumber) throw new Error(`YGO_JP_DETAIL_EMPTY:${cid}`);
      details.set(cid, true);
      skippedNoNumber += detail.skippedNoNumber;
      if (!detail.printings.some(row => row.pid === pack.pid) && !detail.skippedNoNumber) packMissingInDetail++;
      printings.push(...ygoJpRows({ cardId, cid, detail, ctx }));
    }
    processed.push(pack);
  }
  return { packs: processed, scopeCount: scope.length, requests, printings, series: ctx.newSeries, nameByCardId, unmapped: [...unmapped.values()], missingCard: [...missingCard.values()],
    skippedNoNumber, packMissingInDetail, emptyPacks, skippedKeyConflict: ctx.stats.skippedKeyConflict, complete: processed.length === scope.length,
    cursor: processed.length ? packKey(processed.at(-1)) : cursor };
}

export async function syncYugiohJp(db, { fetchText = officialText, fetchJson = ygoprodeckJson, delay = PAGE_DELAY_MS, maxRequests = Number(process.env.YGO_JP_MAX_REQUESTS) || MAX_REQUESTS, today } = {}) {
  const runId = await startRun(db, YGO_JP_SOURCE), stats = { seen: 0, written: 0, cursor: null, metadata: {} };
  try {
    const [previous, cards, series, printingsStored] = await Promise.all([
      db(`/catalog_sync_runs?select=cursor&provider=eq.${YGO_JP_SOURCE}&status=eq.completed&cursor=not.is.null&order=started_at.desc&limit=1`),
      storedRows(db, '/tcg_cards', YGOPRODECK_SOURCE, 'id,name_ja,aliases,search_text'),
      storedRows(db, '/tcg_series', YGO_JP_SOURCE, 'id,official_code,provider_id'),
      storedRows(db, '/tcg_printings', YGO_JP_SOURCE, 'provider_id,card_id,local_set_code,local_card_number')
    ]);
    const cursor = Array.isArray(previous) ? previous[0]?.cursor || null : null;
    const rows = await collectYugiohJp({ fetchText, fetchJson, delay, maxRequests, today, cursor, stored: { cards, series, printings: printingsStored } });
    const written = { series: await insertOnly(db, '/tcg_series', rows.series, 'id'), printings: await insertOnly(db, '/tcg_printings', rows.printings, 'source,provider_id') };
    const filledNames = await patchRows(db, '/tcg_cards', ygoJpNamePatches(cards, rows.nameByCardId));
    stats.seen = rows.printings.length;
    stats.written = written.series + written.printings + filledNames;
    stats.cursor = rows.cursor;
    stats.metadata = { complete: rows.complete, packsProcessed: rows.packs.length, packsInScope: rows.scopeCount, requests: rows.requests, newSeries: rows.series.length, newPrintings: rows.printings.length, filledNames,
      unmappedCids: rows.unmapped.length, unmappedSample: rows.unmapped.slice(0, 50), missingCardCids: rows.missingCard.length, missingCardSample: rows.missingCard.slice(0, 50),
      skippedNoNumber: rows.skippedNoNumber, packMissingInDetail: rows.packMissingInDetail, emptyPacks: rows.emptyPacks, skippedKeyConflict: rows.skippedKeyConflict, basis: '使用者 2026-11-05 同意（接受條款未確認風險）' };
    await finishRun(db, runId, 'completed', stats);
    return stats;
  } catch (error) { await finishRun(db, runId, 'failed', stats, error); throw error; }
}
