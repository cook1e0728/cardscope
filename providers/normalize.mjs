import { readFileSync } from 'node:fs';

export const PRICE_TYPES = new Set(['listing','sale','buyback','retail','market','user_report']);

// Keep the rarity vocabulary in one place for providers and the public browse
// API. The JSON file remains the reviewable source of truth; loading it once at
// module initialization avoids a database round trip and keeps fallback mode
// deterministic.
export const RARITY_RANKINGS = JSON.parse(readFileSync(new URL('../data/rarity-rankings.json', import.meta.url), 'utf8'));

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

export function rarityToken(value){
  return String(value ?? '').normalize('NFKC').toLocaleUpperCase().replace(/[\s・·._:：'’"\-]/g,'').replace(/[^\p{L}\p{N}+]/gu,'');
}

export function rarityDefinition(gameId){
  return RARITY_RANKINGS.systems?.[String(gameId ?? '').trim()] || null;
}

function rarityEntries(definition){
  if(!definition)return [];
  if(Array.isArray(definition.entries)&&definition.entries.length)return definition.entries;
  const codes=Array.isArray(definition.canonicalCodes)?definition.canonicalCodes:[],labels=definition.canonicalLabels||{},aliases=definition.aliases||{};
  return (definition.highToLow||[]).map((group,index)=>{
    const code=String(codes[index]??group?.[0]??'').trim(),groupValues=(Array.isArray(group)?group:[]).filter(Boolean).map(String);
    return {code,label:String(labels[code]??code).trim()||code,aliases:[...new Set([...groupValues,...(Array.isArray(aliases[code])?aliases[code]:[])].filter(value=>String(value).trim()&&String(value).trim()!==code).map(String))]};
  }).filter(entry=>entry.code);
}

function rarityEntry(gameId,value){
  const token=rarityToken(value);
  if(!token)return null;
  return rarityEntries(rarityDefinition(gameId)).find(entry=>[entry.code,entry.label,...(entry.aliases||[])].some(candidate=>rarityToken(candidate)===token))||null;
}

export function rarityCanonicalCode(gameId,value){
  const raw=String(value ?? '').trim();
  if(!raw)return null;
  return rarityEntry(gameId,raw)?.code || raw;
}

export function rarityDisplayLabel(gameId,value){
  const raw=String(value ?? '').trim(),entry=rarityEntry(gameId,raw);
  return entry?.label || raw;
}

export function rarityRank(gameId,value){
  const raw=String(value ?? '').trim(),definition=rarityDefinition(gameId),canonical=rarityCanonicalCode(gameId,raw);
  if(!raw||!definition)return Number.MAX_SAFE_INTEGER;
  const groups=Array.isArray(definition.highToLow)?definition.highToLow:[];
  const index=groups.findIndex(group=>(Array.isArray(group)?group:[]).some(label=>rarityToken(label)===rarityToken(canonical)));
  return index<0?Number.MAX_SAFE_INTEGER:index;
}

export function normalizeRarityValue(gameId,value){
  const raw=value&&typeof value==='object'&&!Array.isArray(value)
    ? value.raw ?? value.sourceLabel ?? value.label ?? value.name ?? value.value ?? value.code
    : value;
  const cleanRaw=clean(raw),entry=rarityEntry(gameId,cleanRaw),code=entry?.code||cleanRaw,label=entry?.label||cleanRaw,rank=entry?rarityRank(gameId,code):Number.MAX_SAFE_INTEGER;
  return {raw:cleanRaw,code:code||null,label:label||null,rank:rank===Number.MAX_SAFE_INTEGER?null:rank,known:Boolean(entry)};
}

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
  const rawRarity = input.rawRarity ?? input.raw_rarity ?? input.rarity ?? input.rarityCode ?? input.rarity_code ?? input.rarityLabel ?? input.rarity_label;
  const normalized = normalizeRarityValue(gameId, rawRarity);
  if(!gameId || !normalized.code)return null;
  const dataStatus = clean(input.dataStatus ?? input.data_status) || 'incomplete';
  if(!CATALOG_DATA_STATUSES.has(dataStatus))throw new Error(`UNSUPPORTED_CATALOG_DATA_STATUS:${dataStatus}`);
  const tier = input.rarityTier ?? input.rarity_tier;
  const rarityTier = tier == null || tier === '' ? normalized.rank : numberOrNull(tier);
  const sourceRarity = rawRarity && typeof rawRarity === 'object' && !Array.isArray(rawRarity) ? rawRarity : normalized.raw;
  const metadata = objectOrEmpty(input.metadata),provenance = {
    ...metadata,
    rawRarity: sourceRarity,
    normalizedRarityCode: normalized.code,
    normalizedRarityLabel: normalized.label,
    rarityStatus: normalized.known ? 'mapped' : 'unmapped'
  };
  return {
    game_id: gameId,
    rarity_code: normalized.code,
    rarity_label: normalized.label || clean(input.rarityLabel ?? input.rarity_label),
    rarity_tier: rarityTier,
    source: clean(input.source),
    source_url: clean(input.sourceUrl ?? input.source_url),
    data_status: dataStatus,
    metadata: provenance
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
