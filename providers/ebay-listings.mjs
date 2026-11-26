// eBay 現售掛牌價（Browse API）：開卡時才查，只回傳固定價掛牌摘要，不存資料庫。
// 標題必須含卡號才算對到；eBay 的標題、賣家名稱是外部不可信字串，前端顯示時要跳脫。
import { createBoundedSnapshotCache } from './backend-reliability.mjs';

export const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
export const EBAY_SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
export const EBAY_SINGLE_CARD_CATEGORY = '183454';
export const EBAY_TTL_MS = 60 * 60 * 1000;
export const EBAY_DAILY_LOOKUPS = 1000;
export const EBAY_MAX_ITEMS = 10;

const NAME_PATTERN = /^[\p{L}\p{N} '.:&,!-]{1,60}$/u, SET_PATTERN = /^[A-Za-z0-9-]{1,12}$/, NUMBER_PATTERN = /^(?:[A-Za-z]{0,3}\d{1,4}(?:\/[A-Za-z0-9]{1,5})?|[A-Za-z]{1,3}\/[A-Za-z]{2,5})$/;

// 商品連結只收 ebay.com 與其子網域；圖片只收 ebayimg.com 與其子網域（例 i.ebayimg.com）。
const hostIn = (host, root) => host === root || host.endsWith(`.${root}`);
function safeUrl(value, root) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hostIn(url.hostname.toLowerCase(), root) ? url.href : null;
  } catch { return null; }
}

// "025/165" 與 "25/165" 視為同一張；有分母時標題也要有分母，避免 "PSA 10" 之類的數字誤中卡號 10。
const TOKEN = /(?<![A-Za-z0-9])([A-Za-z]{0,3})(\d{1,4})(?:\s*\/\s*(\d{1,4}))?(?![A-Za-z0-9])/g;
// 鑑定級別（PSA 10、BGS 9.5）不是卡號。
const GRADE = /(?<![A-Za-z0-9])(?:PSA|BGS|CGC|SGC|TAG|ACE|CSG|ARS)\s*\d+(?:\.\d)?(?![A-Za-z0-9])/gi;
const isGraded = title => new RegExp(GRADE.source, 'i').test(String(title ?? ''));
const normalizeToken = (prefix, digits, total) => `${prefix.toLowerCase()}${Number(digits)}${total ? `/${Number(total)}` : ''}`;
export const normalizeCardNumber = value => { const m = /^([A-Za-z]{0,3})(\d{1,4})(?:\/(\d{1,4}))?$/.exec(String(value ?? '').trim()); return m ? normalizeToken(m[1], m[2], m[3]) : null; };
// 全字母卡號（30th 夢幻「R/RGB」）：標題要有「R/RGB」，或同時有「#R」與「RGB」字樣（例「Mew RGB Rare #B」）。
const LETTER_NUMBER = /^([A-Za-z]{1,3})\/([A-Za-z]{2,5})$/;
const word = text => new RegExp(`(?<![A-Za-z0-9])${text}(?![A-Za-z0-9])`, 'i');
export function titleHasNumber(title, number) {
  const letters = LETTER_NUMBER.exec(String(number ?? '').trim());
  if (letters) {
    const t = String(title ?? ''), [, mark, suffix] = letters;
    return word(`${mark}\\s*/\\s*${suffix}`).test(t) || (word(`#${mark}`).test(t) && word(suffix).test(t));
  }
  const want = normalizeCardNumber(number);
  if (!want) return false;
  for (const m of String(title ?? '').replace(GRADE, ' ').matchAll(TOKEN)) {
    const got = normalizeToken(m[1], m[2], m[3]);
    if (got === want || (!want.includes('/') && got.split('/')[0] === want)) return true;
  }
  return false;
}

export function ebayQuery({ name, set, number } = {}) {
  const n = String(name ?? '').trim(), s = String(set ?? '').trim(), c = String(number ?? '').trim();
  if (!NAME_PATTERN.test(n) || !NUMBER_PATTERN.test(c) || (s && !SET_PATTERN.test(s))) return null;
  const q = [n, s, c].filter(Boolean).join(' ');
  return { key: q.toLowerCase(), number: c, params: { q, category_ids: EBAY_SINGLE_CARD_CATEGORY, filter: 'buyingOptions:{FIXED_PRICE}', limit: '50' } };
}

