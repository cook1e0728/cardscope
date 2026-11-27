import { marketEventsFor, catalogEventsFrom, mergeMarketEvents } from './providers/market-events.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { crossVersionLowestPrices, matchYgoprodeckSet, searchYgoProDeck } from './providers/ygoprodeck.mjs';
import { fetchTcgdexPricing, fetchTcgdexPricingEn, tcgdexLookupForPrinting } from './providers/tcgdex-pricing.mjs';
import { createGradedPrices } from './providers/graded-prices.mjs';
import { createEbayListings } from './providers/ebay-listings.mjs';
import { createPriceSnapshotController } from './providers/price-snapshot.mjs';
import { createPageStats, createCardHotStats, isBot } from './providers/page-stats.mjs';
import { createTcgapiPricing } from './providers/tcgapi-pricing.mjs';
import { createArchiveReader, createArchiveStorage, createPriceArchiveController, mergeSnapshotRows } from './providers/price-archive.mjs';
import { REFERENCE_BODY_MAX_BYTES, buildReferencePrices, referenceQueryParams, validateReferenceRequest } from './providers/collection-valuation.mjs';
import { normalizeMarketRecord, withTwd, RARITY_RANKINGS, rarityCanonicalCode as normalizeRarityCanonicalCode, rarityDisplayLabel as normalizeRarityDisplayLabel, rarityRank as normalizeRarityRank, rarityToken as normalizeRarityToken, rarityDefinition as normalizeRarityDefinition } from './providers/normalize.mjs';
import { auditCatalogLinks, catalogProvidersNeedingSync, closeInterruptedCatalogRuns, localizeProductName, refreshBrowseKeys, syncCatalog } from './providers/catalog-sync.mjs';
import { cacheYugiohImages, yugiohImageStatus } from './providers/image-cache.mjs';
import { anniversaryTerms, buildSeriesIndex, foldSearch, foldedSpan, gameHintFor, parseSearchQuery, postgrestLike, printingMatchesRarity, rarityMatchValues, rarityOnlyExample } from './providers/search-query.mjs';
import { normalizeProduct } from './providers/products.mjs';
import { PACK_PRIZE_GAMES, PACK_PRIZE_LIMIT, PACK_PRIZE_WINDOW_DAYS, SERIES_HIT_FETCH, SERIES_HIT_PER_GAME, buildSeriesHits, prizeCards, mergePrizeRows, prizeRow, prizeSeriesCandidates } from './providers/pack-prizes.mjs';
import { catalogCollectionAllowed, filterAllowedCatalogProviders, imageCollectionAllowed, imageDisplayPolicies, imageRightsAllowDisplay, publicSourcePolicies, sourceDisplayDenied, sourcePolicySummary } from './providers/source-policy.mjs';
import { aggregateCatalogBaselines } from './providers/catalog-baseline.mjs';
import { chunkCardIds, createBoundedSnapshotCache, createRateLimiter, imageSourceOf, summarizeImageHealth } from './providers/backend-reliability.mjs';
import './collection-store.js'; // 瀏覽器與伺服器共用的收藏驗證與合併規則（掛在 globalThis.CollectionStore）
import { createAuthSyncController, googleCallbackLocation } from './providers/auth-sync.mjs';
import { SITEMAP_MAX_URLS, applyNoindexToHtml, applySeoToHtml, cardSeo, cardSitemapEntries, chunkEntries, homeSeo, mergeCardSitemapRows, normalizeBaseUrl, pageSitemapEntries, renderRobotsTxt, renderSitemapIndex, renderUrlSet, seriesSeo, seriesSitemapEntries, viewSeo, withSeriesPages } from './providers/seo.mjs';
import { API_CSP, NOT_FOUND_HTML, PUBLIC_STATIC, REVALIDATE_EXTENSIONS, SECURITY_HEADERS, buildPageCsp, inlineScripts, mergeVaryHeader, renderSecurityTxt, seoRequestTarget } from './providers/http-security.mjs';
import { BASE_CATALOG_GAME_IDS, CATALOG_REGION_IDS, MAIN_ONLY_PATH, SECOND_DB_GAMES, dbForGame, dbForId } from './providers/supabase-client.mjs';
import {
  ALLOWED_CURRENCIES,
  ALLOWED_PLATFORMS,
  BROWSE_CACHE_MS,
  BROWSE_CARD_SELECT,
  BROWSE_IMAGE_SELECT,
  BROWSE_PAGE_MAX,
  BROWSE_PRICE_SORTS,
  BROWSE_PRINTING_SELECT,
  BROWSE_RARITY_FORMAT,
  BROWSE_SERIES_FALLBACK_MAX,
  CATALOG_GAMES_PATH,
  CATALOG_SERIES_PATH,
  DB_NEAR_LIMIT_BYTES,
  FX_CACHE_MS,
  FX_JUMP_LIMIT,
  FX_JUMP_WINDOW_MS,
  HOME_EVENTS_PAST_DAYS,
  HOT_CARDS_DAYS,
  HOT_CARDS_LIMIT,
  HOT_CARDS_MIN_OPENS,
  MARKET_CACHE_MS,
  MAX_PRICE,
  ONEPIECE_IMAGE_HOSTS,
  ONEPIECE_IMAGE_MAX_BYTES,
  ONEPIECE_IMAGE_MIMES,
  PRICE_HISTORY_DAYS,
  PRICE_HISTORY_IDS_MAX,
  PRICE_MOVERS_DAYS,
  PRICE_MOVERS_MIN_EUR,
  PUBLIC_REPORT_SELECT,
  SEARCH_CANDIDATE_LIMIT,
  SEARCH_PAGE_MAX,
  SEARCH_PATTERNS_MAX,
  SEARCH_RESULT_LIMIT,
  SEARCH_SERIES_IDS_MAX,
  SERIES_ZH_ENTRIES,
  SHORT_CACHE,
  TCGDEX_EN_SET_MAP,
  UPSTREAM_ERROR,
  accumulateCoverage,
  adjustCoverageGame,
  amountToTwd,
  attachCatalogBaselines,
  browseHasUsableImage,
  browseRarityRank,
  browseValues,
  buildBrowseFacets,
  buildBrowsePage,
  buildCoverageGame,
  buildCuratedProducts,
  buildFallbackCatalogCoverage,
  buildHotCardsPayload,
  buildPriceMovers,
  buildPrintingIndex,
  buildProductSetsFromSources,
  buildStats,
  buildVersionPrices,
  canonicalizeCatalog,
  cardImageFields,
  cardMatchRank,
  cardNumberTerms,
  catalogBaselineReport,
  chunkDatabaseRelationCardIds as coreChunkDatabaseRelationCardIds,
  compareIsoDesc,
  coverageFreshness,
  coverageIso,
  coverageMetric,
  createCoverageAccumulator,
  databaseRelationQuery,
  finishCoverage,
  fxJump,
  getFallbackCatalogCopy,
  hydrateBrowseCard,
  mergeCatalogRows,
  normalizeBrowseRarity,
  normalizeBrowseRegion,
  normalizeBrowseSort,
  normalizeSearch,
  onePieceImageTarget,
  pokemonProductNameZh,
  priceHistoryCardIds,
  productFeedMeta,
  providerStatusFromEnv,
  rarityCanonicalCode,
  rarityCanonicalToken,
  rarityDisplayLabel,
  readBoundedBytes,
  referenceChange,
  referencePriceFromRow,
  regionLabel,
  searchQueryTerms,
  searchTimedOut,
  sourceMarkupTerms,
  storageStatus,
  suggestBody,
  tcgdexLookups,
  trendObservationWindow,
  trendRecordKey,
  uniqueValues,
  validCardId,
  withTimeout as coreWithTimeout
} from './providers/catalog-core.mjs';

const nativeFetch = globalThis.fetch;
const fetch = (url, options={}) => nativeFetch(url,{...options,signal:options.signal||AbortSignal.timeout(12000)});

const root = fileURLToPath(new URL('.', import.meta.url));
const rarityRankings = RARITY_RANKINGS;
const port = Number(process.env.PORT || 4173);
const jpyToTwdFallback = Number(process.env.JPY_TO_TWD || 0.22);
const usdToTwdFallback = Number(process.env.USD_TO_TWD || 32);
const fxCache = { data:null, expiresAt:0 };
const CATALOG_GAME_IDS = new Set(BASE_CATALOG_GAME_IDS);
// 第二個 Supabase 專案（docs/UA_SECOND_DB_PLAN.md）收的遊戲：卡片、系列 id 都以「遊戲 id-」開頭。沒設 SUPABASE2_URL／SUPABASE2_SERVICE_KEY 時這些遊戲不存在，正式站照舊。
if (secondDbConfigured()) for (const game of SECOND_DB_GAMES) CATALOG_GAME_IDS.add(game);
// 第二庫只是補充：跨遊戲的查詢（目錄、搜尋）等它最多這麼久，逾時或失敗就只回主庫。
const SECOND_DB_TIMEOUT_MS = Number(process.env.SUPABASE2_TIMEOUT_MS || 4000);
// Faceted browsing reads the complete selected game before pagination so the
// counts stay truthful. Reuse that snapshot across normal browsing sessions
// instead of repeating the same database scan on every filter interaction.
const browseCache=new Map();
const BROWSE_CACHE_ROWS_MAX = 5000;
const RELATION_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.CATALOG_RELATION_BATCH_SIZE) || 100));
const RELATION_QUERY_MAX_BYTES = 8 * 1024;
const RELATION_QUERY_CONCURRENCY = 4;
const RELATION_SCAN_PAGE_SIZE = 1000;
const SNAPSHOT_TTL_MS = Math.max(1000, Number(process.env.CATALOG_SNAPSHOT_CACHE_MS) || BROWSE_CACHE_MS);
const SNAPSHOT_MAX_STALE_MS = Math.max(1000, Number(process.env.CATALOG_SNAPSHOT_MAX_STALE_MS) || 24 * 60 * 60 * 1000);
// The health and coverage snapshots take 10-15 s on the database: serve the last one while one background load refreshes it.
const catalogHealthCache = createBoundedSnapshotCache({ttlMs:SNAPSHOT_TTL_MS,maxStaleMs:SNAPSHOT_MAX_STALE_MS,serveStaleWhileRevalidate:true});
// 覆蓋率每次重算要整庫掃描（正式站曾量到 125 秒），資料又很少變：一小時才背景重算一次。
const COVERAGE_TTL_MS = Math.max(1000, Number(process.env.CATALOG_SNAPSHOT_CACHE_MS) || 60 * 60 * 1000);
const catalogCoverageCache = createBoundedSnapshotCache({ttlMs:COVERAGE_TTL_MS,maxStaleMs:SNAPSHOT_MAX_STALE_MS,serveStaleWhileRevalidate:true});
const TREND_CACHE_MS = 5 * 60 * 1000;
const trendCache = {data:null,expiresAt:0,promise:null};

