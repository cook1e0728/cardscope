import {createHash} from 'node:crypto';
import {PRICE_TYPES} from './normalize.mjs';
import {sourcePolicyForProvider} from './source-policy.mjs';

/**
 * Price history is intentionally a planning module.  It normalizes and
 * validates observations, but it never talks to Supabase and never performs a
 * provider request.  A caller can use the returned `upserts` after its own
 * transaction and RLS checks have been completed.
 */

export const PRICE_HISTORY_VERSION=1;
export const DEFAULT_PLAN_LIMIT=100;
export const MAX_PLAN_LIMIT=500;

const ISO_CURRENCY=/^[A-Z]{3}$/;
const SOURCE_ID=/^[a-z0-9][a-z0-9._-]*$/;
const DISABLED_SOURCE_ALIASES=new Set(['yuyutei','yuyutei-buyback']);

export class PriceHistoryValidationError extends Error{
  constructor(code,message,details={}){
    super(`${code}:${message}`);
    this.name='PriceHistoryValidationError';
    this.code=code;
    this.details=details;
  }
}

const clean=value=>value==null?null:String(value).trim()||null;
const first=(...values)=>values.find(value=>value!=null&&value!=='');

function fail(code,message,details={}){throw new PriceHistoryValidationError(code,message,details)}

function stableValue(value){
  if(value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
}

function stableStringify(value){return JSON.stringify(stableValue(value))}

function hash(value){return createHash('sha256').update(stableStringify(value)).digest('hex')}

function normalizeSource(value){
  const source=clean(value)?.toLowerCase();
  if(!source)fail('SOURCE_REQUIRED','price observation source is required');
  if(!SOURCE_ID.test(source))fail('SOURCE_INVALID','source must be a stable provider id',{source});
  return source;
}

function optionPolicyFor(source,options={}){
  const supplied=options.sourcePolicies??options.policies;
  if(supplied instanceof Map)return supplied.get(source)||null;
  if(supplied&&typeof supplied==='object')return supplied[source]||null;
  return null;
}

/**
 * Resolve the collection decision for a price source.  A known disabled
 * source is always blocked; an options override cannot silently turn policy
 * back on.  Unknown sources require an explicit approvedSources entry or an
 * enabled source policy supplied by the caller.
 */
export function assertPriceSourceAllowed(sourceValue,options={}){
  const source=normalizeSource(sourceValue);
  const configured=sourcePolicyForProvider(source);
  if(configured&&configured.collectionEnabled!==true||DISABLED_SOURCE_ALIASES.has(source)){
    fail('SOURCE_POLICY_BLOCKED',`source policy disables ${source} price collection`,{source,policy:configured||{collectionEnabled:false}});
  }
  if(configured)return {source,policy:configured,decision:'enabled'};
  const supplied=optionPolicyFor(source,options);
  if(supplied?.collectionEnabled===true)return {source,policy:supplied,decision:'enabled'};
  const approved=new Set((options.approvedSources||[]).map(value=>normalizeSource(value)));
  if(approved.has(source))return {source,policy:{id:source,collectionEnabled:true,access:'caller-approved'},decision:'enabled'};
  fail('SOURCE_POLICY_UNKNOWN',`source ${source} has no enabled collection policy`,{source});
}

function numberValue(value,field){
  if(value==null||value==='')fail(`${field.toUpperCase()}_REQUIRED`,`${field} is required`);
  if(typeof value==='string'&&!value.trim())fail(`${field.toUpperCase()}_REQUIRED`,`${field} is required`);
  const number=typeof value==='number'?value:Number(String(value).trim());
  if(!Number.isFinite(number))fail(`${field.toUpperCase()}_INVALID`,`${field} must be finite`,{value});
  if(number<0)fail(`${field.toUpperCase()}_NEGATIVE`,`${field} cannot be negative`,{value});
  return number;
}

function normalizeTimestamp(value){
  if(value==null||value==='')fail('TIMESTAMP_REQUIRED','observedAt is required');
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))fail('TIMESTAMP_INVALID','observedAt must be a valid timestamp',{value});
  return date.toISOString();
}

