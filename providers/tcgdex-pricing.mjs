// ADR 0036: TCGdex relays Cardmarket (EUR) prices on each Japanese card. Live lookup by TCGdex card ID, cached in memory, never stored.
export const TCGDEX_CARD_ENDPOINT = 'https://api.tcgdex.net/v2/ja/cards';
export const TCGDEX_PRICING_TTL_MS = 60 * 60 * 1000;
export const TCGDEX_PRICING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const TCGDEX_REQUEST_TIMEOUT_MS = 8000;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const positive = value => { const n = Number(value); return value != null && Number.isFinite(n) && n > 0 ? n : null; };
const clean = value => value == null ? null : String(value).trim() || null;
const jaName = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '');
// ADR 0038: English names also fold case, accents, curly apostrophes, hyphens (Shuckle-GX / Shuckle GX) and a trailing LV.X, as in the set-map evidence.
const enName = value => String(value ?? '').normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[‘’]/g, "'").replace(/-/g, ' ').replace(/\s*lv\.\s*x$/, '').replace(/\s+/g, '');
export const sameTcgdexName = (a, b, language = 'ja') => { const f = language === 'en' ? enName : jaName; return f(a) === f(b); };

// ADR 0038: US cards use the English endpoint; the path differs only by language.
export function tcgdexCardUrl(providerCardId, language = 'ja') {
  return `https://api.tcgdex.net/v2/${language === 'en' ? 'en' : 'ja'}/cards/${encodeURIComponent(providerCardId)}`;
}
const TCGPLAYER_META = new Set(['unit', 'updated']);

// ADR 0038: TCGdex English card ID from a data/tcgdex-en-set-map.json entry. none = number as is; padN = first run of digits left-padded to N.
// numberSource 'providerId': the source's printed number is wrong for that set, so the number after the provider ID's last hyphen is used.
export function tcgdexEnCardId(entry, number, providerId = null) {
  const value = entry?.numberSource === 'providerId' ? clean(String(providerId ?? '').split('-').pop()) : clean(number);
  if (!entry?.tcgdex || !value) return null;
  if (entry.numberFormat === 'none') return `${entry.tcgdex}-${value}`;
  const pad = /^pad(\d)$/.exec(entry.numberFormat || '');
  return pad ? `${entry.tcgdex}-${value.replace(/\d+/, digits => digits.padStart(Number(pad[1]), '0'))}` : null;
}

// Cardmarket trend -> market (platform reference price), low -> listing (lowest asking price). avg7/avg30 ride on the market record as a steadier second reading (ADR 0054); other avg* fields are never read.
// The 7-day freshness rule is not applied here: it runs on every read (dropStaleTcgdexPricing), so a cached record cannot outlive it.
// ADR 0038: TCGplayer (USD) marketPrice -> market, lowPrice -> listing, per finish (normal, holofoil, reverseHolofoil, ...); mid/high/directLow are never read.
const observedAtOf = updated => { const value = clean(updated); return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; };
export function parseTcgdexPricing(card, providerCardId = card?.id, { language = 'ja' } = {}) {
  const records = [], sourceUrl = tcgdexCardUrl(providerCardId, language);
  // Some cards (e.g. en xy3-91) carry prices only on the card itself; their finish is then unknown for Cardmarket (holo columns are not read).
  const variants = Array.isArray(card?.variants_detailed) ? card.variants_detailed : [];
  const priced = variants.some(v => v?.pricing?.cardmarket || v?.pricing?.tcgplayer) ? variants : (card?.pricing ? [{ type: null, pricing: card.pricing, thirdParty: card.thirdParty }] : []);
  for (const variant of priced) {
    const pricing = variant?.pricing?.cardmarket;
    const observedAt = pricing && typeof pricing === 'object' && clean(pricing.unit)?.toUpperCase() === 'EUR' ? observedAtOf(pricing.updated) : null;
    if (observedAt) {
      const common = {
        provider: 'tcgdex',
        market: 'Cardmarket',
        providerCardId: clean(providerCardId),
        variant: clean(variant.type),
        idProduct: pricing.idProduct ?? variant.thirdParty?.cardmarket ?? null,
        currency: 'EUR',
        observedAt,
        sourceUrl
      };
      for (const [field, priceType] of [['trend', 'market'], ['low', 'listing']]) {
        const amount = positive(pricing[field]);
        if (amount != null) records.push({ ...common, priceType, amount, ...(priceType === 'market' ? { avg7: positive(pricing.avg7), avg30: positive(pricing.avg30) } : {}) });
      }
    }
    const tcgplayer = variant?.pricing?.tcgplayer, tpObservedAt = tcgplayer && typeof tcgplayer === 'object' && clean(tcgplayer.unit)?.toUpperCase() === 'USD' ? observedAtOf(tcgplayer.updated) : null;
    if (!tpObservedAt) continue;
    for (const [finish, prices] of Object.entries(tcgplayer)) {
      if (TCGPLAYER_META.has(finish) || !prices || typeof prices !== 'object') continue;
      const common = { provider: 'tcgdex', market: 'TCGplayer', providerCardId: clean(providerCardId), variant: clean(finish), idProduct: prices.productId ?? variant.thirdParty?.tcgplayer ?? null, currency: 'USD', observedAt: tpObservedAt, sourceUrl };
      for (const [field, priceType] of [['marketPrice', 'market'], ['lowPrice', 'listing']]) {
        const amount = positive(prices[field]);
        if (amount != null) records.push({ ...common, priceType, amount });
      }
    }
  }
  // A finish can be repeated on several variants; keep the first.
  const seen = new Set();
  return records.filter(r => { const key = [r.market, r.variant, r.priceType].join('|'); if (seen.has(key)) return false; seen.add(key); return true; });
}