const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json'};
// 公開白名單與安全標頭、CSP、404 頁面改由 providers/http-security.mjs 統一產生（Node 與 Worker 共用）。
// 內容雜湊 ETag：靜態頁與 SEO 頁共用，If-None-Match 對得上就回 304。
const etagHash=content=>createHash('sha1').update(content).digest('hex');
const etagOf=content=>`"${etagHash(content)}"`,etagMatches=(req,etag)=>String(req.headers['if-none-match']||'').split(',').some(value=>value.trim().replace(/^W\//,'')===etag);
// 回應壓縮：只壓縮 >= 1 KB 的文字類回應，br（品質 5）優先於 gzip；靜態檔壓縮結果快取在記憶體（上限 20 MB，依內容雜湊為鍵）。
const COMPRESS_MIN_BYTES=1024,STATIC_COMPRESS_CACHE_MAX_BYTES=20*1024*1024;
const BROTLI_OPTIONS={params:{[zlibConstants.BROTLI_PARAM_QUALITY]:5}};
const COMPRESSIBLE_TYPES=new Set(['text/html','text/css','text/javascript','application/javascript','application/json','application/manifest+json','image/svg+xml','application/xml','text/xml','text/plain']);
const isCompressibleType=contentType=>COMPRESSIBLE_TYPES.has(String(contentType||'').split(';')[0].trim().toLowerCase());
function chooseEncoding(req){
  const header=String(req?.headers?.['accept-encoding']||'').toLowerCase();
  if(!header)return null;
  const accepted=new Map();
  for(const part of header.split(',')){
    const [rawCoding,...params]=part.trim().split(';'),coding=rawCoding.trim();
    if(!coding)continue;
    let q=1;
    for(const param of params){const [k,v]=param.trim().split('=');if(k==='q'){const parsed=Number(v);q=Number.isFinite(parsed)?parsed:0}}
    if(!accepted.has(coding)||q>accepted.get(coding))accepted.set(coding,q);
  }
  if(accepted.get('br')>0)return 'br';
  if(accepted.get('gzip')>0)return 'gzip';
  return null;
}
const staticCompressCache=new Map();let staticCompressCacheBytes=0;
function getCachedCompressed(key){const hit=staticCompressCache.get(key);if(!hit)return null;staticCompressCache.delete(key);staticCompressCache.set(key,hit);return hit}
function setCachedCompressed(key,buf){
  if(!Buffer.isBuffer(buf)||buf.length>STATIC_COMPRESS_CACHE_MAX_BYTES)return;
  const prev=staticCompressCache.get(key);
  if(prev){staticCompressCache.delete(key);staticCompressCacheBytes-=prev.length}
  while(staticCompressCacheBytes+buf.length>STATIC_COMPRESS_CACHE_MAX_BYTES&&staticCompressCache.size){const oldestKey=staticCompressCache.keys().next().value,oldest=staticCompressCache.get(oldestKey);staticCompressCache.delete(oldestKey);staticCompressCacheBytes-=oldest.length}
  staticCompressCache.set(key,buf);staticCompressCacheBytes+=buf.length;
}
const compressBuffer=(buf,encoding)=>encoding==='br'?brotliCompressSync(buf,BROTLI_OPTIONS):gzipSync(buf);
const requestOfResponse=new WeakMap();
function sendResponse(res,status,body,headers={},{etag=false,cacheCompressed=false}={}){
  const req=requestOfResponse.get(res),buf=Buffer.isBuffer(body)?body:Buffer.from(body??'','utf8'),outHeaders={};
  let contentType='',hasContentEncoding=false,varyKey=null;
  for(const [name,value] of Object.entries(headers)){
    const lower=name.toLowerCase();
    if(lower==='content-length')continue;
    if(lower==='content-type')contentType=value;
    if(lower==='content-encoding')hasContentEncoding=true;
    if(lower==='vary')varyKey=name;
    outHeaders[name]=value;
  }
  outHeaders[varyKey||'Vary']=mergeVaryHeader(varyKey?outHeaders[varyKey]:'');
  const encoding=!hasContentEncoding&&isCompressibleType(contentType)&&buf.length>=COMPRESS_MIN_BYTES?chooseEncoding(req):null;
  let baseHash=null;
  if(etag){
    baseHash=etagHash(buf);
    const tag=encoding?`"${baseHash}-${encoding==='br'?'br':'gz'}"`:`"${baseHash}"`;
    outHeaders.ETag=tag;
    if(req&&etagMatches(req,tag)){res.writeHead(304,{'Cache-Control':outHeaders['Cache-Control']||'no-cache',ETag:tag,Vary:outHeaders[varyKey||'Vary']});return res.end()}
  }
  let outBuf=buf;
  if(encoding){
    if(cacheCompressed){
      const key=`${baseHash||etagHash(buf)}:${encoding}`,cached=getCachedCompressed(key);
      if(cached)outBuf=cached;
      else{outBuf=compressBuffer(buf,encoding);setCachedCompressed(key,outBuf)}
    }else outBuf=compressBuffer(buf,encoding);
    outHeaders['Content-Encoding']=encoding;
  }
  outHeaders['Content-Length']=String(outBuf.length);
  res.writeHead(status,outHeaders);
  res.end(req?.method==='HEAD'?undefined:outBuf);
}
// 感測器留給自己：look-effects.js 的手機傾斜卡片要讀 device orientation／motion。
// 強制：script-src 只允許同源 .js 與 index.html 內 inline <script> 的 SHA-256（啟動時由檔案算出，不用 nonce：nonce 會與 ETag 304、service worker 快取的舊頁對不上）；沒有 unsafe-inline、也沒有 inline 事件屬性（script-src-attr 'none'，改用 ui-actions.js 的事件委派）。擋的是外部腳本、未列出的圖片主機、被嵌入框架。新增卡圖來源時要把主機加進 img-src，否則圖片會被擋；改 index.html 的 inline script 不必動這裡，重啟即重算。
const INLINE_SCRIPT_SOURCES=(()=>{try{return inlineScripts(readFileSync(join(root,'index.html'),'utf8')).map(code=>`'sha256-${createHash('sha256').update(code).digest('base64')}'`)}catch{return[]}})();
const CSP=buildPageCsp(INLINE_SCRIPT_SOURCES);
// 目錄類回應每份 1–3 MB：讓瀏覽器 1 分鐘內重用、5 分鐘內先用舊的再背景更新，免得每次換頁重抓。
const json = (res,status,body,headers={})=>sendResponse(res,status,JSON.stringify(body),{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
// 公開回應不帶底層錯誤原文（supabaseFetch 的訊息含 PostgREST 回應，會露出表／欄位／函式名）：原文只進日誌，回應給固定訊息或代碼。
// 瀏覽器導覽到不存在的路徑給簡單的繁中 404 頁（可回首頁）；/api/ 仍回 JSON，程式端才解析得了。
const notFound=(res,pathname)=>{if(pathname.startsWith('/api/'))return json(res,404,{error:'Not found'});return sendResponse(res,404,NOT_FOUND_HTML,{'Content-Type':types['.html'],'Cache-Control':'no-store'})};
const failJson=(res,status,label,error,headers)=>{console.error(label,error?.message||error);return json(res,status,{error:'資料暫時無法讀取'},headers)},publicReason=(label,error)=>{console.error(label,error?.message||error);return UPSTREAM_ERROR};

async function proxyOnePieceImage(res,value){
  const target=onePieceImageTarget(value);
  if(!target)return json(res,400,{error:'不支援的圖片來源'});
  let response;
  try{response=await nativeFetch(target,{redirect:'error',headers:{Accept:'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8','User-Agent':'CardScope/1.0'},signal:AbortSignal.timeout(20000)})}
  catch{return json(res,502,{error:'官方卡圖暫時無法讀取'})}
  const contentType=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),length=Number(response.headers.get('content-length')||0);
  if(!response.ok||!ONEPIECE_IMAGE_MIMES.has(contentType)||(length&&length>ONEPIECE_IMAGE_MAX_BYTES)){response.body?.cancel?.().catch(()=>{});return json(res,502,{error:'官方卡圖回應無效'})}
  let body;
  try{body=await readBoundedBytes(response,ONEPIECE_IMAGE_MAX_BYTES)}
  catch(error){return json(res,502,{error:error?.code==='IMAGE_TOO_LARGE'?'官方卡圖超過大小限制':'官方卡圖暫時無法讀取'})}
  res.writeHead(200,{'Content-Type':contentType,'Content-Length':String(body.byteLength),'Cache-Control':'public, max-age=86400, stale-while-revalidate=604800','X-Content-Type-Options':'nosniff'});
  res.end(body);
}

const providerStatus=()=>({
  ...providerStatusFromEnv(process.env),
  snkrdunk:{enabled:false,capability:'只提供外連（link-only），不抓資料；尚未申請授權（not-requested）'}
});

function supabaseConfigured(){return Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_KEY)}
function secondDbConfigured(){return Boolean(process.env.SUPABASE2_URL&&process.env.SUPABASE2_SERVICE_KEY)}
// Which project a call goes to: options.db when given, else the scope set by withDb (a game page, a card or series id), else the main one.
// Prices, reports, stats and sync runs exist only in the main project, whatever the scope.
const dbScope=new AsyncLocalStorage();
const withDb=(db,task)=>dbScope.run(db,task);
function supabaseTarget(pathAndQuery,db){
  const which=db||(MAIN_ONLY_PATH.test(pathAndQuery)?'main':dbScope.getStore()||'main');
  const [base,key]=which==='ip2'?[process.env.SUPABASE2_URL,process.env.SUPABASE2_SERVICE_KEY]:[process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY];
  if(!base||!key)throw new Error(which==='ip2'?'SUPABASE2_NOT_CONFIGURED':'SUPABASE_NOT_CONFIGURED');
  return {base,key};
}
async function supabaseFetch(pathAndQuery,{db,...options}={}){
  const {base,key}=supabaseTarget(pathAndQuery,db);
  const response=await fetch(`${base}/rest/v1${pathAndQuery}`,{...options,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(options.headers||{})}});
  if(!response.ok){const text=await response.text().catch(()=>'');throw new Error(`SUPABASE_${response.status}:${text.slice(0,200)}`)}
  const text=await response.text(); if(!text)return null; try{return JSON.parse(text)}catch{return null}
}

async function supabaseFetchPage(pathAndQuery,{db}={}){
  const {base,key}=supabaseTarget(pathAndQuery,db);
  const response=await fetch(`${base}/rest/v1${pathAndQuery}`,{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json',Prefer:'count=exact'}});
  if(!response.ok){const text=await response.text().catch(()=>'');throw new Error(`SUPABASE_${response.status}:${text.slice(0,200)}`)}
  const contentRange=String(response.headers.get('content-range')||''),totalToken=contentRange.split('/').at(-1),total=/^\d+$/.test(totalToken)?Number(totalToken):null;
  return {data:await response.json(),total};
}

async function loadStoredTwdRates(){
  try{
    const rows=await supabaseFetch('/exchange_rates?select=currency,rate_to_twd,rate_date,source,fetched_at&order=fetched_at.desc&limit=30');
    if(!Array.isArray(rows)||!rows.length)return null;
    const latest=new Map(); for(const row of rows)if(!latest.has(row.currency))latest.set(row.currency,row);
    if(!['JPY','USD','EUR'].every(c=>latest.has(c)))return null;
    const times=[...latest.values()].map(r=>new Date(r.fetched_at).getTime()).filter(Number.isFinite).sort((a,b)=>b-a);
    if(!times[0])return null;
    const rates={TWD:1}; for(const [currency,row] of latest){const rate=Number(row.rate_to_twd);if(Number.isFinite(rate)&&rate>0)rates[currency]=rate}
    return {rates,updatedAt:latest.get('JPY')?.rate_date||null,fetchedAt:new Date(times[0]).toISOString(),source:`Supabase cache (${latest.get('JPY')?.source||'unknown'})`};
  }catch{return null}
}
async function saveTwdRates(data){
  if(!supabaseConfigured())return;
  const rateDate=data.updatedAt||new Date().toISOString().slice(0,10),fetchedAt=data.fetchedAt||new Date().toISOString();
  const rows=Object.entries(data.rates).filter(([c])=>c!=='TWD').map(([currency,rate])=>({currency,rate_to_twd:Number(rate),rate_date:rateDate,source:data.source,fetched_at:fetchedAt}));
  await supabaseFetch('/exchange_rates?on_conflict=currency,rate_date',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify(rows)});
}
async function getTwdRates(){
  if(fxCache.data&&fxCache.expiresAt>Date.now())return fxCache.data;
  const stored=supabaseConfigured()?await loadStoredTwdRates():null,storedAge=stored?Date.now()-new Date(stored.fetchedAt).getTime():Infinity;
  if(storedAge<FX_CACHE_MS){fxCache.data=stored;fxCache.expiresAt=Date.now()+Math.max(60000,FX_CACHE_MS-storedAge);return stored}
  // 抓不到或被擋下時沿用資料庫裡最後一次的匯率（再舊也比寫死的值準），完全沒有才用寫死的值。
  const fallback=stored||{rates:{TWD:1,JPY:jpyToTwdFallback,USD:usdToTwdFallback,EUR:35},updatedAt:null,fetchedAt:new Date().toISOString(),source:'fallback'};
  try{
    // Frankfurter（歐洲央行）沒有新台幣；改用 ExchangeRate-API 的免金鑰端點，條款要求標示來源（前端附連結）。
    const response=await fetch('https://open.er-api.com/v6/latest/TWD'); if(!response.ok)throw new Error(`FX_${response.status}`);
    const body=await response.json(),rates={TWD:1}; if(body.result!=='success')throw new Error('FX_RESULT'); for(const currency of ['JPY','USD','EUR','KRW','HKD']){const value=Number(body.rates?.[currency]);if(Number.isFinite(value)&&value>0)rates[currency]=1/value} if(!['JPY','USD','EUR'].every(c=>rates[c]))throw new Error('FX_INCOMPLETE');
    const jump=storedAge<FX_JUMP_WINDOW_MS&&fxJump(stored.rates,rates);if(jump)throw new Error(`FX_JUMP_${jump}`);
    const data={rates,updatedAt:body.time_last_update_utc?new Date(body.time_last_update_utc).toISOString().slice(0,10):null,fetchedAt:new Date().toISOString(),source:'ExchangeRate-API'};fxCache.data=data;fxCache.expiresAt=Date.now()+FX_CACHE_MS;saveTwdRates(data).catch(()=>{});return data;
  }catch(error){console.error('fx fetch failed',error.message);fxCache.data=fallback;fxCache.expiresAt=Date.now()+60*60*1000;return fallback}
}
const decodeHtml=s=>String(s||'').replace(/&#(\d+);/g,(_,value)=>String.fromCodePoint(Number(value))).replace(/&#x([0-9a-f]+);/gi,(_,value)=>String.fromCodePoint(Number.parseInt(value,16))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#039;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
async function supabaseFetchAll(pathAndQuery,pageSize=1000){const rows=[];for(let offset=0;;offset+=pageSize){const separator=pathAndQuery.includes('?')?'&':'?',batch=await supabaseFetch(`${pathAndQuery}${separator}limit=${pageSize}&offset=${offset}`);rows.push(...(batch||[]));if(!batch||batch.length<pageSize)return rows}}
// F4：每天各類頁面被開幾次，只存總數（不記 IP、UA、網址參數、來源頁）；記憶體累計，每 10 分鐘與收到 SIGTERM 時寫進 page_stats_daily。
const pageStats=createPageStats({db:supabaseFetch,enabled:supabaseConfigured,intervalMs:Number(process.env.PAGE_STATS_FLUSH_MS)||10*60*1000});
// 每天被開最多次的卡（使用者 2026-11-12 同意）：只記卡片 ID 與次數、不記是誰開的；前端開卡片時帶 ?open=1，非機器人才算；資料庫每天只留前 50 名（card_hot_add）。
const cardHot=createCardHotStats({db:supabaseFetch,enabled:supabaseConfigured,intervalMs:Number(process.env.PAGE_STATS_FLUSH_MS)||10*60*1000});
// C3：資料庫大小。免費方案上限 500 MB，價格快照自動煞車在 440 MB（SNAPSHOT_DB_BRAKE_BYTES），所以 430 MB 就先讓外部監測亮燈。公開端點只給 ok／near-limit／unknown，不給位元組數。
const STORAGE_CACHE_MS=60*60*1000,STORAGE_RETRY_MS=60*1000,storageCaches={main:{data:null,expiresAt:0,promise:null,retryAt:0},ip2:{data:null,expiresAt:0,promise:null,retryAt:0}};
// db 'ip2' is the second project (its own 500 MB); asking it every hour also keeps that free project from pausing after 7 idle days.
function loadStorageReport(db='main'){
  if(!(db==='ip2'?secondDbConfigured():supabaseConfigured()))return Promise.resolve(null);
  const storageCache=storageCaches[db];
  if(storageCache.data&&storageCache.expiresAt>Date.now())return Promise.resolve(storageCache.data);
  if(storageCache.promise)return storageCache.promise;
  if(Date.now()<storageCache.retryAt)return Promise.resolve(storageCache.data);
  return storageCache.promise=supabaseFetch('/rpc/db_size_report',{db,method:'POST',body:'{}',signal:AbortSignal.timeout(15000)}).then(report=>{if(!Number.isFinite(Number(report?.databaseBytes)))throw new Error('bad db_size_report');storageCache.data=report;storageCache.expiresAt=Date.now()+STORAGE_CACHE_MS;return report}).catch(error=>{console.warn('db size report failed',db,error?.message);storageCache.retryAt=Date.now()+STORAGE_RETRY_MS;return storageCache.data}).finally(()=>{storageCache.promise=null});
}
// Cached results are also bounded by size: 400 page-sized RPC results of ~200 KB each would otherwise pin about 80 MB.
const BROWSE_CACHE_BYTES_MAX=24*1024*1024;
function browseCacheBytes(data){try{return JSON.stringify(data)?.length||0}catch{return 0}}
function trimBrowseCacheBytes(){let total=0;for(const entry of browseCache.values())total+=entry.bytes||0;for(const [entryKey,entry] of browseCache){if(total<=BROWSE_CACHE_BYTES_MAX)break;if(entry.bytes){browseCache.delete(entryKey);total-=entry.bytes}}}
async function cachedBrowseRows(key,loader,ttlMs=BROWSE_CACHE_MS){
  const now=Date.now(),cached=browseCache.get(key);
  if(cached?.data&&cached.expiresAt>now)return cached.data;
  if(cached?.promise)return cached.promise;
  // A whole-game row list (tens of thousands of rows) is shared with the callers waiting on it but never kept: kept for five minutes it held
  // 100+ MB of the 512 MB instance (OOM crash loop, 2026-10-15/16).
  const promise=Promise.resolve().then(loader).then(data=>{if(Array.isArray(data)&&data.length>BROWSE_CACHE_ROWS_MAX)browseCache.delete(key);else{browseCache.set(key,{data,expiresAt:Date.now()+ttlMs,bytes:browseCacheBytes(data)});trimBrowseCacheBytes()}return data}).catch(error=>{browseCache.delete(key);throw error});
  browseCache.set(key,{promise,expiresAt:now+ttlMs});
  // Pages of every offset can be cached now; an expired entry still holds its rows until swept, so drop them on every miss, then the oldest past 400 keys.
  for(const [entryKey,entry] of browseCache)if(entry.data&&entry.expiresAt<=now)browseCache.delete(entryKey);
  while(browseCache.size>400)browseCache.delete(browseCache.keys().next().value);
  return promise;
}
function clearBrowseCache(){browseCache.clear()}
async function loadDatabaseImages(cardIds=[]){
  if (!Array.isArray(cardIds) || !cardIds.length) return [];
  const key=`images:${createHash('sha1').update(cardIds.join('|')).digest('hex')}`;
  return cachedBrowseRows(key,async()=>{
    const legacy='id,cardId:card_id,language,source,imageUrl:image_url,sourceUrl:source_url,isPrimary:is_primary,fetchedAt:fetched_at';
    return loadDatabaseRelationsForCards('card_images',BROWSE_IMAGE_SELECT,cardIds,{legacySelect:legacy});
  });
}
// Newest Cardmarket reference price per card (price_snapshots through price_reference_best, migration 20261024090000: EUR, at most 7 days old, one variant per card, never 0).
// Cached like browse rows; waits at most REFERENCE_PRICE_WAIT_MS and never throws: a failure only means the cards go out without a price.
const REFERENCE_PRICE_TTL_MS=10*60*1000,REFERENCE_PRICE_WAIT_MS=1500;
function referenceRpc(key,name,args){let timer;return Promise.race([cachedBrowseRows(key,()=>supabaseFetch(`/rpc/${name}`,{method:'POST',body:JSON.stringify(args)}),REFERENCE_PRICE_TTL_MS),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('REFERENCE_PRICE_TIMEOUT')),REFERENCE_PRICE_WAIT_MS)})]).finally(()=>clearTimeout(timer))}
async function loadReferencePrices(ids,{prior=false}={}){
  const unique=[...new Set((ids||[]).filter(id=>typeof id==='string'&&id))].sort(),prices=new Map();
  if(!unique.length||!supabaseConfigured())return prices;
  const hash=createHash('sha1').update(unique.join('|')).digest('hex');
  try{
    // 比較價失敗只代表沒有漲跌，不能拖垮價格本身。
    const [rows,priorRows]=await Promise.all([referenceRpc(`refprice:${hash}`,'price_reference_best',{p_ids:unique}),prior?referenceRpc(`refprior:${hash}`,'price_reference_prior',{p_ids:unique,p_days:7}).catch(error=>{console.error('reference prior lookup failed; no change shown',error.message);return []}):[]]);
    const priorByKey=new Map((Array.isArray(priorRows)?priorRows:[]).map(row=>[`${row.card_id}|${row.provider}|${row.variant||''}`,row]));
    for(const row of Array.isArray(rows)?rows:[]){const price=referencePriceFromRow(row);if(price)prices.set(row.card_id,{...price,...referenceChange(price,priorByKey.get(`${row.card_id}|${price.source}|${row.variant||''}`))})}
  }catch(error){prices.failed=true;console.error('reference price lookup failed; cards go out without it',error.message)}
  return prices;
}
async function attachReferencePrices(cards){
  const prices=await loadReferencePrices((cards||[]).map(card=>card.id),{prior:true});
  let rates={};if(prices.size){try{rates=(await getTwdRates()).rates||{}}catch(error){console.error('reference price fx failed',error.message)}}
  for(const card of cards||[]){const price=prices.get(card.id),rate=Number(rates[price?.currency]);if(price)card.referencePrice=rate>0?{...price,amountTwd:Math.round(price.amount*rate)}:price}
  // 查詢逾時或失敗時標記，呼叫端就不讓瀏覽器快取這份沒有價格的回應
  return Object.assign(cards,{referenceFailed:!!prices.failed});
}
// Price sort inside one series (a few hundred cards): the amounts are looked up here and handed to buildBrowsePage.
async function seriesPriceMap(cards,sort){
  if(!BROWSE_PRICE_SORTS.has(sort))return null;
  const prices=await loadReferencePrices(cards.map(card=>card.id));let usdToEur=null;
  // 歐元與美元混在同一個系列時換成歐元再比；拿不到匯率就只比歐元的卡，美元的排到沒價格那一段。
  if([...prices.values()].some(price=>price.currency==='USD'))try{const r=(await getTwdRates()).rates||{};usdToEur=Number(r.USD)/Number(r.EUR)||null}catch(error){console.error('series price fx failed',error.message)}
  return new Map([...prices].flatMap(([id,price])=>price.currency==='EUR'?[[id,price.amount]]:usdToEur?[[id,Math.round(price.amount*usdToEur*100)/100]]:[]));
}
// 寶可夢系列裡有參考價的卡數，讓頁面在使用者選價格排序前就知道這個系列能不能照價格排；查詢失敗回 null（不知道），不當成 0。
async function seriesReferencePricedCount(game,cards){
  if(game!=='pokemon'||!cards?.length)return null;
  const prices=await loadReferencePrices(cards.map(card=>card.id));
  return prices.failed?null:prices.size;
}
// A region alone is filtered inside browse_cards_page (game pages always browse one region); rarity and series are not.
function databaseFastBrowseEligible({region=null,rarity=null,seriesId=null,sort='number-asc'}={}){
  return !rarity&&!seriesId&&(sort==='number-asc'||sort==='number-desc');
}
async function loadDatabasePageRelations(table,select,cardIds,{legacySelect=null}={}){
  if(!cardIds.length)return [];
  try{return await supabaseFetchAll(databaseRelationQuery(table,select,cardIds))}
  catch(error){
    if(!legacySelect)throw error;
    const rows=await supabaseFetchAll(databaseRelationQuery(table,legacySelect,cardIds));
    return table==='card_images'?rows.map(row=>({...row,imageRightsStatus:'not-provided'})):rows;
  }
}
const chunkDatabaseRelationCardIds=(table,select,cardIds,legacySelect=null)=>coreChunkDatabaseRelationCardIds(table,select,cardIds,legacySelect,{batchSize:RELATION_BATCH_SIZE,supabaseUrl:process.env.SUPABASE_URL||'',maxBytes:RELATION_QUERY_MAX_BYTES});
async function loadDatabaseRelationsForCards(table,select,cardIds,{legacySelect=null}={}){
  const batches=chunkDatabaseRelationCardIds(table,select,cardIds,legacySelect);
  if(!batches.length)return [];
  const rows=[];
  for(let index=0;index<batches.length;index+=RELATION_QUERY_CONCURRENCY){
    const pageRows=await Promise.all(batches.slice(index,index+RELATION_QUERY_CONCURRENCY).map(batch=>loadDatabasePageRelations(table,select,batch,{legacySelect})));
    rows.push(...pageRows.flat());
  }
  return rows;
}
async function browseDatabasePageFast(game,options={}){
  const safeGame=String(game).replace(/[^a-z0-9-]/gi,''),take=Math.min(Math.max(Number(options.limit)||60,1),BROWSE_PAGE_MAX),skip=Math.max(Number(options.offset)||0,0),direction=options.sort==='number-desc'?'desc':'asc',region=normalizeBrowseRegion(options.region);
  // One round trip through browse_cards_page when the database has it; otherwise the page, printing and image queries below.
  // Kept for BROWSE_CACHE_MS like other browse rows (catalog data only changes in batch imports); callers get a copy.
  let rpc=null;try{rpc=structuredClone(await cachedBrowseRows(`rpc:browse_cards_page:${safeGame}|${take}|${skip}|${direction}|${region||''}`,()=>supabaseFetch('/rpc/browse_cards_page',{method:'POST',body:JSON.stringify({p_game:safeGame,p_limit:take,p_offset:skip,p_desc:direction==='desc',...(region?{p_region:region}:{})})})))}catch(error){console.error('browse rpc failed; using PostgREST queries',error.message)}
  if(rpc&&Array.isArray(rpc.cards)&&Number.isFinite(Number(rpc.total))){
    const cards=rpc.cards.slice(0,take),printingByCard=buildPrintingIndex(cards.flatMap(card=>card.printings||[])),imageByCard=new Map(cards.map(card=>[card.id,card.images||[]]));
    const data=cards.map(({printings,images,...card})=>hydrateBrowseCard(card,printingByCard,imageByCard)),total=Number(rpc.total);
    return {data,total,hasMore:skip+data.length<total,facets:null,facetStatus:'deferred',limit:take,offset:skip,errors:{printings:null,images:null}};
  }
  // The paged PostgREST fallback below cannot filter by region; a region request is paged by the database filter (browse_cards_filtered) instead of loading the game.
  if(region)return browseDatabaseCardsFiltered(game,{...options,rarity:null});
  const params=new URLSearchParams({select:BROWSE_CARD_SELECT,game_id:`eq.${safeGame}`,order:`official_card_number.${direction},id.${direction}`,limit:String(take+1),offset:String(skip)}),page=await supabaseFetchPage(`/tcg_cards?${params}`),cards=(page.data||[]).slice(0,take),cardIds=cards.map(card=>card.id);
  const fallbackPrintingSelect='id,cardId:card_id,seriesId:series_id,region,language,localSetCode:local_set_code,localCardNumber:local_card_number,rarity,imageUrl:image_url,sourceUrl:source_url,releaseDate:release_date,imageRehostRequired:image_rehost_required',legacyImageSelect='id,cardId:card_id,language,source,imageUrl:image_url,sourceUrl:source_url,isPrimary:is_primary,fetchedAt:fetched_at';
  const [printingResult,imageResult]=await Promise.all([
    loadDatabasePageRelations('tcg_printings',BROWSE_PRINTING_SELECT,cardIds,{legacySelect:fallbackPrintingSelect}).then(rows=>({rows,status:'complete'})).catch(error=>({rows:[],status:'partial',error})),
    loadDatabasePageRelations('card_images',BROWSE_IMAGE_SELECT,cardIds,{legacySelect:legacyImageSelect}).then(rows=>({rows,status:'complete'})).catch(error=>({rows:[],status:'unknown',error}))
  ]),printingByCard=buildPrintingIndex(printingResult.rows),imageByCard=new Map();
  for(const image of imageResult.rows){const list=imageByCard.get(image.cardId)||[];list.push(image);imageByCard.set(image.cardId,list)}
  const data=cards.map(card=>hydrateBrowseCard(card,printingByCard,imageByCard)),total=page.total??skip+data.length+(page.data?.length>take?1:0);
  return {data,total,hasMore:skip+data.length<total,facets:null,facetStatus:'deferred',limit:take,offset:skip,errors:{printings:printingResult.error?publicReason('browse printings failed',printingResult.error):null,images:imageResult.status==='complete'?null:'圖片資料暫時無法讀取'}};
}
async function browseDatabaseSeriesCards(game,options={}){
  const safeGame=String(game).replace(/[^a-z0-9-]/gi,''),safeSeries=String(options.seriesId||'').replace(/[^a-z0-9:_-]/gi,'');
  if(!safeSeries)return browseDatabasePageFast(game,options);
  // One round trip through browse_series_cards (same three row sets); otherwise the paged PostgREST queries below.
  const timings={},mark=(name,started)=>{timings[name]=Math.round(performance.now()-started)};
  let rpc=null,started=performance.now();try{const cached=await cachedBrowseRows(`rpc:browse_series_cards:${safeGame}|${safeSeries}`,()=>supabaseFetch('/rpc/browse_series_cards',{method:'POST',body:JSON.stringify({p_game:safeGame,p_series:safeSeries})}));mark('rpc',started);started=performance.now();rpc=structuredClone(cached);mark('clone',started)}catch(error){console.error('series browse rpc failed; using PostgREST queries',error.message)}
  if(rpc&&Array.isArray(rpc.printings)&&Array.isArray(rpc.cards)&&Array.isArray(rpc.images)){
    if(!rpc.cards.length)return {data:[],total:0,hasMore:false,facets:{rarity:{},region:{},language:{},rarityLabels:{}},facetStatus:'complete',limit:options.limit,offset:options.offset,errors:{printings:null,images:null},timings};
    started=performance.now();const printingByCard=buildPrintingIndex(rpc.printings),imageByCard=new Map();
    for(const image of rpc.images){const list=imageByCard.get(image.cardId)||[];list.push(image);imageByCard.set(image.cardId,list)}
    // 同作品層其他卡的圖（migration 20261022120000）：本卡圖片失效時卡牆依序改用，例如台灣官方站維護時用日版圖
    const siblingUrls=new Map();
    for(const image of Array.isArray(rpc.siblingImages)?rpc.siblingImages:[]){if(!browseHasUsableImage(image))continue;const list=siblingUrls.get(image.groupId)||[];if(!list.includes(image.imageUrl))list.push(image.imageUrl);siblingUrls.set(image.groupId,list)}
    for(const card of rpc.cards){const urls=siblingUrls.get(card.canonicalId||card.id);if(urls?.length)card.fallbackImageUrls=urls.slice(0,3)}
    const [priceByCard,referencePriced]=await Promise.all([seriesPriceMap(rpc.cards,options.sort),seriesReferencePricedCount(safeGame,rpc.cards)]);started=performance.now();const page=buildBrowsePage(rpc.cards,{...options,printingByCard,imageByCard,facetStatus:'complete',priceByCard});mark('page',started);
    return {...page,referencePriced,errors:{printings:null,images:null},timings};
  }
  const printingParams=new URLSearchParams({select:BROWSE_PRINTING_SELECT,series_id:`eq.${safeSeries}`,order:'local_card_number.asc,id.asc'}),printings=await supabaseFetchAll(`/tcg_printings?${printingParams}`),cardIds=[...new Set((printings||[]).map(printing=>printing.cardId).filter(Boolean))];
  if(!cardIds.length)return {data:[],total:0,hasMore:false,facets:{rarity:{},region:{},language:{},rarityLabels:{}},facetStatus:'complete',limit:options.limit,offset:options.offset,errors:{printings:null,images:null}};
  // Hard guard: a series is a few hundred cards; this fallback must never turn into a whole-game load.
  if(cardIds.length>BROWSE_SERIES_FALLBACK_MAX)throw Object.assign(new Error('這個系列太大，無法在備援模式下載入'),{code:'BROWSE_REFUSED'});
  const cards=[];
  for(const batch of chunkCardIds(cardIds,RELATION_BATCH_SIZE)){
    const ids=batch.map(id=>`"${String(id).replaceAll('"','')}"`).join(','),params=new URLSearchParams({select:BROWSE_CARD_SELECT,game_id:`eq.${safeGame}`,id:`in.(${ids})`,order:'official_card_number.asc,id.asc'});
    cards.push(...await supabaseFetchAll(`/tcg_cards?${params}`));
  }
  const imageResult=await loadDatabaseImages(cardIds).then(rows=>({rows,status:'complete'})).catch(error=>({rows:[],status:'unknown',error})),printingByCard=buildPrintingIndex(printings),imageByCard=new Map();
  for(const image of imageResult.rows){const list=imageByCard.get(image.cardId)||[];list.push(image);imageByCard.set(image.cardId,list)}
  const result=buildBrowsePage(cards,{...options,printingByCard,imageByCard,facetStatus:'complete',priceByCard:await seriesPriceMap(cards,options.sort)});
  return {...result,errors:{printings:null,images:imageResult.status==='complete'?null:'圖片資料暫時無法讀取'}};
}
// Every query below for one game goes to that game's project (withDb scope), including the rarity table and facets.
async function browseDatabaseCards(game,options){
  return withDb(dbForGame(game),()=>{
    if(options.seriesId)return browseDatabaseSeriesCards(game,options);
    if(databaseFastBrowseEligible(options))return browseDatabasePageFast(game,options);
    return browseDatabaseCardsFiltered(game,options);
  });
}
// Rarity filter and the name / release / rarity sorts run inside the database (browse_cards_filtered + browse_cards_facets, migration 20261016110000):
// the server asks for one page plus the total and facets and never loads a whole game (Pokemon is 55k cards and 105k printings; one such request
// used to exhaust the 512 MB instance). Rarity codes, ranks and filter tokens come from data/rarity-rankings.json through the server's own
// normalizers, passed to the database as a small raw-value table (PostgREST needs every parameter named, so p_region/p_token are sent as null, never omitted); a raw value the table lacks is reported back (unmapped) and the table rebuilt once.
// supabaseFetch gives up after 12 s; these calls scan a whole game (1-3 s warm, more while the small instance is busy or cold), so they get the database's own 20 s limit plus a margin.
// Facets and the rarity table change only with catalog imports: keep them long.
const BROWSE_HEAVY_MAX=2,BROWSE_HEAVY_QUEUE_MAX=24,BROWSE_HEAVY_TIMEOUT_MS=25000,BROWSE_FACET_TTL_MS=30*60*1000,BROWSE_RARITY_TABLE_TTL_MS=60*60*1000,browseHeavy={active:0,waiting:[]};
const browseFacetFailures=new Map();
const browseRpc=(name,body)=>supabaseFetch(`/rpc/${name}`,{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(BROWSE_HEAVY_TIMEOUT_MS)});
// The database scans a whole game for each of these calls (1-3 s): run two at a time, queue a few more, then answer 503 instead of piling up.
async function withBrowseHeavySlot(task){
  if(browseHeavy.active<BROWSE_HEAVY_MAX)browseHeavy.active++;
  else{
    if(browseHeavy.waiting.length>=BROWSE_HEAVY_QUEUE_MAX){const error=new Error('目前篩選與排序的請求較多，請稍後再試');error.code='BROWSE_BUSY';throw error}
    await new Promise(resolve=>browseHeavy.waiting.push(resolve));
  }
  try{return await task()}
  finally{const next=browseHeavy.waiting.shift();if(next)next();else browseHeavy.active--}
}
async function loadBrowseRarityMap(game,{refresh=false}={}){
  const key=`rarity-values:${game}`;
  if(refresh)browseCache.delete(key);
  const values=await cachedBrowseRows(key,()=>withBrowseHeavySlot(()=>browseRpc('browse_rarity_values',{p_game:game})),BROWSE_RARITY_TABLE_TTL_MS);
  return (Array.isArray(values)?values:[]).map(raw=>{
    const code=rarityCanonicalCode(game,raw),rank=code?browseRarityRank(game,code):Number.MAX_SAFE_INTEGER;
    return {raw,code,token:code?rarityCanonicalToken(game,code):null,rank:rank===Number.MAX_SAFE_INTEGER?null:rank};
  });
}
async function browseDatabaseCardsFiltered(game,options={}){
  const safeGame=String(game).replace(/[^a-z0-9-]/gi,''),take=Math.min(Math.max(Number(options.limit)||60,1),BROWSE_PAGE_MAX),skip=Math.max(Number(options.offset)||0,0),sort=normalizeBrowseSort(options.sort,safeGame),region=normalizeBrowseRegion(options.region),priceSort=BROWSE_PRICE_SORTS.has(sort);
  // An empty token means "no rarity filter", as in buildBrowsePage.
  const token=options.rarity?rarityCanonicalToken(safeGame,options.rarity):'';
  for(let attempt=0;;attempt++){
    const rmap=await loadBrowseRarityMap(safeGame,{refresh:attempt>0}),pageKey=`rpc:browse_cards_filtered:${safeGame}|${region||''}|${token}|${sort}|${take}|${skip}`,facetKey=`rpc:browse_cards_facets:${safeGame}|${region||''}`;
    // The page first (it gets the database to itself); facets only describe the game and are optional: if they cannot be had in time the page still goes out with facets deferred, as the number-order pages already do.
    // Price order (Pokemon): browse_cards_priced puts cards with a Cardmarket reference price first, the rest after them; if it fails the page falls back to number order instead of an error.
    let page;
    try{page=await cachedBrowseRows(pageKey,()=>withBrowseHeavySlot(()=>priceSort?browseRpc('browse_cards_priced',{p_game:safeGame,p_region:region||null,p_token:token||null,p_desc:sort==='price-desc',p_limit:take,p_offset:skip,p_rmap:rmap}):browseRpc('browse_cards_filtered',{p_game:safeGame,p_region:region||null,p_token:token||null,p_sort:sort,p_limit:take,p_offset:skip,p_rmap:rmap})))}
    catch(error){if(!priceSort||error.code==='BROWSE_BUSY')throw error;console.error('price-sorted browse failed; using number order',error.message);return browseDatabaseCardsFiltered(game,{...options,sort:'number-asc'})}
    let facets=null;
    // After a failed facet call the next minute skips it instead of making every page wait out the timeout again.
    if(Date.now()-(browseFacetFailures.get(facetKey)||0)>=60000)try{facets=await cachedBrowseRows(facetKey,()=>withBrowseHeavySlot(()=>browseRpc('browse_cards_facets',{p_game:safeGame,p_region:region||null,p_rmap:rmap})),BROWSE_FACET_TTL_MS);if(!facets||typeof facets.rarity!=='object')facets=null}
    catch(error){browseFacetFailures.set(facetKey,Date.now());console.error('browse facets failed; page sent without them',error.message)}
    if(!page||!Array.isArray(page.cards)||!Number.isFinite(Number(page.total)))throw new Error('BROWSE_FILTERED_BAD_RESPONSE');
    if((page.unmapped||facets?.unmapped)&&attempt===0){browseCache.delete(pageKey);browseCache.delete(facetKey);continue}
    const cards=structuredClone(page.cards).slice(0,take),printingByCard=buildPrintingIndex(cards.flatMap(card=>card.printings||[])),imageByCard=new Map(cards.map(card=>[card.id,card.images||[]]));
    const data=cards.map(({printings,images,...card})=>hydrateBrowseCard(card,printingByCard,imageByCard)),total=Number(page.total),rarityLabels={};
    if(facets)for(const value of Object.keys(facets.rarity))if(value!=='unknown')rarityLabels[value]=rarityDisplayLabel(safeGame,value);
    return {data,total,hasMore:skip+data.length<total,facets:facets?{rarity:{...facets.rarity},region:{...facets.region},language:{...facets.language},rarityLabels}:null,facetStatus:facets?'complete':'deferred',limit:take,offset:skip,errors:{printings:null,images:null}};
  }
}

