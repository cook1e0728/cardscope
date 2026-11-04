// 遊戲王日版（region JP）：官方卡片資料庫 Neuron 日文版（db.yugioh-card.com，request_locale=ja）的定時同步（精簡版）。
// 使用者 2026-11-05 同意收錄並接受條款未確認的風險；只收文字事實與官方圖片網址（外連，不轉存）。
// 單一連線、每個請求間隔至少 1.1 秒、非 200 重試兩次後停止；只新增（既有列不改），只補既有卡「目前是 null」的日文卡名。
//
// 資料庫空間有限（正式庫接近免費方案上限），所以不收各パック各稀有度的完整收錄：每張卡的每種卡圖（ciid）只寫一筆日版版本，
// 卡號、稀有度、發售日取該卡圖「最早發售的日版收錄」（同日取詳細頁第一筆），其餘收錄只把包代碼（卡號前綴）放進 metadata.packCodes。
// 不建日版系列：版本的 series_id 沿用既有卡的 series_id。
//
// 讀法：YGOPRODeck（misc=yes）的 misc_info.konami_id 就是官方 cid，用它列出既有卡的 cid，
// 每張還沒收錄的卡開一次詳細頁（卡號、稀有度、發售日、圖片 enc 都在這一頁），完全不讀パック頁。
// 進度：catalog_sync_runs.cursor 記「已處理到的 cid」（由小到大）；每輪最多約 YGO_JP_MAX_REQUESTS 個請求，
// 沒處理完時 metadata.complete=false，排程下個小時續跑。待處理 = 對得到既有卡、且資料庫還沒有它日版版本的 cid；
// 游標之後的先做，做完再回頭重試之前沒有日版收錄的卡，所以新增的卡（以及晚一點才有美版的卡）之後的每輪都會自動補上。

export const YGO_JP_SOURCE = 'yugioh-neuron';
export const YGO_JP_BASE = 'https://www.db.yugioh-card.com/yugiohdb/';
export const YGOPRODECK_MISC = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes';
const PAGE_DELAY_MS = 1100;
const MAX_REQUESTS = 1200;
const MAX_PACK_CODES = 30;
const CONSECUTIVE_EMPTY_LIMIT = 10;
const YGOPRODECK_SOURCE = 'ygoprodeck';

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

/**
 * 卡片詳細頁 → { name, images: Map(ciid → enc), printings: [{ pid, date, number, rarity, rarityLabel, ciid, packName }], skippedNoNumber }。
 * printings 依頁面順序（新到舊）；一列收錄可有多個稀有度圖示（各算一筆，同一列的依序相鄰）；沒有卡號的列（單賣組合、同梱特典）略過。
 */
export function parseYgoJpDetail(html) {
  const images = new Map();
  for (const [, ciid, enc] of String(html).matchAll(/get_image\.action\?type=2&cid=\d+&ciid=(\d+)&enc=([\w-]+)/g)) images.set(ciid, enc);
  // 官方沒有這張卡時（衍生物、只有英文版的 cid）仍回 200，標題是頁面名「カード詳細」，不是卡名
  const title = decodeEntities(String(html).match(/<title>\s*([^<|]*?)\s*\|/)?.[1] || '') || null, missing = title === 'カード詳細', name = missing ? null : title;
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
  return { name, missing, images, printings, skippedNoNumber };
}

/** 官方圖片網址（外連）；enc 取自詳細頁，沒帶 enc 官方會回另一張替代圖，所以沒有 enc 就不給網址。 */
export const ygoJpImageUrl = (cid, ciid, enc) => enc ? `${YGO_JP_BASE}get_image.action?type=1&osplang=1&cid=${cid}&ciid=${ciid}&enc=${enc}` : null;
export const ygoJpDetailUrl = cid => `${YGO_JP_BASE}card_search.action?ope=2&cid=${cid}&request_locale=ja`;

