import {createHash} from 'node:crypto';

/**
 * Safe, external-record-only enrichment for Yu-Gi-Oh Traditional Chinese
 * names. This module deliberately has no network client: a caller must supply
 * records obtained from a reviewed official or approved source.
 */

export const YUGIOH_GAME_ID='yugioh';
export const TARGET_LOCALE='zh-Hant-TW';
export const ENRICHMENT_PROVIDER='yugioh-zh-enrichment';
export const ENRICHMENT_VERSION=1;

const NAME_TYPES=new Set(['official','alias','romanized','search-alias']);
const DATA_STATUSES=new Set(['verified','pending','incomplete']);
const LOCALE_ALIASES=new Map([
  ['zh-hant-tw',TARGET_LOCALE],
  ['zh-hant',TARGET_LOCALE],
  ['zh-tw',TARGET_LOCALE],
  ['zh_tw',TARGET_LOCALE]
]);

const clean=value=>value==null?null:String(value).trim()||null;
const first=(object,keys)=>{
  if(!object||typeof object!=='object')return null;
  for(const key of keys){const value=object[key];if(value!=null&&String(value).trim()!=='')return value}
  return null;
};
const asArray=value=>Array.isArray(value)?value:value==null?[]:[value];
const unique=values=>[...new Set(values.filter(Boolean))];

function objectOrEmpty(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}

/** Normalize an identifier without removing punctuation or leading zeroes. */
export function normalizeYugiohIdentifier(value){
  const normalized=clean(value);
  return normalized?normalized.normalize('NFKC').toLocaleLowerCase():null;
}

/** Normalize an exact set/card code while retaining its meaningful syntax. */
export function normalizeYugiohCode(value){
  const normalized=clean(value);
  return normalized?normalized.normalize('NFKC')
    .replace(/[‐‑‒–—−]/g,'-')
    .replace(/\s+/g,'')
    .toLocaleUpperCase():null;
}

export function normalizeTraditionalChineseLocale(value){
  const normalized=clean(value);
  if(!normalized)return TARGET_LOCALE;
  return LOCALE_ALIASES.get(normalized.toLocaleLowerCase().replaceAll('_','-'))||null;
}

function normalizeName(value){
  const normalized=clean(value);
  return normalized?normalized.normalize('NFKC').replace(/[\u3000\s]+/g,' '):null;
}

function normalizeProvider(value){
  const normalized=clean(value);
  return normalized?normalized.normalize('NFKC').toLocaleLowerCase():null;
}

function normalizeCursor(value){
  const normalized=clean(value);
  return normalized?normalized.normalize('NFKC'):null;
}

function normalizeApprovedSources(value){
  if(value==null)return null;
  const values=value instanceof Set?[...value]:asArray(value);
  return new Set(values.map(normalizeProvider).filter(Boolean));
}

function normalizeProvenance(input,options){
  const inputProvenance=objectOrEmpty(input.provenance);
  const sourceValue=clean(first(input,['source'])||first(inputProvenance,['source'])||options.defaultSource);
  const source=sourceValue?sourceValue.normalize('NFKC'):null;
  const sourceUrl=clean(first(input,['sourceUrl','source_url'])||first(inputProvenance,['sourceUrl','source_url'])||options.defaultSourceUrl);
  const retrievedAt=clean(first(input,['retrievedAt','retrieved_at','observedAt','observed_at'])||first(inputProvenance,['retrievedAt','retrieved_at','observedAt','observed_at'])||options.retrievedAt);
  const approvalStatus=clean(first(input,['approvalStatus','approval_status'])||first(inputProvenance,['approvalStatus','approval_status'])||options.approvalStatus)||'caller-supplied';
  const approved=input.approved===false||inputProvenance.approved===false?false:true;
  return {source,sourceUrl,retrievedAt,approvalStatus,approved};
}