function nonEmptyObject(value){
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length>0;
}

function normalizeCardIdentity(input,source){
  const explicit=first(input.cardIdentity,input.card_identity,input.identity);
  const cardId=first(input.cardId,input.card_id);
  const providerCardId=first(input.providerCardId,input.provider_card_id);
  if(explicit!=null){
    if(typeof explicit==='string'||typeof explicit==='number'){
      const value=clean(explicit);
      if(!value)fail('CARD_IDENTITY_REQUIRED','card identity cannot be empty');
      return {type:'explicit',value,stable:`explicit:${value}`,cardId:cardId?clean(cardId):null,providerCardId:providerCardId?clean(providerCardId):null};
    }
    if(nonEmptyObject(explicit)){
      const value=stableStringify(explicit);
      return {type:'explicit-object',value,stable:`explicit-object:${value}`,cardId:cardId?clean(cardId):null,providerCardId:providerCardId?clean(providerCardId):null};
    }
    fail('CARD_IDENTITY_INVALID','card identity must be a non-empty scalar or object');
  }
  if(cardId!=null){
    const value=clean(cardId);
    if(!value)fail('CARD_IDENTITY_REQUIRED','cardId cannot be empty');
    return {type:'card-id',value,stable:`card:${value}`,cardId:value,providerCardId:providerCardId?clean(providerCardId):null};
  }
  if(providerCardId!=null){
    const value=clean(providerCardId);
    if(!value)fail('CARD_IDENTITY_REQUIRED','providerCardId cannot be empty');
    return {type:'provider-card-id',value,stable:`provider:${source}:${value}`,cardId:null,providerCardId:value};
  }
  const game=clean(first(input.game,input.gameId,input.game_id));
  const setCode=clean(first(input.setCode,input.set_code));
  const cardNumber=clean(first(input.cardNumber,input.card_number));
  const language=clean(input.language)?.toLowerCase()||'';
  if(game&&setCode&&cardNumber){
    const value=[game.toLowerCase(),setCode.toUpperCase(),cardNumber.toUpperCase(),language].join('|');
    return {type:'composite',value,stable:`composite:${value}`,cardId:null,providerCardId:null};
  }
  fail('CARD_IDENTITY_REQUIRED','stable cardId, providerCardId, cardIdentity, or game/setCode/cardNumber is required');
}

function normalizePriceType(value){
  const priceType=clean(value)?.toLowerCase();
  if(!priceType)fail('PRICE_TYPE_REQUIRED','priceType is required');
  if(!PRICE_TYPES.has(priceType))fail('PRICE_TYPE_UNSUPPORTED',`unsupported price type ${priceType}`,{priceType,allowed:[...PRICE_TYPES]});
  return priceType;
}

function normalizeCurrency(value){
  const currency=clean(value)?.toUpperCase();
  if(!currency)fail('CURRENCY_REQUIRED','currency is required');
  if(!ISO_CURRENCY.test(currency))fail('CURRENCY_INVALID','currency must be a 3-letter ISO code',{currency});
  return currency;
}

function normalizedFields(input){
  const source=normalizeSource(first(input.source,input.provider));
  const priceType=normalizePriceType(first(input.priceType,input.price_type));
  const currency=normalizeCurrency(first(input.currency,input.currencyCode,input.currency_code));
  const amount=numberValue(first(input.amount,input.price,input.value),'amount');
  const observedAt=normalizeTimestamp(first(input.observedAt,input.observed_at,input.timestamp));
  const card=normalizeCardIdentity(input,source);
  return {source,priceType,currency,amount,observedAt,card};
}

/**
 * Normalize one externally supplied observation.  Policy validation is on by
 * default; callers reading old rows can opt out only for read-only comparison
 * (`enforceSourcePolicy:false`).
 */