export function dropStaleTcgdexPricing(records, { now = Date.now(), maxAgeMs = TCGDEX_PRICING_MAX_AGE_MS } = {}) {
  return records.filter(record => {
    const age = now - Date.parse(record.observedAt);
    return Number.isFinite(age) && age <= maxAgeMs;
  });
}

export function createTcgdexPricing({ language = 'ja', fetch: fetchImpl = globalThis.fetch, now = Date.now, ttlMs = TCGDEX_PRICING_TTL_MS, maxAgeMs = TCGDEX_PRICING_MAX_AGE_MS, timeoutMs = TCGDEX_REQUEST_TIMEOUT_MS } = {}) {
  const cache = new Map(), pending = new Map();
  async function load(id) {
    const response = await fetchImpl(tcgdexCardUrl(id, language), { headers: { Accept: 'application/json', 'User-Agent': 'CardScope/1.0' }, signal: AbortSignal.timeout(timeoutMs) });
    // A card TCGdex does not know is a stable answer (cached as empty); any other failure is not, so the next request retries.
    if (response.status === 404) return { name: null, records: [] };
    if (!response.ok) throw new Error(`TCGDEX_PRICING_${response.status}`);
    const body = await response.json();
    return { name: clean(body?.name), records: parseTcgdexPricing(body, clean(body?.id) || id, { language }) };
  }
  // expectedName (ADR 0037): the ID was derived from series code + card number, so TCGdex's Japanese name must match before any price is used.
  return async function fetchTcgdexPricing(providerCardId, { expectedName = null } = {}) {
    const id = clean(providerCardId);
    if (!id || !ID_PATTERN.test(id)) return [];
    const use = entry => expectedName != null && !sameTcgdexName(entry.name, expectedName, language) ? [] : dropStaleTcgdexPricing(entry.records, { now: now(), maxAgeMs });
    const hit = cache.get(id);
    if (hit && hit.expiresAt > now()) return use(hit);
    let promise = pending.get(id);
    if (!promise) {
      promise = load(id).then(entry => { cache.set(id, { ...entry, expiresAt: now() + ttlMs }); return entry; }).finally(() => pending.delete(id));
      pending.set(id, promise);
    }
    return use(await promise);
  };
}

export const fetchTcgdexPricing = createTcgdexPricing();
export const fetchTcgdexPricingEn = createTcgdexPricing({ language: 'en' });

// ADR 0037: official-import JP series checked against TCGdex (unique card numbers, Japanese names present). Evidence: docs/evidence/pokemon-jp/tcgdex-pricing-official-match-20261013.json
export const TCGDEX_OFFICIAL_JP_SERIES = new Set(['SV4a', 'SV-P', 'M-P', 'SV5K', 'SV5M']);

// Which TCGdex card a printing is priced against, and which name must match (ADR 0036/0037/0038). Pure: shared by the detail page and the daily snapshot (ADR 0042).
// x is a printing ({ source, providerId, region, cardId, localSetCode, localCardNumber, nameJa, nameEn }) or the card itself; card only supplies the English-name fallback.
export function tcgdexLookupForPrinting(x, card = null, { enSetMap = {}, officialJpSeries = TCGDEX_OFFICIAL_JP_SERIES } = {}) {
  if (!x) return null;
  const make = (id, expectedName, language) => typeof id === 'string' && id ? { id, expectedName, language } : null;
  if (x.source === 'tcgdex-ja') return make(x.providerId || x.provider_id, null, 'ja');
  if (x.region === 'JP' && x.cardId && !/-v\d+$/.test(x.cardId) && officialJpSeries.has(x.localSetCode) && x.localCardNumber && x.nameJa) return make(`${x.localSetCode}-${x.localCardNumber}`, x.nameJa, 'ja');
  if (x.source === 'pokemontcg' && x.region === 'US' && Object.hasOwn(enSetMap, x.localSetCode || '') && (x.nameEn || card?.nameEn)) return make(tcgdexEnCardId(enSetMap[x.localSetCode], x.localCardNumber, x.providerId || x.provider_id), x.nameEn || card.nameEn, 'en');
  return null;
}