function normalizeRecordDetailed(input={},options={}){
  if(!input||typeof input!=='object'||Array.isArray(input))return {record:null,reason:'INVALID_SOURCE_RECORD'};
  const gameId=normalizeProvider(first(input,['gameId','game_id','game']))||YUGIOH_GAME_ID;
  if(gameId!==YUGIOH_GAME_ID)return {record:null,reason:'WRONG_GAME'};
  const localeInput=first(input,['locale','language','sourceLocale','source_locale']);
  const locale=normalizeTraditionalChineseLocale(localeInput);
  if(!locale)return {record:null,reason:'UNSUPPORTED_LOCALE'};

  const explicitName=first(input,['nameZh','name_zh','traditionalChineseName','traditional_chinese_name','zhHantName','zh_hant_name']);
  // A generic `name` is accepted only when the source row explicitly labels
  // itself as Traditional Chinese. This prevents an English/Japanese name
  // from being silently written into name_zh by a permissive fallback.
  const nameValue=explicitName||(localeInput&&locale===TARGET_LOCALE?first(input,['name']):null);
  const nameZh=normalizeName(nameValue);
  if(!nameZh)return {record:null,reason:'MISSING_TRADITIONAL_CHINESE_NAME'};

  const provenance=normalizeProvenance(input,options);
  if(!provenance.source)return {record:null,reason:'MISSING_PROVENANCE_SOURCE'};
  const approvedSources=normalizeApprovedSources(options.approvedSources);
  if(!provenance.approved)return {record:null,reason:'SOURCE_NOT_APPROVED'};
  if(approvedSources&&!approvedSources.has(normalizeProvider(provenance.source)))return {record:null,reason:'SOURCE_NOT_APPROVED'};

  const nameType=clean(first(input,['nameType','name_type']))||'official';
  if(!NAME_TYPES.has(nameType))return {record:null,reason:'UNSUPPORTED_NAME_TYPE'};
  const dataStatus=clean(first(input,['dataStatus','data_status']))||'pending';
  if(!DATA_STATUSES.has(dataStatus))return {record:null,reason:'UNSUPPORTED_DATA_STATUS'};

  const provider=normalizeProvider(first(input,['provider','providerName','provider_name','identityProvider','identity_provider']));
  const providerCardId=normalizeYugiohIdentifier(first(input,['providerCardId','provider_card_id','providerId','provider_id']));
  const officialId=normalizeYugiohIdentifier(first(input,['officialId','official_id','officialCardId','official_card_id']));
  const cardId=clean(first(input,['cardId','card_id']));
  const setCode=normalizeYugiohCode(first(input,['setCode','set_code']));
  const setName=normalizeYugiohCode(first(input,['setName','set_name','set']));
  const cardNumber=normalizeYugiohCode(first(input,['cardNumber','card_number','number','localCardNumber','local_card_number','cardCode','card_code'])
    || (setCode||setName?first(input,['officialCardNumber','official_card_number']):null));
  const cursor=normalizeCursor(first(input,['cursor','sourceCursor','source_cursor','offset']));
  const metadata=objectOrEmpty(input.metadata);
  const record={
    gameId:YUGIOH_GAME_ID,
    locale,
    nameZh,
    nameType,
    dataStatus,
    provider,
    providerCardId,
    officialId,
    cardId,
    setCode,
    setName,
    cardNumber,
    cursor,
    metadata,
    provenance
  };
  if(!providerCardId&&!officialId&&!cardId&&!(setCode||setName)&&!cardNumber){
    return {record,reason:'NO_EXACT_IDENTIFIER'};
  }
  return {record,reason:null};
}

/**
 * Normalize one externally supplied row. Invalid rows return null; the plan
 * function keeps the reason and reports it as unmatched instead of guessing.
 */
export function normalizeYugiohZhRecord(input={},options={}){
  const {record,reason}=normalizeRecordDetailed(input,options);
  return reason&&(!record||reason!=='NO_EXACT_IDENTIFIER')?null:record;
}

