// 鑑定卡價格（PokemonPriceTracker v2，eBay／Fanatics 成交彙整）：開卡時才查，只回傳各級別摘要，不存資料庫。
// 免費方案每天 100 credit、每張卡 2 credit，扣點照 limit 算，所以固定 limit=1。
export const GRADED_ENDPOINT = 'https://www.pokemonpricetracker.com/api/v2/cards';
export const GRADED_TTL_MS = 24 * 60 * 60 * 1000;
export const GRADED_DAILY_LOOKUPS = 40;

const GRADE_ORDER = ['psa10', 'psa9', 'bgs10', 'bgs9_5', 'cgc10', 'cgc9_5', 'tag10', 'sgc10', 'ace10'];
const SET_PATTERN = /^[A-Za-z0-9-]{1,12}$/, NUMBER_PATTERN = /^[A-Za-z0-9-]{1,10}$/, ID_PATTERN = /^\d{1,9}$/;

// 英文版只用 TCGplayer 編號；日版只用「系列代號＋卡號」。自由文字搜尋會配錯（Espeon 48 → 冠軍賽版），不接受。
export function gradedQuery({ tcgPlayerId, set, number } = {}) {
  if (tcgPlayerId != null && ID_PATTERN.test(String(tcgPlayerId))) return { key: `en:${tcgPlayerId}`, params: { tcgPlayerId: String(tcgPlayerId) } };
  if (set && number && SET_PATTERN.test(set) && NUMBER_PATTERN.test(number)) return { key: `ja:${set.toLowerCase()}:${number.toLowerCase()}`, params: { language: 'japanese', set, search: number } };
  return null;
}

const leadingNumber = value => String(value ?? '').split('/')[0].trim().replace(/^0+(?=.)/, '').toLowerCase();

// 日版必須只有一筆，而且系列代號與卡號都對得上，否則當作沒對到。
export function pickGradedCard(body, query) {
  const data = body?.data;
  if (query.params.tcgPlayerId) return data && !Array.isArray(data) && String(data.tcgPlayerId) === query.params.tcgPlayerId ? data : null;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (Number(body?.metadata?.total) !== 1 || rows.length !== 1) return null;
  const card = rows[0], set = query.params.set.toLowerCase();
  if (!String(card.setName ?? '').toLowerCase().startsWith(`${set}:`)) return null;
  return leadingNumber(card.cardNumber) === leadingNumber(query.params.search) ? card : null;
}

export const gradeLabel = key => key.replace(/^([a-z]+)(\d+)(?:_(\d+))?$/, (_, company, whole, half) => `${company.toUpperCase()} ${whole}${half ? `.${half}` : ''}`);
const money = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };

export function summarizeGrades(card, usdToTwd) {
  const grades = card?.ebay?.salesByGrade || {};
  return GRADE_ORDER.filter(key => Number(grades[key]?.count) > 0 && money(grades[key].medianPrice)).map(key => {
    const g = grades[key], median = money(g.medianPrice);
    return {
      grade: gradeLabel(key), count: Number(g.count), medianUsd: median, minUsd: money(g.minPrice), maxUsd: money(g.maxPrice),
      medianTwd: usdToTwd ? Math.round(median * usdToTwd) : null, lastSaleDate: g.lastSaleDate || null,
      smartUsd: money(g.smartMarketPrice?.price), confidence: g.smartMarketPrice?.confidence || null,
    };
  });
}

export function createGradedPrices({ apiKey, fetchFn, now = () => Date.now(), dailyLimit = GRADED_DAILY_LOOKUPS, maxEntries = 500 }) {
  const cache = new Map();
  let day = '', used = 0;
  return async function lookup(input, usdToTwd) {
    const query = gradedQuery(input);
    if (!query) return { status: 'unsupported' };
    if (!apiKey) return { status: 'not-configured' };
    const hit = cache.get(query.key);
    if (hit && hit.expiresAt > now()) return hit.value;
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) { day = today; used = 0; }
    if (used >= dailyLimit) return { status: 'daily-limit' };
    used++;
    const response = await fetchFn(`${GRADED_ENDPOINT}?${new URLSearchParams({ ...query.params, includeEbay: 'true', limit: '1' })}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`GRADED_${response.status}`);
    const card = pickGradedCard(await response.json(), query), grades = card ? summarizeGrades(card, usdToTwd) : [];
    const value = card ? { status: grades.length ? 'ok' : 'no-sales', name: card.name || null, setName: card.setName || null, updatedAt: card.ebay?.updatedAt || null, grades } : { status: 'no-match' };
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(query.key, { value, expiresAt: now() + GRADED_TTL_MS });
    return value;
  };
}
