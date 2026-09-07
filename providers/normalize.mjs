export const PRICE_TYPES = new Set(['listing','sale','buyback','retail','market','user_report']);

// Catalog enrichment is deliberately normalized separately from market data.
// The database keeps source evidence and review state beside every name and
// rarity mapping so a later import cannot silently turn a reviewed value into
// an unverified one.
export const CATALOG_DATA_STATUSES = new Set(['verified','pending','incomplete']);
export const CARD_NAME_TYPES = new Set(['official','alias','romanized','search-alias']);

const clean = value => value == null ? null : String(value).trim() || null;
const numberOrNull = value => {
  if(value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const objectOrEmpty = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function normalizeCardNameRecord(input = {}){
  const cardId = clean(input.cardId ?? input.card_id);
  const locale = clean(input.locale);
  const name = clean(input.name);
  if(!cardId || !locale || !name)return null;
  const nameType = clean(input.nameType ?? input.name_type) || 'official';
  if(!CARD_NAME_TYPES.has(nameType))throw new Error(`UNSUPPORTED_CARD_NAME_TYPE:${nameType}`);
  const dataStatus = clean(input.dataStatus ?? input.data_status) || 'incomplete';
  if(!CATALOG_DATA_STATUSES.has(dataStatus))throw new Error(`UNSUPPORTED_CATALOG_DATA_STATUS:${dataStatus}`);
  return {
    card_id: cardId,
    locale,
    name,
    name_type: nameType,
    source: clean(input.source),
    source_url: clean(input.sourceUrl ?? input.source_url),
    data_status: dataStatus,
    metadata: objectOrEmpty(input.metadata)
  };
}

export function normalizeRarityRecord(input = {}){
  const gameId = clean(input.gameId ?? input.game_id);
  const rarityCode = clean(input.rarityCode ?? input.rarity_code);
  if(!gameId || !rarityCode)return null;
  const dataStatus = clean(input.dataStatus ?? input.data_status) || 'incomplete';
  if(!CATALOG_DATA_STATUSES.has(dataStatus))throw new Error(`UNSUPPORTED_CATALOG_DATA_STATUS:${dataStatus}`);
  const tier = input.rarityTier ?? input.rarity_tier;
  const rarityTier = tier == null || tier === '' ? null : numberOrNull(tier);
  return {
    game_id: gameId,
    rarity_code: rarityCode,
    rarity_label: clean(input.rarityLabel ?? input.rarity_label),
    rarity_tier: rarityTier,
    source: clean(input.source),
    source_url: clean(input.sourceUrl ?? input.source_url),
    data_status: dataStatus,
    metadata: objectOrEmpty(input.metadata)
  };
}

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