/** YGOPRODeck（misc=yes）的卡 → Map(官方 cid → { cardId, name })；只收有 konami_id 且（有標示賽制時）有 OCG 的卡，TCG 限定卡官方日文庫沒有。 */
export function konamiIdMap(cards) {
  const map = new Map();
  for (const card of cards || []) {
    const info = card?.misc_info?.[0], cid = Number(info?.konami_id);
    if (cid > 0 && card.id != null && card.frameType !== 'token' && (!Array.isArray(info.formats) || info.formats.includes('OCG'))) map.set(String(cid), { cardId: `yugioh-ygoprodeck-${card.id}`, name: card.name || null });
  }
  return map;
}

// ---- 列 ----

const setPrefix = number => String(number).split('-')[0];
export const ygoJpProviderId = (cid, ciid) => `jp:${cid}:${ciid}`;

/**
 * 一張卡的詳細頁 → 版本列：每種卡圖（ciid）一筆，卡號、稀有度、發售日取使用這張圖的最早日版收錄（同日取頁面第一筆）。
 * 唯一鍵 (card_id, region, language, local_set_code, local_card_number) 不含稀有度與圖，兩種圖卡號相同時，後來的列卡號加「 稀有度」（仍衝突再加圖片編號）。
 * metadata.packCodes：使用這張圖的所有日版收錄的卡號前綴（去重、最多 30 個）。
 */
