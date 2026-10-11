// ADR 0036: TCGdex relays Cardmarket (EUR) prices on each Japanese card. Live lookup by TCGdex card ID, cached in memory, never stored.
export const TCGDEX_CARD_ENDPOINT = 'https://api.tcgdex.net/v2/ja/cards';
export const TCGDEX_PRICING_TTL_MS = 24 * 60 * 60 * 1000;
export const TCGDEX_PRICING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const TCGDEX_REQUEST_TIMEOUT_MS = 8000;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const positive = value => { const n = Number(value); return value != null && Number.isFinite(n) && n > 0 ? n : null; };
const clean = value => value == null ? null : String(value).trim() || null;

export function tcgdexCardUrl(providerCardId) {
  return `${TCGDEX_CARD_ENDPOINT}/${encodeURIComponent(providerCardId)}`;
}

// Cardmarket trend -> market (platform reference price), low -> listing (lowest asking price). The avg* fields are never read (ADR 0036).
// The 7-day freshness rule is not applied here: it runs on every read (dropStaleTcgdexPricing), so a cached record cannot outlive it.
export function parseTcgdexPricing(card, providerCardId = card?.id) {
  const records = [];
  for (const variant of Array.isArray(card?.variants_detailed) ? card.variants_detailed : []) {
    const pricing = variant?.pricing?.cardmarket;
    if (!pricing || typeof pricing !== 'object') continue;
    const currency = clean(pricing.unit)?.toUpperCase();
    if (currency !== 'EUR') continue;
    const updated = clean(pricing.updated), observedAt = updated && Number.isFinite(Date.parse(updated)) ? new Date(updated).toISOString() : null;
    if (!observedAt) continue;
    const common = {
      provider: 'tcgdex',
      market: 'Cardmarket',
      providerCardId: clean(providerCardId),
      variant: clean(variant.type),
      idProduct: pricing.idProduct ?? variant.thirdParty?.cardmarket ?? null,
      currency,
      observedAt,
      sourceUrl: tcgdexCardUrl(providerCardId)
    };
    for (const [field, priceType] of [['trend', 'market'], ['low', 'listing']]) {
      const amount = positive(pricing[field]);
      if (amount != null) records.push({ ...common, priceType, amount });
    }
  }
  return records;
}

export function dropStaleTcgdexPricing(records, { now = Date.now(), maxAgeMs = TCGDEX_PRICING_MAX_AGE_MS } = {}) {
  return records.filter(record => {
    const age = now - Date.parse(record.observedAt);
    return Number.isFinite(age) && age <= maxAgeMs;
  });
}

export function createTcgdexPricing({ fetch: fetchImpl = globalThis.fetch, now = Date.now, ttlMs = TCGDEX_PRICING_TTL_MS, maxAgeMs = TCGDEX_PRICING_MAX_AGE_MS, timeoutMs = TCGDEX_REQUEST_TIMEOUT_MS } = {}) {
  const cache = new Map(), pending = new Map();
  async function load(id) {
    const response = await fetchImpl(tcgdexCardUrl(id), { headers: { Accept: 'application/json', 'User-Agent': 'CardScope/1.0' }, signal: AbortSignal.timeout(timeoutMs) });
    // A card TCGdex does not know is a stable answer (cached as empty); any other failure is not, so the next request retries.
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`TCGDEX_PRICING_${response.status}`);
    const body = await response.json();
    return parseTcgdexPricing(body, clean(body?.id) || id);
  }
  return async function fetchTcgdexPricing(providerCardId) {
    const id = clean(providerCardId);
    if (!id || !ID_PATTERN.test(id)) return [];
    const hit = cache.get(id);
    if (hit && hit.expiresAt > now()) return dropStaleTcgdexPricing(hit.records, { now: now(), maxAgeMs });
    let promise = pending.get(id);
    if (!promise) {
      promise = load(id).then(records => { cache.set(id, { records, expiresAt: now() + ttlMs }); return records; }).finally(() => pending.delete(id));
      pending.set(id, promise);
    }
    return dropStaleTcgdexPricing(await promise, { now: now(), maxAgeMs });
  };
}

export const fetchTcgdexPricing = createTcgdexPricing();
