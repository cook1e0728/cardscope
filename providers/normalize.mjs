export const PRICE_TYPES = new Set(['listing','sale','buyback','retail','market','user_report']);

const clean = value => value == null ? null : String(value).trim() || null;
const numberOrNull = value => {
  if(value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function normalizeMarketRecord(input = {}){
  const priceType = clean(input.priceType) || 'listing';
  if(!PRICE_TYPES.has(priceType)) throw new Error(`UNSUPPORTED_PRICE_TYPE:${priceType}`);
  return {
    provider: clean(input.provider),
    market: clean(input.market),
    marketplaceId: clean(input.marketplaceId),
    cardId: clean(input.cardId),
    providerCardId: clean(input.providerCardId),
    cardName: clean(input.cardName),
    cardNumber: clean(input.cardNumber),
    setCode: clean(input.setCode),
    rarity: clean(input.rarity),
    language: clean(input.language),
    priceType,
    amount: numberOrNull(input.amount),
    currency: clean(input.currency)?.toUpperCase() || null,
    shippingAmount: numberOrNull(input.shippingAmount),
    priceTwd: numberOrNull(input.priceTwd),
    shippingTwd: numberOrNull(input.shippingTwd),
    landedPriceTwd: numberOrNull(input.landedPriceTwd),
    condition: clean(input.condition),
    imageUrl: clean(input.imageUrl),
    sourceUrl: clean(input.sourceUrl),
    observedAt: input.observedAt || new Date().toISOString()
  };
}

export function withTwd(record, fx){
  const convert = (amount, currency) => {
    const n = numberOrNull(amount), rate = Number(fx?.rates?.[currency]);
    return n == null || !Number.isFinite(rate) ? null : Math.round(n * rate);
  };
  const priceTwd = convert(record.amount, record.currency);
  const shippingTwd = convert(record.shippingAmount, record.currency);
  return {...record, priceTwd, shippingTwd, landedPriceTwd: priceTwd == null ? null : priceTwd + (shippingTwd || 0)};
}