export const normalizeRecord=normalizeYugiohZhRecord;

function normalizeExistingCard(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const gameId=normalizeProvider(first(input,['gameId','game_id','game']))||YUGIOH_GAME_ID;
  const cardId=clean(first(input,['id','cardId','card_id']));
  if(!cardId)return null;
  const provider=normalizeProvider(first(input,['provider','source','identityProvider','identity_provider']));
  const providerCardId=normalizeYugiohIdentifier(first(input,['providerCardId','provider_card_id','providerId','provider_id']));
  const officialId=normalizeYugiohIdentifier(first(input,['officialId','official_id','officialCardId','official_card_id']));
  const setCodes=[],cardNumbers=[],officialNumbers=[];
  const addSet=value=>{const normalized=normalizeYugiohCode(value);if(normalized)setCodes.push(normalized)};
  const addNumber=value=>{const normalized=normalizeYugiohCode(value);if(normalized)cardNumbers.push(normalized)};
  const addOfficial=value=>{const normalized=normalizeYugiohIdentifier(value);if(normalized)officialNumbers.push(normalized)};
  const addPrinting=printing=>{
    if(!printing||typeof printing!=='object')return;
    for(const key of ['setCode','set_code','localSetCode','local_set_code','setName','set_name','set'])addSet(printing[key]);
    for(const key of ['cardNumber','card_number','localCardNumber','local_card_number','cardCode','card_code','number'])addNumber(printing[key]);
    for(const key of ['officialId','official_id','officialCardId','official_card_id'])addOfficial(printing[key]);
  };
  for(const key of ['setCode','set_code','localSetCode','local_set_code','setName','set_name','set'])addSet(input[key]);
  for(const key of ['cardNumber','card_number','localCardNumber','local_card_number','cardCode','card_code','number'])addNumber(input[key]);
  // The provider's numeric official_card_number is only indexed when a
  // source explicitly labels it as an official identity, avoiding accidental
  // cross-provider matches on an internal-looking number.
  for(const key of ['officialId','official_id','officialCardId','official_card_id'])addOfficial(input[key]);
  for(const printing of [
    ...asArray(input.printings),
    ...asArray(input.tcgPrintings),
    ...asArray(input.tcg_printings),
    ...asArray(input.metadata?.printings),
    ...asArray(input.metadata?.tcgPrintings),
    ...asArray(input.cardSets),
    ...asArray(input.card_sets)
  ])addPrinting(printing);

  const names=[];
  const addNameRow=row=>{
    // Bare strings do not carry a locale and may be English/Japanese aliases;
    // only a row explicitly labelled as Traditional Chinese is evidence here.
    if(typeof row==='string')return;
    if(!row||typeof row!=='object')return;
    const rowLocale=normalizeTraditionalChineseLocale(first(row,['locale','language','sourceLocale','source_locale']));
    if(rowLocale!==TARGET_LOCALE)return;
    const name=normalizeName(first(row,['name','nameZh','name_zh','localizedName','localized_name']));
    if(name)names.push(name);
  };
  for(const key of ['names','nameRows','name_rows','tcgCardNames','tcg_card_names','localizedNames','localized_names'])for(const row of asArray(input[key]))addNameRow(row);
  for(const key of ['nameZh','name_zh']){const name=normalizeName(input[key]);if(name)names.push(name)}

  return {
    raw:input,
    gameId,
    cardId,
    provider,
    providerCardId,
    officialId,
    setCodes:unique(setCodes),
    cardNumbers:unique(cardNumbers),
    officialNumbers:unique(officialNumbers),
    existingZhNames:unique(names)
  };
}

function keyStable(kind,gameId,value,provider=null){
  const normalized=normalizeYugiohIdentifier(value);
  if(!normalized)return null;
  return kind==='provider'
    ? `stable:provider:${gameId}:${normalizeProvider(provider)||'unknown'}:${normalized}`
    : `stable:${kind}:${gameId}:${normalized}`;
}