// Coverage is aggregated card chunk by card chunk, never the whole catalog at once (about 75k cards, 105k printings and 45k images
// overflowed the 512 MB instance). Every metric either adds up across chunks or is kept as a small ordered set / first-50 sample.
const COVERAGE_CARD_CHUNK=1000;
// One page of a relation table for the cards of one chunk: a card_id range (indexed) in unique id order, offset-paged inside the small range.
async function loadCoverageRelationRange(table,select,firstId,lastId){
  // Read until an empty page and advance by what came back: a server that caps responses below the requested limit must not truncate silently.
  const rows=[];
  for(let offset=0;;){
    const query=new URLSearchParams({select,order:'id.asc',limit:String(RELATION_SCAN_PAGE_SIZE),offset:String(offset)});
    query.append('card_id',`gte.${firstId}`);query.append('card_id',`lte.${lastId}`);
    const page=await supabaseFetch(`/${table}?${query}`);
    if(!Array.isArray(page)||page.length>RELATION_SCAN_PAGE_SIZE)throw relationPaginationError('invalid-page');
    if(!page.length)return rows;
    rows.push(...page);offset+=page.length;
  }
}
function relationPaginationError(reason){const error=new Error(`RELATION_PAGINATION_${reason.toUpperCase().replaceAll('-','_')}`);error.code='RELATION_PAGINATION_INVALID';return error}
// Shared by all games of one coverage run: the first failure marks the whole relation unknown (as the former single global scan did) and stops further requests.
function createCoverageRelation(table,select,legacySelect){
  const state={status:'complete',error:null,legacy:false,async load(firstId,lastId){
    if(state.status!=='complete')return [];
    try{
      if(!state.legacy){try{return await loadCoverageRelationRange(table,select,firstId,lastId)}catch(error){if(error.code==='RELATION_PAGINATION_INVALID')throw error;state.legacy=true}}
      const rows=await loadCoverageRelationRange(table,legacySelect,firstId,lastId);
      return table==='card_images'?rows.map(row=>({...row,imageRightsStatus:'not-provided'})):rows;
    }catch(error){state.status='unknown';state.error=publicReason('coverage relation failed',error);return []}
  }};
  return state;
}
// Cards of one game in keyset chunks; each chunk is folded into the accumulator with its printings and images and then dropped.
async function loadCoverageGame(gameId,printingRelation,imageRelation){
  const safeGame=String(gameId).replace(/[^a-z0-9-]/gi,''),acc=createCoverageAccumulator();let last=null;
  try{
    for(;;){
      const params=new URLSearchParams({select:BROWSE_CARD_SELECT,game_id:`eq.${safeGame}`,order:'id.asc',limit:String(COVERAGE_CARD_CHUNK)});
      if(last!==null)params.set('id',`gt.${last}`);
      const cards=await supabaseFetch(`/tcg_cards?${params}`);
      if(!Array.isArray(cards))throw new Error('COVERAGE_BAD_CARD_PAGE');
      if(cards.length){const [printings,images]=await Promise.all([printingRelation.load(cards[0].id,cards.at(-1).id),imageRelation.load(cards[0].id,cards.at(-1).id)]);accumulateCoverage(acc,cards,printings,images)}
      if(cards.length<COVERAGE_CARD_CHUNK)return {gameId,acc,status:'complete'};
      const next=cards.at(-1)?.id;
      if(!next||next===last)throw new Error('COVERAGE_CARD_PAGING_STALLED');
      last=next;
    }
  }catch(error){return {gameId,acc:createCoverageAccumulator(),status:'unknown',error:publicReason('coverage game failed',error)}}
}
// 公開覆蓋率只給計數：來源 ID 全清單（寶可夢約 5 萬筆）與重複鍵清單前端都不讀，卻占回應 3 MB；重複鍵只留前 20 筆當樣本。
function slimCoverageGame(entry){
  const keys=entry.linkAudit?.duplicateProviderKeys||[];
  return {...entry,sources:undefined,sourceCount:entry.sources?.length??0,linkAudit:{...entry.linkAudit,duplicateProviderKeys:keys.slice(0,20),duplicateProviderKeyCount:keys.length}};
}
async function loadCatalogCoverageUncached(){
  const fallback=await loadFallbackCatalog();
  if(!supabaseConfigured())return buildFallbackCatalogCoverage(fallback);
  try{
    const printingRelation=createCoverageRelation('tcg_printings',BROWSE_PRINTING_SELECT,'id,cardId:card_id,seriesId:series_id,region,language,localSetCode:local_set_code,localCardNumber:local_card_number,rarity,imageUrl:image_url,sourceUrl:source_url,source,providerId:provider_id,releaseDate:release_date,imageRehostRequired:image_rehost_required'),imageRelation=createCoverageRelation('card_images',BROWSE_IMAGE_SELECT,'id,cardId:card_id,language,source,imageUrl:image_url,sourceUrl:source_url,isPrimary:is_primary,fetchedAt:fetched_at'),secondRelations={printing:createCoverageRelation('tcg_printings',BROWSE_PRINTING_SELECT,'id,cardId:card_id,seriesId:series_id,region,language,localSetCode:local_set_code,localCardNumber:local_card_number,rarity,imageUrl:image_url,sourceUrl:source_url,source,providerId:provider_id,releaseDate:release_date,imageRehostRequired:image_rehost_required'),image:createCoverageRelation('card_images',BROWSE_IMAGE_SELECT,'id,cardId:card_id,language,source,imageUrl:image_url,sourceUrl:source_url,isPrimary:is_primary,fetchedAt:fetched_at')};
    const results=await Promise.all([
      supabaseFetchAll('/tcg_series?select=id,gameId:game_id,region,language,providerId:provider_id,sourceUrl:source_url,updatedAt:updated_at,metadata&order=game_id,region,id').then(rows=>({rows,status:'complete'})).catch(error=>({rows:[],status:'unknown',error:publicReason('coverage series failed',error)})),
      // A second-project game reads its own project with its own relation state, so a failure there does not mark the main project's relations unknown.
      ...[...CATALOG_GAME_IDS].map(gameId=>dbForGame(gameId)==='ip2'?withDb('ip2',()=>loadCoverageGame(gameId,secondRelations.printing,secondRelations.image)):loadCoverageGame(gameId,printingRelation,imageRelation))
    ]),seriesResult=results[0],cardGroups=results.slice(1),printingResult={status:printingRelation.status,error:printingRelation.error},imageResult={status:imageRelation.status,error:imageRelation.error},games={},allTimestamps=[],baseline=catalogBaselineReport(seriesResult.rows);
    for(const group of cardGroups){
      const relations=dbForGame(group.gameId)==='ip2'?secondRelations:{printing:printingRelation,image:imageRelation},options={cardStatus:group.status,printingStatus:relations.printing.status,imageStatus:relations.image.status},entry=slimCoverageGame(adjustCoverageGame(finishCoverage(group.acc,group.gameId,options),options));
      // 該遊戲的卡片查詢失敗或逾時時，卡數是「不知道」不是 0：給 null，前端顯示「待補」。
      if(group.status!=='complete')entry.cards=null;
      games[group.gameId]=entry;allTimestamps.push(entry.sourceTimestamp);
    }
    attachCatalogBaselines(games,baseline.report);
    const totalCards=Object.values(games).reduce((sum,game)=>sum+game.cards,0),knownTimestamps=allTimestamps.map(coverageIso).filter(Boolean).sort(),coveredGames=Object.keys(games).filter(gameId=>games[gameId].cards>0),coveredSets=uniqueValues(Object.values(games).flatMap(game=>game.coveredSets||[])),freshness=coverageFreshness(knownTimestamps.at(-1)),cardErrors=Object.fromEntries(cardGroups.filter(group=>group.error).map(group=>[group.gameId,group.error]));
    const complete=cardGroups.every(group=>group.status==='complete')&&printingResult.status==='complete'&&imageResult.status==='complete',expectedTotals={value:null,status:'unknown',reason:'沒有可跨地區合併的完整卡表分母；來源回報基準僅按範圍呈現'};
    return {totalCards,totalMatchingRecords:totalCards,games,coveredGames,coveredSets,totalSets:coveredSets.length,source:'supabase-current-rows',updatedAt:knownTimestamps.at(-1)||new Date().toISOString(),expectedTotals,baselineRegistry:{schemaVersion:baseline.report.schemaVersion,registryVersion:baseline.report.registryVersion,reviewedAt:baseline.report.reviewedAt,status:baseline.report.summary.status,seriesStatus:seriesResult.status,error:baseline.error||seriesResult.error||null},freshness,sample:false,complete,scope:{sample:false,complete,kind:'supabase-current-rows',expectedTotal:null,expectedTotalStatus:'unknown',totalMatchingRecords:totalCards,coveredGames,coveredSets,totalSets:coveredSets.length,freshness,limitations:['此報告完整涵蓋目前 Supabase 查詢結果，但不把目前列數當成各 IP 完整卡表分母。','來源回報的系列卡數按地區與系列隔離呈現，不跨地區加總成 IP 完整度。','中文名、稀有度、版本與圖片比例的分母是目前觀測到的卡片列數。']},metricStatus:{cards:cardGroups.every(group=>group.status==='complete')?'complete':'partial',printings:printingResult.status,images:printingResult.status==='unknown'||imageResult.status==='unknown'?'unknown':imageResult.status,chineseNames:cardGroups.every(group=>group.status==='complete')?'complete':'unknown',rarities:printingResult.status==='unknown'?'unknown':cardGroups.every(group=>group.status==='complete')?'complete':'unknown',versions:printingResult.status,sourceTimestamp:knownTimestamps.length?'observed':'unknown',expectedTotals:'unknown'},errors:{cards:cardErrors,printings:printingResult.error||null,images:imageResult.error||null,baselines:baseline.error||seriesResult.error||null}};
  }catch(error){return buildFallbackCatalogCoverage(fallback,{source:'catalog.json-fallback',fallbackReason:publicReason('coverage failed; using catalog.json',error),scope:{sample:false,complete:false,kind:'fallback-after-database-error',expectedTotal:null,expectedTotalStatus:'unknown',limitations:['Supabase 查詢失敗，暫以公開備援資料檔回應；不能視為資料庫完整報告。']},metricStatus:{cards:'unknown',printings:'unknown',images:'unknown',chineseNames:'unknown',rarities:'unknown',versions:'unknown',sourceTimestamp:'unknown',expectedTotals:'unknown'}})}
}
// 資料庫查詢失敗或逾時（結果 complete:false）不進快取：沿用上次成功值；從沒成功過就回這份標了 unknown 的報告，並在一個快取週期內不重跑（重跑要 30 秒以上的整庫掃描）。
let coverageDegraded=null;
async function loadCoverageSnapshot(){
  if(coverageDegraded&&Date.now()<coverageDegraded.retryAt)throw new Error('COVERAGE_RETRY_LATER');
  const report=await loadCatalogCoverageUncached();
  if(report.complete||!supabaseConfigured()){coverageDegraded=null;return report}
  coverageDegraded={report,retryAt:Date.now()+SNAPSHOT_TTL_MS};
  throw new Error('COVERAGE_INCOMPLETE');
}
async function loadCatalogCoverage(){
  try{const snapshot=await catalogCoverageCache.get(loadCoverageSnapshot);return {...snapshot.data,cache:snapshot.cache}}
  catch(error){if(!coverageDegraded)throw error;return {...coverageDegraded.report,cache:{status:'degraded',stale:false,lastSuccessAt:null,error:publicReason('coverage degraded',error)}}}
}
function trendMeta(snapshot){
  const rowsScanned=Number(snapshot?.rowsScanned)||0,validRows=Number(snapshot?.validRows)||0,uniqueCards=Number(snapshot?.uniqueCards)||0,window=snapshot?.observationWindow||trendObservationWindow([]),complete=snapshot?.status==='complete',coveredGames=snapshot?.coveredGames||[],coveredSets=snapshot?.coveredSets||[],freshness=coverageFreshness(window.latest),limitations=['資料只涵蓋遊々亭日版買取價，不是全市場掛牌、成交或玩家熱度資料。','漲幅以同筆觀測中的 previous_price 與 price 計算；缺少其中一項的列不列入排名。'];
  return {source:'yuyutei-buyback',label:'單一來源買取漲幅（遊々亭）',formula:'(price - previous_price) / previous_price',priceType:'buyback',market:'JP',totalMatchingRecords:rowsScanned,coveredGames,coveredSets,observationWindow:window,freshness,sample:false,complete,scope:{source:'yuyutei',market:'JP',priceType:'buyback',filter:'source=yuyutei AND previous_price IS NOT NULL AND price > previous_price',rowsScanned,totalMatchingRecords:rowsScanned,rowsWithValidChange:validRows,uniqueCards,coveredGames,coveredSets,observationWindow:window,freshness,sample:false,complete,coverage:'source-only',limitations},completeness:{status:complete?'complete':'unavailable',sample:false,rowsScanned,totalMatchingRecords:rowsScanned,denominatorStatus:'source-filtered-observations-only',coveredGames,coveredSets,freshness},limitations,warning:'只反映遊々亭日版買取調價，不代表全市場熱度、成交量、掛牌價或成交價。'};
}
async function loadTrendSnapshot(){
  if(trendCache.data&&trendCache.expiresAt>Date.now())return trendCache.data;
  if(trendCache.promise)return trendCache.promise;
  const promise=Promise.resolve().then(async()=>{
    const params=new URLSearchParams({select:'game,setCode:set_code,setName:set_name,cardCode:card_code,cardNumber:card_number,rarity,cardName:card_name,price,previousPrice:previous_price,currency,cardUrl:card_url,imageUrl:image_url,updatedAt:scraped_at,source',source:'eq.yuyutei',previous_price:'not.is.null',order:'scraped_at.desc'}),rows=await supabaseFetchAll(`/jp_buyback_prices?${params}`,1000),valid=(rows||[]).filter(row=>Number(row.previousPrice)>0&&Number.isFinite(Number(row.price))&&Number(row.price)>Number(row.previousPrice)),byCard=new Map();
    for(const row of valid){const key=trendRecordKey(row);if(!key)continue;const existing=byCard.get(key),rowTime=Date.parse(String(row.updatedAt||'')),existingTime=Date.parse(String(existing?.updatedAt||''));if(!existing||(!Number.isFinite(existingTime)&&Number.isFinite(rowTime))||rowTime>existingTime)byCard.set(key,row)}
    const data=[...byCard.values()].map(row=>({...row,price:Number(row.price),previousPrice:Number(row.previousPrice),changePercent:Math.round((Number(row.price)-Number(row.previousPrice))/Number(row.previousPrice)*10000)/100,priceType:'buyback'})).sort((a,b)=>b.changePercent-a.changePercent||String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    return {status:'complete',data,rowsScanned:(rows||[]).length,validRows:valid.length,uniqueCards:data.length,coveredGames:uniqueValues((rows||[]).map(row=>row.game)),coveredSets:uniqueValues((rows||[]).map(row=>row.setCode||row.setName)),observationWindow:trendObservationWindow(rows||[])};
  }).then(data=>{trendCache.data=data;trendCache.expiresAt=Date.now()+TREND_CACHE_MS;return data}).finally(()=>{trendCache.promise=null});
  trendCache.promise=promise;
  return promise;
}
async function loadCatalogHealth(){
  if(!supabaseConfigured())return {...await loadCatalogCoverage(),policy:sourcePolicySummary()};
  try{
    const cached=await catalogHealthCache.get(async()=>{
      const policies=imageDisplayPolicies();
      // The v2 snapshot scans every printing, card and image (about 14 s on the current instance), past the default 12 s fetch timeout.
      try{return await supabaseFetch('/rpc/catalog_health_snapshot_v2',{method:'POST',body:JSON.stringify({p_display_policies:policies}),signal:AbortSignal.timeout(60000)})}
      catch(v2Error){
        console.error('catalog health v2 snapshot failed; falling back to legacy snapshot',v2Error?.message||v2Error);
        const legacy=await supabaseFetch('/rpc/catalog_health_snapshot',{method:'POST',body:'{}'});
        return {...legacy,metricStatus:{...(legacy.metricStatus||{}),images:'legacy-strict'},healthCompatibilityWarning:'v2 snapshot unavailable'};
      }
    });
    return {...cached.data,policy:sourcePolicySummary(),cache:cached.cache};
  }catch(error){return {...await loadCatalogCoverage(),policy:sourcePolicySummary(),healthFallbackReason:publicReason('catalog health failed',error)}}
}
function safeTokenEqual(actual,expected){
  if(typeof actual!=='string'||typeof expected!=='string'||!actual||!expected)return false;
  const digest=value=>createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual),digest(expected));
}
function adminAuthorized(req){
  const authorization=String(req.headers.authorization||''),bearer=authorization.startsWith('Bearer ')?authorization.slice(7):null;
  const token=req.headers['x-scrape-token']||bearer;
  return safeTokenEqual(token,process.env.SCRAPE_SECRET);
}
function trustedCfIp(req){
  const secret=process.env.ORIGIN_VERIFY_SECRET,verified=Boolean(secret)&&safeTokenEqual(req.headers['x-origin-verify'],secret);
  // 經 Worker 代理時 cf-connecting-ip 是 Worker 出口 IP；帶對密鑰的 x-client-ip 才是真實訪客。
  const forwarded=req.headers['x-client-ip'];
  if(verified&&typeof forwarded==='string'&&forwarded.trim())return forwarded.trim();
  const cf=req.headers['cf-connecting-ip'];
  if(typeof cf!=='string'||!cf.trim())return null;
  if(secret&&!verified)return null;
  return cf.trim();
}
// 公開 API 每個 IP 每分鐘的上限；卡圖一頁就有幾十張，另算一個寬鬆的額度；SEO 動態查庫與低配額外部價格端點各自獨立收緊。
const apiLimiter=createRateLimiter({limit:Number(process.env.API_RATE_LIMIT_PER_MINUTE||240)}),imageLimiter=createRateLimiter({limit:Number(process.env.IMAGE_RATE_LIMIT_PER_MINUTE||1200)}),seoLimiter=createRateLimiter({limit:Number(process.env.SEO_RATE_LIMIT_PER_MINUTE||60)}),gradedLimiter=createRateLimiter({limit:Number(process.env.GRADED_RATE_LIMIT_PER_MINUTE||15)}),ebayLimiter=createRateLimiter({limit:Number(process.env.EBAY_RATE_LIMIT_PER_MINUTE||15)});
// 正式站在 Cloudflare 後面，只有這個標頭無法由訪客偽造（X-Forwarded-For 的第一段可以）；若設定 ORIGIN_VERIFY_SECRET 則必須同時通過 x-origin-verify 驗證才採信。沒有這個標頭時（有人繞過 Cloudflare 直連源站）退回用 TCP 連線對端 IP（socket.remoteAddress，同樣無法偽造，每個直連 client 各自計一組額度）；絕不信 X-Forwarded-For。
function rateLimited(req,url){
  const ip=trustedCfIp(req)||req.socket?.remoteAddress,pathname=url.pathname;
  if(!ip||adminAuthorized(req))return false;
  if(pathname==='/'&&(url.searchParams.has('card')||url.searchParams.has('series')))return !seoLimiter(ip);
  if(!pathname.startsWith('/api/'))return false;
  if(pathname==='/api/graded-prices')return !gradedLimiter(ip)||!apiLimiter(ip);
  if(pathname==='/api/ebay-listings')return !ebayLimiter(ip)||!apiLimiter(ip);
  return !(pathname.startsWith('/api/images/')?imageLimiter:apiLimiter)(ip);
}
// ---- 收藏雲端同步（docs/NEXT_PHASE_PLAN.md Y2）與 Google 登入（docs/COLLECTION_SYNC_GOOGLE_PLAN.md）----
// 與 Cloudflare Worker 共用 providers/auth-sync.mjs（Web Crypto SHA-256、PKCE 交換、/auth/v1/user 短暫快取、revision 樂觀鎖、輸入驗證與錯誤不外洩）。
const syncLimiter=createRateLimiter({limit:Number(process.env.SYNC_RATE_LIMIT_PER_MINUTE||6)});
const authLimiter=createRateLimiter({limit:Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE||10)});
const syncError=(res,status,error,extra={})=>json(res,status,{error},extra);
const clientIp=req=>trustedCfIp(req)||req.socket?.remoteAddress||'unknown';
const authSync=createAuthSyncController({getEnv:()=>process.env,fetchFn:fetch,supabaseFetch,now:Date.now});
const authPublicUrl=()=>authSync.configUrl();
async function handleAuth(req,res,action){
  if(!authLimiter(clientIp(req)))return syncError(res,429,'登入太頻繁，請一分鐘後再試',{'Retry-After':'60'});
  const result=await authSync.handleAuth({action,authorizationHeader:req.headers.authorization,readBody:maxBytes=>readJsonBody(req,maxBytes)});
  if(result.status===204){res.writeHead(204,{'Cache-Control':'no-store'});return res.end()}
  return json(res,result.status,result.body,result.headers||{});
}
async function handleCollectionSync(req,res,action){
  // 同一個 IP 每分鐘幾次（pull 與 push 合計）；先計數再讀內容，亂打的也算。
  if(!syncLimiter(clientIp(req)))return syncError(res,429,'同步太頻繁，請一分鐘後再試',{'Retry-After':'60'});
  const result=await authSync.handleSync({action,authorizationHeader:req.headers.authorization,contentLengthHeader:req.headers['content-length'],readBody:maxBytes=>readJsonBody(req,maxBytes)});
  return json(res,result.status,result.body,result.headers||{});
}
async function loadAdminCatalogHealth(){
  const [summary,missingChinese,missingSeries,pendingPrintingImages,pendingCardImages,storage,secondStorage]=await Promise.all([
    loadCatalogHealth(),
    supabaseFetch('/tcg_cards?select=id,game:game_id,officialCardNumber:official_card_number,nameJa:name_ja,nameEn:name_en&name_zh=is.null&order=game_id,id&limit=50'),
    supabaseFetch('/tcg_cards?select=id,game:game_id,officialCardNumber:official_card_number,nameZh:name_zh,nameJa:name_ja,nameEn:name_en&series_id=is.null&order=game_id,id&limit=50'),
    supabaseFetch('/tcg_printings?select=id,cardId:card_id,region,language,sourceUrl:source_url,imageRightsStatus:image_rights_status&image_url=not.is.null&image_rights_status=eq.not-provided&order=id&limit=50'),
    supabaseFetch('/card_images?select=id,cardId:card_id,source,sourceUrl:source_url,imageRightsStatus:image_rights_status&image_url=not.is.null&image_rights_status=eq.not-provided&order=id&limit=50'),
    loadStorageReport(),
    // 第二庫（UA 等）的容量，與主庫分開算：各有 500 MB。
    loadStorageReport('ip2')
  ]);
  return {summary,missing:{chineseNames:missingChinese,series:missingSeries},rightsReview:{printings:pendingPrintingImages,images:pendingCardImages},storage:storage||{error:'unavailable'},...(secondDbConfigured()?{secondStorage:secondStorage||{error:'unavailable'}}:{}),sources:publicSourcePolicies()};
}
const officialProductCache={data:null,expiresAt:0};
function japaneseDate(value){const m=String(value||'').match(/(\d{4})年\s*(\d{1,2})月(\d{1,2})日/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null}
async function loadPokemonOfficialProducts(){
  if(officialProductCache.data&&officialProductCache.expiresAt>Date.now())return officialProductCache.data;
  const types=['expansion','construction','others','peripheral'];
  const fetchPage=async(productType,page)=>{
    const response=await fetch(`https://www.pokemon-card.com/products/resultAPI.php?productType=${encodeURIComponent(productType)}&page=${page}`,{headers:{Accept:'application/json','User-Agent':'CardScope/1.0'}});
    if(!response.ok)throw new Error(`POKEMON_PRODUCTS_${response.status}`);
    return response.json();
  };
  const pages=await Promise.all(types.map(async productType=>{
    const bodies=[await fetchPage(productType,1)];
    const maxPage=Math.min(Math.max(Number(bodies[0]?.maxPage)||1,1),100);
    // One request per category at a time: official index only, no high-concurrency crawling.
    for(let page=2;page<=maxPage;page++)bodies.push(await fetchPage(productType,page));
    return {productType,bodies};
  })),rows=[],seen=new Set();
  for(const {productType,bodies} of pages)for(const body of bodies)for(const item of body.products||[]){
    const title=String(item.productTitle||'').trim(),releaseDate=japaneseDate(item.releaseDate);
    if(!title)continue;
    const identity=createHash('sha1').update(`${productType}:${title}:${releaseDate||''}`).digest('hex').slice(0,16);
    if(seen.has(identity))continue;seen.add(identity);
    const sourceUrl=item.link_detailPage?new URL(item.link_detailPage,'https://www.pokemon-card.com/').href:'https://www.pokemon-card.com/products/index.html';
    const officialCode=sourceUrl.match(/\/(?:ex|product)\/([^/#?]+)/i)?.[1]?.toUpperCase()||null;
    rows.push({id:`pokemon-jp-product-${identity}`,game:'pokemon',seriesId:null,officialCode,productType:item.productType||productType,name:title,nameZh:pokemonProductNameZh(title,item.productType),nameJa:title,nameKo:null,region:'JP',language:'ja-JP',versionLabel:'日版',releaseDate,imageUrl:item.tumbsImg?new URL(item.tumbsImg,'https://www.pokemon-card.com/').href:null,imageKind:'sealed-product',source:'pokemon-card-official-jp',sourceUrl,metadata:{catalogSection:productType,officialCardList:item.link_cardList?new URL(item.link_cardList,'https://www.pokemon-card.com/').href:null,translationStatus:'category-only'}});
  }
  officialProductCache.data=rows;officialProductCache.expiresAt=Date.now()+6*60*60*1000;return rows;
}
async function loadYugiohSets(){const response=await fetch('https://db.ygoprodeck.com/api/v7/cardsets.php',{headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`YGO_SETS_${response.status}`);const body=await response.json();return (body||[]).map((s,i)=>({id:`yugioh-${s.set_code}-${i}`,game:'yugioh',name:s.set_name,nameZh:null,region:'US',language:'en-US',versionLabel:'美版',releaseDate:s.tcg_date||null,sealedCount:null,cardsCount:Number(s.num_of_cards)||0,imageUrl:s.set_image||null,imageKind:'series-logo',productType:'系列',source:'ygoprodeck',sourceUrl:'https://ygoprodeck.com/'}))}
async function loadCuratedProducts(){return buildCuratedProducts(await loadFallbackCatalog())}
async function loadStoredProducts(){if(!supabaseConfigured())return [];const rows=await supabaseFetchAll('/tcg_products?select=id,game:game_id,seriesId:series_id,officialCode:official_code,productType:product_type,nameZh:name_zh,nameJa:name_ja,name:name_en,nameKo:name_ko,region,language,releaseDate:release_date,imageUrl:image_url,imageKind:image_kind,source,sourceUrl:source_url,metadata&order=release_date.desc.nullslast');return rows.map(row=>({...row,versionLabel:regionLabel(row.region,row.language,row.game),cardsCount:row.metadata?.cardsCount??row.metadata?.total??null}))}
const loadSeriesTranslations=async()=>SERIES_ZH_ENTRIES;
// The product feed reads every stored product row on each call; keep it like the catalog: serve the cached feed and refresh it
// in one background load once it is older than the TTL (products only change in batch imports). A feed missing the stored
// products (database error) is returned but not kept.
const PRODUCT_CACHE_TTL_MS=Number(process.env.PRODUCT_CACHE_TTL_MS??600000);
let productCache={value:null,at:0,pending:null};
async function loadProductSets(){
  const refresh=()=>{if(!productCache.pending)productCache.pending=loadProductSetsUncached().then(value=>{if(!value.partial)productCache={value,at:Date.now(),pending:null};else productCache.pending=null;return value},error=>{productCache.pending=null;throw error});return productCache.pending};
  if(productCache.value){if(Date.now()-productCache.at>=PRODUCT_CACHE_TTL_MS)refresh().catch(error=>console.error('product refresh failed',error.message));return structuredClone(productCache.value)}
  return structuredClone(await refresh());
}
async function loadProductSetsUncached(){
  // 只合併系列列（資料庫的系列 Logo 與內建備用目錄同代碼）；卡盒商品各自是一件商品，同代碼多件（SVD 十副牌組）或同名重發（はじめてセット 2010／2013）都要保留，依 ID 去重。
  let storedFailed=false;const stored=await loadStoredProducts().catch(()=>{storedFailed=true;return []}),curated=await loadCuratedProducts();
  // Taiwanese series names straight from tcg_series too: series imported from the Taiwanese official card search (ADR 0015) have no series-logo product row.
  const twSeriesNames=new Map();if(supabaseConfigured())try{for(const row of await supabaseFetchAll('/tcg_series?select=game:game_id,code:official_code,nameZh:name_zh,source&region=eq.TW&name_zh=not.is.null')){const key=`${row.game}:${String(row.code||'').toUpperCase()}`;if(!twSeriesNames.has(key)||row.source==='asia-pokemon-card-official-tw')twSeriesNames.set(key,row.nameZh)}}catch(error){console.error('tw series names for products failed',error.message)}
  const {products,series}=buildProductSetsFromSources({stored,curated,twSeriesNames,seriesTranslations:await loadSeriesTranslations()});
  return storedFailed?{products,series,partial:true}:{products,series};
}
const loadFallbackCatalog=async()=>getFallbackCatalogCopy();
// Search and card detail call this on every request; it pages through every series plus a card sample (2-4 s), so keep a successful result
// and share in-flight loads. Once it is older than the TTL, callers still get it at once while one background load refreshes it
// (a request never waits for a reload after the first). Ten minutes keeps those reloads from competing with searches on the small
// database instance; catalog data only changes in batch imports. Callers get a clone because they canonicalize/mutate it.
const CATALOG_CACHE_TTL_MS=Number(process.env.CATALOG_CACHE_TTL_MS??600000);
let catalogCache={value:null,at:0,pending:null};
function loadCatalogShared(){
  const refresh=()=>{if(!catalogCache.pending)catalogCache.pending=loadCatalogUncached().then(value=>{if(!value.fallbackReason)catalogCache={value,at:Date.now(),pending:null};else catalogCache.pending=null;return value},error=>{catalogCache.pending=null;throw error});return catalogCache.pending};
  if(catalogCache.value){if(Date.now()-catalogCache.at>=CATALOG_CACHE_TTL_MS)refresh().catch(error=>console.error('catalog refresh failed',error.message));return Promise.resolve(catalogCache.value)}
  return refresh();
}
const loadCatalog=async()=>structuredClone(await loadCatalogShared());
// The second project's games and series join the catalog (its cards are fetched per page as usual); a failure or timeout there only drops those rows.
async function loadSecondDbCatalogRows(){
  if(!secondDbConfigured())return {games:[],series:[]};
  try{return await withTimeout(withDb('ip2',async()=>{const [games,series]=await Promise.all([supabaseFetch(CATALOG_GAMES_PATH),supabaseFetchAll(CATALOG_SERIES_PATH)]);return {games:games||[],series:series||[]}}),SECOND_DB_TIMEOUT_MS)}
  catch(error){console.error('second database catalog failed; main catalog only',error.message);return {games:[],series:[]}}
}
async function loadCatalogUncached(){
  const fallback=await loadFallbackCatalog();
  if(!supabaseConfigured())return canonicalizeCatalog({...fallback,source:'catalog.json'});
  try{
    const [games,series,cards,second]=await Promise.all([
      supabaseFetch(CATALOG_GAMES_PATH),
      supabaseFetchAll(CATALOG_SERIES_PATH),
      supabaseFetch('/tcg_cards?select=id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases&order=created_at.asc&limit=250'),
      loadSecondDbCatalogRows()
    ]);
    const cardIds=(cards||[]).map(c=>`"${String(c.id).replaceAll('"','')}"`).join(','),[printings,images]=cardIds?await Promise.all([
      supabaseFetchAll(`/tcg_printings?${new URLSearchParams({select:BROWSE_PRINTING_SELECT,card_id:`in.(${cardIds})`})}`),
      supabaseFetch(`/card_images?${new URLSearchParams({select:BROWSE_IMAGE_SELECT,card_id:`in.(${cardIds})`,order:'is_primary.desc,fetched_at.desc',limit:'1000'})}`).catch(()=>[])
    ]):[[],[]];
    const printingByCard=new Map(),imageByCard=new Map();
    for(const p of printings||[]){const list=printingByCard.get(p.cardId)||[];list.push(p);printingByCard.set(p.cardId,list)}
    for(const i of images||[]){const list=imageByCard.get(i.cardId)||[];list.push(i);imageByCard.set(i.cardId,list)}
    const databaseCards=(cards||[]).map(c=>{const ps=printingByCard.get(c.id)||[],imgs=imageByCard.get(c.id)||[],primary=imgs.find(browseHasUsableImage)||ps.find(browseHasUsableImage);return {...c,region:ps[0]?.region||null,language:ps[0]?.language||null,imageUrl:primary?.imageUrl||null,imageSource:primary?.source||null,imageRightsStatus:primary?.imageRightsStatus||null,printings:ps,images:imgs}}),merged={version:3,updatedAt:new Date().toISOString(),source:'supabase+catalog.json',games:mergeCatalogRows(fallback.games,[...(games||[]),...second.games]),series:mergeCatalogRows(fallback.series,[...(series||[]),...second.series],{keepFallbackOnly:false}),cards:mergeCatalogRows(fallback.cards,databaseCards,{keepFallbackOnly:false})};
    return canonicalizeCatalog(merged);
  }catch(error){return canonicalizeCatalog({...fallback,source:'catalog.json',fallbackReason:publicReason('catalog load failed; using catalog.json',error)})}
}
async function loadCatalogCoverageLegacy(){
  const fallback=await loadFallbackCatalog();
  if(!supabaseConfigured())return {totalCards:fallback.cards.length,games:Object.fromEntries(fallback.games.map(g=>[g.id,{cards:fallback.cards.filter(c=>c.game===g.id).length,displayableImages:fallback.cards.filter(c=>c.game===g.id&&c.imageUrl).length}])),source:'catalog.json',updatedAt:fallback.updatedAt||null};
  try{
    const runs=await supabaseFetch('/catalog_sync_runs?select=provider,rowsSeen:rows_seen,metadata,finishedAt:finished_at&status=eq.completed&provider=not.in.(price-snapshot,price-archive)&order=finished_at.desc&limit=12'),latest=new Map();
    for(const run of runs||[])if(!latest.has(run.provider))latest.set(run.provider,run);
    const pokemon=latest.get('pokemontcg'),onepiece=latest.get('onepiece-official'),yugioh=latest.get('ygoprodeck'),haikyuu=latest.get('haikyu-official'),weiss=latest.get('weiss-schwarz-official'),dragonball=latest.get('dbs-fw-official'),games={
      pokemon:{cards:Number(pokemon?.metadata?.totalCards||pokemon?.rowsSeen||0),displayableImages:Number(pokemon?.metadata?.totalCards||pokemon?.rowsSeen||0),provider:'Pokémon TCG Data'},
      onepiece:{cards:Number(onepiece?.metadata?.cards||0),displayableImages:Number(onepiece?.metadata?.cards||0),provider:'ONE PIECE 官方卡表'},
      yugioh:{cards:Number(yugioh?.metadata?.cards||yugioh?.rowsSeen||0),displayableImages:0,provider:'YGOPRODeck',imageNotice:'圖片來源要求先自行保存，因此不直接長期引用'},
      haikyuu:{cards:Number(haikyuu?.metadata?.cards||haikyuu?.rowsSeen||0),displayableImages:Number(haikyuu?.metadata?.images||0),provider:'Takara Tomy 官方卡表'},
      'weiss-schwarz':{cards:Number(weiss?.metadata?.cards||weiss?.rowsSeen||0),displayableImages:Number(weiss?.metadata?.images||0),provider:'Weiß Schwarz 官方卡表'},
      'dragonball-fw':{cards:Number(dragonball?.metadata?.cards||0),displayableImages:Number(dragonball?.metadata?.images||0),provider:'七龍珠超 Fusion World 官方卡表'}
    },finished=[pokemon,onepiece,yugioh,haikyuu,weiss,dragonball].map(x=>x?.finishedAt).filter(Boolean).sort().at(-1)||null;
    return {totalCards:Object.values(games).reduce((sum,g)=>sum+g.cards,0),games,source:'supabase-sync-runs',updatedAt:finished};
  }catch(error){return {totalCards:fallback.cards.length,games:Object.fromEntries(fallback.games.map(g=>[g.id,{cards:fallback.cards.filter(c=>c.game===g.id).length,displayableImages:fallback.cards.filter(c=>c.game===g.id&&c.imageUrl).length}])),source:'catalog.json',updatedAt:fallback.updatedAt||null,fallbackReason:publicReason('health counts failed; using catalog.json',error)}}
}

// TW source names wrap an owner prefix in angle brackets (<火箭隊的>超夢ex); a query typed as printed (火箭隊的超夢) gets one variant per 的 so ilike can still match.
// Every term the database search tries for a query: the query, a mapped alias, markup, anniversary and card-number variants (capped for SQL safety).
// rawQuery may be an array (the database's own spellings of the query, see foldedNameSpans); the alias mapping follows the first one.
const seriesIndexCache=new WeakMap();
function getSeriesSearchIndex(catalog){const list=catalog?.series;if(!Array.isArray(list))return buildSeriesIndex([]);let idx=seriesIndexCache.get(list);if(!idx){idx=buildSeriesIndex(list);seriesIndexCache.set(list,idx)}return idx}
// Repeated searches within a minute reuse the answer (same freshness as the catalog cache); at most 200 queries, least recently used dropped first.
// Catalog data only changes in batch imports, so a 10-minute search result cache is safe; 200 entries stay within a few tens of MB.
const SEARCH_CACHE_TTL_MS=600000,SEARCH_CACHE_MAX=200,searchCache=new Map();
function recallSearch(key){const hit=searchCache.get(key);if(!hit)return null;searchCache.delete(key);if(Date.now()-hit.at>=SEARCH_CACHE_TTL_MS)return null;searchCache.set(key,hit);return hit.body}
function rememberSearch(key,body){searchCache.delete(key);searchCache.set(key,{at:Date.now(),body});while(searchCache.size>SEARCH_CACHE_MAX)searchCache.delete(searchCache.keys().next().value)}
// search_cards_ranked(..., p_offset, p_rarities) (migration 20261019090000) pages, filters by rarity and returns matchRank; while it is missing the four-argument version answers (first page only) and this is not retried for five minutes.
// search_cards_ranked(..., p_series_ids) (migration 20261121000000) intersects target series with card features in SQL; while missing, falls back to bounded PostgREST intersection.
let rankedPageMissingUntil=0,rankedSeriesMissingUntil=0;
// A search that found nothing is retried with the database's own spelling when only spaces, middle dots or hyphens differ (日向翔陽 -> 日向 翔陽, OP-17-118 -> OP17-118):
// search_fold_names (migration 20261023140000) lists names whose folded form contains the folded query; we cut the matching span out of each. Fewer than 3 folded characters has no trigram index, so no retry.
async function foldedNameSpans(name){
  const folded=foldSearch(name);if(folded.length<3)return [];
  try{const ask=db=>supabaseFetch('/rpc/search_fold_names',{db,method:'POST',body:JSON.stringify({p_fold:folded,p_limit:5})}),[rows,secondRows]=await Promise.all([ask('main'),secondDbConfigured()?withTimeout(ask('ip2'),SECOND_DB_TIMEOUT_MS).catch(()=>[]):[]]);return [...new Set([...(Array.isArray(rows)?rows:[]),...(Array.isArray(secondRows)?secondRows:[])].map(row=>foldedSpan(row?.name,folded)).filter(span=>span&&span.toLowerCase()!==String(name).trim().toLowerCase()))].slice(0,3)}
  catch(error){console.error('search fold retry failed',error.message);return []}
}
// Typo help for a search with no result: search_name_suggestion (migration 20261023150000, pg_trgm on the card names) returns the closest name, or NULL when nothing is close. Called only on zero results.
async function suggestCardName(name,region){
  const query=String(name||'').trim();if(query.length<3)return null;
  try{const ask=db=>supabaseFetch('/rpc/search_name_suggestion',{db,method:'POST',body:JSON.stringify({p_q:query,p_region:region==='ALL'?null:region})});let value=await ask('main');if(typeof value!=='string'&&secondDbConfigured())value=await withTimeout(ask('ip2'),SECOND_DB_TIMEOUT_MS).catch(()=>null);const text=typeof value==='string'?value.trim():'';return text&&text.toLowerCase()!==query.toLowerCase()?{q:text,reason:'相近的卡名'}:null}
  catch(error){console.error('search name suggestion failed',error.message);return null}
}
// Search across both projects: the main project's results come first, exactly as before; the second project fills a page the main one could not
// fill, its own results continuing at offset - (main total). Asked only then, so most searches cost nothing more; a failure or timeout there keeps the main answer.
// shortcut: second-project hits always rank after every main hit (no cross-project relevance merge), and while main pages are full the total counts main only
// (it grows on the first page that reaches the second project); merge by matchRank and ask both for counts if UA results feel buried.
async function searchCatalogDatabase(rawQuery,region='ALL',limit=SEARCH_RESULT_LIMIT,{offset=0,rarities=[],seriesIds=[]}={}){
  const scopedSeries=[...new Set((seriesIds||[]).map(id=>String(id||'').trim()).filter(Boolean))].slice(0,SEARCH_SERIES_IDS_MAX);
  if(scopedSeries.length){
    const mainSeries=scopedSeries.filter(id=>dbForId(id)==='main'),secondSeries=secondDbConfigured()?scopedSeries.filter(id=>dbForId(id)==='ip2'):[];
    if(!mainSeries.length&&!secondSeries.length)return {cards:[],candidateCount:0,candidateLimit:SEARCH_CANDIDATE_LIMIT,resultLimit:limit,mayHaveMore:false,searched:true,matchedSeries:0,timings:{},total:0,paged:false};
    if(!mainSeries.length){try{return await withTimeout(withDb('ip2',()=>searchCatalogDatabaseIn(rawQuery,region,limit,{offset,rarities,seriesIds:secondSeries})),SECOND_DB_TIMEOUT_MS)}catch(error){console.error('second database scoped search failed',error.message);return {cards:[],candidateCount:0,candidateLimit:SEARCH_CANDIDATE_LIMIT,resultLimit:limit,mayHaveMore:false,searched:true,matchedSeries:0,timings:{},total:0,paged:false}}}
    const main=await withDb('main',()=>searchCatalogDatabaseIn(rawQuery,region,limit,{offset,rarities,seriesIds:mainSeries}));
    if(!secondSeries.length||!main.searched||main.cards.length>=limit)return main;
    const mainTotal=main.cards.length?offset+main.cards.length:Number(main.total)||0,secondOffset=Math.max(offset-mainTotal,0);
    let second;try{second=await withTimeout(withDb('ip2',()=>searchCatalogDatabaseIn(rawQuery,region,limit-main.cards.length,{offset:secondOffset,rarities,seriesIds:secondSeries})),SECOND_DB_TIMEOUT_MS)}
    catch(error){console.error('second database search failed; main results only',error.message);return main}
    if(!second.cards.length&&!second.total)return main;
    const secondTotal=Number(second.total)||secondOffset+second.cards.length,timings={...main.timings};
    for(const [name,ms] of Object.entries(second.timings||{}))timings[`second-${name}`]=ms;
    return {...main,cards:[...main.cards,...second.cards],candidateCount:main.candidateCount+second.candidateCount,mayHaveMore:second.mayHaveMore,matchedSeries:main.matchedSeries||second.matchedSeries,timings,total:mainTotal+secondTotal,paged:Boolean(main.cards.length?main.paged:second.paged)};
  }
  const main=await withDb('main',()=>searchCatalogDatabaseIn(rawQuery,region,limit,{offset,rarities}));
  if(!secondDbConfigured()||!main.searched||main.cards.length>=limit)return main;
  const mainTotal=main.cards.length?offset+main.cards.length:Number(main.total)||0,secondOffset=Math.max(offset-mainTotal,0);
  let second;try{second=await withTimeout(withDb('ip2',()=>searchCatalogDatabaseIn(rawQuery,region,limit-main.cards.length,{offset:secondOffset,rarities})),SECOND_DB_TIMEOUT_MS)}
  catch(error){console.error('second database search failed; main results only',error.message);return main}
  if(!second.cards.length&&!second.total)return main;
  const secondTotal=Number(second.total)||secondOffset+second.cards.length,timings={...main.timings};
  for(const [name,ms] of Object.entries(second.timings||{}))timings[`second-${name}`]=ms;
  return {...main,cards:[...main.cards,...second.cards],candidateCount:main.candidateCount+second.candidateCount,mayHaveMore:second.mayHaveMore,matchedSeries:main.matchedSeries||second.matchedSeries,timings,total:mainTotal+secondTotal,paged:Boolean(main.cards.length?main.paged:second.paged)};
}
async function searchCatalogDatabaseIn(rawQuery,region='ALL',limit=SEARCH_RESULT_LIMIT,{offset=0,rarities=[],seriesIds=[]}={}){
  const scopedSeries=[...new Set((seriesIds||[]).map(id=>String(id||'').trim()).filter(Boolean))].slice(0,SEARCH_SERIES_IDS_MAX),hasSeriesScope=scopedSeries.length>0,seriesIdSet=hasSeriesScope?new Set(scopedSeries):null;
  const rarityValues=rarityMatchValues(rarities),filtered=region!=='ALL'||rarityValues.length>0||hasSeriesScope;
  if(!supabaseConfigured())return {cards:[],candidateCount:0,candidateLimit:SEARCH_CANDIDATE_LIMIT,resultLimit:limit,mayHaveMore:false,searched:false};
  const terms=searchQueryTerms(rawQuery).slice(0,SEARCH_PATTERNS_MAX);if(!terms.length)return {cards:[],candidateCount:0,candidateLimit:SEARCH_CANDIDATE_LIMIT,resultLimit:limit,mayHaveMore:false,searched:false};
  // Card queries embed their printings to save a round trip; if the embed is rejected, fall back to the plain select and a separate printing fetch.
  const plainSelect='id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases,metadata,searchText:search_text';let select=`${plainSelect},printings:tcg_printings!tcg_printings_card_id_fkey(${BROWSE_PRINTING_SELECT})`;
  const cardsFetch=async params=>{try{return await supabaseFetch(`/tcg_cards?${new URLSearchParams({select,...params})}`)}catch(error){if(select===plainSelect||searchTimedOut(error))throw error;console.error('search printing embed failed; retrying without it',error.message);select=plainSelect;return supabaseFetch(`/tcg_cards?${new URLSearchParams({select,...params})}`)}};
  // Per-step durations for the Server-Timing header (search latency budget, PRODUCT_PLAN release gate).
  const timings={},timed=async(name,work)=>{const started=performance.now();try{return await work}finally{timings[name]=Math.round((timings[name]||0)+performance.now()-started)}};
  const query=columns=>{const filters=[];for(const term of terms)for(const column of columns)filters.push(`${column}.ilike.*${term}*`);return cardsFetch({or:`(${filters.join(',')})`,limit:String(SEARCH_CANDIDATE_LIMIT)})};
  // One round trip: search_cards_ranked ranks in SQL and returns only the best `limit` canonical groups with trimmed fields;
  // older databases fall back to search_cards_with_siblings (100 unranked hits + siblings), then to two PostgREST queries.
  const patterns=terms.map(term=>`%${term}%`);
  const rankedCall=body=>timed('rpc',supabaseFetch('/rpc/search_cards_ranked',{method:'POST',body:JSON.stringify(body)})),rankedShape=value=>Boolean(value&&Array.isArray(value.cards)&&Number.isFinite(Number(value.matchCount))),regionArg=region==='ALL'?null:region;
  const needles=terms.map(normalizeSearch);
  let ranked=null,paged=false,viaRanked=false,rankedHits=false,rpc=null,viaRpc=false,cards=[],matchedSeries=0;
  if(hasSeriesScope){
    // 複合系列＋卡片特徵模式：優先呼叫 7 參數 search_cards_ranked；若資料庫尚未套用 migration（PGRST202/404），降級為有限度的 PostgREST 系列×卡名交集。
    if(Date.now()>=rankedSeriesMissingUntil){try{ranked=await rankedCall({p_patterns:patterns,p_needles:terms,p_limit:limit,p_region:regionArg,p_offset:offset,p_rarities:rarityValues.length?rarityValues:null,p_series_ids:scopedSeries});paged=rankedShape(ranked)}catch(error){if(searchTimedOut(error))throw error;if(/PGRST202|SUPABASE_404/.test(error.message))rankedSeriesMissingUntil=Date.now()+300000;console.error('search ranked series rpc failed; using PostgREST series intersection',error.message)}}
    viaRanked=paged;rankedHits=viaRanked&&ranked.cards.length>0;
    if(viaRanked){cards=rankedHits?ranked.cards.map(({hit,...card})=>card):[]}
    else{
      const seriesIn=scopedSeries.map(id=>`"${String(id).replace(/["\\]/g,'')}"`).join(','),pParams={select:'cardId:card_id,seriesId:series_id,region,rarity,rarityCode:rarity_code,localCardNumber:local_card_number',series_id:`in.(${seriesIn})`,order:'series_id.asc,local_card_number.asc,card_id.asc',limit:'1000'};
      if(regionArg)pParams.region=`eq.${regionArg}`;
      const scopedPrintings=await timed('series-printings',supabaseFetch(`/tcg_printings?${new URLSearchParams(pParams)}`))||[];
      const matchingCardIds=[...new Set(scopedPrintings.filter(p=>printingMatchesRarity(p,rarityValues)).map(p=>p.cardId))];
      if(matchingCardIds.length){
        const fetched=[];
        for(let i=0;i<matchingCardIds.length&&fetched.length<400;i+=100){
          const batch=matchingCardIds.slice(i,i+100).map(id=>`"${String(id).replace(/["\\]/g,'')}"`).join(',');
          const rows=await timed('series-cards',cardsFetch({id:`in.(${batch})`,limit:'100'}))||[];
          fetched.push(...rows);
        }
        const seriesOrder=new Map(scopedSeries.map((id,idx)=>[id,idx]));
        cards=fetched.filter(c=>{const vals=[c.nameZh,c.nameJa,c.nameEn,c.nameKo,...(c.aliases||[]),c.officialCardNumber,c.searchText,...(c.printings||[]).filter(p=>seriesIdSet.has(p.seriesId)&&(region==='ALL'||p.region===region)).map(p=>p.localCardNumber)];return vals.some(v=>{const nv=normalizeSearch(v);return nv&&needles.some(n=>nv.includes(n))})}).sort((a,b)=>(seriesOrder.get(a.seriesId)??999)-(seriesOrder.get(b.seriesId)??999));
      }
    }
  }else{
    // The paging/filtering version first (every parameter named, nulls included, as PostgREST resolves the function by name); missing or malformed -> the four-argument version, which only knows the first 100 groups.
    if(Date.now()>=rankedPageMissingUntil){try{ranked=await rankedCall({p_patterns:patterns,p_needles:terms,p_limit:limit,p_region:regionArg,p_offset:offset,p_rarities:rarityValues.length?rarityValues:null});paged=rankedShape(ranked)}catch(error){if(searchTimedOut(error))throw error;if(/PGRST202|SUPABASE_404/.test(error.message))rankedPageMissingUntil=Date.now()+300000;console.error('search ranked page rpc failed; trying the four-argument search_cards_ranked',error.message)}}
    if(!paged){ranked=null;try{ranked=await rankedCall({p_patterns:patterns,p_needles:terms,p_limit:Math.min(offset+limit,SEARCH_PAGE_MAX),p_region:regionArg})}catch(error){if(searchTimedOut(error))throw error;console.error('search ranked rpc failed; trying search_cards_with_siblings',error.message)}}
    viaRanked=Boolean(ranked&&Array.isArray(ranked.cards)&&Number.isFinite(Number(ranked.matchCount)));rankedHits=viaRanked&&ranked.cards.length>0;
    if(!viaRanked){try{rpc=await timed('rpc',supabaseFetch('/rpc/search_cards_with_siblings',{method:'POST',body:JSON.stringify({p_patterns:patterns,p_limit:SEARCH_CANDIDATE_LIMIT})}))}catch(error){if(searchTimedOut(error))throw error;console.error('search rpc failed; using PostgREST queries',error.message)}}
    viaRpc=Boolean(rpc&&Array.isArray(rpc.hits)&&Array.isArray(rpc.siblings));
    cards=rankedHits?ranked.cards.map(({hit,...card})=>card):viaRanked?[]:viaRpc&&rpc.hits.length?rpc.hits:viaRpc?[]:await timed('names',query(['name_zh','name_ja','name_en','name_ko','official_card_number']));matchedSeries=rankedHits&&ranked.matchedBy==='series'?Number(ranked.matchedSeries)||1:0;
    // search_cards_ranked already tried search_text (when it reports matchedBy) and series names (matchedSeries); cards it matched but the region filter removed end the search.
    const rankedMatched=viaRanked&&Number(ranked.matchCount)>0;if(!cards?.length&&!(viaRanked&&'matchedBy' in ranked))cards=await timed('text',query(['search_text']));
    // No card matched by name or text: fall back to series names/codes (e.g. 「ナイトワンダラー」, "SV6a") and list that series' cards in card-number order.
    if(!cards?.length&&!rankedMatched&&!(viaRanked&&'matchedSeries' in ranked)){const seriesFilters=[];for(const term of terms)for(const column of ['name_zh','name_ja','name_en','name_ko','official_code'])seriesFilters.push(`${column}.ilike.*${term}*`);const series=await supabaseFetch(`/tcg_series?${new URLSearchParams({select:'id',or:`(${seriesFilters.join(',')})`,limit:'5'})}`);if(series?.length){matchedSeries=series.length;const sIds=series.map(s=>`"${String(s.id).replaceAll('"','')}"`).join(','),rows=await supabaseFetch(`/tcg_printings?${new URLSearchParams({select:'cardId:card_id',series_id:`in.(${sIds})`,order:'series_id.asc,local_card_number.asc,card_id.asc',limit:String(SEARCH_CANDIDATE_LIMIT)})}`),cardIds=[...new Set((rows||[]).map(r=>r.cardId))];if(cardIds.length){const order=new Map(cardIds.map((id,index)=>[id,index]));cards=(await cardsFetch({id:`in.(${cardIds.map(id=>`"${String(id).replaceAll('"','')}"`).join(',')})`,limit:String(SEARCH_CANDIDATE_LIMIT)})||[]).sort((a,b)=>(order.get(a.id)??SEARCH_CANDIDATE_LIMIT)-(order.get(b.id)??SEARCH_CANDIDATE_LIMIT))}}}
  }
  if(!cards?.length)return {cards:[],candidateCount:0,candidateLimit:SEARCH_CANDIDATE_LIMIT,resultLimit:limit,mayHaveMore:false,searched:true,matchedSeries,timings,...(paged&&offset&&Number(ranked.groupCount)>0?{total:Number(ranked.groupCount),paged}:{})};
  const score=card=>{const names=[card.nameZh,card.nameJa,card.nameEn,card.nameKo,...(card.aliases||[]),card.officialCardNumber].map(normalizeSearch).filter(Boolean);if(names.some(name=>needles.some(needle=>name===needle)))return 0;if(names.some(name=>needles.some(needle=>name.startsWith(needle))))return 1;if(names.some(name=>needles.some(needle=>name.includes(needle))))return 2;return 3};if(!matchedSeries&&!rankedHits)cards.sort((a,b)=>score(a)-score(b)||String(a.nameEn||a.nameZh||'').localeCompare(String(b.nameEn||b.nameZh||'')));
  // Pull in the other cards of each matched canonical (e.g. the TW twin of a JP card, ADR 0003) so one result lists every printing; a failure here only loses the extra printings.
  const candidateCount=rankedHits?Number(ranked.matchCount):cards.length,knownIds=new Set(cards.map(c=>c.id)),canonicalIds=[...new Set(cards.map(c=>c.canonicalId).filter(Boolean))];
  if(canonicalIds.length&&viaRpc&&!matchedSeries&&rpc.hits.length){for(const sibling of rpc.siblings)if(!knownIds.has(sibling.id)){knownIds.add(sibling.id);cards.push(sibling)}}
  else if(canonicalIds.length&&!rankedHits){try{const siblings=await timed('siblings',cardsFetch({canonical_id:`in.(${canonicalIds.map(id=>`"${String(id).replaceAll('"','')}"`).join(',')})`,limit:String(SEARCH_CANDIDATE_LIMIT*2)}));for(const sibling of siblings||[])if(!knownIds.has(sibling.id)){knownIds.add(sibling.id);cards.push(sibling)}}catch(error){console.error('search sibling cards failed',error.message)}}
  // Card queries embed their printings, saving a round trip; rows that come back without the embed still get a separate printing fetch.
  const unembedded=cards.filter(c=>!Array.isArray(c.printings)),ids=unembedded.map(c=>`"${String(c.id).replaceAll('"','')}"`).join(','),printings=[...cards.flatMap(c=>Array.isArray(c.printings)?c.printings:[]),...(ids?await timed('printings',supabaseFetch(`/tcg_printings?${new URLSearchParams({select:BROWSE_PRINTING_SELECT,card_id:`in.(${ids})`,limit:'1000'})}`))||[]:[])],byCard=new Map();
  for(const p of printings){if((region!=='ALL'&&p.region!==region)||!printingMatchesRarity(p,rarityValues)||(seriesIdSet&&!seriesIdSet.has(p.seriesId)))continue;const list=byCard.get(p.cardId)||[];list.push(p);byCard.set(p.cardId,list)}
  const canonicalCards=canonicalizeCatalog({cards:cards.filter(c=>!filtered||byCard.has(c.id)).map(c=>({...c,printings:byCard.get(c.id)||[],region:byCard.get(c.id)?.[0]?.region||null,language:byCard.get(c.id)?.[0]?.language||null,...cardImageFields(c,byCard.get(c.id))}))}).cards;
  // 版本篩選濾掉的同作品層卡（例如日版 M6a SAR 的台版）：圖留給卡牆在本卡沒圖時改用，與系列瀏覽的 fallbackImageUrls 一致
  const siblingUrls=new Map();if(filtered)for(const c of cards){const url=byCard.has(c.id)?null:cardImageFields(c,c.printings).imageUrl,key=c.canonicalId||c.id;if(url){const list=siblingUrls.get(key)||[];if(!list.includes(url))list.push(url);siblingUrls.set(key,list)}}
  for(const card of canonicalCards){const urls=siblingUrls.get(card.canonicalId||card.id);if(urls?.length)card.fallbackImageUrls=urls.slice(0,3)}
  // Paged answers are already one page in the database's order; older paths slice here. total is the real number of canonical cards (paged), a lower bound otherwise.
  const page=paged?canonicalCards.slice(0,limit):canonicalCards.slice(offset,offset+limit),total=paged?Math.max(Number(ranked.groupCount)||0,offset+page.length):rankedHits&&!rarityValues.length&&!hasSeriesScope?Math.max(Number(ranked.groupCount)||0,page.length):canonicalCards.length;
  return {cards:page.map(card=>({...card,matchRank:card.matchRank??cardMatchRank(card,needles)})),candidateCount,candidateLimit:SEARCH_CANDIDATE_LIMIT,resultLimit:limit,mayHaveMore:rankedHits?Number(ranked.groupCount)>limit:candidateCount>=SEARCH_CANDIDATE_LIMIT||canonicalCards.length>limit,searched:true,matchedSeries,timings,total,paged};
}

async function browseCardsByGame(game,limit=60,offset=0,seriesId=''){
  if(!supabaseConfigured())return [];
  const safeGame=String(game).replace(/[^a-z0-9-]/gi,''),take=Math.min(Math.max(Number(limit)||60,1),100),skip=Math.max(Number(offset)||0,0),select='id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases,metadata';
  if(!CATALOG_GAME_IDS.has(safeGame))throw new Error('UNSUPPORTED_GAME');
  let cards=[];
  if(seriesId){
    const safeSeries=String(seriesId).replace(/[^a-z0-9:_-]/gi,''),printingPage=await supabaseFetch(`/tcg_printings?select=cardId:card_id&series_id=eq.${encodeURIComponent(safeSeries)}&order=local_card_number.asc,card_id.asc&limit=${take+1}&offset=${skip}`),cardIds=[...new Set((printingPage||[]).slice(0,take).map(p=>p.cardId))];
    if(!cardIds.length)return {data:[],hasMore:false};
    const ids=cardIds.map(id=>`"${String(id).replaceAll('"','')}"`).join(',');cards=await supabaseFetch(`/tcg_cards?select=${select}&game_id=eq.${safeGame}&id=in.(${encodeURIComponent(ids)})&limit=${take}`);const order=new Map(cardIds.map((id,index)=>[id,index]));cards=(cards||[]).sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999));
    cards.hasMore=printingPage.length>take;
  }else cards=await supabaseFetch(`/tcg_cards?select=${select}&game_id=eq.${safeGame}&order=official_card_number.asc,id.asc&limit=${take+1}&offset=${skip}`);
  if(!cards?.length)return {data:[],hasMore:false};
  const hasMore=seriesId?Boolean(cards.hasMore):cards.length>take;cards=cards.slice(0,take);
  const ids=cards.map(c=>`"${String(c.id).replaceAll('"','')}"`).join(','),params=new URLSearchParams({select:BROWSE_PRINTING_SELECT,card_id:`in.(${ids})`,limit:'1000'}),printings=await supabaseFetch(`/tcg_printings?${params}`),byCard=new Map();
  for(const p of printings||[]){const list=byCard.get(p.cardId)||[];list.push(p);byCard.set(p.cardId,list)}
  return {data:cards.map(c=>({...c,printings:byCard.get(c.id)||[],region:byCard.get(c.id)?.[0]?.region||null,language:byCard.get(c.id)?.[0]?.language||null,imageUrl:byCard.get(c.id)?.find(p=>p.imageUrl&&!p.imageRehostRequired)?.imageUrl||null})),hasMore};
}
// One round trip through get_card_detail when the database has it; otherwise the PostgREST queries below.
async function loadCardDetailRpc(cardId){
  let detail=null;try{detail=await supabaseFetch('/rpc/get_card_detail',{method:'POST',body:JSON.stringify({p_id:String(cardId)})})}catch(error){console.error('card detail rpc failed; using PostgREST queries',error.message);return undefined}
  if(!detail||!Array.isArray(detail.cards)||!Array.isArray(detail.series)||!Array.isArray(detail.games))return undefined;
  if(!detail.cards.length)return null;
  const hydrated=detail.cards.map(c=>({...c,printings:c.printings||[],region:c.printings?.[0]?.region||null,language:c.printings?.[0]?.language||null,...cardImageFields(c,c.printings)})),cards=canonicalizeCatalog({cards:hydrated}).cards,canonical=cards.find(c=>c.id===cardId)||cards[0];
  return {catalog:{source:'supabase-full-catalog',cards:[canonical],series:detail.series,games:detail.games.filter(g=>g.id===canonical.game)},card:canonical};
}
// A second-project card id is looked up only there; with that project not configured the card does not exist.
async function loadCardFromDatabase(cardId){
  const db=dbForId(cardId);if(db==='ip2'&&!secondDbConfigured())return null;
  return withDb(db,()=>loadCardFromDatabaseIn(cardId));
}
async function loadCardFromDatabaseIn(cardId){
  if(!supabaseConfigured())return null;const viaRpc=await loadCardDetailRpc(cardId);if(viaRpc!==undefined)return viaRpc;const safe=String(cardId).replace(/[(),"\\]/g,'');if(!safe)return null;const cardSelect='id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases,metadata',params=new URLSearchParams({select:cardSelect,or:`(id.eq.${safe},canonical_id.eq.${safe})`,limit:'100'}),cards=await supabaseFetch(`/tcg_cards?${params}`);if(!cards?.length)return null;
  // A card linked into another canonical (e.g. a JP card joining its TW twin, ADR 0003) must bring that canonical's other printings along.
  const knownIds=new Set(cards.map(c=>c.id)),siblingCanonicals=[...new Set(cards.map(c=>c.canonicalId).filter(id=>id&&id!==safe))];
  if(siblingCanonicals.length){const siblings=await supabaseFetch(`/tcg_cards?${new URLSearchParams({select:cardSelect,canonical_id:`in.(${siblingCanonicals.map(id=>`"${String(id).replace(/["\\]/g,'')}"`).join(',')})`,limit:'100'})}`);for(const sibling of siblings||[])if(!knownIds.has(sibling.id)){knownIds.add(sibling.id);cards.push(sibling)}}
  const ids=cards.map(c=>`"${String(c.id).replace(/["\\]/g,'')}"`).join(','),printingParams=new URLSearchParams({select:BROWSE_PRINTING_SELECT,card_id:`in.(${ids})`,limit:'1000'}),printings=await supabaseFetch(`/tcg_printings?${printingParams}`),byCard=new Map();for(const p of printings||[]){const list=byCard.get(p.cardId)||[];list.push(p);byCard.set(p.cardId,list)}
  const hydrated=cards.map(c=>({...c,printings:byCard.get(c.id)||[],region:byCard.get(c.id)?.[0]?.region||null,language:byCard.get(c.id)?.[0]?.language||null,imageUrl:byCard.get(c.id)?.find(p=>p.imageUrl&&!p.imageRehostRequired)?.imageUrl||null})),canonical=canonicalizeCatalog({cards:hydrated}).cards.find(c=>c.id===cardId)||canonicalizeCatalog({cards:hydrated}).cards[0],seriesIds=[...new Set((canonical?.printings||[]).map(p=>p.seriesId).concat(canonical?.seriesId).filter(Boolean))],series=seriesIds.length?await supabaseFetch(`/tcg_series?select=id,game:game_id,officialCode:official_code,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,region,releaseDate:release_date&${new URLSearchParams({id:`in.(${seriesIds.map(x=>`"${String(x).replace(/["\\]/g,'')}"`).join(',')})`})}`):[],games=await supabaseFetch(`/tcg_games?select=id,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko&id=eq.${encodeURIComponent(canonical.game)}`);return {catalog:{source:'supabase-full-catalog',cards:[canonical],series:series||[],games:games||[]},card:canonical};
}
// The detail page and its market tab ask for the same card at once: share the database load and keep it briefly.
const CARD_CACHE_TTL_MS=600000,CARD_CACHE_MAX=500,cardCache=new Map();
function loadCardCached(cardId){const hit=cardCache.get(cardId);if(hit&&(hit.pending||Date.now()-hit.at<CARD_CACHE_TTL_MS))return hit.promise;const entry={pending:true,at:0,promise:null};entry.promise=loadCardFromDatabase(cardId).then(value=>{entry.pending=false;entry.at=Date.now();if(!value)cardCache.delete(cardId);return value},error=>{cardCache.delete(cardId);throw error});cardCache.set(cardId,entry);while(cardCache.size>CARD_CACHE_MAX)cardCache.delete(cardCache.keys().next().value);return entry.promise}
async function getCard(cardId){const fromDatabase=supabaseConfigured()?loadCardCached(cardId).catch(()=>null):Promise.resolve(null),shared=await loadCatalogShared();const match=shared.cards.find(c=>c.id===cardId)||shared.cards.find(c=>c.physicalCardIds?.includes(cardId)||c.printings?.some(p=>p.cardId===cardId||p.id===cardId));if(match){const catalog=structuredClone(shared);return {catalog,card:catalog.cards.find(c=>c.id===match.id)}}const found=await fromDatabase;return found?structuredClone(found):{catalog:shared,card:null}}
// eq. takes the value literally (URLSearchParams does the URL encoding); the old ilike-style backslash escaping made card numbers containing . _ % never match.
async function yuyuteiMarket(card,fx){if(!supabaseConfigured()||!card.officialCardNumber)return [];const params=new URLSearchParams({select:'cardName:card_name,cardNumber:card_number,rarity,price,currency,cardUrl:card_url,imageUrl:image_url,setCode:set_code,setName:set_name,scrapedAt:scraped_at',card_number:`eq.${card.officialCardNumber}`,order:'scraped_at.desc',limit:'10'}),rows=await supabaseFetch(`/jp_buyback_prices?${params}`);return (rows||[]).map(r=>({...withTwd(normalizeMarketRecord({provider:'yuyutei',market:'JP',cardId:card.id,cardName:r.cardName,cardNumber:r.cardNumber,setCode:r.setCode,rarity:r.rarity,language:'ja-JP',priceType:'buyback',amount:r.price,currency:r.currency,imageUrl:r.imageUrl,sourceUrl:r.cardUrl,observedAt:r.scrapedAt}),fx),region:'JP'}))}
// Snapshots of every printing of the card (the same read as the collection valuation); a failure only means the table falls back to the live records.
async function loadVersionSnapshots(card,fx){
  const ids=priceHistoryCardIds(card,card?.id);if(card?.game!=='pokemon'||ids.length<2||!supabaseConfigured())return [];
  try{return buildReferencePrices(await supabaseFetch(`/price_snapshots?${new URLSearchParams(referenceQueryParams(ids))}`),ids,{fx,amountToTwd}).cards}catch(error){console.error('version price snapshots failed',error.message);return []}
}
async function unifiedMarket(card){
  const fx=await getTwdRates(),snapshotsPending=loadVersionSnapshots(card,fx),tasks=sourceDisplayDenied('yuyutei')?[]:[['yuyutei',()=>yuyuteiMarket(card,fx)]];
  // 優先顯示「這個 printing」的價：card_sets[].set_price 依 printing 卡號＋稀有度精確配對（日版 -JP 一律不配）。一個版本都配不到時才退回 card_prices 的跨版本最低價，並標明不是這個版本的價格，也不掛到版本對照表；只有日版的卡不退回，那是 TCG 價格，不是 OCG 行情。
  // set_price 的來源平台 YGOPRODeck 文件只寫「$ value」，所以標「YGOPRODeck 參考價（USD）」，不稱 TCGplayer 或成交價。
  if(card.game==='yugioh')tasks.push(['ygoprodeck',async()=>{const wanted=String(card.nameEn||'').trim().toLowerCase();if(!wanted)return [];const found=await searchYgoProDeck(card.nameEn,{limit:20}),match=found.find(x=>String(x.name).trim().toLowerCase()===wanted);if(!match)return [];
    const printings=card.printings?.length?card.printings.map(p=>({number:p.localCardNumber,rarity:p.rarity,region:p.region})):[{number:card.officialCardNumber,rarity:card.rarity,region:card.region}],seen=new Set(),rows=[];
    for(const p of printings){if(p.region==='JP')continue;const set=matchYgoprodeckSet(match.sets,p),key=set&&`${set.setCode}|${set.rarity}`;if(!set||seen.has(key))continue;seen.add(key);rows.push({...withTwd(normalizeMarketRecord({provider:'ygoprodeck',market:'YGOPRODeck',cardId:card.id,providerCardId:match.providerCardId,cardName:match.name,cardNumber:set.setCode,setCode:set.setCode,rarity:set.rarity,priceType:'market',amount:set.setPriceUsd,currency:'USD',observedAt:match.observedAt}),fx),region:p.region||null,scope:'printing-set-price'})}
    if(!rows.length){rows.notice='沒有這個版本的 YGOPRODeck set price；改顯示跨版本最低參考價。';if(printings.some(p=>p.region!=='JP'))for(const price of crossVersionLowestPrices(match))rows.push({...withTwd(normalizeMarketRecord({provider:'ygoprodeck',market:price.market,cardId:card.id,providerCardId:match.providerCardId,cardName:match.name,priceType:'market',amount:price.amount,currency:price.currency,observedAt:match.observedAt}),fx),scope:'cross-version-lowest'})}return rows}]);
  // ADR 0036/0037: tcgdex-ja printings by provider_id; official-import JP printings only in checked series and only when TCGdex's Japanese name matches. No TW or US mapping. The registry switch stops it.
  if(card.game==='pokemon'&&catalogCollectionAllowed('tcgdexPricing')){const lookups=tcgdexLookups(card);if(lookups.length)tasks.push(['tcgdex',async()=>(await Promise.all(lookups.map(x=>(x.language==='en'?fetchTcgdexPricingEn:fetchTcgdexPricing)(x.id,{expectedName:x.expectedName}).then(rows=>rows.map(r=>({...r,en:x.language==='en'})))))).flat().map(r=>({...withTwd(normalizeMarketRecord({provider:r.provider,market:r.market,cardId:card.id,providerCardId:r.providerCardId,cardName:r.en?(card.nameEn||card.nameZh):(card.nameJa||card.nameZh),cardNumber:card.officialCardNumber,language:r.en?'en-US':'ja-JP',priceType:r.priceType,amount:r.amount,currency:r.currency,sourceUrl:r.sourceUrl,observedAt:r.observedAt}),fx),variant:r.variant,idProduct:r.idProduct,avg7:r.avg7,avg30:r.avg30,region:r.en?'US':'JP'}))])}
  const settled=await Promise.all(tasks.map(async([source,run])=>{try{return {source,status:'ok',data:await run()}}catch(error){return {source,status:'unavailable',error:publicReason(`market source ${source} failed`,error)}}})),records=settled.flatMap(x=>Array.isArray(x.data)?x.data:[]);
  // 上游把不同的卡對到同一個 Cardmarket 商品時標出來（price_products_shared）；查不到就不標，不影響價格本身。
  let sharedPriceCardIds=[];if(card.game==='pokemon'&&supabaseConfigured()&&records.some(r=>r.market==='Cardmarket')){try{sharedPriceCardIds=(await supabaseFetch('/rpc/price_products_shared',{method:'POST',body:JSON.stringify({p_ids:priceHistoryCardIds(card,card.id)})}))||[]}catch(error){console.error('price shared lookup failed',error.message)}}
  return {records,versions:buildVersionPrices(card,records,await snapshotsPending,{fx}),sources:settled.map(x=>({source:x.source,status:x.status,error:x.error||null,notice:x.data?.notice||null})),meta:{sharedPriceCardIds,exchangeRates:fx,priceTypes:{listing:'最低掛牌價',buyback:'店家買取／回收',market:'平台參考價',sale:'可驗證成交',user_report:'使用者回報（未驗證）'},warning:'不同價格性質不混算中位價；目前沒有可靠成交來源時，不顯示成交價或交易量。'}}
}

// 詳細頁的價格分頁：同一張卡短時間內不重查；有來源失敗的結果不快取，下次重試。
const MARKET_CACHE_MAX=300,marketCache=new Map();
function unifiedMarketCached(card){const hit=marketCache.get(card.id);if(hit&&(hit.pending||Date.now()-hit.at<MARKET_CACHE_MS))return hit.promise;const entry={pending:true,at:0,promise:null};entry.promise=unifiedMarket(card).then(value=>{entry.pending=false;entry.at=Date.now();if(value.sources.some(source=>source.status!=='ok'))marketCache.delete(card.id);return value},error=>{marketCache.delete(card.id);throw error});marketCache.set(card.id,entry);while(marketCache.size>MARKET_CACHE_MAX)marketCache.delete(marketCache.keys().next().value);return entry.promise}

// ADR 0042：參考價走勢（public.price_snapshots，只存平台參考價）。同作品層的實體卡各自成線；每條線只屬於一張實體卡＋來源＋variant，不合併。台幣以今日匯率換算。
const PRICE_HISTORY_TTL_MS=3600000,PRICE_HISTORY_CACHE_MAX=300,priceHistoryCache=new Map();
// ADR 0046：30 天前的列在私有 Storage bucket `price-archive`（分片 gzip JSON），讀取時與資料庫的列合併成同一份資料；沒有設定 Supabase 就沒有封存。
const archiveStorage=createArchiveStorage(),archiveReader=createArchiveReader({storage:archiveStorage});
// 來源名稱依資料實際有的列出：TCGdex 現在不回 TCGplayer，快照裡的 TCGplayer 只到舊日期，不寫死兩個平台。
const PRICE_SOURCE_LABELS={cardmarket:'Cardmarket',tcgplayer:'TCGplayer'};
const priceHistoryNote=series=>{const names=[...new Set((series||[]).map(x=>PRICE_SOURCE_LABELS[x.provider]).filter(Boolean))];return `參考價為${names.length?` ${names.join('／')} 的`:''}平台參考價（經 TCGdex 轉供），不是成交價或台灣行情；新台幣以今日匯率換算，歷史點位不代表當時匯率。`};
// TCG API 轉來的 TCGplayer 價（variant 'tcgapi-…'）在這裡去掉前綴，前端才對得到 market 紀錄、翻得出中文版本名；和 referencePriceFromRow 一致。
function buildPriceHistory(rows,{card,requestedId,fx,now=Date.now()}){
  const groups=new Map(),regionOf=cardId=>(card?.printings||[]).find(p=>p.cardId===cardId)?.region||(card?.id===cardId?card.region:null)||null;
  for(const row of rows||[]){const amount=Number(row.amount);if(!row?.card_id||!row.snapshot_date||!Number.isFinite(amount))continue;const variant=row.provider==='tcgplayer'?String(row.variant||'').replace(/^tcgapi-/,''):row.variant||'',key=JSON.stringify([row.card_id,row.provider,variant,row.currency]);let group=groups.get(key);if(!group){group={cardId:row.card_id,region:regionOf(row.card_id),provider:row.provider,variant,currency:row.currency,points:[]};groups.set(key,group)}group.points.push({date:String(row.snapshot_date).slice(0,10),amount,amountTwd:amountToTwd(amount,row.currency,fx),observedAt:row.observed_at||null})}
  const series=[...groups.values()].map(g=>({...g,points:g.points.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0)}));
  const cmp=(x,y)=>x<y?-1:x>y?1:0;series.sort((a,b)=>(b.cardId===requestedId)-(a.cardId===requestedId)||b.points.length-a.points.length||cmp(b.points.at(-1).date,a.points.at(-1).date)||cmp(a.cardId+a.provider+a.variant,b.cardId+b.provider+b.variant));
  const from=new Date(now-PRICE_HISTORY_DAYS*86400000).toISOString().slice(0,10);return {series,meta:{exchangeRates:fx,note:priceHistoryNote(series),windowDays:PRICE_HISTORY_DAYS,from,events:marketEventsFor(card?.game,from,now),generatedAt:new Date(now).toISOString()}};
}
async function loadPriceHistory(card,requestedId){
  const ids=priceHistoryCardIds(card,requestedId),from=new Date(Date.now()-PRICE_HISTORY_DAYS*86400000).toISOString().slice(0,10);
  const [rows,fx]=await Promise.all([supabaseFetchAll(`/price_snapshots?${new URLSearchParams({select:'card_id,provider,variant,currency,snapshot_date,amount,observed_at',card_id:`in.(${ids.map(id=>`"${id.replaceAll('"','')}"`).join(',')})`,snapshot_date:`gte.${from}`,order:'card_id.asc,provider.asc,variant.asc,snapshot_date.asc'})}`),getTwdRates()]);
  // 先讀資料庫再讀封存：封存器是先寫封存、驗證、才刪資料庫的列，這個順序下兩邊至少有一邊有那一列，重複的列以主鍵去除。
  // 封存讀取失敗時退回只有資料庫的列（最近 30 天仍可畫），標 meta.archiveUnavailable，且只快取一分鐘；不假裝是完整資料。
  let archived=[],archiveUnavailable=false;try{archived=await archiveReader.rowsFor(ids,{from})}catch(error){archiveUnavailable=true;console.error('price archive unavailable',error.message)}
  const body=buildPriceHistory(mergeSnapshotRows(rows,archived),{card,requestedId,fx});body.meta.events=mergeMarketEvents(body.meta.events,(await loadCatalogEvents().catch(()=>[])).filter(event=>event.game===card?.game&&event.date>=from));if(archiveUnavailable)body.meta.archiveUnavailable=true;return body;
}
// 一小時快取（以請求的卡片 ID 為鍵、合併同時的請求）；失敗不快取。
function priceHistoryCached(card,requestedId){const hit=priceHistoryCache.get(requestedId);if(hit&&(hit.pending||Date.now()-hit.at<PRICE_HISTORY_TTL_MS))return hit.promise;const entry={pending:true,at:0,promise:null};entry.promise=loadPriceHistory(card,requestedId).then(value=>{entry.pending=false;entry.at=Date.now()-(value.meta?.archiveUnavailable?PRICE_HISTORY_TTL_MS-60000:0);return value},error=>{priceHistoryCache.delete(requestedId);throw error});priceHistoryCache.set(requestedId,entry);while(priceHistoryCache.size>PRICE_HISTORY_CACHE_MAX)priceHistoryCache.delete(priceHistoryCache.keys().next().value);return entry.promise}
// 時事：手動維護的官方消息＋目錄裡的新系列發售日（既有同步會自動更新）；一小時快取，失敗不快取。
const CATALOG_EVENTS_TTL_MS=3600000;let catalogEventsCache=null;
function loadCatalogEvents(now=Date.now()){
  if(catalogEventsCache&&now-catalogEventsCache.at<CATALOG_EVENTS_TTL_MS)return catalogEventsCache.promise;
  const day=offset=>new Date(now+offset*86400000).toISOString().slice(0,10),entry={at:now,promise:null};
  const path=`/tcg_series?select=game_id,region,release_date,name_zh,name_ja,name_en,source_url&release_date=gte.${day(-PRICE_HISTORY_DAYS)}&release_date=lte.${day(60)}&order=release_date.asc&limit=500`;
  // 第二庫（UNION ARENA）的發售日另外問，失敗或逾時只少 UA 的活動。
  const second=secondDbConfigured()?withTimeout(supabaseFetch(path,{db:'ip2'}),SECOND_DB_TIMEOUT_MS).catch(error=>{console.error('second database events failed',error.message);return []}):Promise.resolve([]);
  entry.promise=Promise.all([supabaseFetch(path,{db:'main'}),second]).then(([main,extra])=>catalogEventsFrom([...(main||[]),...(extra||[])])).catch(error=>{catalogEventsCache=null;throw error});
  catalogEventsCache=entry;return entry.promise;
}
async function marketEventsResponse(game,now=Date.now()){
  const from=new Date(now-HOME_EVENTS_PAST_DAYS*86400000).toISOString().slice(0,10),catalog=await loadCatalogEvents(now).catch(error=>{console.error('catalog events unavailable',error.message);return []});
  const events=mergeMarketEvents(marketEventsFor(null,from,now),catalog.filter(event=>event.date>=from)).filter(event=>!game||event.game===game);
  return {data:events,meta:{note:'發售日與官方消息，不代表會影響價格。',generatedAt:new Date(now).toISOString()}};
}
// 參考價漲跌榜（/api/price-movers）：資料庫函式 price_movers 算好排名，這裡只換算新台幣；一小時快取、合併同時的請求，失敗不快取。冷啟動時要掃約 50 萬個資料頁（熱的 1 秒、冷的超過 12 秒），所以用 25 秒上限，並在開機時預熱。
const PRICE_MOVERS_TTL_MS=3600000,priceMoversCache=createBoundedSnapshotCache({ttlMs:PRICE_MOVERS_TTL_MS,maxStaleMs:24*60*60*1000,serveStaleWhileRevalidate:true});
async function loadPriceMovers(){
  const snapshot=await priceMoversCache.get(async()=>{const [rows,fx]=await Promise.all([supabaseFetch('/rpc/price_movers',{method:'POST',body:JSON.stringify({p_days:PRICE_MOVERS_DAYS,p_min:PRICE_MOVERS_MIN_EUR,p_limit:20}),signal:AbortSignal.timeout(BROWSE_HEAVY_TIMEOUT_MS)}),getTwdRates()]);return buildPriceMovers(rows,fx)});
  return snapshot.data;
}
// 最熱的卡（/api/hot-cards）：資料庫函式 card_hot_top 排名；近 7 天至少被開 3 次才上榜（避免從排名反推個人行為），不回傳次數；一小時快取，失敗不快取。
const hotCardsCache=createBoundedSnapshotCache({ttlMs:3600000,maxStaleMs:24*60*60*1000,serveStaleWhileRevalidate:true});
async function loadHotCards(){
  const snapshot=await hotCardsCache.get(async()=>buildHotCardsPayload(await supabaseFetch('/rpc/card_hot_top',{method:'POST',body:JSON.stringify({p_days:HOT_CARDS_DAYS,p_limit:HOT_CARDS_LIMIT,p_min:HOT_CARDS_MIN_OPENS})})));
  return snapshot.data;
}
// 本彈大獎（/api/pack-prizes，首頁「最夯」）：寶可夢、航海王、黑白雙翼各取近 90 天最新主流彈的最高稀有度卡（規則在 providers/pack-prizes.mjs），
// 加上 data/pack-prizes.json 的手動置頂。同一彈的台版、日版、亞洲版合成一排（互補缺卡與參考價），合起來不到 3 張大獎就往前找下一彈，每個遊戲最多看 3 彈。一小時快取，失敗不快取。
const PACK_PRIZE_PINNED=JSON.parse(readFileSync(new URL('./data/pack-prizes.json',import.meta.url),'utf8')).pinned||[],packPrizesCache=createBoundedSnapshotCache({ttlMs:3600000,maxStaleMs:24*60*60*1000,serveStaleWhileRevalidate:true});
async function prizeBrowse(game,options){
  if(supabaseConfigured())return (await browseDatabaseCards(game,options)).data;
  const catalog=await loadCatalog(),cards=catalog.cards.filter(card=>card.game===game);
  return buildBrowsePage(cards,{...options,printingByCard:buildPrintingIndex(cards.flatMap(card=>(card.printings||[]).map(printing=>({...printing,cardId:printing.cardId||card.id}))))}).data;
}
async function loadPackPrizes(){
  const snapshot=await packPrizesCache.get(async()=>{
    const catalog=await loadCatalog(),today=new Date().toISOString().slice(0,10),seriesById=new Map((catalog.series||[]).map(s=>[s.id,s]));
    // 資料庫讀不到時 loadCatalog 會退回內建的舊目錄（沒有近期系列）：丟錯讓快取不收這份空結果。
    if(catalog.fallbackReason)throw new Error(`catalog fallback: ${catalog.fallbackReason}`);
    const games=[];
    for(const rule of PACK_PRIZE_GAMES){
      for(const release of prizeSeriesCandidates(catalog.series,rule,today).slice(0,3)){
        const versions=[];
        for(const series of release){
          const cards=await prizeBrowse(rule.game,{region:series.region,seriesId:series.id,sort:'rarity-desc',limit:BROWSE_PAGE_MAX,offset:0});
          if(rule.game==='pokemon')await attachReferencePrices(cards);
          versions.push({region:series.region,rows:prizeCards(rule.game,rule.top,cards,{seriesId:series.id,limit:BROWSE_PAGE_MAX}).map(card=>prizeRow(card,series))});
        }
        const data=mergePrizeRows(rule.game,versions);
        if(data.length<3)continue;
        const [series]=release;
        games.push({game:rule.game,seriesId:series.id,region:series.region,seriesName:series.nameZh||series.nameJa||series.nameEn||series.officialCode,releaseDate:series.releaseDate,data});break;
      }
    }
    const pinnedCards=[];
    for(const id of PACK_PRIZE_PINNED){const card=(await getCard(id).catch(()=>null))?.card;if(card)pinnedCards.push(card)}
    const pokemonPinned=pinnedCards.filter(card=>card.game==='pokemon');if(pokemonPinned.length)await attachReferencePrices(pokemonPinned);
    const pinned=pinnedCards.map(card=>{const seriesId=card.seriesId||card.printings?.[0]?.seriesId;return prizeRow(card,seriesById.get(seriesId))});
    return {pinned,games,meta:{windowDays:PACK_PRIZE_WINDOW_DAYS,limit:PACK_PRIZE_LIMIT,generatedAt:new Date().toISOString()}};
  });
  return snapshot.data;
}
// 系列卡的縮圖（/api/series-hits，首頁「最新系列」卡片）：不看本彈大獎的資格（PACK_PRIZE_GAMES），首頁會顯示的系列（每個遊戲最新 SERIES_HIT_PER_GAME 個、各版本）
// 各取稀有度排名最高的 3 張有圖的卡（排名依 data/rarity-rankings.json，挑選規則在 providers/pack-prizes.mjs 的 buildSeriesHits）。每個系列一次卡表查詢（不抓參考價），
// 同時最多 6 個；沒有任何稀有度資訊的系列不放縮圖。一小時快取，失敗不快取。
const seriesHitsCache=createBoundedSnapshotCache({ttlMs:3600000,maxStaleMs:24*60*60*1000,serveStaleWhileRevalidate:true});
async function loadSeriesHits(){
  const snapshot=await seriesHitsCache.get(async()=>{
    const catalog=await loadCatalog(),today=new Date().toISOString().slice(0,10);
    if(catalog.fallbackReason)throw new Error(`catalog fallback: ${catalog.fallbackReason}`);
    const sets=await buildSeriesHits({series:catalog.series,today,fetchCards:series=>prizeBrowse(series.game,{region:series.region,seriesId:series.id,sort:'rarity-desc',limit:SERIES_HIT_FETCH,offset:0})});
    return {data:{sets,meta:{perGame:SERIES_HIT_PER_GAME,generatedAt:new Date().toISOString()}}};
  });
  return snapshot.data;
}
async function priceHistoryResponse(requestedId){
  let loaded=null;try{loaded=await getCard(requestedId)}catch{return {status:200,body:{series:[],meta:{unavailable:'price-history-unavailable',note:priceHistoryNote([]),generatedAt:new Date().toISOString()}}}}
  if(!loaded?.card)return {status:404,body:{error:'找不到這張卡'}};
  if(!supabaseConfigured())return {status:200,body:{series:[],meta:{note:priceHistoryNote([]),windowDays:PRICE_HISTORY_DAYS,generatedAt:new Date().toISOString()}}};
  try{return {status:200,body:await priceHistoryCached(loaded.card,requestedId)}}catch{return {status:200,body:{series:[],meta:{unavailable:'price-history-unavailable',note:priceHistoryNote([]),windowDays:PRICE_HISTORY_DAYS,generatedAt:new Date().toISOString()}}}}
}

const PUBLIC_SELECT=PUBLIC_REPORT_SELECT;
function readJsonBody(req,maxBytes=10000){return new Promise((resolve,reject)=>{let size=0;const chunks=[];req.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){reject(new Error('BODY_TOO_LARGE'));req.destroy();return}chunks.push(chunk)});req.on('end',()=>{if(!chunks.length)return resolve({});try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(new Error('INVALID_JSON'))}});req.on('error',reject)})}

async function scrapeYuyutei(targetUrl){const response=await fetch(targetUrl,{headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'ja,en-US;q=0.9'}});if(!response.ok)throw new Error(`FETCH_${response.status}`);const html=(await response.text()).replace(/\s+/g,' '),setTitle=html.match(/<h3 class="fw-bold py-3">\s*<span class="line1"><\/span>\s*([^<]+)<\/h3>/)?.[1]?.trim()||null,game=targetUrl.match(/\/buy\/([a-z0-9]+)\//i)?.[1]||'unknown',tokens=[];let m;const rarityRe=/<span class="py-2 d-inline-block px-2 me-2 text-white fw-bold">([^<]+)<\/span>\s*Card List/g;while((m=rarityRe.exec(html)))tokens.push({type:'rarity',index:m.index,value:m[1].trim()});const cardRe=/<div class="card-product position-relative mt-4[^"]*"/g;while((m=cardRe.exec(html)))tokens.push({type:'card',index:m.index});tokens.sort((a,b)=>a.index-b.index);const found=[];let rarity=null;for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.type==='rarity'){rarity=t.value;continue}const end=i+1<tokens.length?tokens[i+1].index:Math.min(html.length,t.index+3000),chunk=html.slice(t.index,end),ver=chunk.match(/value="([^"]+)" class="cart_ver"/)?.[1],cid=chunk.match(/value="([^"]+)" class="cart_cid"/)?.[1],number=chunk.match(/text-center my-2">([^<]+)<\/span>/)?.[1]?.trim()||null,name=chunk.match(/text-primary fw-bold">([^<]+)<\/h4>/)?.[1]?.trim()||null,price=chunk.match(/<strong class="d-block text-end[^"]*">\s*([\d,]+)\s*円/)?.[1];if(!ver||!cid||!price)continue;found.push({setCode:ver,cardCode:cid,number,name,rarity,price:Number(price.replace(/,/g,'')),cardUrl:`https://yuyu-tei.jp/buy/${game}/card/${ver}/${cid}`,imageUrl:`https://card.yuyu-tei.jp/${game}/100_140/${ver}/${cid}.jpg`})}return {game,setTitle,cards:found}}

// SEO（providers/seo.mjs）：卡片／系列網址的 head 標籤、robots.txt 與 sitemap。網址一律用 PUBLIC_BASE_URL（預設正式站），不採用請求的 Host。
const PUBLIC_BASE_URL=normalizeBaseUrl(process.env.PUBLIC_BASE_URL);
const CANONICAL_REDIRECT=process.env.CANONICAL_REDIRECT==='true',LEGACY_HOSTS=new Set(['cardscope.onrender.com']);
const SEO_LOAD_TIMEOUT_MS=1500,SEO_CACHE_TTL_MS=600000,SEO_NEGATIVE_TTL_MS=60000,SEO_CACHE_MAX=500,seoCache=new Map();
const SITEMAP_TTL_MS=24*60*60*1000,SITEMAP_PAGE_SIZE=1000,SITEMAP_URLS_PER_FILE=Math.min(SITEMAP_MAX_URLS,Math.max(1,Number(process.env.SITEMAP_URLS_PER_FILE)||SITEMAP_MAX_URLS)),sitemapCache={value:null,expiresAt:0,promise:null};
const withTimeout=(promise,ms)=>coreWithTimeout(promise,ms,'SEO_TIMEOUT');
function seoCacheGet(key){const hit=seoCache.get(key);if(hit&&hit.expiresAt>Date.now())return hit.value;seoCache.delete(key);return undefined}
function seoCacheSet(key,value,ttlMs){seoCache.delete(key);seoCache.set(key,{value,expiresAt:Date.now()+ttlMs});while(seoCache.size>SEO_CACHE_MAX)seoCache.delete(seoCache.keys().next().value)}
// SEO_ID_PATTERN 與 seoRequestTarget 由 providers/http-security.mjs 匯入。
async function loadSeoForCard(cardId){
  const loaded=supabaseConfigured()?await loadCardCached(cardId):await getCard(cardId);if(!loaded?.card)return null;
  const {catalog,card}=loaded,seriesId=card.printings?.[0]?.seriesId||card.seriesId,series=(catalog.series||[]).find(s=>s.id===seriesId)||null,game=(catalog.games||[]).find(g=>g.id===card.game)||null;
  return cardSeo({card,series,game,baseUrl:PUBLIC_BASE_URL,rarityLabel:rarityDisplayLabel});
}
async function loadSeoForSeries(seriesId){
  let series=null,printingCount=null;
  const db=dbForId(seriesId);if(db==='ip2'&&!secondDbConfigured())return null;
  if(supabaseConfigured())await withDb(db,async()=>{
    const rows=await supabaseFetch(`/tcg_series?${new URLSearchParams({select:'id,game:game_id,officialCode:official_code,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,region,releaseDate:release_date',id:`eq.${seriesId}`,limit:'1'})}`);series=rows?.[0]||null;
    // The count is a nicety: never let it hold the page back or fail it.
    if(series)printingCount=await withTimeout(supabaseFetchPage(`/tcg_printings?${new URLSearchParams({select:'id',series_id:`eq.${seriesId}`,limit:'1'})}`).then(page=>page.total),800).catch(()=>null);
  });else series=(await loadCatalog()).series.find(s=>s.id===seriesId)||null;
  return series?seriesSeo({series,baseUrl:PUBLIC_BASE_URL,printingCount}):null;
}
// 有 card／series 參數時改寫 head；查詢失敗或逾時就回原本的 index（200），查無才回 404。
async function serveSeoIndex(req,res,target){
  let html;try{html=await readFile(join(root,'index.html'),'utf8')}catch{return json(res,404,{error:'Not found'})}
  // 和首頁靜態檔一致：no-cache＋內容 ETag，換版或卡片資料變了立刻生效，沒變就 304。404 頁不帶 ETag。
  const send=(status,body)=>sendResponse(res,status,body,{'Content-Type':types['.html'],'Cache-Control':'no-cache'},{etag:status===200}),key=`${target.kind}:${target.id}`;let entry=seoCacheGet(key);
  if(entry===undefined){try{const seo=await withTimeout(target.kind==='card'?loadSeoForCard(target.id):loadSeoForSeries(target.id),SEO_LOAD_TIMEOUT_MS);entry=seo?{seo}:{missing:true};seoCacheSet(key,entry,seo?SEO_CACHE_TTL_MS:SEO_NEGATIVE_TTL_MS)}catch(error){console.error('seo lookup failed',error.message);return send(200,html)}}
  return entry.missing?send(404,applyNoindexToHtml(html)):send(200,applySeoToHtml(html,withSeriesPages(entry.seo,target.pages)));
}
// Keyset paging (id > last) keeps every page cheap however deep the table is.
async function forEachKeysetPage(table,select,onRows){let last=null;for(let pages=0;pages<1000;pages++){const params=new URLSearchParams({select,order:'id.asc',limit:String(SITEMAP_PAGE_SIZE)});if(last!==null)params.set('id',`gt.${last}`);const rows=await supabaseFetch(`/${table}?${params}`);if(!Array.isArray(rows))throw new Error('SITEMAP_BAD_RESPONSE');onRows(rows);if(rows.length<SITEMAP_PAGE_SIZE)return;const next=rows.at(-1)?.id;if(!next||next===last)throw new Error('SITEMAP_PAGING_STALLED');last=next}throw new Error('SITEMAP_TOO_MANY_PAGES')}
async function collectSitemapRows(groups,seriesRows){
  // 先用資料庫一次分組好的結果（public.sitemap_card_groups，約 1 秒）；失敗或格式不符才退回逐頁抓卡片（冷啟動 40–60 秒）。
  let grouped=null;try{const rows=await supabaseFetch('/rpc/sitemap_card_groups',{method:'POST',body:'{}',signal:AbortSignal.timeout(45000)});if(Array.isArray(rows)&&rows.length&&rows.every(r=>Array.isArray(r)&&typeof r[0]==='string'))grouped=rows}catch(error){console.error('sitemap rpc failed',error.message)}
  if(grouped)for(const [id,game,lastmod] of grouped)groups.set(id,{id,game:game||null,lastmod:lastmod||null});
  else await forEachKeysetPage('tcg_cards','id,canonical_id,game_id,updated_at,name_zh,name_ja,name_en,name_ko',rows=>mergeCardSitemapRows(rows,groups));
  await forEachKeysetPage('tcg_series','id,game_id,region,official_code,name_zh,name_ja,name_en,name_ko,updated_at',rows=>seriesRows.push(...rows));
}
async function buildSitemaps(){
  const groups=new Map(),seriesRows=[];
  await withDb('main',()=>collectSitemapRows(groups,seriesRows));
  // 第二庫的卡與系列另外收齊才併入：中途失敗不留半套，主庫照常。
  if(secondDbConfigured()){const secondGroups=new Map(),secondSeries=[];try{await withDb('ip2',()=>collectSitemapRows(secondGroups,secondSeries));for(const [id,entry] of secondGroups)groups.set(id,entry);seriesRows.push(...secondSeries)}catch(error){console.error('second database sitemap failed; main rows only',error.message)}}
  const generated=new Date().toISOString().slice(0,10),cardFiles=chunkEntries(cardSitemapEntries(PUBLIC_BASE_URL,groups),SITEMAP_URLS_PER_FILE).map(renderUrlSet),index=[{loc:`${PUBLIC_BASE_URL}/sitemaps/pages.xml`,lastmod:generated},{loc:`${PUBLIC_BASE_URL}/sitemaps/series.xml`,lastmod:generated},...cardFiles.map((_,i)=>({loc:`${PUBLIC_BASE_URL}/sitemaps/cards-${i+1}.xml`,lastmod:generated}))];
  return {index:renderSitemapIndex(index),pages:renderUrlSet(pageSitemapEntries(PUBLIC_BASE_URL,[...CATALOG_GAME_IDS])),series:renderUrlSet(seriesSitemapEntries(PUBLIC_BASE_URL,seriesRows)),cards:cardFiles,cardCount:groups.size};
}
// Built at most once at a time and kept 24 hours; a failed build is never cached.
function loadSitemaps(){if(sitemapCache.value&&sitemapCache.expiresAt>Date.now())return Promise.resolve(sitemapCache.value);if(!sitemapCache.promise)sitemapCache.promise=buildSitemaps().then(value=>{sitemapCache.value=value;sitemapCache.expiresAt=Date.now()+SITEMAP_TTL_MS;return value}).finally(()=>{sitemapCache.promise=null});return sitemapCache.promise}
async function serveSitemap(res,pathname){
  const xml=body=>sendResponse(res,200,body,{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'}),cardFile=pathname.match(/^\/sitemaps\/cards-(\d+)\.xml$/);
  if(pathname==='/sitemaps/pages.xml')return xml(renderUrlSet(pageSitemapEntries(PUBLIC_BASE_URL,[...CATALOG_GAME_IDS])));
  if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});
  let built;try{built=await loadSitemaps()}catch(error){console.error('sitemap build failed',error.message);return json(res,503,{error:'Sitemap 暫時無法產生'})}
  if(pathname==='/sitemap.xml')return xml(built.index);
  if(pathname==='/sitemaps/series.xml')return xml(built.series);
  const body=cardFile?built.cards[Number(cardFile[1])-1]:null;return body?xml(body):json(res,404,{error:'Not found'});
}

// shortcut: 快取只在記憶體，Render 重啟會清掉並重新扣點；查詢量大到撞每日上限時再改存 Supabase。
const gradedLookup=createGradedPrices({apiKey:process.env.POKEMONPRICETRACKER_API_KEY,fetchFn:fetch});
async function gradedPrices(res,params){
  try{const fx=await getTwdRates();return json(res,200,{data:await gradedLookup({tcgPlayerId:params.get('tcgPlayerId'),set:params.get('set'),number:params.get('number')},fx.rates?.USD)})}
  catch(error){return failJson(res,502,'graded prices failed',error)}
}
// eBay 現售掛牌價：金鑰只在 Render 環境變數；缺金鑰回 200 空結果，上游錯誤只回通用訊息。
const ebayLookup=createEbayListings({clientId:process.env.EBAY_CLIENT_ID,clientSecret:process.env.EBAY_CLIENT_SECRET,fetchFn:fetch});
async function ebayListings(res,params){
  const input={name:params.get('name')||'',set:params.get('set')||'',number:params.get('number')||''};
  try{const data=await ebayLookup(input);return data.status==='unsupported'?json(res,400,{error:'參數無效'}):json(res,200,{data})}
  catch(error){return failJson(res,502,'ebay listings failed',error)}
}
// 記憶體警戒（2026-10-21 Render 免費方案 512 MB 被 OOM 重啟，免費方案沒有請求紀錄）：RSS 超過門檻時，把當下處理中的請求寫進日誌，下次就知道是哪個請求。
const MEMORY_WARN_BYTES=(Number(process.env.MEMORY_WARN_MB)||380)*1024*1024,inflightRequests=new Set();let memoryWarnedAt=0;
setInterval(()=>{const m=process.memoryUsage();if(m.rss<MEMORY_WARN_BYTES||Date.now()-memoryWarnedAt<60000)return;memoryWarnedAt=Date.now();console.warn('memory high',JSON.stringify({rssMb:Math.round(m.rss/1048576),heapMb:Math.round(m.heapUsed/1048576),inflight:[...inflightRequests].slice(0,15)}))},2000).unref();
function redactInflightSearch(search){return search?String(search).replace(/([?&]code=)[^&#]*/gi,'$1[REDACTED]').slice(0,160):''}
const handleRequest=async(req,res)=>{
  // 舊網址（Render 預設網域）301 到正式網域同路徑；CANONICAL_REDIRECT=true 時才開，確認新網域可用後再設。
  if(CANONICAL_REDIRECT&&LEGACY_HOSTS.has(String(req.headers.host||'').toLowerCase().split(':')[0])){res.writeHead(301,{Location:PUBLIC_BASE_URL+(req.url||'/'),'Cache-Control':'public, max-age=86400'});return res.end()}
  const url=new URL(req.url,`http://${req.headers.host}`);const inflightKey=`${req.method} ${url.pathname}${redactInflightSearch(url.search)} ${String(req.headers['user-agent']||'').slice(0,60)}`;inflightRequests.add(inflightKey);res.once('close',()=>inflightRequests.delete(inflightKey));
  if(rateLimited(req,url))return json(res,429,{error:'請求太頻繁，請稍後再試'},{'Retry-After':'60'});
  if(url.pathname==='/api/images/onepiece'&&req.method==='GET')return proxyOnePieceImage(res,url.searchParams.get('url'));
  if(url.pathname==='/api/graded-prices'&&req.method==='GET')return gradedPrices(res,url.searchParams);
  if(url.pathname==='/api/ebay-listings'&&req.method==='GET')return ebayListings(res,url.searchParams);
  if(url.pathname==='/api/providers')return json(res,200,{data:providerStatus()});
  if(url.pathname==='/api/catalog/image-status'&&req.method==='GET'){try{return json(res,200,{data:await yugiohImageStatus(supabaseFetch)})}catch(e){return failJson(res,502,'image status failed',e)}}
  if(url.pathname==='/api/admin/catalog/cache-images'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});if(!imageCollectionAllowed('yugioh'))return json(res,409,{error:'來源尚未明確允許保存卡圖，圖片快取已暫停'});try{return json(res,200,{data:await cacheYugiohImages(supabaseFetch,{limit:Number(process.env.CARD_IMAGE_CACHE_LIMIT||15000),concurrency:Number(process.env.CARD_IMAGE_CACHE_CONCURRENCY||4)})})}catch(e){return json(res,502,{error:e.message})}}
  if(url.pathname==='/api/catalog'&&req.method==='GET'){const data=await loadCatalog();return json(res,200,{data,meta:{source:data.source,fallbackReason:data.fallbackReason||null}},data.fallbackReason?{}:SHORT_CACHE)}
  if(url.pathname==='/api/catalog/coverage'&&req.method==='GET'){return json(res,200,{data:await loadCatalogCoverage()},SHORT_CACHE)}
  // 外部監測（UptimeRobot 預設 HEAD）只需確認服務活著並保持喚醒，不查資料庫。
  if(url.pathname==='/api/catalog/health'&&req.method==='HEAD'){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return res.end()}
  if(url.pathname==='/api/catalog/health'&&req.method==='GET'){const [health,storage,secondStorage]=await Promise.all([loadCatalogHealth(),loadStorageReport(),loadStorageReport('ip2')]);return json(res,200,{data:{...health,storage:{status:storageStatus(storage)},...(secondDbConfigured()?{secondStorage:{status:storageStatus(secondStorage)}}:{})}})}
  if(url.pathname==='/api/catalog/sources'&&req.method==='GET'){return json(res,200,{data:publicSourcePolicies(),meta:sourcePolicySummary()})}
  if(url.pathname==='/api/admin/catalog/health'&&req.method==='GET'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；請使用 Authorization Bearer 或 x-scrape-token 標頭'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});try{return json(res,200,{data:await loadAdminCatalogHealth()})}catch(e){return json(res,502,{error:e.message})}}
  if(url.pathname==='/api/admin/page-stats'&&req.method==='GET'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；請使用 Authorization Bearer 或 x-scrape-token 標頭'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});const days=Math.min(366,Math.max(1,Math.floor(Number(url.searchParams.get('days')))||30));try{const [rows,hotRows]=await Promise.all([supabaseFetch(`/page_stats_daily?select=day,counts,updatedAt:updated_at&order=day.desc&limit=${days}`),supabaseFetch(`/card_hot_daily?select=day,counts,updatedAt:updated_at&order=day.desc&limit=${days}`).catch(()=>null)]);return json(res,200,{data:{days:rows,pending:pageStats.pending(),cardHot:{days:hotRows,pending:cardHot.pending()}}})}catch(e){return json(res,502,{error:e.message,pending:pageStats.pending()})}}
  if(url.pathname==='/api/trends'&&req.method==='GET'){
    const requestedLimit=Math.floor(Number(url.searchParams.get('limit'))),limit=Math.min(Math.max(Number.isFinite(requestedLimit)&&requestedLimit>0?requestedLimit:12,1),50);
    // Trends come only from Yuyu-tei buyback history; Yuyu-tei declined reuse (2026-10-12), so the section is switched off rather than shown empty forever.
    if(sourceDisplayDenied('yuyutei'))return json(res,200,{data:[],meta:{...trendMeta({status:'unavailable',rowsScanned:0,validRows:0,uniqueCards:0,observationWindow:trendObservationWindow([])}),disabled:true,disabledReason:'source-denied'}});
    if(!supabaseConfigured())return json(res,200,{data:[],meta:trendMeta({status:'unavailable',rowsScanned:0,validRows:0,uniqueCards:0,observationWindow:trendObservationWindow([])})});
    try{const snapshot=await loadTrendSnapshot();return json(res,200,{data:snapshot.data.slice(0,limit),meta:trendMeta(snapshot)})}catch(e){console.error('trend snapshot failed',e.message);return json(res,502,{error:'資料暫時無法讀取',meta:trendMeta({status:'unavailable',rowsScanned:0,validRows:0,uniqueCards:0,observationWindow:trendObservationWindow([])})})}
  }
  if(url.pathname==='/api/buyback-prices'&&req.method==='GET'){
    if(!supabaseConfigured())return json(res,200,{data:[],meta:{source:'yuyutei-buyback',warning:'沒有資料庫時不建立示範價格'}});
    const requestedGame=(url.searchParams.get('game')||'').trim().toLowerCase(),providerGame=sourceDisplayDenied('yuyutei')?null:new Map([['pokemon','poc']]).get(requestedGame)||null;
    if(!providerGame)return json(res,200,{data:[],meta:{source:'yuyutei-buyback',warning:'此 IP 目前沒有可驗證的買取價格來源，因此不顯示價格。'}});
    try{
      const rows=await cachedBrowseRows(`buyback:${providerGame}`,()=>supabaseFetch(`/jp_buyback_prices?select=game,cardNumber:card_number,rarity,cardName:card_name,price,currency,cardUrl:card_url,updatedAt:scraped_at&source=eq.yuyutei&game=eq.${providerGame}&order=scraped_at.desc&limit=500`)),seen=new Set(),data=[];
      for(const row of rows||[]){const key=String(row.cardNumber||'').trim().toUpperCase();if(!key||seen.has(key)||!Number.isFinite(Number(row.price)))continue;seen.add(key);data.push({...row,price:Number(row.price),priceType:'buyback'})}
      return json(res,200,{data,meta:{source:'yuyutei-buyback',label:'遊々亭日版買取價',warning:'只用於篩選與排序有可靠對應的卡片；不是成交價、掛牌價或市場均價。'}});
    }catch(e){return failJson(res,502,'buyback prices failed',e)}
  }
  if(url.pathname==='/api/products'&&req.method==='GET'){try{const catalog=await loadProductSets();return json(res,200,{data:catalog.products,series:catalog.series,meta:productFeedMeta(catalog)},SHORT_CACHE)}catch(e){return failJson(res,502,'products failed',e)}}
  if(url.pathname==='/api/market-events'&&req.method==='GET'){if(!supabaseConfigured())return json(res,200,{data:[],meta:{unavailable:'not-configured'}});return json(res,200,await marketEventsResponse(url.searchParams.get('game')||null),SHORT_CACHE)}
  if(url.pathname==='/api/pack-prizes'&&req.method==='GET'){try{return json(res,200,await loadPackPrizes(),SHORT_CACHE)}catch(e){console.error('pack prizes failed',e.message);return json(res,502,{error:'資料暫時無法讀取'})}}
  if(url.pathname==='/api/series-hits'&&req.method==='GET'){try{return json(res,200,await loadSeriesHits(),SHORT_CACHE)}catch(e){console.error('series hits failed',e.message);return json(res,502,{error:'資料暫時無法讀取'})}}
  if(url.pathname==='/api/hot-cards'&&req.method==='GET'){if(!supabaseConfigured())return json(res,200,{data:[],meta:{unavailable:'not-configured'}});try{return json(res,200,await loadHotCards(),SHORT_CACHE)}catch(e){console.error('hot cards failed',e.message);return json(res,502,{error:'資料暫時無法讀取'})}}
  if(url.pathname==='/api/price-movers'&&req.method==='GET'){if(!supabaseConfigured())return json(res,200,{data:{up:[],down:[]},meta:{unavailable:'not-configured'}});try{return json(res,200,await loadPriceMovers(),SHORT_CACHE)}catch(e){console.error('price movers failed',e.message);return json(res,502,{error:'資料暫時無法讀取'})}}
  if(url.pathname==='/api/exchange-rates'&&req.method==='GET')return json(res,200,{data:await getTwdRates()});
  if(url.pathname==='/api/cards'&&req.method==='GET'){const requestedGame=(url.searchParams.get('game')||'').trim();if(requestedGame&&SECOND_DB_GAMES.has(requestedGame)&&!secondDbConfigured())return json(res,503,{error:'此遊戲資料暫時無法連線'});if(requestedGame&&!CATALOG_GAME_IDS.has(requestedGame))return json(res,400,{error:'請選擇單一卡牌遊戲'});const region=normalizeBrowseRegion(url.searchParams.get('region')),rarity=normalizeBrowseRarity(url.searchParams.get('rarity')),sort=normalizeBrowseSort(url.searchParams.get('sort'),requestedGame),seriesId=(url.searchParams.get('series')||'').trim()||null,limit=Math.min(Math.max(Math.floor(Number(url.searchParams.get('limit')))||60,1),BROWSE_PAGE_MAX),offset=Math.min(Math.max(Math.floor(Number(url.searchParams.get('offset')))||0,0),200000);if(region&&!CATALOG_REGION_IDS.has(region))return json(res,400,{error:'不支援的版本地區'});if(seriesId&&seriesId.length>128)return json(res,400,{error:'系列代碼過長'});if(rarity&&!BROWSE_RARITY_FORMAT.test(rarity))return json(res,400,{error:'稀有度格式不正確'});if(requestedGame&&supabaseConfigured()){try{const started=performance.now(),page=await browseDatabaseCards(requestedGame,{region,rarity,seriesId,sort,limit,offset});if(requestedGame==='pokemon')await attachReferencePrices(page.data);return json(res,200,{data:page.data,meta:{source:'supabase-full-catalog',game:requestedGame,seriesId,region,rarity,sort,limit,offset,hasMore:page.hasMore,total:page.total,facets:page.facets,facetStatus:page.facetStatus,errors:page.errors,referencePriced:page.referencePriced??null}},{...SHORT_CACHE,'Server-Timing':`${Object.entries(page.timings||{}).map(([name,dur])=>`${name};dur=${dur}`).concat(`total;dur=${Math.round(performance.now()-started)}`).join(', ')}`})}catch(e){if(e.code==='BROWSE_BUSY')return json(res,503,{error:e.message},{'Retry-After':'5'});if(e.code==='BROWSE_REFUSED')return json(res,502,{error:e.message});return failJson(res,502,'browse failed',e)}}const catalog=await loadCatalog(),printingByCard=buildPrintingIndex(catalog.cards.flatMap(card=>(card.printings||[]).map(printing=>({...printing,cardId:printing.cardId||card.id})))),page=buildBrowsePage(requestedGame?catalog.cards.filter(card=>card.game===requestedGame):catalog.cards,{region,rarity,seriesId,sort,limit,offset,printingByCard});return json(res,200,{data:page.data,meta:{source:catalog.source,game:requestedGame||null,seriesId,region,rarity,sort,limit,offset,hasMore:page.hasMore,total:page.total,facets:page.facets,facetStatus:page.facetStatus}},catalog.fallbackReason?{}:SHORT_CACHE)}
  if(url.pathname==='/api/search'&&req.method==='GET'){
    // ADR 0044 Q6/Q7 + 複合特徵搜尋：系列／周年、稀有度代碼與版本詞拆成篩選條件（parsed），其餘為卡名／卡號；結果採真實總數分頁。
    const rawRegion=(url.searchParams.get('region')||'').trim().toUpperCase(),regionParam=!rawRegion||rawRegion==='ALL'?'ALL':rawRegion;
    if(regionParam!=='ALL'&&!CATALOG_REGION_IDS.has(regionParam))return json(res,400,{error:'不支援的版本地區'});
    const searchStarted=performance.now(),rawQ=(url.searchParams.get('q')||'').trim().slice(0,100);
    const catalog=await loadCatalogShared(),catalogDoneAt=performance.now(),seriesIndex=getSeriesSearchIndex(catalog);
    const parsedQuery=parseSearchQuery(rawQ,{seriesIndex,region:regionParam}),region=regionParam!=='ALL'?regionParam:(parsedQuery.region||'ALL'),rarities=parsedQuery.rarities,rarityValues=rarityMatchValues(rarities);
    const rawSeries=parsedQuery.series||null,hasSeriesFeature=Boolean(rawSeries&&Array.isArray(rawSeries.allIds)&&rawSeries.allIds.length>0);
    const searchName=rawSeries&&!hasSeriesFeature?(rarities.length||parsedQuery.region?`${rawSeries.label} ${parsedQuery.name}`:rawQ):parsedQuery.name;
    let activeSeries=hasSeriesFeature?{kind:rawSeries.kind,label:rawSeries.label,terms:rawSeries.terms}:null;
    const seriesIds=hasSeriesFeature?(rawSeries.ids||[]).slice(0,SEARCH_SERIES_IDS_MAX):[],allSeriesIds=hasSeriesFeature?(rawSeries.allIds||[]).slice(0,SEARCH_SERIES_IDS_MAX):[];
    const limit=Math.min(Math.max(Math.floor(Number(url.searchParams.get('limit')))||SEARCH_RESULT_LIMIT,1),SEARCH_PAGE_MAX),offset=Math.min(Math.max(Math.floor(Number(url.searchParams.get('offset')))||0,0),200000);
    const buildParsed=(seriesMeta=activeSeries)=>({q:rawQ,name:searchName,rarities,region:regionParam!=='ALL'?null:parsedQuery.region,...(parsedQuery.rarityOnly?{rarityOnly:true}:{}),...(seriesMeta?{series:seriesMeta}:{})});
    let parsed=buildParsed();
    const suggestOnly=url.searchParams.get('fields')==='suggest',slimBody=body=>suggestOnly?suggestBody(body,region):body;
    const seriesCacheKey=hasSeriesFeature?`${rawSeries.label}:${seriesIds.join(',')}`:'';
    const searchCacheKey=[regionParam,rawQ,searchName,rarities.join(','),parsed.region||'',seriesCacheKey,offset,limit].join('|'),cachedSearch=recallSearch(searchCacheKey);if(cachedSearch)return json(res,200,slimBody(cachedSearch),{...SHORT_CACHE,'Server-Timing':'cache;desc="hit", total;dur=0'});
    // A bare rarity code (SAR, UR 日版) names no card: say so instead of matching it against card names, and offer a working example.
    if(parsedQuery.rarityOnly){let example=rarityOnlyExample(rarities);
    // Only offer the example when it really has results (皮卡丘 MUR does not).
    if(example){const check=parseSearchQuery(example);try{if(!supabaseConfigured()||!(await searchCatalogDatabase(check.name,'ALL',1,{rarities:check.rarities})).cards.length)example=null}catch{example=null}}
    const body={data:[],meta:{source:'rarity-only',architecture:'canonical-card-with-printings',match:'rarity-only',resultLimit:limit,mayHaveMore:false,queryTerms:[],total:0,offset,limit,hasMore:false,parsed,suggestion:example?{q:example,reason:'稀有度請搭配卡名一起搜'}:null,hint:{kind:'rarity-only',message:'只輸入稀有度無法判斷是哪一張卡，請加上卡名'+(example?`，例如「${example}」`:'')+'。'}}};rememberSearch(searchCacheKey,body);return json(res,200,body,SHORT_CACHE)}
    // 只有符號（. _ % 之類）或空查詢無從比對卡名：回空結果與提示，不拿備援樣本卡充數。
    if(!/[\p{L}\p{N}]/u.test(normalizeSearch(searchName)))return json(res,200,{data:[],meta:{source:'symbols-only',architecture:'canonical-card-with-printings',match:'symbols-only',resultLimit:limit,mayHaveMore:false,queryTerms:[],total:0,offset,limit,hasMore:false,parsed,suggestion:null,hint:{kind:'symbols-only',message:'請輸入卡名、卡號或系列名稱。'}}},SHORT_CACHE);
    const q=normalizeSearch(searchName),emptyScopedDb={cards:[],candidateCount:0,candidateLimit:SEARCH_CANDIDATE_LIMIT,resultLimit:limit,mayHaveMore:false,searched:true,matchedSeries:0,timings:{},total:0,paged:true};
    const databasePending=supabaseConfigured()?(hasSeriesFeature&&!seriesIds.length?Promise.resolve({value:emptyScopedDb,doneAt:performance.now()}):searchCatalogDatabase(searchName,region,limit,{offset,rarities,seriesIds}).then(value=>({value,doneAt:performance.now()}),error=>({error}))):null;
    const seriesById=new Map(catalog.series.map(s=>[s.id,s])),nameValues=c=>[c.nameZh,c.nameJa,c.nameEn,c.nameKo,...(c.aliases||[]),...(c.printings||[]).flatMap(p=>[p.nameZh,p.nameJa,p.nameEn,p.nameKo])];
    const localNeedles=searchQueryTerms(searchName).map(normalizeSearch),localSeriesSet=hasSeriesFeature?new Set(seriesIds):null;
    const found=catalog.cards.filter(c=>{
      if(region!=='ALL'&&c.region!==region&&!c.printings?.some(p=>p.region===region))return false;
      const series=[seriesById.get(c.seriesId)||{},...(c.printings||[]).map(p=>seriesById.get(p.seriesId)||{})];
      if(localSeriesSet){
        const inSeries=localSeriesSet.has(c.seriesId)||Boolean(c.printings?.some(p=>localSeriesSet.has(p.seriesId)&&(region==='ALL'||p.region===region)));
        if(!inSeries)return false;
        const cardVals=[...nameValues(c),c.officialCardNumber,...(c.printings||[]).filter(p=>localSeriesSet.has(p.seriesId)&&(region==='ALL'||p.region===region)).map(p=>p.localCardNumber)];
        return !localNeedles.length||cardVals.some(v=>{const nv=normalizeSearch(v);return nv&&localNeedles.some(n=>nv.includes(n))});
      }
      const values=[...nameValues(c),c.officialCardNumber,...(c.printings||[]).flatMap(p=>[p.localSetCode,p.localCardNumber]),...series.flatMap(s=>[s.officialCode,s.nameZh,s.nameJa,s.nameEn,s.nameKo,...(s.aliases||[])])];
      return !q||values.some(v=>normalizeSearch(v).includes(q));
    }),exact=q?found.filter(c=>nameValues(c).some(v=>{const nv=normalizeSearch(v);return nv===q||(localSeriesSet&&localNeedles.includes(nv))})):[];
    // Local-catalog answers (no database, or the database has nothing) apply the parsed filters to printings too, then page and rank like the database ones.
    const narrowing=rarityValues.length>0||(regionParam==='ALL'&&Boolean(parsedQuery.region))||Boolean(localSeriesSet),narrowLocal=list=>narrowing?list.map(c=>({...c,printings:(c.printings||[]).filter(p=>(region==='ALL'||p.region===region)&&printingMatchesRarity(p,rarityValues)&&(!localSeriesSet||localSeriesSet.has(p.seriesId)))})).filter(c=>c.printings.length):list,withRank=list=>list.map(c=>c.matchRank===undefined?{...c,matchRank:cardMatchRank(c,localNeedles)}:c);
    const pageLocal=list=>{const items=narrowLocal(list);return {data:withRank(items.slice(offset,offset+limit)),total:items.length}};
    const gameHint=gameHintFor(searchName),withPaging=(meta,data,total,suggestion=null)=>{const hasMore=offset+data.length<total,seriesTerms=activeSeries?.terms?.length?activeSeries.terms:null;return {data,meta:{...meta,resultLimit:limit,mayHaveMore:hasMore,queryTerms:searchQueryTerms(searchName),total,offset,limit,hasMore,parsed,suggestion,...(seriesTerms?{seriesTerms}:{}),...(gameHint?{gameHint:gameHint.gameId,franchiseHint:gameHint.franchiseId}:{})}}};
    // The database's answer as one page: its own page when it paged, otherwise merged with the exact local matches; no database hits -> the loaded catalog.
    const settle=db=>{if(db.cards.length>0&&db.paged)return {data:db.cards,total:db.total};/* offset 超過結果數：資料庫的頁是空的，但總數仍是真的 */if(db.paged&&db.total>0)return {data:[],total:db.total};if(db.cards.length>0){const merged=offset?db.cards:narrowLocal(canonicalizeCatalog({...catalog,cards:[...exact,...db.cards]}).cards);return {data:withRank(merged.slice(0,limit)),total:Math.max(db.total||0,offset+merged.length)}}const page=pageLocal(exact.length?exact:found);return {data:page.data,total:page.total}};
    if(!supabaseConfigured()){
      const page=pageLocal(exact.length?exact:found);
      return json(res,200,slimBody(withPaging({source:catalog.source,architecture:'canonical-card-with-printings',match:exact.length?'exact-name':'substring'},page.data,page.total)))
    }
    try{
      const settled=await databasePending;if(settled.error)throw settled.error;let database=settled.value,hasDatabaseMatches=database.cards.length>0,{data,total}=settle(database),matchedAs=null,retryMs=0;
      // 零結果第一層：資料庫字面折疊重試（保留系列／版本／稀有度條件）。
      if(total===0&&(!hasSeriesFeature||seriesIds.length>0)){const retryStarted=performance.now(),spans=await foldedNameSpans(searchName);if(spans.length){try{const again=await searchCatalogDatabase(spans,region,limit,{offset,rarities,seriesIds});if(again.cards.length){database=again;hasDatabaseMatches=true;({data,total}=settle(again));matchedAs=spans}}catch(error){console.error('search fold retry failed',error.message)}}retryMs=performance.now()-retryStarted}
      // 零結果第二層（防誤拆安全網）：若複合系列交集為 0，再以未拆系列的完整字串查一次，確保卡名本身含系列字詞時仍可命中。
      if(total===0&&hasSeriesFeature&&rawQ&&rawQ!==searchName){const retryStarted=performance.now();try{const rawAgain=await searchCatalogDatabase(rawQ,region,limit,{offset,rarities});if(rawAgain.cards.length){database=rawAgain;hasDatabaseMatches=true;activeSeries=null;parsed=buildParsed(null);({data,total}=settle(rawAgain))}}catch(error){console.error('search raw fallback failed',error.message)}retryMs+=performance.now()-retryStarted}
      const timing=Object.entries({catalog:catalogDoneAt-searchStarted,db:settled.doneAt-searchStarted,...database.timings,...(retryMs?{retry:retryMs}:{}),total:performance.now()-searchStarted}).map(([name,ms])=>`${name};dur=${Math.round(ms)}`).join(', ');
      // 零結果第三層：跨區提示（保留系列條件）與「改只搜卡名」建議。
      let suggestion=null,otherRegion=null;
      if(total===0&&regionParam!=='ALL'){try{const all=await searchCatalogDatabase(searchName,'ALL',1,{rarities,seriesIds:hasSeriesFeature?allSeriesIds:[]}),hit=all.cards[0],other=hit&&(hit.region!==region?hit.region:hit.printings?.find(p=>p.region&&p.region!==region)?.region);if(other)otherRegion={region:other}}catch(error){console.error('search region hint failed',error.message)}}
      if(total===0&&(hasSeriesFeature||rarities.length||parsed.region)){try{const nameOnly=await searchCatalogDatabase(searchName,regionParam,1);if(nameOnly.cards.length)suggestion={q:searchName,reason:hasSeriesFeature?'name-only-series':'name-only'}}catch(error){console.error('search suggestion failed',error.message)}}
      // 卡號後面多一個單字母（OP05-001 R：單字母不是稀有度代碼，只會被當成卡名的一部分）：去掉它若有結果就當建議。
      else if(total===0){const trimmed=searchName.replace(/\s+[A-Za-z]$/,'');if(trimmed&&trimmed!==searchName)try{const base=await searchCatalogDatabase(trimmed,regionParam,1);if(base.cards.length)suggestion={q:trimmed,reason:'去掉結尾的單一字母'}}catch(error){console.error('search suggestion failed',error.message)}}
      // Still nothing (typo?): offer the closest card name; an IP name that has no cards of its own (排球少年) is not a typo.
      if(total===0&&!suggestion&&!gameHint&&!otherRegion)suggestion=await suggestCardName(searchName,region);
      const searchBody=withPaging({...(matchedAs?{matchedAs}:{}),...(otherRegion?{otherRegion}:{}),source:hasDatabaseMatches?'supabase-search':catalog.source,architecture:'canonical-card-with-printings',match:hasDatabaseMatches?(database.matchedSeries?'database-series':activeSeries?'database-series+name':exact.length?'exact-name+database-substring':'database-substring'):(exact.length?'exact-name':'substring'),databaseSearch:database.searched?'available':'skipped',searchScope:hasDatabaseMatches?'bounded-database-query':'loaded-catalog-only',candidateCount:database.candidateCount,candidateLimit:database.candidateLimit},data,total,suggestion);rememberSearch(searchCacheKey,searchBody);return json(res,200,slimBody(searchBody),{...SHORT_CACHE,'Server-Timing':timing})
    }catch(error){
      console.error('catalog search failed',error.message);
      const page=pageLocal(exact.length?exact:found);
      return json(res,200,slimBody(withPaging({source:catalog.source,architecture:'canonical-card-with-printings',match:exact.length?'exact-name':'substring',databaseSearch:'unavailable',searchScope:'loaded-catalog-only'},page.data,page.total)))
    }
  }
  if(url.pathname.startsWith('/api/cards/')&&req.method==='GET'){const tail=decodeURIComponent(url.pathname.slice(11)),validCardId=id=>Boolean(id)&&id.length<=128&&!/[\u0000-\u001f\u007f]/.test(id);if(tail.endsWith('/price-history')){const id=tail.slice(0,-14);if(!validCardId(id))return json(res,400,{error:'卡片 ID 格式不正確'});const result=await priceHistoryResponse(id);return json(res,result.status,result.body)}if(tail.endsWith('/market')){const id=tail.slice(0,-7);if(!validCardId(id))return json(res,400,{error:'卡片 ID 格式不正確'});const {card}=await getCard(id);if(!card)return json(res,404,{error:'找不到這張卡'});return json(res,200,{data:await unifiedMarketCached(card)})}if(!validCardId(tail))return json(res,400,{error:'卡片 ID 格式不正確'});const {catalog,card}=await getCard(tail);if(!card)return json(res,404,{error:'找不到這張卡'});if(url.searchParams.get('open')==='1'&&!isBot(req.headers['user-agent']))cardHot.record(card.id);const series=catalog.series.find(s=>s.id===card.seriesId)||null,game=catalog.games.find(g=>g.id===card.game)||null,data={...card,series,game};const priced=card.game==='pokemon'?await attachReferencePrices([data]):null;if(priced?.referenceFailed)data.referencePriceFailed=true;return json(res,200,{data,meta:{source:catalog.source,imagePolicy:'優先使用已保存或來源允許的圖片；不長期 hotlink YGOPRODeck 圖片。'}},catalog.fallbackReason||priced?.referenceFailed?{}:SHORT_CACHE)}
  if(url.pathname==='/api/reports/meta')return json(res,200,{data:{platforms:ALLOWED_PLATFORMS,currencies:ALLOWED_CURRENCIES,maxPrice:MAX_PRICE}});
  // ADR 0045：免登入收藏的參考總值。最多 100 張卡、一次查詢 price_snapshots、不打外部來源。
  if(url.pathname==='/api/prices/reference'&&req.method==='POST'){let body;try{body=await readJsonBody(req,REFERENCE_BODY_MAX_BYTES)}catch(error){return json(res,error.message==='BODY_TOO_LARGE'?413:400,{error:error.message==='BODY_TOO_LARGE'?'請求內容過大':'JSON 格式錯誤'})}const v=validateReferenceRequest(body);if(v.error)return json(res,400,{error:v.error});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});try{const [rows,fx]=await Promise.all([supabaseFetch(`/price_snapshots?${new URLSearchParams(referenceQueryParams(v.ids))}`),getTwdRates()]);return json(res,200,{data:buildReferencePrices(rows,v.ids,{fx,amountToTwd})})}catch{return json(res,502,{error:'參考價查詢失敗'})}}
  if(url.pathname==='/api/auth/config'&&req.method==='GET')return json(res,200,{data:{url:authPublicUrl(),googleClientId:authSync.googleClientId()}});
  if(url.pathname==='/api/auth/google/callback'&&req.method==='GET'){res.writeHead(302,{Location:googleCallbackLocation(url.searchParams),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end()}
  if(['/api/auth/exchange','/api/auth/refresh','/api/auth/logout'].includes(url.pathname)&&req.method==='POST')return handleAuth(req,res,url.pathname.slice(10));
  if(['/api/sync/pull','/api/sync/push','/api/sync/delete'].includes(url.pathname)&&req.method==='POST')return handleCollectionSync(req,res,url.pathname.slice(10));
  if(url.pathname==='/api/reports'&&req.method==='GET'){const cardId=(url.searchParams.get('cardId')||'').trim(),cardName=(url.searchParams.get('cardName')||'').trim(),game=(url.searchParams.get('game')||'').trim(),limit=Math.min(100,Math.max(1,Math.floor(Number(url.searchParams.get('limit')))||20));if(!cardId&&!cardName)return json(res,400,{error:'請提供 cardId 或 cardName'});if(cardId&&(cardId.length>128||/[\u0000-\u001f\u007f]/.test(cardId)))return json(res,400,{error:'cardId 格式不正確'});if(cardName&&(cardName.length>100||/[\u0000-\u001f\u007f]/.test(cardName)))return json(res,400,{error:'cardName 長度或格式不正確'});if(game&&!CATALOG_GAME_IDS.has(game))return json(res,400,{error:'不支援的卡牌遊戲'});if(!supabaseConfigured())return json(res,200,{data:{reports:[],stats:[],total:0},meta:{status:'unavailable',reason:'尚未設定使用者回報資料庫'}});const base=new URLSearchParams();if(cardId)base.set('card_id',`eq.${cardId}`);else base.set('card_name',`ilike.*${cardName.replace(/[\\%_]/g,'\\$&').replace(/\*/g,'_')}*`);/* ilike wildcards in user input are escaped; PostgREST has no escape for *, so a literal * matches any one character */if(game)base.set('game',`eq.${game}`);try{const statsParams=new URLSearchParams(base);statsParams.set('select','currency,price');statsParams.set('limit','1000');const recentParams=new URLSearchParams(base);recentParams.set('select',PUBLIC_SELECT);recentParams.set('order','traded_at.desc');recentParams.set('limit',String(limit));const [all,recent]=await Promise.all([supabaseFetch(`/reports?${statsParams}`),supabaseFetch(`/reports?${recentParams}`)]);return json(res,200,{data:{reports:recent,stats:buildStats(all),total:all.length}})}catch{return json(res,502,{error:'資料庫查詢失敗'})}}
  if(url.pathname==='/api/admin/scrape/yuyutei'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});if(!catalogCollectionAllowed('yuyutei'))return json(res,409,{error:'來源權利尚未確認，已由來源政策暫停自動抓取'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});let targetUrl=url.searchParams.get('url');if(req.method==='POST'){try{targetUrl=(await readJsonBody(req)).url||targetUrl}catch{return json(res,400,{error:'JSON 格式錯誤'})}}if(!targetUrl?.startsWith('https://yuyu-tei.jp/buy/'))return json(res,400,{error:'請提供合法的遊々亭買取頁'});try{const {game,setTitle,cards:found}=await scrapeYuyutei(targetUrl),rows=found.map(c=>({source:'yuyutei',game,set_code:c.setCode,set_name:setTitle,card_code:c.cardCode,card_number:c.number,rarity:c.rarity,card_name:c.name,price:c.price,currency:'JPY',card_url:c.cardUrl,image_url:null,scraped_at:new Date().toISOString()}));for(let i=0;i<rows.length;i+=200)await supabaseFetch('/jp_buyback_prices?on_conflict=source,game,set_code,card_code',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify(rows.slice(i,i+200))});return json(res,200,{data:{message:'抓取並存檔成功',game,setTitle,count:rows.length}})}catch(e){return json(res,502,{error:`抓取失敗：${e.message}`})}}
  if(url.pathname==='/api/catalog/sync-status'&&req.method==='GET'){if(!supabaseConfigured())return json(res,200,{data:[]});try{const data=await supabaseFetch('/catalog_sync_runs?select=provider,scope,status,rowsSeen:rows_seen,rowsWritten:rows_written,startedAt:started_at,finishedAt:finished_at&provider=not.in.(price-snapshot,price-archive)&order=started_at.desc&limit=12');return json(res,200,{data})}catch(e){return failJson(res,502,'sync status failed',e)}}
  // ADR 0042：每日參考價快照的狀態、手動觸發與停止。
  if(url.pathname==='/api/admin/price-snapshot'&&req.method==='GET'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});return json(res,200,{data:priceSnapshot.status()})}
  if(url.pathname==='/api/admin/price-snapshot/run'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});const result=await priceSnapshot.runNow();return json(res,result.started?202:409,{data:result})}
  if(url.pathname==='/api/admin/price-archive'&&req.method==='GET'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});return json(res,200,{data:priceArchive.status()})}
  if(url.pathname==='/api/admin/price-archive/run'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});const result=await priceArchive.runNow();return json(res,result.started?202:409,{data:result})}
  if(url.pathname==='/api/admin/price-snapshot/stop'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});return json(res,200,{data:priceSnapshot.stop()})}
  if(url.pathname==='/api/admin/catalog/sync'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});const requested=(url.searchParams.get('provider')||'all').toLowerCase(),aliases={pokemontw:'pokemonZhTw',pokemonzh:'pokemonZhTw',weissfrieren:'weissFrieren',frieren:'weissFrieren',dragonball:'dragonballFw',dbs:'dragonballFw',yugiohjp:'yugiohJp',neuron:'yugiohJp'},selected=aliases[requested]||requested,tcgdexTw=process.env.TCGDEX_TW_SYNC==='true',candidates=requested==='all'?['pokemon',...(tcgdexTw?['pokemonZhTw']:[]),'onepiece','yugioh','haikyuu','weissFrieren','dragonballFw','yugiohJp']:[selected];if(candidates.some(p=>!['pokemon','pokemonZhTw','onepiece','yugioh','haikyuu','weissFrieren','dragonballFw','yugiohJp'].includes(p)))return json(res,400,{error:'不支援的 provider'});if(candidates.includes('pokemonZhTw')&&!tcgdexTw)return json(res,409,{error:'TCGdex 台版同步會覆寫台灣官方補正的資料，需設定 TCGDEX_TW_SYNC=true 才能執行'});const providers=filterAllowedCatalogProviders(candidates),blocked=candidates.filter(provider=>!providers.includes(provider));if(!providers.length)return json(res,409,{error:'所選來源尚未通過來源政策',blocked});syncCatalog(supabaseFetch,{providers}).then(result=>console.log('catalog sync complete',JSON.stringify(result))).catch(error=>console.error('catalog sync failed',error));return json(res,202,{data:{message:'Catalog 同步已在背景開始',providers,blocked}})}
  // 聯絡信箱：SITE_IMPROVEMENT_PLAN 決定 5（2026-11-12 使用者開設）。
  if((req.method==='GET'||req.method==='HEAD')&&url.pathname==='/.well-known/security.txt')return sendResponse(res,200,renderSecurityTxt(PUBLIC_BASE_URL),{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=3600'});
  if((req.method==='GET'||req.method==='HEAD')&&url.pathname==='/robots.txt')return sendResponse(res,200,renderRobotsTxt(PUBLIC_BASE_URL),{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=3600'});
  if((req.method==='GET'||req.method==='HEAD')&&(url.pathname==='/sitemap.xml'||/^\/sitemaps\/(?:pages|series|cards-\d+)\.xml$/.test(url.pathname)))return serveSitemap(res,url.pathname);
  if(req.method==='GET'&&url.pathname==='/')pageStats.record(url.searchParams,req.headers['user-agent'],req.headers['sec-fetch-dest']);
  if((req.method==='GET'||req.method==='HEAD')&&url.pathname==='/'){const seoTarget=seoRequestTarget(url);if(seoTarget)return serveSeoIndex(req,res,seoTarget)}
  let pathname=url.pathname==='/'?'/index.html':url.pathname;if(!PUBLIC_STATIC.test(pathname))return notFound(res,url.pathname);const file=normalize(join(root,pathname));if(!file.startsWith(root))return json(res,403,{error:'Forbidden'});try{const raw=await readFile(file),ext=extname(file),game=url.searchParams.get('game'),
    // 首頁與遊戲頁補 canonical／og:image／遊戲專屬標題（index.html 是靜態檔）；帶 view 的子頁維持原樣。
    // ?view=about／privacy 有自己的標題與 canonical；其他 view 值維持原樣。
    seo=url.pathname!=='/'?null:url.searchParams.has('view')?viewSeo({view:url.searchParams.get('view'),baseUrl:PUBLIC_BASE_URL}):homeSeo({gameId:CATALOG_GAME_IDS.has(game)?game:'',baseUrl:PUBLIC_BASE_URL}),content=seo?applySeoToHtml(raw.toString('utf8'),seo):raw,headers={'Content-Type':types[ext]||'application/octet-stream'};
    // html/js/css: always revalidate (no-cache) with a content ETag, so a deploy reaches browsers at once and an unchanged file is a 304. Images keep their existing handling.
    const revalidate=REVALIDATE_EXTENSIONS.has(ext);
    if(revalidate)headers['Cache-Control']='no-cache';
    return sendResponse(res,200,content,headers,{etag:revalidate,cacheCompressed:true})}catch{notFound(res,url.pathname)}
};
// 任何未預期的例外只讓這一個請求失敗，不讓整個服務崩潰（2026-10-23 審查：壞掉的 % 編碼曾讓程序結束）。
const server=createServer((req,res)=>{
  requestOfResponse.set(res,req);
  // 先設在 res 上，每一種回應（SEO 頁、sitemap、robots、圖片代理、404、錯誤）寫標頭時都會帶上，不必各處手寫。
  for(const [name,value] of Object.entries(SECURITY_HEADERS))res.setHeader(name,value);
  res.setHeader('Vary','Accept-Encoding');
  // API 與圖片代理的回應不會被當頁面執行：default-src 'none'（圖片本身不受影響，頁面 <img> 看的是頁面自己的 CSP）。
  res.setHeader('Content-Security-Policy',String(req.url).startsWith('/api/')?API_CSP:CSP);
  handleRequest(req,res).catch(error=>{
  const badInput=error instanceof URIError||error?.code==='ERR_INVALID_URL';
  if(!badInput)console.error('request failed',req.method,String(req.url).split('?')[0].slice(0,200),error?.stack||error);
  if(!res.headersSent)json(res,badInput?400:500,{error:badInput?'網址格式錯誤':'伺服器暫時發生錯誤'});else res.end();
})});
// 只限制接收請求的時間（擋慢速連線），不影響回應要跑多久。
server.headersTimeout=20000;server.requestTimeout=30000;
process.on('unhandledRejection',error=>console.error('unhandled rejection',error?.stack||error));
// Render 部署時送 SIGTERM：先把還沒寫進資料庫的頁面計數送出再結束（最多等 8 秒，資料庫慢也不拖住部署）。伺服器關閉時（測試）把監聽器與計時器拆掉。
const flushPageStatsAndExit=()=>{pageStats.stop();cardHot.stop();Promise.race([Promise.all([pageStats.flush(),cardHot.flush()]),new Promise(resolve=>setTimeout(resolve,8000))]).finally(()=>process.exit(0))};
process.once('SIGTERM',flushPageStatsAndExit);server.once('close',()=>{process.off('SIGTERM',flushPageStatsAndExit);pageStats.stop();cardHot.stop()});

const priceSnapshot=createPriceSnapshotController({db:supabaseFetch,isBlocked:()=>priceArchive.status().running});
const tcgapiPricing=createTcgapiPricing({apiKey:process.env.TCGAPI_KEY,db:supabaseFetch});
// 封存器不和快照輪次、目錄同步同時跑（HANDOFF 99 的 OOM）：快照在跑就延後，目錄同步看 catalog_sync_runs。
const priceArchive=createPriceArchiveController({db:supabaseFetch,storage:archiveStorage,reader:archiveReader,isBusy:()=>priceSnapshot.status().running,enabled:()=>process.env.PRICE_ARCHIVE_ENABLED!=='false'});
let sitemapWarm=null,coverageWarm=null;
server.listen(port,()=>{
  if(supabaseConfigured()){pageStats.start();cardHot.start()}
  if(supabaseConfigured()&&process.env.CATALOG_WARM_ON_START!=='false'){priceSnapshot.start();priceArchive.start();tcgapiPricing.start()}
  console.log(`CardScope is running at http://localhost:${port}`);
  // Load the catalog and product feed now so the first visitor after a deploy does not wait 2-4 s for them.
  if(process.env.CATALOG_WARM_ON_START!=='false'&&supabaseConfigured()){loadCatalog().catch(error=>console.error('catalog warm-up failed',error.message));loadCatalogHealth().catch(error=>console.error('health warm-up failed',error.message));loadProductSets().catch(error=>console.error('product warm-up failed',error.message));loadTrendSnapshot().catch(error=>console.error('trend warm-up failed',error.message));loadPriceMovers().catch(error=>console.error('price movers warm-up failed',error.message));loadPackPrizes().catch(error=>console.error('pack prizes warm-up failed',error.message));
    // Coverage pages through every card and printing (about a minute cold); start it after the lighter warm-ups so the first visitor after a restart does not wait for it.
    setTimeout(()=>{coverageWarm=loadCatalogCoverage().catch(error=>console.error('coverage warm-up failed',error.message))},30000).unref();
    // The sitemap scans every card (about a minute cold, 24-hour cache): build it after the other warm-ups so a crawler's first request is not the one that waits.
    setTimeout(()=>{sitemapWarm=loadSitemaps().catch(error=>console.error('sitemap warm-up failed',error.message))},15000).unref()}
  // A kept-warm instance can run for days, so the 72-hour freshness check repeats hourly instead of only at start-up.
  if(process.env.CATALOG_SYNC_ON_START!=='false'&&supabaseConfigured()){let syncRunning=false,firstRun=true;const bootedAt=new Date().toISOString();const runScheduledCatalogSync=async()=>{if(syncRunning)return;syncRunning=true;const startup=firstRun;firstRun=false;try{if(startup){await Promise.allSettled([sitemapWarm,coverageWarm]);await closeInterruptedCatalogRuns(supabaseFetch,bootedAt).catch(error=>console.warn('closing interrupted catalog runs failed',error?.message))}const maxAgeHours=Math.max(1,Number(process.env.CATALOG_SYNC_MAX_AGE_HOURS)||72),needed=await catalogProvidersNeedingSync(supabaseFetch,maxAgeHours,{includeTcgdexTw:process.env.TCGDEX_TW_SYNC==='true'}),providers=filterAllowedCatalogProviders(needed),blocked=needed.filter(provider=>!providers.includes(provider));if(blocked.length)console.warn('source policy blocked scheduled catalog sync',blocked.join(','));if(providers.length){console.log('starting scheduled catalog sync',providers.join(','));const result=await syncCatalog(supabaseFetch,{providers});console.log('scheduled catalog sync complete',JSON.stringify(result))}{const keys=await refreshBrowseKeys(supabaseFetch);if(Object.keys(keys).length)console.log('browse keys rebuilt',JSON.stringify(keys))}const cacheSetting=process.env.CARD_IMAGE_CACHE_ON_START,shouldCacheImages=((startup&&cacheSetting==='true')||(cacheSetting!=='false'&&providers.includes('yugioh')))&&imageCollectionAllowed('yugioh');if(shouldCacheImages){console.log('starting card image cache');const images=await cacheYugiohImages(supabaseFetch,{limit:Number(process.env.CARD_IMAGE_CACHE_LIMIT||15000),concurrency:Number(process.env.CARD_IMAGE_CACHE_CONCURRENCY||4)});console.log('card image cache complete',JSON.stringify(images))}}catch(error){console.error('scheduled catalog/image sync failed',error.message)}finally{syncRunning=false}};
    // The first look waits until the sitemap and coverage warm-ups (15 s and 30 s after start) are done: a sync holds tens of MB (YGOPRODeck's card list alone is 20 MB of JSON) and must not peak together with them.
    setTimeout(runScheduledCatalogSync,process.env.CATALOG_WARM_ON_START!=='false'?45000:3000);const intervalMinutes=Number(process.env.CATALOG_SYNC_INTERVAL_MINUTES??60);if(intervalMinutes>0)setInterval(runScheduledCatalogSync,intervalMinutes*60000).unref()}
});

// Keep the pure browse helpers available to contract tests and maintenance
// tooling without changing the public HTTP surface.
export { referenceChange, fxJump, buildPriceMovers, buildVersionPrices, referencePriceFromRow, normalizeBrowseSort, buildPriceHistory, accumulateCoverage, adjustCoverageGame, buildBrowseFacets, buildBrowsePage, buildPrintingIndex, buildCoverageGame, browseCache, cachedBrowseRows, createCoverageAccumulator, finishCoverage, browseValues, coverageMetric, rarityCanonicalCode, rarityDisplayLabel, onePieceImageTarget, seoRequestTarget, redactInflightSearch, server };