const amount = (value, currency) => { const v = Number(value); return Number.isFinite(v) && v >= 0 && /^[A-Z]{3}$/.test(String(currency)) ? { value: String(value), currency } : null; };
const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

export function summarizeListing(item) {
  const price = amount(item?.price?.value, item?.price?.currency), link = safeUrl(item?.itemWebUrl, 'ebay.com'), id = text(item?.itemId, 64), title = text(item?.title, 200);
  if (!price || !link || !id || !title) return null;
  const ship = item.shippingOptions?.[0]?.shippingCost;
  return {
    itemId: id, title, price, shipping: ship ? amount(ship.value, ship.currency) : null, condition: text(item.condition, 60),
    seller: text(item.seller?.username, 64), image: safeUrl(item.image?.imageUrl, 'ebayimg.com'), itemWebUrl: link, itemEndDate: text(item.itemEndDate, 40)
  };
}

export function pickListings(body, number) {
  const rows = Array.isArray(body?.itemSummaries) ? body.itemSummaries : [];
  // 鑑定卡另有成交區，掛牌區只留裸卡；只排除不重排（eBay 顯示規定）。
  return rows.filter(item => !isGraded(item?.title) && titleHasNumber(item?.title, number)).map(summarizeListing).filter(Boolean).slice(0, EBAY_MAX_ITEMS);
}

const taipeiDay = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);

// shortcut: token、快取、每日計數都只在記憶體，Render 重啟會歸零，所以上限設得遠低於官方額度。
export function createEbayListings({ clientId, clientSecret, fetchFn, now = () => Date.now(), dailyLimit = EBAY_DAILY_LOOKUPS, maxEntries = 500, ttlMs = EBAY_TTL_MS }) {
  const caches = new Map();
  let day = '', used = 0, token = null, tokenPending = null;
  const enabled = Boolean(clientId && clientSecret);

  async function getToken() {
    if (token && token.expiresAt - 60000 > now()) return token.value;
    tokenPending ??= (async () => {
      const response = await fetchFn(EBAY_TOKEN_URL, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
      });
      if (!response.ok) throw new Error(`EBAY_TOKEN_${response.status}`);
      const body = await response.json();
      if (typeof body?.access_token !== 'string' || !(Number(body.expires_in) > 0)) throw new Error('EBAY_TOKEN_INVALID');
      token = { value: body.access_token, expiresAt: now() + Number(body.expires_in) * 1000 };
      return token.value;
    })().finally(() => { tokenPending = null; });
    return tokenPending;
  }

  async function search(query) {
    const auth = await getToken();
    const response = await fetchFn(`${EBAY_SEARCH_URL}?${new URLSearchParams(query.params)}`, {
      signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${auth}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`EBAY_SEARCH_${response.status}`);
    return pickListings(await response.json(), query.number);
  }

  return async function lookup(input) {
    const query = ebayQuery(input);
    if (!query) return { status: 'unsupported', enabled, limited: false, items: [] };
    if (!enabled) return { status: 'not-configured', enabled: false, limited: false, items: [] };
    let cache = caches.get(query.key);
    const fresh = cache?.peek() && cache.peek().expiresAt > now();
    const today = taipeiDay(now());
    if (today !== day) { day = today; used = 0; }
    if (!fresh && used >= dailyLimit) return { status: 'limited', enabled: true, limited: true, items: [] };
    if (!cache) {
      if (caches.size >= maxEntries) caches.delete(caches.keys().next().value);
      cache = createBoundedSnapshotCache({ ttlMs, maxStaleMs: 0, now });
      caches.set(query.key, cache);
    }
    const { data } = await cache.get(async () => { used++; return search(query); });
    return { status: data.length ? 'ok' : 'no-match', enabled: true, limited: false, items: data };
  };
}