function stableKeys(identity){
  const keys=[];
  if(identity.cardId)keys.push({kind:'internal-card-id',key:keyStable('internal',identity.gameId,identity.cardId)});
  if(identity.officialId)keys.push({kind:'official-id',key:keyStable('official',identity.gameId,identity.officialId)});
  if(identity.providerCardId&&identity.provider)keys.push({kind:'provider-card-id',key:keyStable('provider',identity.gameId,identity.providerCardId,identity.provider)});
  // Existing provider IDs are intentionally not matched without their source
  // namespace. This is the guard against a numeric ID collision between data
  // providers.
  return keys.filter(entry=>entry.key);
}

function codeKeys(identity){
  const keys=[];
  const sets=identity.setCode||identity.setName?[...new Set([identity.setCode,identity.setName].filter(Boolean))]:identity.setCodes||[];
  const numbers=identity.cardNumber?[identity.cardNumber]:identity.cardNumbers||[];
  for(const setCode of sets)for(const cardNumber of numbers){
    const set=normalizeYugiohCode(setCode),number=normalizeYugiohCode(cardNumber);
    if(set&&number)keys.push({kind:'set-card-code',key:`code:${identity.gameId}:${set}:${number}`});
  }
  return keys;
}

function officialNumberKeys(identity){
  const keys=[];
  for(const value of identity.officialNumbers||[]){
    const normalized=normalizeYugiohIdentifier(value);
    if(normalized)keys.push({kind:'official-card-number',key:`number:${identity.gameId}:${normalized}`});
  }
  return keys;
}

function indexAdd(index,key,cardIndex){
  if(!key)return;
  const values=index.get(key)||new Set();
  values.add(cardIndex);index.set(key,values);
}

/** Build exact-match indexes for a supplied Yu-Gi-Oh card snapshot. */
export function buildYugiohExactIndexes(cards=[]){
  const normalizedCards=asArray(cards).map(normalizeExistingCard).filter(Boolean);
  const stable=new Map(),codes=new Map(),officialNumbers=new Map();
  normalizedCards.forEach((card,index)=>{
    for(const entry of stableKeys(card))indexAdd(stable,entry.key,index);
    for(const entry of codeKeys(card))indexAdd(codes,entry.key,index);
    for(const entry of officialNumberKeys(card))indexAdd(officialNumbers,entry.key,index);
  });
  return {cards:normalizedCards,stable,codes,officialNumbers};
}

function setUnion(values){
  const result=new Set();for(const value of values)for(const item of value||[])result.add(item);return result;
}

function exactMatch(record,indexes){
  const stableEntries=stableKeys(record);
  const stableHits=stableEntries.map(entry=>({entry,hit:indexes.stable.get(entry.key)||new Set()})).filter(value=>value.hit.size);
  if(stableHits.length){
    const candidates=setUnion(stableHits.map(value=>value.hit));
    if(candidates.size!==1){
      return {status:'ambiguous',reason:'AMBIGUOUS_STABLE_IDENTIFIER',candidates:[...candidates].map(i=>indexes.cards[i].cardId)};
    }
    const cardIndex=[...candidates][0];
    const codeHits=setUnion(codeKeys(record).map(entry=>indexes.codes.get(entry.key)||new Set()));
    if(codeHits.size&&(!codeHits.has(cardIndex)||codeHits.size>1))return {status:'ambiguous',reason:'CONFLICTING_EXACT_IDENTIFIERS',candidates:[...new Set([cardIndex,...codeHits])].map(i=>indexes.cards[i].cardId)};
    const selected=stableHits.sort((a,b)=>stableEntries.indexOf(a.entry)-stableEntries.indexOf(b.entry))[0].entry;
    return {status:'matched',cardIndex,matchedBy:selected.kind,identifier:selected.key};
  }

  const codeEntries=codeKeys(record);
  const codeHits=setUnion(codeEntries.map(entry=>indexes.codes.get(entry.key)||new Set()));
  if(codeHits.size){
    if(codeHits.size!==1)return {status:'ambiguous',reason:'AMBIGUOUS_SET_CARD_CODE',candidates:[...codeHits].map(i=>indexes.cards[i].cardId)};
    const selected=codeEntries.find(entry=>(indexes.codes.get(entry.key)||new Set()).size);
    return {status:'matched',cardIndex:[...codeHits][0],matchedBy:'set-card-code',identifier:selected?.key||null};
  }

  // An explicitly labelled official card number is an exact fallback only;
  // plain tcg_cards.official_card_number is not indexed by this module.
  const officialEntries=officialNumberKeys(record);
  const officialHits=setUnion(officialEntries.map(entry=>indexes.officialNumbers.get(entry.key)||new Set()));
  if(officialHits.size){
    if(officialHits.size!==1)return {status:'ambiguous',reason:'AMBIGUOUS_OFFICIAL_CARD_NUMBER',candidates:[...officialHits].map(i=>indexes.cards[i].cardId)};
    const selected=officialEntries.find(entry=>(indexes.officialNumbers.get(entry.key)||new Set()).size);
    return {status:'matched',cardIndex:[...officialHits][0],matchedBy:'official-card-number',identifier:selected?.key||null};
  }
  return {status:'unmatched',reason:'NO_EXACT_MATCH'};
}