export function normalizePriceObservation(input={},options={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('OBSERVATION_INVALID','observation must be an object');
  const fields=normalizedFields(input);
  const policy=options.enforceSourcePolicy===false?null:assertPriceSourceAllowed(fields.source,options);
  const card=fields.card;
  const comparisonPayload={source:fields.source,priceType:fields.priceType,currency:fields.currency,cardIdentity:card.stable};
  const observationPayload={...comparisonPayload,amount:fields.amount,observedAt:fields.observedAt,sourceObservationId:clean(first(input.sourceObservationId,input.source_observation_id,input.observationId,input.observation_id))};
  const sourceObservationId=observationPayload.sourceObservationId;
  const sourceUrl=clean(first(input.sourceUrl,input.source_url));
  const market=clean(input.market)?.toUpperCase()||null;
  const language=clean(input.language)||null;
  const condition=clean(input.condition)||null;
  const setCode=clean(first(input.setCode,input.set_code))||null;
  const cardNumber=clean(first(input.cardNumber,input.card_number))||null;
  const metadata=nonEmptyObject(input.metadata)?stableValue(input.metadata):{};
  const observationKey=`pho_${hash(observationPayload)}`;
  const comparisonKey=`phc_${hash(comparisonPayload)}`;
  return {
    history_version:PRICE_HISTORY_VERSION,
    source:fields.source,
    provider:fields.source,
    policy_status:policy?.decision||'historical-read',
    card_id:card.cardId,
    provider_card_id:card.providerCardId,
    card_identity:card.stable,
    card_identity_type:card.type,
    card_identity_value:card.value,
    price_type:fields.priceType,
    currency:fields.currency,
    amount:fields.amount,
    observed_at:fields.observedAt,
    source_observation_id:sourceObservationId,
    market,
    language,
    condition,
    set_code:setCode,
    card_number:cardNumber,
    source_url:sourceUrl,
    metadata,
    observation_key:observationKey,
    comparison_key:comparisonKey
  };
}

export const validatePriceObservation=normalizePriceObservation;
export const normalizePriceHistoryObservation=normalizePriceObservation;

function normalizedForComparison(value){
  if(value&&typeof value==='object'&&value.observation_key&&value.comparison_key&&value.observed_at&&value.price_type&&value.currency&&value.card_identity){
    return value;
  }
  return normalizePriceObservation(value,{enforceSourcePolicy:false});
}

/** Return the dimensions that are required before two prices can be compared. */
export function priceComparisonKey(value){return normalizedForComparison(value).comparison_key}

export function comparePriceObservations(previousValue,currentValue){
  const previous=normalizedForComparison(previousValue);
  const current=normalizedForComparison(currentValue);
  const dimensions=['source','price_type','currency','card_identity'];
  const mismatches=dimensions.filter(field=>previous[field]!==current[field]);
  if(mismatches.length)return {comparable:false,reason:'DIMENSION_MISMATCH',mismatches,comparisonKey:null};
  const changeAmount=current.amount-previous.amount;
  const changePercent=previous.amount===0?null:Math.round(changeAmount/previous.amount*1000000)/10000;
  return {
    comparable:true,
    comparisonKey:current.comparison_key,
    previousObservationKey:previous.observation_key,
    currentObservationKey:current.observation_key,
    previousAmount:previous.amount,
    currentAmount:current.amount,
    changeAmount,
    changePercent,
    direction:changeAmount>0?'up':changeAmount<0?'down':'unchanged'
  };
}

export const computePriceChange=comparePriceObservations;
export const compareObservations=comparePriceObservations;
export function areComparable(previous,current){return comparePriceObservations(previous,current).comparable}
export const isComparable=areComparable;

function sortObservations(a,b){
  return String(a.observed_at).localeCompare(String(b.observed_at))||String(a.observation_key).localeCompare(String(b.observation_key));
}

function cursorFrom(value){
  if(!value)return null;
  if(typeof value==='object'&&value.observedAt&&value.observationKey)return {observedAt:String(value.observedAt),observationKey:String(value.observationKey)};
  if(typeof value!=='string')fail('CURSOR_INVALID','cursor must be an opaque string');
  try{
    const decoded=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    if(!decoded||typeof decoded.observedAt!=='string'||typeof decoded.observationKey!=='string')throw new Error('shape');
    return decoded;
  }catch{fail('CURSOR_INVALID','cursor is not a valid price history cursor')}
}

export function encodePriceHistoryCursor(observation){
  const normalized=normalizedForComparison(observation);
  return Buffer.from(JSON.stringify({version:PRICE_HISTORY_VERSION,observedAt:normalized.observed_at,observationKey:normalized.observation_key})).toString('base64url');
}

export const encodeCursor=encodePriceHistoryCursor;

function afterCursor(observation,cursor){
  return String(observation.observed_at)>String(cursor.observedAt)||String(observation.observed_at)===String(cursor.observedAt)&&String(observation.observation_key)>String(cursor.observationKey);
}

function storedObservationKey(value,normalized){return clean(first(value?.observation_key,value?.observationKey))||normalized.observation_key}

function normalizeExisting(value){
  const normalized=normalizePriceObservation(value,{enforceSourcePolicy:false});
  const storedKey=storedObservationKey(value,normalized);
  return storedKey===normalized.observation_key?normalized:{...normalized,observation_key:storedKey};
}

function planRow(observation,comparison,previous){
  return {
    history_version:PRICE_HISTORY_VERSION,
    observation_key:observation.observation_key,
    source:observation.source,
    provider:observation.provider,
    card_id:observation.card_id,
    provider_card_id:observation.provider_card_id,
    card_identity:observation.card_identity,
    comparison_key:observation.comparison_key,
    price_type:observation.price_type,
    currency:observation.currency,
    amount:observation.amount,
    observed_at:observation.observed_at,
    previous_observation_key:previous?.observation_key||null,
    change_amount:comparison?.changeAmount??null,
    change_percent:comparison?.changePercent??null,
    change_direction:comparison?.direction||null,
    market:observation.market,
    language:observation.language,
    condition:observation.condition,
    set_code:observation.set_code,
    card_number:observation.card_number,
    source_observation_id:observation.source_observation_id,
    source_url:observation.source_url,
    metadata:observation.metadata
  };
}

function coverageFrom(normalized,options={}){
  const rows=normalized||[];
  const sources=[...new Set(rows.map(row=>row.source).filter(Boolean))].sort();
  const priceTypes=[...new Set(rows.map(row=>row.price_type).filter(Boolean))].sort();
  const currencies=[...new Set(rows.map(row=>row.currency).filter(Boolean))].sort();
  const cards=[...new Set(rows.map(row=>row.card_identity).filter(Boolean))];
  const timestamps=rows.map(row=>row.observed_at).filter(Boolean).sort();
  const expected=options.expectedCardCount==null?null:Number(options.expectedCardCount);
  const denominatorStatus=Number.isFinite(expected)&&expected>=0?'provided':'unknown';
  const observedCardCount=cards.length;
  return {
    version:PRICE_HISTORY_VERSION,
    scope:'approved-external-observations',
    sample:rows.length>0,
    complete:false,
    completeness:'unknown',
    observations:rows.length,
    uniqueCards:observedCardCount,
    sources,
    priceTypes,
    currencies,
    source: sources.length===1?sources[0]:'mixed',
    priceType: priceTypes.length===1?priceTypes[0]:'mixed',
    denominator: denominatorStatus==='provided'?expected:null,
    denominatorStatus,
    observedCardCount,
    coveragePercent:denominatorStatus==='provided'&&expected>0?Math.round(observedCardCount/expected*10000)/100:null,
    observationWindow:{
      earliest:timestamps[0]||null,
      latest:timestamps.at(-1)||null,
      status:timestamps.length?'observed':'unavailable'
    },
    separation:{groupBy:['source','price_type','currency','card_identity'],groups:new Set(rows.map(row=>row.comparison_key)).size},
    limitations:[
      '這是已核准外部觀測批次，不代表來源或整個市場的完整資料。',
      '不同來源、價格性質、幣別與卡片身份只在相同分組內比較。',
      '沒有官方卡數分母時，覆蓋率維持 unknown，不推定完整。'
    ]
  };
}

export function buildPriceHistoryCoverage(observations=[],options={}){
  if(!Array.isArray(observations))fail('OBSERVATIONS_INVALID','observations must be an array');
  const normalized=observations.map(value=>normalizePriceObservation(value,options));
  return coverageFrom(normalized,options);
}

export const summarizePriceHistoryCoverage=buildPriceHistoryCoverage;

/**
 * Build a bounded, dry-run history plan.  The result is data only: callers
 * decide whether and how to execute the returned upsert operations.
 */
export function planPriceHistory(observations=[],options={}){
  if(!Array.isArray(observations))fail('OBSERVATIONS_INVALID','observations must be an array');
  const requested=options.limit==null?DEFAULT_PLAN_LIMIT:Number(options.limit);
  if(!Number.isInteger(requested)||requested<1)fail('PLAN_LIMIT_INVALID','limit must be a positive integer');
  const limit=Math.min(requested,MAX_PLAN_LIMIT);
  const normalized=observations.map(value=>normalizePriceObservation(value,options)).sort(sortObservations);
  const cursor=cursorFrom(options.cursor);
  const candidates=cursor?normalized.filter(row=>afterCursor(row,cursor)):normalized;
  const page=candidates.slice(0,limit);
  const existing=Array.isArray(options.existingObservations)?options.existingObservations.map(normalizeExisting).sort(sortObservations):[];
  const existingByKey=new Set(existing.map(row=>row.observation_key));
  const groups=new Map();
  for(const row of existing){
    const group=groups.get(row.comparison_key)||[];
    group.push(row);
    groups.set(row.comparison_key,group);
  }
  for(const rows of groups.values())rows.sort(sortObservations);
  const upserts=[];
  const plannedByKey=new Set();
  const seenPageKeys=new Set();
  const skipped={duplicates:0,unchanged:0};
  for(const row of page){
    if(existingByKey.has(row.observation_key)||plannedByKey.has(row.observation_key)||seenPageKeys.has(row.observation_key)){skipped.duplicates++;continue}
    seenPageKeys.add(row.observation_key);
    const group=groups.get(row.comparison_key)||[];
    const sameTimestamp=group.find(previous=>previous.observed_at===row.observed_at);
    if(sameTimestamp&&sameTimestamp.amount!==row.amount)fail('CONFLICTING_OBSERVATIONS','same card/source/type/currency has two prices at one timestamp',{comparisonKey:row.comparison_key,observedAt:row.observed_at});
    if(sameTimestamp){skipped.duplicates++;continue}
    const previous=[...group].filter(candidate=>candidate.observed_at<row.observed_at).at(-1)||null;
    if(previous&&previous.amount===row.amount){skipped.unchanged++;continue}
    const comparison=previous?comparePriceObservations(previous,row):null;
    const planned=planRow(row,comparison,previous);
    upserts.push(planned);
    plannedByKey.add(row.observation_key);
    group.push(row);
    group.sort(sortObservations);
    groups.set(row.comparison_key,group);
  }
  const last=page.at(-1);
  const hasMore=candidates.length>page.length;
  const nextCursor=hasMore&&last?encodePriceHistoryCursor(last):null;
  const coverage=coverageFrom(page,options);
  return {
    version:PRICE_HISTORY_VERSION,
    dryRun:true,
    bounded:true,
    limit,
    cursor:options.cursor||null,
    nextCursor,
    hasMore,
    inputCount:observations.length,
    scanned:page.length,
    accepted:upserts.length,
    skipped,
    upserts,
    operations:upserts.map(row=>({type:'upsert',conflictTarget:['observation_key'],row})),
    coverage
  };
}

export const planPriceHistoryBatch=planPriceHistory;
export const buildPriceHistoryPlan=planPriceHistory;
export const createPriceHistoryPlan=planPriceHistory;