export function ygoJpRows({ cardId, seriesId = null, cid, detail }) {
  const earliest = new Map(), codes = new Map();
  for (const row of detail.printings) {
    const current = earliest.get(row.ciid);
    if (!current || row.date < current.date) earliest.set(row.ciid, row);
    if (!codes.has(row.ciid)) codes.set(row.ciid, []);
    if (!codes.get(row.ciid).includes(setPrefix(row.number))) codes.get(row.ciid).push(setPrefix(row.number));
  }
  const used = new Set(), printings = [];
  let skippedKeyConflict = 0;
  for (const [ciid, row] of [...earliest].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const set = setPrefix(row.number), number = [row.number, `${row.number} ${row.rarity || ''}`.trim(), `${row.number} ${row.rarity || ''} ${ciid}`.trim()].find(candidate => !used.has(`${set}|${candidate}`));
    if (!number) { skippedKeyConflict++; continue; }
    used.add(`${set}|${number}`);
    printings.push({ card_id: cardId, series_id: seriesId, region: 'JP', language: 'ja-JP', local_set_code: set, local_card_number: number,
      rarity: row.rarity, image_url: ygoJpImageUrl(cid, ciid, detail.images.get(ciid)), source_url: ygoJpDetailUrl(cid), release_date: row.date,
      source: YGO_JP_SOURCE, provider_id: ygoJpProviderId(cid, ciid), image_rehost_required: false, image_rights_status: 'not-provided',
      metadata: { cid, ciid, packCodes: codes.get(ciid).slice(0, MAX_PACK_CODES), imageLanguage: 'ja' }, data_status: 'incomplete' });
  }
  return { printings, skippedKeyConflict };
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

/** 這一輪要開的 cid：游標之後的先做，再回頭做游標之前還沒有日版版本的（由小到大）。 */
export function orderYgoJpTargets(cids, cursor) {
  const sorted = [...cids].sort((a, b) => Number(a) - Number(b)), after = cursor == null ? -1 : Number(cursor);
  return [...sorted.filter(cid => Number(cid) > after), ...sorted.filter(cid => Number(cid) <= after)];
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
 * stored: { cards: [{ id, series_id, name_ja, aliases, search_text }], printings: [{ provider_id }] }；only: 只處理這些 cid（乾跑用）。
 */
export async function collectYugiohJp({ fetchText = officialText, fetchJson = ygoprodeckJson, delay = PAGE_DELAY_MS, maxRequests = MAX_REQUESTS, cursor = null, only = null, stored }) {
  const cidToCard = konamiIdMap((await fetchJson(YGOPRODECK_MISC))?.data);
  if (!cidToCard.size) throw new Error('YGO_JP_KONAMI_ID_MISSING');
  const cardsById = new Map(stored.cards.map(card => [card.id, card])), fetched = new Set(stored.printings.map(row => String(row.provider_id).split(':')[1]));
  // YGOPRODeck 有 konami_id、資料庫沒有這張卡（多為 OCG 獨有）：只回報，不建卡
  const missingCard = [...cidToCard].filter(([, info]) => !cardsById.has(info.cardId)).map(([cid, info]) => ({ cid, cardId: info.cardId, name: info.name })).sort((a, b) => Number(a.cid) - Number(b.cid));
  const pending = orderYgoJpTargets([...cidToCard].filter(([cid, info]) => cardsById.has(info.cardId) && !fetched.has(cid) && (!only || only.includes(cid))).map(([cid]) => cid), cursor);
  const printings = [], nameByCardId = new Map(), noJpRows = [], processed = [];
  let requests = 0, skippedNoNumber = 0, skippedKeyConflict = 0, consecutiveEmpty = 0;
  for (const cid of pending) {
    if (processed.length && requests >= maxRequests) break;
    if (requests++) await pause(delay);
    const { cardId } = cidToCard.get(cid), detail = parseYgoJpDetail(await fetchText(ygoJpDetailUrl(cid)));
    // 連續讀到沒有任何收錄列的頁面，多半是官方改版或被擋，整輪失敗不寫入
    consecutiveEmpty = detail.printings.length || detail.skippedNoNumber || detail.missing ? 0 : consecutiveEmpty + 1;
    if (consecutiveEmpty >= CONSECUTIVE_EMPTY_LIMIT) throw new Error(`YGO_JP_DETAIL_EMPTY:${cid}`);
    processed.push(cid);
    skippedNoNumber += detail.skippedNoNumber;
    if (detail.name) nameByCardId.set(cardId, detail.name);
    const rows = ygoJpRows({ cardId, seriesId: cardsById.get(cardId).series_id || null, cid, detail });
    skippedKeyConflict += rows.skippedKeyConflict;
    if (!rows.printings.length) noJpRows.push(cid);
    printings.push(...rows.printings);
  }
  return { requests, pending: pending.length, processed: processed.length, printings, nameByCardId, missingCard, noJpRows, skippedNoNumber, skippedKeyConflict,
    complete: processed.length === pending.length, cursor: processed.length ? processed.at(-1) : cursor };
}

export async function syncYugiohJp(db, { fetchText = officialText, fetchJson = ygoprodeckJson, delay = PAGE_DELAY_MS, maxRequests = Number(process.env.YGO_JP_MAX_REQUESTS) || MAX_REQUESTS } = {}) {
  const runId = await startRun(db, YGO_JP_SOURCE), stats = { seen: 0, written: 0, cursor: null, metadata: {} };
  try {
    const [previous, cards, printingsStored] = await Promise.all([
      db(`/catalog_sync_runs?select=cursor&provider=eq.${YGO_JP_SOURCE}&status=eq.completed&cursor=not.is.null&order=started_at.desc&limit=1`),
      storedRows(db, '/tcg_cards', YGOPRODECK_SOURCE, 'id,series_id,name_ja,aliases,search_text'),
      storedRows(db, '/tcg_printings', YGO_JP_SOURCE, 'provider_id')
    ]);
    const cursor = Array.isArray(previous) ? previous[0]?.cursor || null : null;
    const rows = await collectYugiohJp({ fetchText, fetchJson, delay, maxRequests, cursor, stored: { cards, printings: printingsStored } });
    const written = await insertOnly(db, '/tcg_printings', rows.printings, 'source,provider_id');
    const filledNames = await patchRows(db, '/tcg_cards', ygoJpNamePatches(cards, rows.nameByCardId));
    stats.seen = rows.printings.length;
    stats.written = written + filledNames;
    stats.cursor = rows.cursor;
    stats.metadata = { complete: rows.complete, cardsPending: rows.pending, cardsProcessed: rows.processed, requests: rows.requests, newPrintings: rows.printings.length, filledNames,
      noJpRowsCount: rows.noJpRows.length, noJpRowsSample: rows.noJpRows.slice(0, 50), missingCardCids: rows.missingCard.length, missingCardSample: rows.missingCard.slice(0, 50),
      skippedNoNumber: rows.skippedNoNumber, skippedKeyConflict: rows.skippedKeyConflict, basis: '使用者 2026-11-05 同意（接受條款未確認風險）' };
    await finishRun(db, runId, 'completed', stats);
    return stats;
  } catch (error) { await finishRun(db, runId, 'failed', stats, error); throw error; }
}