function recordIdentityKey(record){
  const stable=stableKeys(record)[0]?.key;
  if(stable)return stable;
  const code=codeKeys(record)[0]?.key;
  if(code)return code;
  return `record:${hashPayload({gameId:record.gameId,locale:record.locale,nameZh:record.nameZh,source:record.provenance.source})}`;
}

function compareCursor(left,right){
  const a=normalizeCursor(left),b=normalizeCursor(right);
  if(a==null||b==null)return 0;
  if(/^\d+$/.test(a)&&/^\d+$/.test(b)){
    const ai=BigInt(a),bi=BigInt(b);return ai<bi?-1:ai>bi?1:0;
  }
  return a<b?-1:a>b?1:0;
}

function canonicalize(value){
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalize(value[key])]));
  return value;
}

function hashPayload(value){return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}

function safeCandidate(record){
  return {
    gameId:record.gameId,
    locale:record.locale,
    nameZh:record.nameZh,
    nameType:record.nameType,
    dataStatus:record.dataStatus,
    provider:record.provider,
    providerCardId:record.providerCardId,
    officialId:record.officialId,
    cardId:record.cardId,
    setCode:record.setCode,
    setName:record.setName,
    cardNumber:record.cardNumber,
    cursor:record.cursor,
    provenance:record.provenance
  };
}

function createNamePatch(record,target,match,now){
  const patch={
    card_id:target.cardId,
    locale:record.locale,
    name:record.nameZh,
    name_type:record.nameType,
    data_status:record.dataStatus,
    metadata:{
      enrichmentProvider:ENRICHMENT_PROVIDER,
      enrichmentVersion:ENRICHMENT_VERSION,
      matchedBy:match.matchedBy,
      matchedIdentifier:match.identifier,
      provenance:record.provenance
    }
  };
  if(record.provenance.source)patch.source=record.provenance.source;
  if(record.provenance.sourceUrl)patch.source_url=record.provenance.sourceUrl;
  if(now)patch.updated_at=now;
  return patch;
}

function createCardPatch(record,target,now){
  const patch={id:target.cardId,name_zh:record.nameZh};
  if(now)patch.updated_at=now;
  return patch;
}

function summarizeCounts(counts){return {...counts,total:counts.changed+counts.unchanged+counts.ambiguous+counts.unmatched}}

/**
 * Create a dry-run plan. No network request or database write is performed.
 *
 * `previousState` may be the returned state from an earlier run. A matching
 * checksum skips the repeat, while an explicit record cursor skips only rows
 * at or before that cursor. Source records without an exact identity are
 * reported as unmatched; their names are never used for an automatic write.
 */
