// ADR 0034：排球少年（TAKARA TOMY 官方卡表）與葬送的芙莉蓮（Weiß Schwarz 官方卡表）的定時同步。
// 使用者接受未確認條款的風險；只收文字事實與官方圖片網址（外連，不轉存）。
// 只新增官方有而資料庫沒有的系列、卡片與版本；既有列（含手動整理的中文別名、系列中文名）一律不改，
// 官方與既有資料不一致處只記在執行紀錄的 metadata。單一連線、每個請求間隔至少 1 秒、非 200 重試兩次後停止。

export const HAIKYUU_SOURCE = 'haikyu-official';
export const WEISS_SOURCE = 'weiss-schwarz-official';
export const HAIKYUU_BASE = 'https://www.takaratomy.co.jp/products/haikyuvobacabreak/cardlist/';
export const WEISS_API = 'https://ws-tcg.com/manage/CardListUser';
export const FRIEREN_TITLE = '147';
const PAGE_DELAY_MS = 1100;
const HAIKYUU_PER_PAGE = 20;

const lower = value => String(value || '').toLowerCase();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function officialJson(url, { attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CardScope/1.0 (catalog sync; low rate)' }, signal: AbortSignal.timeout(60000) });
    if (response.ok) return response.json();
    if (attempt === attempts || ![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`${new URL(url).hostname}_${response.status}`);
    await pause(attempt * 1500);
  }
}

// ---- 排球少年 ----

export function haikyuuSeriesRow(series) {
  const code = series.product_type;
  return { id: `haikyuu-${lower(code)}`, game_id: 'haikyuu', official_code: code, name_ja: series.product_name, name_zh: null, name_en: null, name_ko: null,
    region: 'JP', language: 'ja-JP', release_date: null, aliases: [code], source_url: HAIKYUU_BASE, image_url: null, image_kind: null,
    source: HAIKYUU_SOURCE, provider_id: code, metadata: { officialSeriesId: series.id } };
}

/** 官方 itemsearch.php 的一張卡 → 卡片與版本列（欄位與 2026-08-31 首次匯入的資料相同）。`seriesZh` 為系列中文名（可為空）。 */
export function haikyuuCardRows(item, seriesZh = null) {
  const code = item.product_type, number = item.card_no, id = `haikyuu-${item.ID}`, seriesId = `haikyuu-${lower(code)}`;
  const aliases = [item.name, item.name_ruby, code, seriesZh].filter(Boolean);
  const card = { id, canonical_id: `haikyuu-${lower(code)}-${lower(number)}`, game_id: 'haikyuu', series_id: seriesId, official_card_number: number,
    rarity: item.vobarity || null, name_ja: item.name, name_zh: item.name, name_en: null, name_ko: null, aliases,
    source: HAIKYUU_SOURCE, provider_id: String(item.ID), search_text: [item.name, item.name_ruby, number, code, seriesZh].filter(Boolean).join(' '),
    metadata: { category: item.category || null, position: item.position || null, affiliation: item.affiliation || null }, data_status: 'verified' };
  const printing = { card_id: id, series_id: seriesId, region: 'JP', language: 'ja-JP', local_set_code: code, local_card_number: number,
    rarity: item.vobarity || null, image_url: `${HAIKYUU_BASE}card/${number}-${item.image_end}.webp`, source_url: HAIKYUU_BASE,
    source: HAIKYUU_SOURCE, provider_id: String(item.ID), image_rehost_required: false, image_rights_status: 'not-provided', metadata: {}, data_status: 'incomplete' };
  return { card, printing };
}

// ---- 葬送的芙莉蓮（Weiß Schwarz）----

/** 卡號 SFN/S108-001 → 系列代碼 S108；試玩牌組 SFN/S108-T01 → S108-TD。 */
export function weissSetCode(cardNumber) {
  const match = String(cardNumber || '').match(/\/([A-Z0-9]+)-(T?)\d/i);
  if (!match) return null;
  return match[2] ? `${match[1]}-TD` : match[1];
}

export function weissSeriesRow(expansion, code) {
  return { id: `weiss-frieren-${lower(code)}`, game_id: 'weiss-schwarz', official_code: code, name_ja: expansion.name, name_zh: null, name_en: null, name_ko: null,
    region: 'JP', language: 'ja-JP', release_date: null, aliases: ['芙莉蓮'], source_url: `https://ws-tcg.com/cardlist/search/?expansion=${expansion.id}`,
    image_url: null, image_kind: null, source: WEISS_SOURCE, provider_id: String(expansion.id), metadata: { ip: 'frieren' } };
}

export function weissCardRows(item) {
  const number = item.card_number, code = weissSetCode(number), id = `weiss-${item.id}`, seriesId = `weiss-frieren-${lower(code)}`;
  const card = { id, canonical_id: `weiss-${lower(number)}`, game_id: 'weiss-schwarz', series_id: seriesId, official_card_number: number,
    rarity: item.rare || null, name_ja: item.card_name, name_zh: item.card_name, name_en: null, name_ko: null,
    aliases: [item.card_name, item.card_name_kana, '芙莉蓮'].filter(Boolean), source: WEISS_SOURCE, provider_id: String(item.id),
    search_text: [item.card_name, item.card_name_kana, number, '芙莉蓮'].filter(Boolean).join(' '),
    metadata: { ip: 'frieren', cost: item.cost ?? null, kind: item.card_kind ?? null, color: item.color ?? null, level: item.level ?? null, power: item.power ?? null, displayNameLanguage: 'ja-JP' },
    data_status: 'verified' };
  const printing = { card_id: id, series_id: seriesId, region: 'JP', language: 'ja-JP', local_set_code: code, local_card_number: number,
    rarity: item.rare || null, image_url: item.picture ? `https://ws-tcg.com/wordpress/wp-content/images/cardlist/${item.picture}` : null,
    source_url: `https://ws-tcg.com/cardlist/cardsearch/?cardno=${encodeURIComponent(number)}`, source: WEISS_SOURCE, provider_id: String(item.id),
    image_rehost_required: false, image_rights_status: 'not-provided', metadata: {}, data_status: 'incomplete' };
  return { card, printing };
}

// ---- 共用：只新增 ----

/** 只留下資料庫沒有的列；`existing` 為已存在的鍵集合。 */
export function onlyNew(rows, existing, key) {
  return rows.filter(row => !existing.has(key(row)));
}

/** 既有卡與官方值不同的欄位（只回報，不寫入）。 */
export function officialDifferences(rows, stored) {
  const byId = new Map(stored.map(row => [row.id, row]));
  const diffs = [];
  for (const row of rows) {
    const current = byId.get(row.id);
    if (!current) continue;
    for (const field of ['official_card_number', 'name_ja', 'rarity']) if ((current[field] ?? null) !== (row[field] ?? null)) diffs.push({ id: row.id, field, stored: current[field] ?? null, official: row[field] ?? null });
  }
  return diffs;
}

async function insertOnly(db, path, rows, onConflict) {
  if (!rows.length) return 0;
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

async function writeNew(db, { source, series, cards, printings }) {
  const [storedSeries, storedCards, storedPrintings] = await Promise.all([
    storedRows(db, '/tcg_series', source, 'id,official_code,name_ja,name_zh'),
    storedRows(db, '/tcg_cards', source, 'id,official_card_number,name_ja,rarity'),
    storedRows(db, '/tcg_printings', source, 'id,provider_id')
  ]);
  const newSeries = onlyNew(series, new Set(storedSeries.map(row => row.id)), row => row.id);
  const newCards = onlyNew(cards, new Set(storedCards.map(row => row.id)), row => row.id);
  const newPrintings = onlyNew(printings, new Set(storedPrintings.map(row => row.provider_id)), row => row.provider_id);
  let written = 0;
  written += await insertOnly(db, '/tcg_series', newSeries, 'id');
  written += await insertOnly(db, '/tcg_cards', newCards, 'id');
  written += await insertOnly(db, '/tcg_printings', newPrintings, 'source,provider_id');
  return { written, newSeries: newSeries.map(row => row.id), newCards: newCards.map(row => row.id), newPrintings: newPrintings.length,
    differences: officialDifferences(cards, storedCards).slice(0, 50), storedSeries };
}

async function startRun(db, provider) {
  const rows = await db('/catalog_sync_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ provider, scope: 'catalog', status: 'running' }]) });
  return rows?.[0]?.id;
}
async function finishRun(db, id, status, stats, error = null) {
  if (!id) return;
  await db(`/catalog_sync_runs?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status, rows_seen: stats.seen || 0, rows_written: stats.written || 0, cursor: null, error: error ? String(error).slice(0, 1000) : null, metadata: stats.metadata || {}, finished_at: new Date().toISOString() }) });
}

export async function syncHaikyuu(db, { fetchJson = officialJson, delay = PAGE_DELAY_MS } = {}) {
  const runId = await startRun(db, HAIKYUU_SOURCE), stats = { seen: 0, written: 0, metadata: {} };
  try {
    const master = await fetchJson(`${HAIKYUU_BASE}master.php`);
    const items = [];
    for (let page = 1, pages = 1; page <= pages; page++) {
      await pause(delay);
      const body = await fetchJson(`${HAIKYUU_BASE}itemsearch.php?para=normal,p,a&p=${page}`);
      if (!Array.isArray(body?.items)) throw new Error('HAIKYUU_ITEMS_MISSING');
      items.push(...body.items);
      pages = Math.ceil(Number(body.count || 0) / HAIKYUU_PER_PAGE);
      if (page === 1) stats.metadata.officialCount = Number(body.count || 0);
    }
    if (items.length !== stats.metadata.officialCount) throw new Error(`HAIKYUU_COUNT_MISMATCH:${items.length}/${stats.metadata.officialCount}`);
    const storedSeries = await storedRows(db, '/tcg_series', HAIKYUU_SOURCE, 'id,name_zh');
    const seriesZh = new Map(storedSeries.map(row => [row.id, row.name_zh]));
    const rows = items.map(item => haikyuuCardRows(item, seriesZh.get(`haikyuu-${lower(item.product_type)}`) || null));
    const result = await writeNew(db, { source: HAIKYUU_SOURCE, series: (master.series || []).map(haikyuuSeriesRow), cards: rows.map(r => r.card), printings: rows.map(r => r.printing) });
    stats.seen = items.length;
    stats.written = result.written;
    stats.metadata = { ...stats.metadata, cards: items.length, newSeries: result.newSeries, newCards: result.newCards, newPrintings: result.newPrintings, differences: result.differences, basis: 'ADR 0034' };
    await finishRun(db, runId, 'completed', stats);
    return stats;
  } catch (error) { await finishRun(db, runId, 'failed', stats, error); throw error; }
}

export async function syncWeissFrieren(db, { fetchJson = officialJson, delay = PAGE_DELAY_MS } = {}) {
  const runId = await startRun(db, WEISS_SOURCE), stats = { seen: 0, written: 0, metadata: {} };
  try {
    const options = await fetchJson(`${WEISS_API}/filter-options`);
    const expansions = (options.expansions || []).filter(expansion => String(expansion.title_name) === FRIEREN_TITLE);
    if (!expansions.length) throw new Error('FRIEREN_EXPANSIONS_MISSING');
    const items = [], series = new Map(), perExpansion = {};
    for (const expansion of expansions) {
      let total = 0;
      for (let page = 1, pages = 1; page <= pages; page++) {
        await pause(delay);
        const body = await fetchJson(`${WEISS_API}/searchJson?expansion=${expansion.id}&page=${page}`);
        if (!Array.isArray(body?.items)) throw new Error(`FRIEREN_ITEMS_MISSING:${expansion.id}`);
        pages = Number(body.page_count || 1);
        total = Number(body.total || 0);
        for (const item of body.items) {
          const code = weissSetCode(item.card_number);
          if (!code) throw new Error(`FRIEREN_CARD_NUMBER:${item.card_number}`);
          if (!series.has(code)) series.set(code, weissSeriesRow(expansion, code));
          items.push(item);
        }
      }
      perExpansion[expansion.id] = total;
    }
    const expected = Object.values(perExpansion).reduce((sum, value) => sum + value, 0);
    if (items.length !== expected) throw new Error(`FRIEREN_COUNT_MISMATCH:${items.length}/${expected}`);
    const rows = items.map(weissCardRows);
    const result = await writeNew(db, { source: WEISS_SOURCE, series: [...series.values()], cards: rows.map(r => r.card), printings: rows.map(r => r.printing) });
    stats.seen = items.length;
    stats.written = result.written;
    stats.metadata = { officialCount: expected, perExpansion, cards: items.length, newSeries: result.newSeries, newCards: result.newCards, newPrintings: result.newPrintings, differences: result.differences, basis: 'ADR 0034' };
    await finishRun(db, runId, 'completed', stats);
    return stats;
  } catch (error) { await finishRun(db, runId, 'failed', stats, error); throw error; }
}