export function planYugiohZhEnrichment({
  cards=[],
  records=[] ,
  sourceRecords,
  dryRun=true,
  cursor=null,
  previousState=null,
  skipRepeated=true,
  approvedSources,
  defaultSource=null,
  defaultSourceUrl=null,
  retrievedAt=null,
  approvalStatus=null,
  now=new Date().toISOString()
}={}){
  const rawRecords=sourceRecords??records;
  const normalizationOptions={approvedSources,defaultSource,defaultSourceUrl,retrievedAt,approvalStatus};
  const normalized=[];
  const invalid=[];
  asArray(rawRecords).forEach((raw,index)=>{
    const detail=normalizeRecordDetailed(raw,normalizationOptions);
    if(detail.record)normalized.push({record:detail.record,index,reason:detail.reason});
    else invalid.push({index,raw,reason:detail.reason});
  });

  const checksum=hashPayload(normalized.map(({record})=>safeCandidate(record)).sort((a,b)=>recordIdentityKey(a).localeCompare(recordIdentityKey(b))));
  const previousChecksum=clean(previousState?.checksum??previousState?.inputChecksum);
  const repeated=Boolean(skipRepeated&&previousChecksum&&previousChecksum===checksum);
  const requestedCursor=normalizeCursor(cursor??previousState?.cursor);
  const skippedByChecksum=repeated?normalized.length+invalid.length:0;
  const eligible=repeated?[]:normalized.filter(({record})=>{
    if(!requestedCursor||!record.cursor)return true;
    return compareCursor(record.cursor,requestedCursor)>0;
  });
  const skippedByCursor=repeated?0:normalized.filter(({record})=>requestedCursor&&record.cursor&&compareCursor(record.cursor,requestedCursor)<=0).length;
  const eligibleInvalid=repeated?[]:invalid.filter(item=>!requestedCursor||!item.raw?.cursor||compareCursor(item.raw.cursor,requestedCursor)>0);

  const indexes=buildYugiohExactIndexes(cards);
  const results=[];
  const tcgCards=[],tcgCardNames=[];
  const counts={input:asArray(rawRecords).length,normalized:normalized.length,considered:eligible.length+eligibleInvalid.length,changed:0,unchanged:0,ambiguous:0,unmatched:0,skippedByCursor,skippedByChecksum,skippedDuplicate:0};

  const duplicateGroups=new Map();
  for(const item of eligible){
    if(item.reason)continue;
    const key=recordIdentityKey(item.record),group=duplicateGroups.get(key)||[];
    group.push(item);duplicateGroups.set(key,group)
  }
  const duplicateConflictKeys=new Set();
  for(const group of duplicateGroups.values())if(unique(group.map(item=>item.record.nameZh)).length>1)duplicateConflictKeys.add(recordIdentityKey(group[0].record));
  const consumedDuplicateKeys=new Set();

  for(const item of eligible){
    const record=item.record,key=recordIdentityKey(record);
    if(item.reason){
      counts.unmatched++;
      results.push({index:item.index,status:'unmatched',reason:item.reason,candidate:safeCandidate(record),provenance:record.provenance});
      continue;
    }
    if(consumedDuplicateKeys.has(key)){
      counts.unchanged++;counts.skippedDuplicate++;
      results.push({index:item.index,status:'unchanged',reason:'DUPLICATE_SOURCE_RECORD',candidate:safeCandidate(record),provenance:record.provenance});
      continue;
    }
    consumedDuplicateKeys.add(key);
    if(duplicateConflictKeys.has(key)){
      counts.ambiguous++;
      results.push({index:item.index,status:'ambiguous',reason:'CONFLICTING_SOURCE_RECORDS',candidate:safeCandidate(record),provenance:record.provenance});
      continue;
    }
    const match=exactMatch(record,indexes);
    if(match.status==='ambiguous'){
      counts.ambiguous++;
      results.push({index:item.index,status:'ambiguous',reason:match.reason,candidates:match.candidates,candidate:safeCandidate(record),provenance:record.provenance});
      continue;
    }
    if(match.status!=='matched'){
      counts.unmatched++;
      results.push({index:item.index,status:'unmatched',reason:match.reason,candidate:safeCandidate(record),provenance:record.provenance});
      continue;
    }
    const target=indexes.cards[match.cardIndex];
    const existingNames=new Set(target.existingZhNames);
    if(existingNames.size&&![...existingNames].includes(record.nameZh)){
      counts.ambiguous++;
      results.push({index:item.index,status:'ambiguous',reason:'EXISTING_NAME_CONFLICT',cardId:target.cardId,matchedBy:match.matchedBy,candidate:safeCandidate(record),provenance:record.provenance});
      continue;
    }
    if(existingNames.has(record.nameZh)){
      counts.unchanged++;
      results.push({index:item.index,status:'unchanged',reason:'NAME_ALREADY_PRESENT',cardId:target.cardId,matchedBy:match.matchedBy,candidate:safeCandidate(record),provenance:record.provenance});
      continue;
    }
    counts.changed++;
    const cardPatch=createCardPatch(record,target,now),namePatch=createNamePatch(record,target,match,now);
    tcgCards.push(cardPatch);tcgCardNames.push(namePatch);
    results.push({index:item.index,status:'changed',reason:'EXACT_MATCH_NAME_MISSING',cardId:target.cardId,matchedBy:match.matchedBy,matchedIdentifier:match.identifier,candidate:safeCandidate(record),patch:{tcg_cards:cardPatch,tcg_card_names:namePatch},provenance:record.provenance});
  }

  for(const item of eligibleInvalid){
    counts.unmatched++;
    results.push({index:item.index,status:'unmatched',reason:item.reason,candidate:null});
  }

  const processed=[...eligible].map(item=>item.record).filter(Boolean);
  const nextCursor=processed.map(record=>record.cursor).filter(Boolean).at(-1)||requestedCursor||null;
  const state={provider:ENRICHMENT_PROVIDER,version:ENRICHMENT_VERSION,checksum,cursor:nextCursor,processedRecords:eligible.length+eligibleInvalid.length,generatedAt:now};
  const sources=unique(normalized.map(({record})=>record.provenance.source));
  const summary=summarizeCounts(counts);
  return {
    provider:ENRICHMENT_PROVIDER,
    game:YUGIOH_GAME_ID,
    locale:TARGET_LOCALE,
    dryRun:Boolean(dryRun),
    summary,
    counts:summary,
    results,
    patches:{tcg_cards:tcgCards,tcg_card_names:tcgCardNames},
    state,
    incremental:{
      checksum,
      previousChecksum,
      repeated,
      cursor:requestedCursor,
      nextCursor,
      skippedByCursor,
      skippedByChecksum
    },
    provenance:{
      provider:ENRICHMENT_PROVIDER,
      version:ENRICHMENT_VERSION,
      locale:TARGET_LOCALE,
      sources,
      collection:'external-records-only',
      sourceReviewRequired:true,
      generatedAt:now
    }
  };
}

export const createYugiohZhEnrichmentPlan=planYugiohZhEnrichment;

/**
 * Adapter facade used by a future sync worker. It accepts records supplied by
 * the caller and intentionally exposes no crawler or fetch implementation.
 */
export function createYugiohZhEnrichmentProvider(options={}){
  return {
    id:ENRICHMENT_PROVIDER,
    game:YUGIOH_GAME_ID,
    locale:TARGET_LOCALE,
    mode:'external-records',
    collectionEnabled:false,
    requiresExternalRecords:true,
    normalizeRecord:record=>normalizeYugiohZhRecord(record,options),
    plan:input=>planYugiohZhEnrichment({...input,...options,approvedSources:input?.approvedSources??options.approvedSources})
  };
}
