import { marketEventsFor } from './providers/market-events.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { matchYgoprodeckSet, searchYgoProDeck } from './providers/ygoprodeck.mjs';
import { fetchTcgdexPricing, fetchTcgdexPricingEn, tcgdexLookupForPrinting } from './providers/tcgdex-pricing.mjs';
import { createPriceSnapshotController } from './providers/price-snapshot.mjs';
import { createArchiveReader, createArchiveStorage, createPriceArchiveController, mergeSnapshotRows } from './providers/price-archive.mjs';
import { REFERENCE_BODY_MAX_BYTES, buildReferencePrices, referenceQueryParams, validateReferenceRequest } from './providers/collection-valuation.mjs';
import { normalizeMarketRecord, withTwd, RARITY_RANKINGS, rarityCanonicalCode as normalizeRarityCanonicalCode, rarityDisplayLabel as normalizeRarityDisplayLabel, rarityRank as normalizeRarityRank, rarityToken as normalizeRarityToken, rarityDefinition as normalizeRarityDefinition } from './providers/normalize.mjs';
import { auditCatalogLinks, catalogProvidersNeedingSync, localizeProductName, refreshBrowseKeys, syncCatalog } from './providers/catalog-sync.mjs';
import { cacheYugiohImages, yugiohImageStatus } from './providers/image-cache.mjs';
import { foldSearch, foldedSpan, gameHintFor, parseSearchQuery, printingMatchesRarity, rarityMatchValues, rarityOnlyExample } from './providers/search-query.mjs';
import { normalizeProduct } from './providers/products.mjs';
import { catalogCollectionAllowed, filterAllowedCatalogProviders, imageCollectionAllowed, imageDisplayPolicies, imageRightsAllowDisplay, publicSourcePolicies, sourceDisplayDenied, sourcePolicySummary } from './providers/source-policy.mjs';
import { aggregateCatalogBaselines } from './providers/catalog-baseline.mjs';
import { chunkCardIds, createBoundedSnapshotCache, imageSourceOf, summarizeImageHealth } from './providers/backend-reliability.mjs';
import { SITEMAP_MAX_URLS, applyNoindexToHtml, applySeoToHtml, cardSeo, cardSitemapEntries, chunkEntries, homeSeo, mergeCardSitemapRows, normalizeBaseUrl, pageSitemapEntries, renderRobotsTxt, renderSitemapIndex, renderUrlSet, seriesSeo, seriesSitemapEntries } from './providers/seo.mjs';

const nativeFetch = globalThis.fetch;
const fetch = (url, options={}) => nativeFetch(url,{...options,signal:options.signal||AbortSignal.timeout(12000)});

const root = fileURLToPath(new URL('.', import.meta.url));
const rarityRankings = RARITY_RANKINGS;
const port = Number(process.env.PORT || 4173);
const jpyToTwdFallback = Number(process.env.JPY_TO_TWD || 0.22);
const usdToTwdFallback = Number(process.env.USD_TO_TWD || 32);
const FX_CACHE_MS = 24 * 60 * 60 * 1000;
const MARKET_CACHE_MS = 24 * 60 * 60 * 1000;
const fxCache = { data:null, expiresAt:0 };
const CATALOG_GAME_IDS = new Set(['pokemon','onepiece','yugioh','haikyuu','weiss-schwarz','dragonball-fw']);
const CATALOG_REGION_IDS = new Set(['JP','TW','US','CN','KR','ASIA']);
const ONEPIECE_IMAGE_HOSTS = new Set(['asia-tc.onepiece-cardgame.com','asia-en.onepiece-cardgame.com']);
// Faceted browsing reads the complete selected game before pagination so the
// counts stay truthful. Reuse that snapshot across normal browsing sessions
// instead of repeating the same database scan on every filter interaction.
const BROWSE_CACHE_MS = 5 * 60 * 1000;
const BROWSE_PAGE_MAX = 100;
const BROWSE_SERIES_FALLBACK_MAX = 3000;
const BROWSE_CARD_SELECT = 'id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases,metadata,source,providerId:provider_id,createdAt:created_at,updatedAt:updated_at';
const BROWSE_PRINTING_SELECT = 'id,cardId:card_id,seriesId:series_id,region,language,localSetCode:local_set_code,localCardNumber:local_card_number,rarity,rarityCode:rarity_code,rarityLabel:rarity_label,imageUrl:image_url,sourceUrl:source_url,source,providerId:provider_id,releaseDate:release_date,imageRehostRequired:image_rehost_required,imageRightsStatus:image_rights_status,imageLicenseExpiresAt:image_license_expires_at,metadata,createdAt:created_at,updatedAt:updated_at';
const BROWSE_IMAGE_SELECT = 'id,cardId:card_id,language,source,imageUrl:image_url,sourceUrl:source_url,isPrimary:is_primary,fetchedAt:fetched_at,imageRightsStatus:image_rights_status,imageLicenseExpiresAt:image_license_expires_at';
const browseCache=new Map();
const BROWSE_CACHE_ROWS_MAX = 5000;
const RELATION_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.CATALOG_RELATION_BATCH_SIZE) || 100));
const RELATION_QUERY_MAX_BYTES = 8 * 1024;
const RELATION_QUERY_CONCURRENCY = 4;
const RELATION_SCAN_PAGE_SIZE = 1000;
const SNAPSHOT_TTL_MS = Math.max(1000, Number(process.env.CATALOG_SNAPSHOT_CACHE_MS) || BROWSE_CACHE_MS);
const SNAPSHOT_MAX_STALE_MS = Math.max(1000, Number(process.env.CATALOG_SNAPSHOT_MAX_STALE_MS) || 30 * 60 * 1000);
// The health and coverage snapshots take 10-15 s on the database: serve the last one while one background load refreshes it.
const catalogHealthCache = createBoundedSnapshotCache({ttlMs:SNAPSHOT_TTL_MS,maxStaleMs:SNAPSHOT_MAX_STALE_MS,serveStaleWhileRevalidate:true});
const catalogCoverageCache = createBoundedSnapshotCache({ttlMs:SNAPSHOT_TTL_MS,maxStaleMs:SNAPSHOT_MAX_STALE_MS,serveStaleWhileRevalidate:true});
const TREND_CACHE_MS = 5 * 60 * 1000;
const trendCache = {data:null,expiresAt:0,promise:null};

const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json'};
// 只公開前端需要的檔案：根目錄的 .js／.css／index.html、assets/、前端讀的兩個 data 檔；server.mjs、providers、docs 等一律 404。
const PUBLIC_STATIC=/^\/(?:[a-z0-9-]+\.(?:js|css)|manifest\.webmanifest|index\.html|googlefb9a9f93e94c056f\.html|assets\/(?:[\w.-]+\/)*[\w.-]+\.(?:png|jpe?g|webp|svg|ico|woff2?)|data\/(?:rarity-rankings|game-taxonomy)\.json)$/;
const SECURITY_HEADERS={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'SAMEORIGIN','Strict-Transport-Security':'max-age=15552000'};
// 強制：script-src 只允許同源 .js 與 index.html 內 inline <script> 的 SHA-256（啟動時由檔案算出，不用 nonce：nonce 會與 ETag 304、service worker 快取的舊頁對不上）；沒有 unsafe-inline、也沒有 inline 事件屬性（script-src-attr 'none'，改用 ui-actions.js 的事件委派）。擋的是外部腳本、未列出的圖片主機、被嵌入框架。新增卡圖來源時要把主機加進 img-src，否則圖片會被擋；改 index.html 的 inline script 不必動這裡，重啟即重算。
const inlineScripts=html=>[...html.matchAll(/<script(?![^>]*\s(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
const INLINE_SCRIPT_SOURCES=(()=>{try{return inlineScripts(readFileSync(join(root,'index.html'),'utf8')).map(code=>`'sha256-${createHash('sha256').update(code).digest('base64')}'`)}catch{return[]}})();
const CSP=`default-src 'self'; script-src 'self' ${INLINE_SCRIPT_SOURCES.join(' ')}; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://www.pokemon-card.com https://asia.pokemon-card.com https://images.pokemontcg.io https://*.supabase.co https://*.onepiece-cardgame.com https://assets.tcgdex.net https://images.ygoprodeck.com https://images.scrydex.com https://ws-tcg.com https://www.takaratomy.co.jp https://www.dbs-cardgame.com; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'`;
// 目錄類回應每份 1–3 MB：讓瀏覽器 1 分鐘內重用、5 分鐘內先用舊的再背景更新，免得每次換頁重抓。
const SHORT_CACHE={'Cache-Control':'public, max-age=60, stale-while-revalidate=300'};
const json = (res,status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(body));};
// 公開回應不帶底層錯誤原文（supabaseFetch 的訊息含 PostgREST 回應，會露出表／欄位／函式名）：原文只進日誌，回應給固定訊息或代碼。
// 瀏覽器導覽到不存在的路徑給簡單的繁中 404 頁（可回首頁）；/api/ 仍回 JSON，程式端才解析得了。
const NOT_FOUND_HTML='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>找不到頁面｜CardScope</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#efeae0;color:#171717;font:16px/1.6 system-ui,"Noto Sans TC",sans-serif;text-align:center}main{padding:24px}h1{margin:0 0 8px;font-size:24px}a{display:inline-block;margin-top:16px;padding:10px 22px;border-radius:8px;background:#171717;color:#fff;text-decoration:none}</style></head><body><main><h1>找不到這個頁面</h1><p>網址可能打錯了，或這個頁面已經移除。</p><a href="/">回 CardScope 首頁</a></main></body></html>',notFound=(res,pathname)=>{if(pathname.startsWith('/api/'))return json(res,404,{error:'Not found'});res.writeHead(404,{'Content-Type':types['.html'],'Cache-Control':'no-store'});res.end(NOT_FOUND_HTML)};
const UPSTREAM_ERROR='UPSTREAM_UNAVAILABLE',failJson=(res,status,label,error,headers)=>{console.error(label,error?.message||error);return json(res,status,{error:'資料暫時無法讀取'},headers)},publicReason=(label,error)=>{console.error(label,error?.message||error);return UPSTREAM_ERROR};

function onePieceImageTarget(value){
  try{
    const target=new URL(String(value||''));
    if(target.protocol!=='https:'||!ONEPIECE_IMAGE_HOSTS.has(target.hostname))return null;
    if(!target.pathname.startsWith('/images/cardlist/card/')||!/\.(?:png|jpe?g|webp)$/i.test(target.pathname))return null;
    return target;
  }catch{return null}
}
async function proxyOnePieceImage(res,value){
  const target=onePieceImageTarget(value);
  if(!target)return json(res,400,{error:'不支援的圖片來源'});
  let response;
  try{response=await nativeFetch(target,{redirect:'error',headers:{Accept:'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8','User-Agent':'CardScope/1.0'},signal:AbortSignal.timeout(20000)})}
  catch{return json(res,502,{error:'航海王官方圖片暫時無法讀取'})}
  const contentType=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),length=Number(response.headers.get('content-length')||0);
  if(!response.ok||!contentType.startsWith('image/')||(length&&length>5*1024*1024))return json(res,502,{error:'航海王官方圖片回應無效'});
  const body=Buffer.from(await response.arrayBuffer());
  if(body.length>5*1024*1024)return json(res,502,{error:'航海王官方圖片超過大小限制'});
  res.writeHead(200,{'Content-Type':contentType,'Content-Length':String(body.length),'Cache-Control':'public, max-age=86400, stale-while-revalidate=604800','X-Content-Type-Options':'nosniff'});
  res.end(body);
}

const providerStatus=()=>({
  ygoprodeck:{enabled:true,capability:'免費遊戲王卡片資料與各版本 set price 參考價（24 小時快取；圖片需自行保存）'},
  kapaipai:{enabled:false,capability:'等待公開頁面結構與存取方式確認'},
  snkrdunk:{enabled:false,capability:'等待公開頁面結構與存取方式確認'},
  yuyutei:{enabled:Boolean(process.env.SCRAPE_SECRET),capability:'遊々亭買取行情；建議每日排程一次'},
  reportsDb:{enabled:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_KEY),capability:'Supabase：回報、多語名稱、日版行情、匯率'}
});

function supabaseConfigured(){return Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_KEY)}
async function supabaseFetch(pathAndQuery,options={}){
  const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_KEY;
  if(!base||!key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const response=await fetch(`${base}/rest/v1${pathAndQuery}`,{...options,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(options.headers||{})}});
  if(!response.ok){const text=await response.text().catch(()=>'');throw new Error(`SUPABASE_${response.status}:${text.slice(0,200)}`)}
  const text=await response.text(); if(!text)return null; try{return JSON.parse(text)}catch{return null}
}

async function supabaseFetchPage(pathAndQuery){
  const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_KEY;
  if(!base||!key)throw new Error('SUPABASE_NOT_CONFIGURED');
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
    if(!times[0]||Date.now()-times[0]>=FX_CACHE_MS)return null;
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
  if(supabaseConfigured()){const stored=await loadStoredTwdRates();if(stored){fxCache.data=stored;fxCache.expiresAt=Date.now()+Math.max(60000,FX_CACHE_MS-(Date.now()-new Date(stored.fetchedAt).getTime()));return stored}}
  const fallback={rates:{TWD:1,JPY:jpyToTwdFallback,USD:usdToTwdFallback,EUR:35},updatedAt:null,fetchedAt:new Date().toISOString(),source:'fallback'};
  try{
    // Frankfurter（歐洲央行）沒有新台幣；改用 ExchangeRate-API 的免金鑰端點，條款要求標示來源（前端附連結）。
    const response=await fetch('https://open.er-api.com/v6/latest/TWD'); if(!response.ok)throw new Error(`FX_${response.status}`);
    const body=await response.json(),rates={TWD:1}; if(body.result!=='success')throw new Error('FX_RESULT'); for(const currency of ['JPY','USD','EUR','KRW','HKD']){const value=Number(body.rates?.[currency]);if(Number.isFinite(value)&&value>0)rates[currency]=1/value} if(!['JPY','USD','EUR'].every(c=>rates[c]))throw new Error('FX_INCOMPLETE');
    const data={rates,updatedAt:body.time_last_update_utc?new Date(body.time_last_update_utc).toISOString().slice(0,10):null,fetchedAt:new Date().toISOString(),source:'ExchangeRate-API'};fxCache.data=data;fxCache.expiresAt=Date.now()+FX_CACHE_MS;saveTwdRates(data).catch(()=>{});return data;
  }catch{fxCache.data=fallback;fxCache.expiresAt=Date.now()+60*60*1000;return fallback}
}
function amountToTwd(amount,currency,fx){const value=Number(amount),rate=Number(fx?.rates?.[currency]);return Number.isFinite(value)&&Number.isFinite(rate)?Math.round(value*rate):null}


const EXTERNAL_QUERY_ALIASES={
  '皮卡丘':{query:'Pikachu',game:'pokemon'},'pikachu':{query:'Pikachu',game:'pokemon'},'ピカチュウ':{query:'Pikachu',game:'pokemon'},'피카츄':{query:'Pikachu',game:'pokemon'},
  '噴火龍':{query:'Charizard',game:'pokemon'},'喷火龙':{query:'Charizard',game:'pokemon'},'charizard':{query:'Charizard',game:'pokemon'},'リザードン':{query:'Charizard',game:'pokemon'},'리자몽':{query:'Charizard',game:'pokemon'},
  '超夢':{query:'Mewtwo',game:'pokemon'},'超梦':{query:'Mewtwo',game:'pokemon'},'mewtwo':{query:'Mewtwo',game:'pokemon'},'ミュウツー':{query:'Mewtwo',game:'pokemon'},'뮤츠':{query:'Mewtwo',game:'pokemon'},
  '夢幻':{query:'Mew',game:'pokemon'},'梦幻':{query:'Mew',game:'pokemon'},'mew':{query:'Mew',game:'pokemon'},'ミュウ':{query:'Mew',game:'pokemon'},'뮤':{query:'Mew',game:'pokemon'},
  '魯夫':{query:'Luffy',game:'one-piece'},'路飛':{query:'Luffy',game:'one-piece'},'路飞':{query:'Luffy',game:'one-piece'}
};
const normalizeSearch=s=>String(s||'').toLocaleLowerCase().normalize('NFKC').replace(/[\s・·._:：'’"\-<>\[\]​-‍⁠﻿]/g,'');
const externalAliasIndex=new Map(Object.entries(EXTERNAL_QUERY_ALIASES).map(([alias,value])=>[normalizeSearch(alias),value]));
const decodeHtml=s=>String(s||'').replace(/&#(\d+);/g,(_,value)=>String.fromCodePoint(Number(value))).replace(/&#x([0-9a-f]+);/gi,(_,value)=>String.fromCodePoint(Number.parseInt(value,16))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#039;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
async function supabaseFetchAll(pathAndQuery,pageSize=1000){const rows=[];for(let offset=0;;offset+=pageSize){const separator=pathAndQuery.includes('?')?'&':'?',batch=await supabaseFetch(`${pathAndQuery}${separator}limit=${pageSize}&offset=${offset}`);rows.push(...(batch||[]));if(!batch||batch.length<pageSize)return rows}}
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
function normalizeBrowseRegion(value){const region=String(value||'').trim().toUpperCase();return !region||region==='ALL'?null:region}
function normalizeBrowseRarity(value){const rarity=String(value||'').trim();return !rarity||rarity.toLowerCase()==='all'?null:rarity}
// 稀有度是各來源的原字（含中日文與符號），所以只驗長度與字元類別（無控制字元），擋掉過長或亂碼字串放大成新的快取鍵。
const BROWSE_RARITY_FORMAT=/^[\p{L}\p{N}\p{M}\p{S}\p{P}\p{Zs}]{1,64}$/u;
// Catalog rows carry no price, so for most games a price sort is plain number order (the page sorts the loaded rows itself, from the buyback list).
// Pokemon pages carry the newest Cardmarket reference price (price_snapshots), so only Pokemon may sort by it, in the database (browse_cards_priced) or, inside a series, here.
const BROWSE_PRICE_SORTS=new Set(['price-asc','price-desc']);
function normalizeBrowseSort(value,game=null){const sort=String(value||'number-asc').trim().toLowerCase();return new Set(['number-asc','number-desc','release-asc','release-desc','rarity-asc','rarity-desc','name-asc','name-desc']).has(sort)||(game==='pokemon'&&BROWSE_PRICE_SORTS.has(sort))?sort:'number-asc'}
function browseToken(value){return normalizeSearch(value).replace(/[^\p{L}\p{N}]/gu,'')}
function rarityRankingToken(value){return normalizeRarityToken(value)}
function rarityDefinition(game){return normalizeRarityDefinition(game)}
function rarityCanonicalCode(game,value){return normalizeRarityCanonicalCode(game,value)}
function rarityCanonicalToken(game,value){return rarityRankingToken(rarityCanonicalCode(game,value))}
function rarityDisplayLabel(game,value){return normalizeRarityDisplayLabel(game,value)}
function browseRarityRank(game,value){return normalizeRarityRank(game,value)}
function compareBrowseRarity(a,b,direction='desc'){
  const ar=browseRarityRank(a.game,browseValues(a,a.printings,'rarity')[0]),br=browseRarityRank(b.game,browseValues(b,b.printings,'rarity')[0]);
  if(ar===Number.MAX_SAFE_INTEGER||br===Number.MAX_SAFE_INTEGER){if(ar!==br)return ar===Number.MAX_SAFE_INTEGER?1:-1}
  else if(ar!==br)return direction==='desc'?ar-br:br-ar;
  return browseNumberCollator.compare(String(browseValues(a,a.printings,'rarity')[0]||''),String(browseValues(b,b.printings,'rarity')[0]||''));
}
function browseValues(card,printings,key){
  const values=[];
  if(key==='rarity')values.push(rarityCanonicalCode(card?.game,card?.rarity),...(printings||[]).flatMap(p=>[p.rarity,p.rarityCode,p.rarityLabel]).map(value=>rarityCanonicalCode(card?.game,value)));
  if(key==='region')values.push(card?.region,...(printings||[]).map(p=>p.region));
  if(key==='language')values.push(card?.language,...(printings||[]).map(p=>p.language));
  return uniqueValues(values);
}
// A printing image wins; otherwise the card's own card_images row (ADR 0031: official card images), if its source policy allows display.
function cardImageFields(card,printings){const printing=(printings||[]).find(p=>p.imageUrl&&!p.imageRehostRequired);if(printing)return {imageUrl:printing.imageUrl};const image=(card?.images||[]).find(browseHasUsableImage);return image?{imageUrl:image.imageUrl,imageSource:image.source,imageRightsStatus:image.imageRightsStatus,imageLicenseExpiresAt:image.imageLicenseExpiresAt||null}:{imageUrl:null}}
function browseHasUsableImage(row){return Boolean(row?.imageUrl&&row.imageRehostRequired!==true&&imageRightsAllowDisplay(row.imageRightsStatus,row.imageLicenseExpiresAt,imageSourceOf(row)))}
function buildPrintingIndex(rows=[]){const byCard=new Map();for(const printing of rows){const list=byCard.get(printing.cardId)||[];list.push(printing);byCard.set(printing.cardId,list)}for(const list of byCard.values())list.sort(comparePrintings);return byCard}
function hydrateBrowseCard(card,printingByCard,imageByCard){
  const printings=printingByCard.get(card.id)||[],images=imageByCard?.get(card.id)||[],image=images.find(browseHasUsableImage)||printings.find(browseHasUsableImage);
  const safePrintings=printings.map(printing=>browseHasUsableImage(printing)?printing:{...printing,imageUrl:null});
  return {...card,printings:safePrintings,images:images.map(item=>browseHasUsableImage(item)?item:{...item,imageUrl:null}),region:printings[0]?.region||card.region||null,language:printings[0]?.language||card.language||null,imageUrl:image?.imageUrl||null,imageSource:image?.source||null,imageRightsStatus:image?.imageRightsStatus||null};
}
function browseNumber(card){return String(card?.officialCardNumber||card?.printings?.find(p=>p.localCardNumber)?.localCardNumber||'')}
function browseRelease(card){return card?.printings?.map(p=>p.releaseDate).filter(Boolean).sort().at(-1)||card?.releaseDate||''}
// Shared collators: localeCompare with options builds a new ICU collator on every call, which dominated sorting a series.
// Pinned to en-US (the ICU root order): the database sorts the same keys with ICU collations 'und-u-kn-true-ks-level1' / 'und-u-ks-level1' / 'und' (migration 20261016110000), and a host locale such as zh-TW would reorder Han names.
const BROWSE_LOCALE='en-US',browseNumberCollator=new Intl.Collator(BROWSE_LOCALE,{numeric:true,sensitivity:'base'}),browseIdCollator=new Intl.Collator(BROWSE_LOCALE),browseNameCollator=new Intl.Collator(BROWSE_LOCALE,{sensitivity:'base'});
// Cards that print no number (ADR 0026) arrive in official list order from browse_series_cards; keep that order among them.
const notPrinted=card=>card?.metadata?.numberStatus==='not-printed';
function browseCompare(a,b,sort,order=null,prices=null){
  const number=()=>browseNumberCollator.compare(browseNumber(a),browseNumber(b))||(order&&notPrinted(a)&&notPrinted(b)?order.get(a)-order.get(b):0)||browseIdCollator.compare(String(a.id),String(b.id));
  if(sort==='number-desc')return -number();
  // Price sorts (Pokemon): a card with a reference price comes before one without, in either direction; equal prices fall back to number order.
  if(BROWSE_PRICE_SORTS.has(sort)){const pa=prices?.get(a.id),pb=prices?.get(b.id);if((pa==null)!==(pb==null))return pa==null?1:-1;if(pa!=null&&pa!==pb)return sort==='price-desc'?pb-pa:pa-pb;return number()}
  if(sort==='release-asc'||sort==='release-desc'){const value=browseIdCollator.compare(String(browseRelease(a)),String(browseRelease(b)))||number();return sort==='release-desc'?-value:value}
  if(sort==='rarity-asc'||sort==='rarity-desc')return compareBrowseRarity(a,b,sort.endsWith('desc')?'desc':'asc')||number();
  if(sort==='name-asc'||sort==='name-desc'){const value=browseNameCollator.compare(String(a.nameZh||a.nameEn||a.nameJa||a.id),String(b.nameZh||b.nameEn||b.nameJa||b.id))||number();return sort==='name-desc'?-value:value}
  return number();
}
function buildBrowseFacets(rows,printingByCard){
  const facets={rarity:{},region:{},language:{}},rarityLabels={};
  // A canonical card may have several physical rows/printings. Count each
  // facet at most once per canonical identity while retaining every rarity
  // represented by that identity.
  const grouped=new Map();
  for(const card of rows){
    const identity=String(card?.canonicalId||card?.id||'');
    if(!identity)continue;
    const current=grouped.get(identity)||{cards:[]};
    current.cards.push(card);
    grouped.set(identity,current);
  }
  for(const {cards} of grouped.values())for(const key of Object.keys(facets)){
    const values=new Set(cards.flatMap(card=>browseValues(card,printingByCard.get(card.id)||[],key)));
    if(!values.size)values.add('unknown');
    for(const value of new Set(values)){
      facets[key][value]=(facets[key][value]||0)+1;
      if(key==='rarity'&&value!=='unknown')rarityLabels[value]=rarityDisplayLabel(cards[0]?.game,value);
    }
  }
  return {...facets,rarityLabels};
}
function buildBrowsePage(rows,{region=null,rarity=null,seriesId=null,sort='number-asc',limit=60,offset=0,printingByCard=new Map(),imageByCard=new Map(),facetStatus='complete',priceByCard=null}={}){
  const regionToken=region?String(region).toUpperCase():null;
  const baseMatching=rows.filter(card=>{const printings=printingByCard.get(card.id)||[];if(seriesId&&card.seriesId!==seriesId&&!printings.some(printing=>printing.seriesId===seriesId))return false;if(regionToken&&!browseValues(card,printings,'region').some(value=>String(value).toUpperCase()===regionToken))return false;return true});
  const matching=baseMatching.filter(card=>{const printings=printingByCard.get(card.id)||[];const cardRarityToken=rarity?rarityCanonicalToken(card?.game,rarity):null;return !cardRarityToken||browseValues(card,printings,'rarity').some(value=>rarityCanonicalToken(card?.game,value)===cardRarityToken)}).map(card=>hydrateBrowseCard(card,printingByCard,imageByCard));
  const order=new Map(matching.map((row,index)=>[row,index]));matching.sort((a,b)=>browseCompare(a,b,sort,order,priceByCard));
  const take=Math.min(Math.max(Number(limit)||60,1),BROWSE_PAGE_MAX),skip=Math.max(Number(offset)||0,0),page=matching.slice(skip,skip+take);
  return {data:page,total:matching.length,hasMore:skip+page.length<matching.length,facets:buildBrowseFacets(baseMatching,printingByCard),facetStatus,limit:take,offset:skip};
}
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
function referencePriceFromRow(row){const amount=Number(row?.amount),date=String(row?.snapshot_date||'').slice(0,10);if(!row?.card_id||!Number.isFinite(amount)||amount<=0||row.currency!=='EUR'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;return {amount,currency:row.currency,source:'cardmarket',variant:row.variant||'',observedAt:row.observed_at||`${date}T00:00:00.000Z`,snapshotDate:date}}
async function loadReferencePrices(ids){
  const unique=[...new Set((ids||[]).filter(id=>typeof id==='string'&&id))].sort(),prices=new Map();
  if(!unique.length||!supabaseConfigured())return prices;
  const key=`refprice:${createHash('sha1').update(unique.join('|')).digest('hex')}`;let timer;
  try{
    const rows=await Promise.race([cachedBrowseRows(key,()=>supabaseFetch('/rpc/price_reference_best',{method:'POST',body:JSON.stringify({p_ids:unique})}),REFERENCE_PRICE_TTL_MS),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('REFERENCE_PRICE_TIMEOUT')),REFERENCE_PRICE_WAIT_MS)})]);
    for(const row of Array.isArray(rows)?rows:[]){const price=referencePriceFromRow(row);if(price)prices.set(row.card_id,price)}
  }catch(error){console.error('reference price lookup failed; cards go out without it',error.message)}
  finally{clearTimeout(timer)}
  return prices;
}
async function attachReferencePrices(cards){
  const prices=await loadReferencePrices((cards||[]).map(card=>card.id));
  for(const card of cards||[]){const price=prices.get(card.id);if(price)card.referencePrice=price}
  return cards;
}
// Price sort inside one series (a few hundred cards): the amounts are looked up here and handed to buildBrowsePage.
async function seriesPriceMap(cards,sort){
  if(!BROWSE_PRICE_SORTS.has(sort))return null;
  return new Map([...await loadReferencePrices(cards.map(card=>card.id))].map(([id,price])=>[id,price.amount]));
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
function databaseRelationQuery(table,select,cardIds){
  const ids=cardIds.map(id=>`"${String(id).replaceAll('"','')}"`).join(','),query=new URLSearchParams({select,card_id:`in.(${ids})`,order:'id.asc'});
  return `/${table}?${query}`;
}
function databaseRelationQueryWithinLimit(table,select,cardIds){
  const path=databaseRelationQuery(table,select,cardIds),url=`${process.env.SUPABASE_URL||''}/rest/v1${path}&limit=1000&offset=9999999999`;
  return Buffer.byteLength(url,'utf8')<=RELATION_QUERY_MAX_BYTES;
}
function chunkDatabaseRelationCardIds(table,select,cardIds,legacySelect=null){
  const selects=[select,legacySelect].filter(Boolean),batches=[];
  for(const sizedBatch of chunkCardIds(cardIds,RELATION_BATCH_SIZE)){
    let batch=[];
    for(const cardId of sizedBatch){
      const candidate=[...batch,cardId],fits=selects.every(candidateSelect=>databaseRelationQueryWithinLimit(table,candidateSelect,candidate));
      if(batch.length&&!fits){batches.push(batch);batch=[cardId]}
      else batch=candidate;
      if(!selects.every(candidateSelect=>databaseRelationQueryWithinLimit(table,candidateSelect,batch)))throw new Error('RELATION_QUERY_TOO_LARGE');
    }
    if(batch.length)batches.push(batch);
  }
  return batches;
}
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
    const priceByCard=await seriesPriceMap(rpc.cards,options.sort);started=performance.now();const page=buildBrowsePage(rpc.cards,{...options,printingByCard,imageByCard,facetStatus:'complete',priceByCard});mark('page',started);
    return {...page,errors:{printings:null,images:null},timings};
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
async function browseDatabaseCards(game,options){
  if(options.seriesId)return browseDatabaseSeriesCards(game,options);
  if(databaseFastBrowseEligible(options))return browseDatabasePageFast(game,options);
  return browseDatabaseCardsFiltered(game,options);
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

function coverageMetric(covered,denominator,status='complete',details={}){
  const safeCovered=covered===null||covered===undefined?null:Number.isFinite(Number(covered))?Number(covered):null,safeDenominator=denominator===null||denominator===undefined?null:Number.isFinite(Number(denominator))&&Number(denominator)>=0?Number(denominator):null;
  // A zero/unknown denominator is not a meaningful completeness percentage.
  // Keep the numeric fields for compatibility, but expose percent as null so
  // the UI cannot present an empty or unverified scope as 100% complete.
  const percent=safeCovered!==null&&safeDenominator!==null&&safeDenominator>0?Math.round(safeCovered/safeDenominator*10000)/100:null;
  return {covered:safeCovered,denominator:safeDenominator,percent,status,...details};
}
function coverageIso(value){const time=Date.parse(String(value||''));return Number.isFinite(time)?new Date(time).toISOString():null}
function coverageTimestamp(...groups){
  const fallbackTimestamp=typeof groups.at(-1)==='string'?groups.pop():null,values=groups.flatMap(group=>Array.isArray(group)?group:[]).flatMap(row=>[row?.updatedAt,row?.fetchedAt]).map(coverageIso).filter(Boolean);
  if(!values.length&&fallbackTimestamp){const fallback=coverageIso(fallbackTimestamp);if(fallback)values.push(fallback)}
  values.sort();
  return {latest:values.at(-1)||null,oldest:values[0]||null,status:values.length?'observed':'unknown',field:values.length?(fallbackTimestamp&&!groups.some(group=>Array.isArray(group)&&group.some(row=>row?.updatedAt||row?.fetchedAt))?'catalog.updatedAt':'updated_at/fetched_at'):'not-available'};
}
function coverageFreshness(timestamp){const time=Date.parse(String(timestamp||''));if(!Number.isFinite(time))return {status:'unknown',observedAt:null,ageHours:null};const ageHours=Math.max(0,Math.round((Date.now()-time)/3600000*10)/10);return {status:ageHours<=72?'fresh':'stale',observedAt:new Date(time).toISOString(),ageHours};}
function coverageSources(...groups){return uniqueValues(groups.flatMap(group=>Array.isArray(group)?group:[]).flatMap(row=>[row?.source,row?.imageSource,row?.providerId,row?.provider]))}
function compactCatalogBaseline(game){
  const regions=(game?.regions||[]).map(region=>({
    region:region.region,
    baseline:region.baseline,
    seriesCount:(region.series||[]).length,
    acceptedSeriesCount:(region.series||[]).filter(row=>row?.accepted).length,
    quarantinedSeriesCount:(region.series||[]).filter(row=>row?.baseline?.evidenceStatus==='quarantined').length,
    limitations:region.limitations||[]
  }));
  return {...(game?.baseline||{kind:'unknown',value:null,status:'unknown'}),regions,limitations:game?.limitations||[]};
}
function catalogBaselineReport(series=[]){
  try{return {report:aggregateCatalogBaselines({series}),error:null}}
  catch(error){return {report:aggregateCatalogBaselines(),error:publicReason('catalog baselines failed',error)}}
}
function attachCatalogBaselines(games,report){
  const rows=new Map((report?.games||[]).map(game=>[game.gameId,game]));
  for(const [gameId,game] of Object.entries(games||{}))game.baseline=compactCatalogBaseline(rows.get(gameId));
  return games;
}
// Coverage is aggregated card chunk by card chunk, never the whole catalog at once (about 75k cards, 105k printings and 45k images
// overflowed the 512 MB instance). Every metric either adds up across chunks or is kept as a small ordered set / first-50 sample.
const COVERAGE_SAMPLE_LIMIT=50,COVERAGE_CARD_CHUNK=1000;
function createCoverageAccumulator(){
  return {cards:0,displayableImages:0,chineseNames:0,rarities:0,cardsWithImageUrls:0,cardsWithSeries:0,totalPrintings:0,totalImages:0,seriesIds:new Set(),cardSeries:new Set(),printingSeries:new Set(),sources:[new Set(),new Set(),new Set()],
    health:{urlRecords:0,policyEligibleUrlRecords:0,policyUnknownUrlRecords:0,policyExcludedUrlRecords:0,displayableCards:0,cardCount:0},
    audit:{cards:0,stableIdentityCards:0,unkeyedCards:0,cardsWithPrintings:0,cardsWithImages:0,printingReferences:0,linkedPrintingReferences:0,imageReferences:0,linkedImageReferences:0,orphanPrintings:0,orphanImages:0,crossGameReferences:0,missingImages:{count:0,sampleIds:[]},missingChineseNames:{count:0,sampleIds:[]}},
    providerKeys:new Map(),missingDisplayable:{count:0,sampleIds:[]},timestamp:{latest:null,oldest:null,raw:false}};
}
function accumulateCoverage(acc,cards=[],printings=[],images=[]){
  const rows=Array.isArray(cards)?cards:[],cardIds=new Set(rows.map(card=>card?.id).filter(Boolean)),selectedPrintings=(printings||[]).filter(printing=>cardIds.has(printing?.cardId)),selectedImages=(images||[]).filter(image=>cardIds.has(image?.cardId)),printingByCard=buildPrintingIndex(selectedPrintings),imageByCard=new Map();
  for(const image of selectedImages){const list=imageByCard.get(image.cardId)||[];list.push(image);imageByCard.set(image.cardId,list)}
  const cardHasImageUrl=card=>Boolean((imageByCard.get(card.id)||[]).some(image=>image?.imageUrl)||(printingByCard.get(card.id)||[]).some(printing=>printing?.imageUrl)||card?.imageUrl),cardHasUsableImage=card=>Boolean((imageByCard.get(card.id)||[]).some(browseHasUsableImage)||(printingByCard.get(card.id)||[]).some(browseHasUsableImage)||(card?.imageUrl&&imageRightsAllowDisplay(card.imageRightsStatus,card.imageLicenseExpiresAt,imageSourceOf(card)))),cardHasChineseName=card=>{const zh=String(card?.nameZh||'').trim();return Boolean(zh)&&zh!==String(card?.nameJa||'').trim()},/* 排球少年、芙莉蓮的 nameZh 只是抄日文原名，不算有中文名 */cardHasRarity=card=>browseValues(card,printingByCard.get(card.id)||[],'rarity').length;
  const health=summarizeImageHealth({cards:rows,printings:selectedPrintings,images:selectedImages,isDisplayable:browseHasUsableImage,isPolicyEligible:row=>imageRightsAllowDisplay(row?.imageRightsStatus,row?.imageLicenseExpiresAt,imageSourceOf(row))}),audit=auditCatalogLinks({cards:rows,printings:selectedPrintings,images:selectedImages,providerKeys:acc.providerKeys}),missingDisplayable=rows.filter(card=>!cardHasUsableImage(card)),timestamp=coverageTimestamp(rows,selectedPrintings,selectedImages);
  acc.cards+=rows.length;acc.displayableImages+=rows.length-missingDisplayable.length;acc.chineseNames+=rows.filter(cardHasChineseName).length;acc.rarities+=rows.filter(cardHasRarity).length;acc.cardsWithImageUrls+=rows.filter(cardHasImageUrl).length;acc.cardsWithSeries+=rows.filter(card=>Boolean(card?.seriesId)||Boolean((printingByCard.get(card.id)||[]).some(printing=>printing?.seriesId))).length;acc.totalPrintings+=selectedPrintings.length;acc.totalImages+=selectedImages.length;
  for(const row of rows){if(row?.seriesId){acc.seriesIds.add(row.seriesId);acc.cardSeries.add(String(row.seriesId))}for(const key of [row?.source,row?.imageSource,row?.providerId,row?.provider])if(key)acc.sources[0].add(String(key))}
  for(const printing of selectedPrintings){if(printing?.seriesId)acc.seriesIds.add(printing.seriesId);const set=printing?.seriesId||printing?.localSetCode;if(set)acc.printingSeries.add(String(set));for(const key of [printing?.source,printing?.imageSource,printing?.providerId,printing?.provider])if(key)acc.sources[1].add(String(key))}
  for(const image of selectedImages)for(const key of [image?.source,image?.imageSource,image?.providerId,image?.provider])if(key)acc.sources[2].add(String(key));
  for(const key of Object.keys(acc.health))acc.health[key]+=health[key];
  for(const key of Object.keys(acc.audit))if(typeof acc.audit[key]==='number')acc.audit[key]+=audit[key];
  for(const key of ['missingImages','missingChineseNames']){acc.audit[key].count+=audit[key].count;const room=COVERAGE_SAMPLE_LIMIT-acc.audit[key].sampleIds.length;if(room>0)acc.audit[key].sampleIds.push(...audit[key].sampleIds.slice(0,room))}
  acc.missingDisplayable.count+=missingDisplayable.length;{const room=COVERAGE_SAMPLE_LIMIT-acc.missingDisplayable.sampleIds.length;if(room>0)acc.missingDisplayable.sampleIds.push(...missingDisplayable.slice(0,room).map(card=>card.id))}
  if(timestamp.latest&&(!acc.timestamp.latest||timestamp.latest>acc.timestamp.latest))acc.timestamp.latest=timestamp.latest;
  if(timestamp.oldest&&(!acc.timestamp.oldest||timestamp.oldest<acc.timestamp.oldest))acc.timestamp.oldest=timestamp.oldest;
  if([rows,selectedPrintings,selectedImages].some(group=>group.some(row=>row?.updatedAt||row?.fetchedAt)))acc.timestamp.raw=true;
  return acc;
}
function finishCoverage(acc,gameId,options={}){
  const rowsLength=acc.cards,imageHealth={...summarizeImageHealth(),...acc.health},stableIdentityCards=acc.audit.stableIdentityCards;
  const duplicateProviderKeys=[...acc.providerKeys.entries()].filter(([,ids])=>ids.length>1).map(([key,ids])=>({key:key.replace('\u001f',':'),cardIds:ids}));
  const linkAudit={status:'observed',cards:acc.audit.cards,stableIdentityCards,unkeyedCards:acc.audit.unkeyedCards,cardsWithPrintings:acc.audit.cardsWithPrintings,cardsWithImages:acc.audit.cardsWithImages,printingReferences:acc.audit.printingReferences,linkedPrintingReferences:acc.audit.linkedPrintingReferences,imageReferences:acc.audit.imageReferences,linkedImageReferences:acc.audit.linkedImageReferences,orphanPrintings:acc.audit.orphanPrintings,orphanImages:acc.audit.orphanImages,crossGameReferences:acc.audit.crossGameReferences,duplicateProviderKeys,missingImages:acc.audit.missingImages,missingChineseNames:acc.audit.missingChineseNames,complete:acc.audit.cards>0&&stableIdentityCards===acc.audit.cards&&acc.audit.orphanPrintings===0&&acc.audit.orphanImages===0&&acc.audit.crossGameReferences===0};
  const fallbackText=typeof options.fallbackUpdatedAt==='string'&&options.fallbackUpdatedAt?options.fallbackUpdatedAt:null,fallbackIso=fallbackText?coverageIso(fallbackText):null,hasRows=Boolean(acc.timestamp.latest),observed=hasRows||Boolean(fallbackIso),timestamp={latest:hasRows?acc.timestamp.latest:fallbackIso,oldest:hasRows?acc.timestamp.oldest:fallbackIso,status:observed?'observed':'unknown',field:observed?(fallbackText&&!acc.timestamp.raw?'catalog.updatedAt':'updated_at/fetched_at'):'not-available'};
  const freshness=coverageFreshness(timestamp.latest),cardStatus=options.cardStatus||'complete',printingStatus=options.printingStatus||'complete',imageStatus=options.imageStatus||'complete',cardDenominator=cardStatus==='unknown'?null:rowsLength,imageMetricStatus=imageStatus==='unknown'&&printingStatus==='unknown'?'unknown':imageStatus==='complete'?'complete':imageStatus,coveredSets=uniqueValues([...acc.cardSeries],[...acc.printingSeries]),displayableImages=acc.displayableImages,cardsWithPrintings=acc.audit.cardsWithPrintings;
  const fields={
    cards:coverageMetric(rowsLength,null,cardStatus==='complete'?'observed-total':'unknown',{denominatorStatus:'unknown',note:'目前僅能確認資料庫觀測到的卡片列數；各 IP 可驗證的完整分母尚未提供。'}),
    images:coverageMetric(displayableImages,cardDenominator,imageMetricStatus,{urlRecords:imageHealth.urlRecords,policyEligibleUrlRecords:imageHealth.policyEligibleUrlRecords,policyUnknownUrlRecords:imageHealth.policyUnknownUrlRecords,policyExcludedUrlRecords:imageHealth.policyExcludedUrlRecords,cardsWithImageUrls:acc.cardsWithImageUrls,sampledLoadCount:imageHealth.sampledLoadCount,sampledLoadStatus:imageHealth.sampledLoadStatus}),
    chineseNames:coverageMetric(acc.chineseNames,cardDenominator,cardStatus==='unknown'?'unknown':cardStatus,{field:'tcg_cards.name_zh'}),
    rarity:coverageMetric(acc.rarities,cardDenominator,cardStatus==='unknown'?'unknown':cardStatus,{field:'tcg_cards.rarity or tcg_printings.rarity'}),
    printings:coverageMetric(cardsWithPrintings,cardDenominator,printingStatus==='unknown'?'unknown':printingStatus,{records:acc.totalPrintings}),
    versions:coverageMetric(cardsWithPrintings,cardDenominator,printingStatus==='unknown'?'unknown':printingStatus,{records:acc.totalPrintings,note:'版本以 tcg_printings 的 region/language 列表示。'}),
    identity:coverageMetric(linkAudit.stableIdentityCards,cardDenominator,cardStatus==='unknown'?'unknown':cardStatus,{unkeyedCards:linkAudit.unkeyedCards}),
    missingImages:coverageMetric(displayableImages,cardDenominator,imageMetricStatus,{missing:acc.missingDisplayable.count,sampleIds:acc.missingDisplayable.sampleIds,definition:'cards-without-policy-displayable-image'}),
    missingChineseNames:coverageMetric(cardDenominator===null?null:Math.max(0,rowsLength-linkAudit.missingChineseNames.count),cardDenominator,cardStatus==='unknown'?'unknown':cardStatus,{missing:linkAudit.missingChineseNames.count,sampleIds:linkAudit.missingChineseNames.sampleIds}),
    sourceTimestamp:{value:timestamp.latest,oldest:timestamp.oldest,status:timestamp.status,field:timestamp.field}
  },sources=uniqueValues([...acc.sources[0]],[...acc.sources[1]],[...acc.sources[2]]),expectedCards=options.expectedCards??null;
  return {cards:rowsLength,displayableImages,chineseNames:acc.chineseNames,rarities:acc.rarities,cardsWithImageUrls:acc.cardsWithImageUrls,cardsWithSeries:acc.cardsWithSeries,totalPrintings:acc.totalPrintings,totalImages:acc.totalImages,totalSeries:acc.seriesIds.size,coveredSets,totalSets:coveredSets.length,expectedCards,completeness:expectedCards===null?'未核定':'已核對',sources,sourceTimestamp:timestamp.latest,sourceTimestampStatus:timestamp.status,observationWindow:timestamp,freshness,coverage:fields,fields,linkAudit,imageHealth, imageUrlRecords:imageHealth.urlRecords,policyEligibleImageUrlRecords:imageHealth.policyEligibleUrlRecords,sampledImageLoadCount:imageHealth.sampledLoadCount,sampledImageLoadStatus:imageHealth.sampledLoadStatus,metricStatus:{cards:cardStatus,printings:printingStatus,images:imageStatus,chineseNames:cardStatus,rarities:cardStatus,versions:printingStatus,sourceTimestamp:timestamp.status,expectedTotals:expectedCards===null?'unknown':'complete'},sample:options.sample??false,complete:options.complete??(cardStatus==='complete'&&printingStatus==='complete'&&imageStatus==='complete'),scope:{sample:options.sample??false,complete:options.complete??(cardStatus==='complete'&&printingStatus==='complete'&&imageStatus==='complete'),kind:options.scopeKind||'current-observed-rows',expectedTotal:expectedCards,expectedTotalStatus:expectedCards===null?'unknown':'provided',coveredSets,totalSets:coveredSets.length,freshness,limitations:options.limitations||['目前未取得各 IP 可驗證的完整卡表分母，因此百分比僅表示目前資料列的欄位覆蓋率，不宣稱全系列完整。']}};
}
function buildCoverageGameRaw(gameId,cards=[],printings=[],images=[],options={}){
  return finishCoverage(accumulateCoverage(createCoverageAccumulator(),cards,printings,images),gameId,options);
}
function buildCoverageGame(gameId,cards=[],printings=[],images=[],options={}){
  return adjustCoverageGame(buildCoverageGameRaw(gameId,cards,printings,images,options),options);
}
function adjustCoverageGame(report,options={}){
  if(options.printingStatus!=='unknown'&&options.imageStatus!=='unknown')return report;
  if(options.printingStatus==='unknown'){
    report.rarities=null;
    for(const key of ['rarity','printings','versions'])report.coverage[key]={...report.coverage[key],covered:null,denominator:null,percent:null,status:'unknown'};
    report.metricStatus.rarities='unknown';
  }
  report.displayableImages=null;
  report.cardsWithImageUrls=null;
  report.imageUrlRecords=null;
  report.policyEligibleImageUrlRecords=null;
  report.sampledImageLoadCount=null;
  report.imageHealth=null;
  report.totalPrintings=options.printingStatus==='unknown'?null:report.totalPrintings;
  report.totalImages=options.imageStatus==='unknown'?null:report.totalImages;
  report.coverage.images={...report.coverage.images,covered:null,denominator:null,percent:null,status:'unknown',urlRecords:null,policyEligibleUrlRecords:null,policyUnknownUrlRecords:null,policyExcludedUrlRecords:null,cardsWithImageUrls:null,sampledLoadCount:null};
  report.coverage.missingImages={...report.coverage.missingImages,covered:null,denominator:null,percent:null,status:'unknown',missing:null,sampleIds:[]};
  report.linkAudit={...report.linkAudit,missingImages:{count:null,sampleIds:[]}};
  report.metricStatus.images='unknown';
  report.complete=false;
  report.scope.complete=false;
  report.scope.limitations=[...report.scope.limitations,'圖片或印刷版本關聯查詢失敗；可顯示圖片與缺圖數量暫時無法核定。'];
  return report;
}
function buildFallbackCatalogCoverage(fallback,extra={}){
  const games={};
  for(const game of fallback.games||[]){
    const rows=(fallback.cards||[]).filter(card=>card.game===game.id),printings=rows.flatMap(card=>{const list=Array.isArray(card.printings)&&card.printings.length?card.printings:[{cardId:card.id,region:card.region,language:card.language,localCardNumber:card.officialCardNumber,rarity:card.rarity,imageUrl:card.imageUrl,source:card.imageSource,sourceUrl:card.sourceUrl}];return list.map(printing=>({...printing,cardId:printing.cardId||card.id}))}),images=rows.flatMap(card=>{const list=Array.isArray(card.images)&&card.images.length?card.images:card.imageUrl?[{cardId:card.id,imageUrl:card.imageUrl,source:card.imageSource,sourceUrl:card.sourceUrl}]:[];return list.map(image=>({...image,cardId:image.cardId||card.id}))});
    games[game.id]=buildCoverageGame(game.id,rows,printings,images,{cardStatus:'catalog-file',printingStatus:'catalog-file',imageStatus:'catalog-file',scopeKind:'fallback-catalog-file',sample:true,fallbackUpdatedAt:fallback.updatedAt,limitations:['這是隨版本控管的公開備援資料檔，不是各 IP 完整卡表分母。']});
  }
  const baseline=catalogBaselineReport(),coveredGames=Object.keys(games).filter(gameId=>games[gameId].cards>0),coveredSets=uniqueValues(Object.values(games).flatMap(game=>game.coveredSets||[])),freshness=coverageFreshness(fallback.updatedAt);
  attachCatalogBaselines(games,baseline.report);
  return {totalCards:(fallback.cards||[]).length,totalMatchingRecords:(fallback.cards||[]).length,games,coveredGames,coveredSets,totalSets:coveredSets.length,source:'catalog.json',updatedAt:fallback.updatedAt||null,expectedTotals:{value:null,status:'unknown',reason:'未提供各 IP 可驗證的完整卡表分母'},baselineRegistry:{schemaVersion:baseline.report.schemaVersion,registryVersion:baseline.report.registryVersion,reviewedAt:baseline.report.reviewedAt,status:baseline.report.summary.status,error:baseline.error},freshness,sample:true,complete:false,scope:{sample:true,complete:false,kind:'fallback-catalog-file',expectedTotal:null,expectedTotalStatus:'unknown',totalMatchingRecords:(fallback.cards||[]).length,coveredGames,coveredSets,totalSets:coveredSets.length,freshness,limitations:['資料庫未設定時使用公開備援資料檔；僅代表檔案內可觀測範圍。']},metricStatus:{cards:'catalog-file',printings:'catalog-file',images:'catalog-file',chineseNames:'catalog-file',rarities:'catalog-file',versions:'catalog-file',sourceTimestamp:fallback.updatedAt?'catalog-file':'unknown',expectedTotals:'unknown'},...extra};
}
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
    const printingRelation=createCoverageRelation('tcg_printings',BROWSE_PRINTING_SELECT,'id,cardId:card_id,seriesId:series_id,region,language,localSetCode:local_set_code,localCardNumber:local_card_number,rarity,imageUrl:image_url,sourceUrl:source_url,source,providerId:provider_id,releaseDate:release_date,imageRehostRequired:image_rehost_required'),imageRelation=createCoverageRelation('card_images',BROWSE_IMAGE_SELECT,'id,cardId:card_id,language,source,imageUrl:image_url,sourceUrl:source_url,isPrimary:is_primary,fetchedAt:fetched_at');
    const results=await Promise.all([
      supabaseFetchAll('/tcg_series?select=id,gameId:game_id,region,language,providerId:provider_id,sourceUrl:source_url,updatedAt:updated_at,metadata&order=game_id,region,id').then(rows=>({rows,status:'complete'})).catch(error=>({rows:[],status:'unknown',error:publicReason('coverage series failed',error)})),
      ...[...CATALOG_GAME_IDS].map(gameId=>loadCoverageGame(gameId,printingRelation,imageRelation))
    ]),seriesResult=results[0],cardGroups=results.slice(1),printingResult={status:printingRelation.status,error:printingRelation.error},imageResult={status:imageRelation.status,error:imageRelation.error},games={},allTimestamps=[],baseline=catalogBaselineReport(seriesResult.rows);
    for(const group of cardGroups){
      const options={cardStatus:group.status,printingStatus:printingResult.status,imageStatus:imageResult.status},entry=slimCoverageGame(adjustCoverageGame(finishCoverage(group.acc,group.gameId,options),options));
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
function trendObservationWindow(rows=[]){
  const values=rows.map(row=>coverageIso(row?.updatedAt)).filter(Boolean).sort();
  return {latest:values.at(-1)||null,oldest:values[0]||null,status:values.length?'observed':'unknown',field:values.length?'scraped_at':'not-available'};
}
function trendRecordKey(row){
  const values=[row?.game,row?.setCode,row?.cardCode||row?.cardNumber,row?.cardName].map(value=>String(value||'').trim().toLocaleLowerCase());
  return values.some(Boolean)?values.join('|'):null;
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
        const legacy=await supabaseFetch('/rpc/catalog_health_snapshot',{method:'POST',body:'{}'});
        return {...legacy,metricStatus:{...(legacy.metricStatus||{}),images:'legacy-strict'},healthCompatibilityWarning:`v2 snapshot unavailable: ${v2Error.message}`};
      }
    });
    return {...cached.data,policy:sourcePolicySummary(),cache:cached.cache};
  }catch(error){return {...await loadCatalogCoverage(),policy:sourcePolicySummary(),healthFallbackReason:publicReason('catalog health failed',error)}}
}
function adminAuthorized(req){
  const authorization=String(req.headers.authorization||''),bearer=authorization.startsWith('Bearer ')?authorization.slice(7):null;
  const token=req.headers['x-scrape-token']||bearer;
  return Boolean(process.env.SCRAPE_SECRET&&token===process.env.SCRAPE_SECRET);
}
async function loadAdminCatalogHealth(){
  const [summary,missingChinese,missingSeries,pendingPrintingImages,pendingCardImages]=await Promise.all([
    loadCatalogHealth(),
    supabaseFetch('/tcg_cards?select=id,game:game_id,officialCardNumber:official_card_number,nameJa:name_ja,nameEn:name_en&name_zh=is.null&order=game_id,id&limit=50'),
    supabaseFetch('/tcg_cards?select=id,game:game_id,officialCardNumber:official_card_number,nameZh:name_zh,nameJa:name_ja,nameEn:name_en&series_id=is.null&order=game_id,id&limit=50'),
    supabaseFetch('/tcg_printings?select=id,cardId:card_id,region,language,sourceUrl:source_url,imageRightsStatus:image_rights_status&image_url=not.is.null&image_rights_status=eq.not-provided&order=id&limit=50'),
    supabaseFetch('/card_images?select=id,cardId:card_id,source,sourceUrl:source_url,imageRightsStatus:image_rights_status&image_url=not.is.null&image_rights_status=eq.not-provided&order=id&limit=50')
  ]);
  return {summary,missing:{chineseNames:missingChinese,series:missingSeries},rightsReview:{printings:pendingPrintingImages,images:pendingCardImages},sources:publicSourcePolicies()};
}
const officialProductCache={data:null,expiresAt:0};
function japaneseDate(value){const m=String(value||'').match(/(\d{4})年\s*(\d{1,2})月(\d{1,2})日/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null}
function pokemonProductNameZh(title,type){const replacements=[['強化拡張パック','強化補充包'],['ハイクラスパック','高級補充包'],['拡張パック','補充包'],['スターターセット','起始組合'],['スタートデッキ','起始牌組'],['構築デッキ','構築牌組'],['デッキ','牌組'],['カードファイル','卡冊'],['デッキシールド','卡套'],['デッキケース','牌盒'],['プレイマット','遊戲墊']];let result=String(title||'');for(const [ja,zh] of replacements)result=result.replace(ja,zh);return result===title?`寶可夢${/周辺|サプライ/.test(type)?'周邊':'商品'}｜${title}`:result}
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
const yugiohProductCache={data:null,expiresAt:0};
function usDate(value){const m=String(value||'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:null}
async function loadYugiohOfficialProducts(){
  if(yugiohProductCache.data&&yugiohProductCache.expiresAt>Date.now())return yugiohProductCache.data;
  const categories={
    'booster-pack':'補充包','structure-deck':'構築牌組',tins:'鐵盒','starter-deck':'起始牌組',others:'其他盒裝商品','speed-duel':'快速決鬥商品','tournament-packs':'特典卡',accessories:'周邊道具'
  },pages=await Promise.all(Object.entries(categories).map(async([category,typeZh])=>{const pageUrl=`https://www.yugioh-card.com/en/products/${category}/`,response=await fetch(pageUrl,{headers:{'User-Agent':'CardScope/1.0','Accept-Language':'en'}});if(!response.ok)throw new Error(`YUGIOH_PRODUCTS_${response.status}`);return {category,typeZh,pageUrl,html:await response.text()}})),rows=[];
  for(const {category,typeZh,pageUrl,html} of pages){const re=/<img[^>]+src=["']([^"']+)["'][^>]+alt=["']([^"']+)["'][^>]*>[\s\S]{0,3500}?<p class=["']date["']>Release Date:\s*([^<]+)<\/p>[\s\S]{0,1200}?<a class=["']btn["'] href=["']([^"']+)["']/gi;let match;while((match=re.exec(html))){const name=decodeHtml(match[2].trim()),sourceUrl=new URL(match[4],pageUrl).href,identity=createHash('sha1').update(`${category}:${sourceUrl}`).digest('hex').slice(0,16);rows.push({id:`yugioh-us-product-${identity}`,game:'yugioh',seriesId:null,officialCode:sourceUrl.match(/\/products\/([^/]+)\/?$/)?.[1]?.toUpperCase()||null,productType:typeZh,name,nameZh:`${typeZh}｜${name}`,nameJa:null,nameKo:null,region:'US',language:'en-US',versionLabel:'美版',releaseDate:usDate(match[3]),imageUrl:new URL(match[1],pageUrl).href,imageKind:'sealed-product',source:'yugioh-official-us',sourceUrl,metadata:{catalogSection:category,translationStatus:'category-only'}})}}
  yugiohProductCache.data=rows;yugiohProductCache.expiresAt=Date.now()+6*60*60*1000;return rows;
}
async function loadOnePieceProducts(){const response=await fetch('https://asia-en.onepiece-cardgame.com/products/',{headers:{'User-Agent':'CardScope/1.0','Accept-Language':'en'}});if(!response.ok)throw new Error(`ONEPIECE_PRODUCTS_${response.status}`);const html=await response.text(),items=[],re=/<li class="linkListColBox" data-cat="([^"]+)">[\s\S]*?<a href="([^"]+)" class="linkListColItem">[\s\S]*?<img[^>]+data-src="([^"]+)"[^>]*>[\s\S]*?<h4 class="linkListColTitle">([\s\S]*?)<\/h4>[\s\S]*?<time[^>]+datetime="([^"]+)"/g;let m;while((m=re.exec(html))){const productType=m[1],originalName=decodeHtml(m[4].replace(/<[^>]+>/g,'').trim());items.push({id:`onepiece-${items.length}`,game:'onepiece',name:originalName,nameZh:localizeProductName('onepiece',originalName,productType),region:'ASIA',language:'en',versionLabel:'亞洲英文版',productType,releaseDate:m[5],sealedCount:null,cardsCount:null,imageUrl:new URL(m[3],'https://asia-en.onepiece-cardgame.com/').href,imageKind:'sealed-product',source:'onepiece-official',sourceUrl:new URL(m[2],'https://asia-en.onepiece-cardgame.com/').href,metadata:{translationStatus:'category-only'}})}return items}
async function loadCuratedProducts(){const catalog=await loadFallbackCatalog();return catalog.series.map(s=>({id:`curated-${s.id}`,game:s.game,name:s.nameEn||s.nameJa||s.nameZh,nameZh:s.nameZh,nameJa:s.nameJa,nameKo:s.nameKo||null,officialCode:s.officialCode,region:s.region,language:s.region==='JP'?'ja-JP':s.region==='KR'?'ko-KR':s.region==='TW'?'zh-Hant-TW':'en-US',versionLabel:null,releaseDate:s.releaseDate,sealedCount:null,cardsCount:null,imageUrl:null,imageKind:'series-logo',productType:'系列',source:'curated-official-index',sourceUrl:s.sourceUrl||null}))}
async function loadStoredProducts(){if(!supabaseConfigured())return [];const rows=await supabaseFetchAll('/tcg_products?select=id,game:game_id,seriesId:series_id,officialCode:official_code,productType:product_type,nameZh:name_zh,nameJa:name_ja,name:name_en,nameKo:name_ko,region,language,releaseDate:release_date,imageUrl:image_url,imageKind:image_kind,source,sourceUrl:source_url,metadata&order=release_date.desc.nullslast');return rows.map(row=>({...row,versionLabel:regionLabel(row.region,row.language,row.game),cardsCount:row.metadata?.cardsCount??row.metadata?.total??null}))}
let seriesTranslationCache=null;
async function loadSeriesTranslations(){if(!seriesTranslationCache){const body=JSON.parse(await readFile(join(root,'data','series-zh.json'),'utf8'));seriesTranslationCache=Array.isArray(body.entries)?body.entries:[]}return seriesTranslationCache}
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
  let storedFailed=false;const stored=await loadStoredProducts().catch(()=>{storedFailed=true;return []}),settled=await Promise.allSettled([Promise.resolve(stored),loadCuratedProducts()]),seen=new Set(),all=settled.flatMap(x=>x.status==='fulfilled'?x.value:[]).filter(x=>{if(x.imageKind==='card')return false;if(!['sealed-product','series-logo'].includes(x.imageKind)&&x.imageUrl)return false;const identity=x.imageKind==='sealed-product'?x.id:x.officialCode||x.nameZh||x.nameJa||x.name||x.nameKo||x.id,key=`${x.game}:${x.region}:${x.imageKind||''}:${identity}`;if(seen.has(key))return false;seen.add(key);return true}).map(row=>({...normalizeProduct(row),imageUrl:imageRightsAllowDisplay(row.metadata?.imageRightsStatus,row.metadata?.imageLicenseExpiresAt,imageSourceOf(row))?row.imageUrl:null})).sort((a,b)=>String(b.releaseDate||'').localeCompare(String(a.releaseDate||''))),series=all.filter(x=>x.imageKind==='series-logo'),seriesByCode=new Map(),seriesRowByCode=new Map();
  for(const row of series.filter(x=>x.officialCode)){const key=`${row.game}:${String(row.officialCode).toUpperCase()}`,current=seriesRowByCode.get(key);if(!current||row.region==='TW'){seriesRowByCode.set(key,row);if(row.seriesId)seriesByCode.set(key,row.seriesId)}}
  // Taiwanese series names straight from tcg_series too: series imported from the Taiwanese official card search (ADR 0015) have no series-logo product row.
  const twSeriesNames=new Map();if(supabaseConfigured())try{for(const row of await supabaseFetchAll('/tcg_series?select=game:game_id,code:official_code,nameZh:name_zh,source&region=eq.TW&name_zh=not.is.null')){const key=`${row.game}:${String(row.code||'').toUpperCase()}`;if(!twSeriesNames.has(key)||row.source==='asia-pokemon-card-official-tw')twSeriesNames.set(key,row.nameZh)}}catch(error){console.error('tw series names for products failed',error.message)}
  const configured=new Map((await loadSeriesTranslations()).map(row=>[`${row.game}:${String(row.code||'').toUpperCase()}`,row])),products=all.filter(x=>x.imageKind==='sealed-product').map(x=>{const key=x.officialCode?`${x.game}:${String(x.officialCode).toUpperCase()}`:null,entry=key?configured.get(key):null,crossRegion=x.game==='pokemon'&&key?seriesRowByCode.get(key)||(twSeriesNames.get(key)?{nameZh:twSeriesNames.get(key)}:null):null,metadata={...(x.metadata||{})},original=x.nameJa||x.name||x.nameEn||x.nameKo||'原名待補';let nameZh=x.nameZh;if(entry){nameZh=entry.nameZh;metadata.translationStatus='maintained-map';metadata.translationSource=entry.source}else if(crossRegion?.nameZh){nameZh=`${pokemonProductNameZh(String(x.productType||'商品'),x.productType).replace(String(x.productType||''),'')}｜${crossRegion.nameZh}`;metadata.translationStatus='official-cross-region'}else if(['unofficial','category-only'].includes(metadata.translationStatus)){nameZh=`官方尚未有中文名稱｜${original}`}return {...x,seriesId:x.seriesId||(key?seriesByCode.get(key):null)||null,nameZh,metadata}});
  return storedFailed?{products,series,partial:true}:{products,series};
}
function productFeedMeta({products,series}){
  const games=['pokemon','onepiece','yugioh','haikyuu','weiss-schwarz','dragonball-fw'],counts=rows=>Object.fromEntries(games.map(game=>[game,rows.filter(row=>row.game===game).length]));
  const productSources=[...new Set(products.map(row=>row.source).filter(Boolean))].sort(),seriesSources=[...new Set(series.map(row=>row.source).filter(Boolean))].sort();
  return {productCount:products.length,seriesCount:series.length,productCountsByGame:counts(products),seriesCountsByGame:counts(series),productImageCountsByGame:counts(products.filter(row=>row.imageUrl)),seriesImageCountsByGame:counts(series.filter(row=>row.imageUrl)),productSources,seriesSources,sources:[...new Set([...productSources,...seriesSources])].sort(),warning:'實體商品與系列索引分開計數；系列圖不是卡盒封面。缺少可靠封面時顯示圖片待補，不借用單卡圖。'};
}
function regionLabel(region,language,game){if(region==='JP')return '日版';if(region==='TW')return game==='onepiece'?'亞洲日文版':'台版';if(region==='KR')return '韓版';if(region==='US')return '美版';if(region==='ASIA'&&String(language).startsWith('en'))return '亞洲英文版';return region||language||'版本待確認'}
const REGION_PRIORITY={JP:0,TW:1,US:2,KR:3,ASIA:4};
function comparePrintings(a,b){return (REGION_PRIORITY[a?.region]??9)-(REGION_PRIORITY[b?.region]??9)||Number(Boolean(b?.imageUrl&&!b?.imageRehostRequired))-Number(Boolean(a?.imageUrl&&!a?.imageRehostRequired))||String(b?.releaseDate||'').localeCompare(String(a?.releaseDate||''))}

let fallbackCatalogCache=null;
async function loadFallbackCatalog(){if(!fallbackCatalogCache)fallbackCatalogCache=JSON.parse(await readFile(join(root,'data','catalog.json'),'utf8'));return structuredClone(fallbackCatalogCache)}
const uniqueValues=(...groups)=>[...new Set(groups.flat().filter(Boolean).map(String))];
// With the database online, catalog.json only fills empty fields of rows the database has (keepFallbackOnly false): a demo row the
// database no longer holds (the OP05-119 seed, deleted 2026-10-14) must not come back through the merge. Offline, catalog.json is the catalog.
function mergeCatalogRows(fallbackRows=[],databaseRows=[],{keepFallbackOnly=true}={}){
  const rows=new Map(fallbackRows.map(row=>[row.id,structuredClone(row)]));
  for(const row of databaseRows){const fallback=rows.get(row.id)||{},merged={...fallback,...row};for(const key of ['nameZh','nameJa','nameEn','nameKo','imageSource','sourceUrl'])if(!merged[key])merged[key]=fallback[key]||null;if(!Object.hasOwn(row,'imageUrl'))merged.imageUrl=fallback.imageUrl||null;merged.aliases=uniqueValues(fallback.aliases||[],row.aliases||[]);merged.printings=[...(fallback.printings||[]),...(row.printings||[])];rows.set(row.id,merged)}
  if(!keepFallbackOnly){const ids=new Set(databaseRows.map(row=>row.id));return [...rows.values()].filter(row=>ids.has(row.id))}
  return [...rows.values()];
}
function canonicalizeCatalog(catalog){
  const grouped=new Map();
  for(const physical of catalog.cards||[]){
    const canonicalId=physical.canonicalId||physical.id,existing=grouped.get(canonicalId),derivedPrinting={cardId:physical.id,region:physical.region||null,language:physical.language||null,localSetCode:physical.localSetCode||null,localCardNumber:physical.officialCardNumber||null,imageUrl:physical.imageUrl||null,imageSource:physical.imageSource||null,source:physical.source||null,sourceUrl:physical.sourceUrl||null,imageRightsStatus:physical.imageRightsStatus||'not-provided',imageLicenseExpiresAt:physical.imageLicenseExpiresAt||null,imageRehostRequired:physical.imageRehostRequired===true,releaseDate:physical.releaseDate||null,seriesId:physical.seriesId||null,rarity:physical.rarity||null,nameZh:physical.nameZh||null,nameJa:physical.nameJa||null,nameEn:physical.nameEn||null,nameKo:physical.nameKo||null},printings=(physical.printings?.length?physical.printings:[derivedPrinting]).map(p=>({...derivedPrinting,...p,cardId:p.cardId||physical.id,seriesId:p.seriesId||physical.seriesId||null,localCardNumber:p.localCardNumber||physical.officialCardNumber||null,imageUrl:p.imageUrl||physical.imageUrl||null,imageSource:p.imageSource||physical.imageSource||null,source:p.source||physical.source||null}));
    if(!existing){const usablePrinting=printings.find(browseHasUsableImage);grouped.set(canonicalId,{...physical,id:canonicalId,canonicalId,physicalCardIds:[physical.id],aliases:uniqueValues(physical.aliases||[],physical.nameZh,physical.nameJa,physical.nameEn,physical.nameKo),printings,region:printings[0]?.region||physical.region||null,language:printings[0]?.language||physical.language||null,imageUrl:usablePrinting?.imageUrl||(imageRightsAllowDisplay(physical.imageRightsStatus,physical.imageLicenseExpiresAt,imageSourceOf(physical))?physical.imageUrl:null)});continue}
    existing.physicalCardIds=uniqueValues(existing.physicalCardIds,physical.id);existing.aliases=uniqueValues(existing.aliases,physical.aliases||[],physical.nameZh,physical.nameJa,physical.nameEn,physical.nameKo);existing.printings.push(...printings);for(const key of ['nameZh','nameJa','nameEn','nameKo','rarity','imageUrl','imageSource'])if(!existing[key]&&physical[key])existing[key]=physical[key];
  }
  for(const card of grouped.values()){const seen=new Set();card.printings=card.printings.filter(p=>{const key=[p.id||p.providerId||'',p.cardId,p.region,p.language,p.localSetCode,p.localCardNumber,p.rarity||p.rarityCode||'',p.metadata?.variantKey||p.metadata?.imageId||''].join('|');if(seen.has(key))return false;seen.add(key);return true}).sort(comparePrintings);const preferred=card.printings[0],usable=card.printings.find(browseHasUsableImage);card.region=preferred?.region||card.region||null;card.language=preferred?.language||card.language||null;card.referenceRegion=preferred?.region||null;card.referencePrintingId=preferred?.id||preferred?.cardId||null;card.imageUrl=usable?.imageUrl||(imageRightsAllowDisplay(card.imageRightsStatus,card.imageLicenseExpiresAt,imageSourceOf(card))?card.imageUrl:null);card.printings=card.printings.map(printing=>browseHasUsableImage(printing)?printing:{...printing,imageUrl:null});card.images=(card.images||[]).map(item=>browseHasUsableImage(item)?item:{...item,imageUrl:null})}
  return {...catalog,cards:[...grouped.values()]};
}
// Search and card detail call this on every request; it pages through every series plus a card sample (2-4 s), so keep a successful result
// and share in-flight loads. Once it is older than the TTL, callers still get it at once while one background load refreshes it
// (a request never waits for a reload after the first). Ten minutes keeps those reloads from competing with searches on the small
// database instance; catalog data only changes in batch imports. Callers get a clone because they canonicalize/mutate it.
const CATALOG_CACHE_TTL_MS=Number(process.env.CATALOG_CACHE_TTL_MS??600000);
let catalogCache={value:null,at:0,pending:null};
async function loadCatalog(){
  const refresh=()=>{if(!catalogCache.pending)catalogCache.pending=loadCatalogUncached().then(value=>{if(!value.fallbackReason)catalogCache={value,at:Date.now(),pending:null};else catalogCache.pending=null;return value},error=>{catalogCache.pending=null;throw error});return catalogCache.pending};
  if(catalogCache.value){if(Date.now()-catalogCache.at>=CATALOG_CACHE_TTL_MS)refresh().catch(error=>console.error('catalog refresh failed',error.message));return structuredClone(catalogCache.value)}
  return structuredClone(await refresh());
}
async function loadCatalogUncached(){
  const fallback=await loadFallbackCatalog();
  if(!supabaseConfigured())return canonicalizeCatalog({...fallback,source:'catalog.json'});
  try{
    const [games,series,cards]=await Promise.all([
      supabaseFetch('/tcg_games?select=id,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko&order=id'),
      supabaseFetchAll('/tcg_series?select=id,game:game_id,officialCode:official_code,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,region,language,releaseDate:release_date,aliases,sourceUrl:source_url,imageUrl:image_url,imageKind:image_kind,metadata&order=release_date.desc'),
      supabaseFetch('/tcg_cards?select=id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases&order=created_at.asc&limit=250')
    ]);
    const cardIds=(cards||[]).map(c=>`"${String(c.id).replaceAll('"','')}"`).join(','),[printings,images]=cardIds?await Promise.all([
      supabaseFetchAll(`/tcg_printings?${new URLSearchParams({select:BROWSE_PRINTING_SELECT,card_id:`in.(${cardIds})`})}`),
      supabaseFetch(`/card_images?${new URLSearchParams({select:BROWSE_IMAGE_SELECT,card_id:`in.(${cardIds})`,order:'is_primary.desc,fetched_at.desc',limit:'1000'})}`).catch(()=>[])
    ]):[[],[]];
    const printingByCard=new Map(),imageByCard=new Map();
    for(const p of printings||[]){const list=printingByCard.get(p.cardId)||[];list.push(p);printingByCard.set(p.cardId,list)}
    for(const i of images||[]){const list=imageByCard.get(i.cardId)||[];list.push(i);imageByCard.set(i.cardId,list)}
    const databaseCards=(cards||[]).map(c=>{const ps=printingByCard.get(c.id)||[],imgs=imageByCard.get(c.id)||[],primary=imgs.find(browseHasUsableImage)||ps.find(browseHasUsableImage);return {...c,region:ps[0]?.region||null,language:ps[0]?.language||null,imageUrl:primary?.imageUrl||null,imageSource:primary?.source||null,imageRightsStatus:primary?.imageRightsStatus||null,printings:ps,images:imgs}}),merged={version:3,updatedAt:new Date().toISOString(),source:'supabase+catalog.json',games:mergeCatalogRows(fallback.games,games||[]),series:mergeCatalogRows(fallback.series,series||[],{keepFallbackOnly:false}),cards:mergeCatalogRows(fallback.cards,databaseCards,{keepFallbackOnly:false})};
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

const postgrestLike=s=>String(s||'').replace(/[\\%_*(),.]/g,'').trim();
// TW source names wrap an owner prefix in angle brackets (<火箭隊的>超夢ex); a query typed as printed (火箭隊的超夢) gets one variant per 的 so ilike can still match.
// Anniversary names are written several ways (30th CELEBRATION, 30周年デザイン, 三十週年); any one of them also searches the others.
const chineseNumber=t=>{if(/^\d+$/.test(t))return Number(t);const d={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9},m=t.match(/^([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/);if(!m||(!m[2]&&(!m[1]||m[3])))return null;return m[2]?(m[1]?d[m[1]]:1)*10+(m[3]?d[m[3]]:0):d[m[1]]};
const anniversaryTerms=term=>{const m=String(term).normalize('NFKC').replace(/\s+/g,'').match(/^(\d{1,3}|[一二三四五六七八九十]{1,3})(?:th|周年|週年|thanniversary|anniversary)$/i),n=m&&chineseNumber(m[1]);if(!n)return [];const original=String(term).toLowerCase();return [`${n}th`,`${n}周年`,`${n}週年`].filter(v=>v.toLowerCase()!==original)};
// Every term the database search tries for a query: the query, a mapped alias, markup and anniversary variants.
// rawQuery may be an array (the database's own spellings of the query, see foldedNameSpans); the alias mapping follows the first one.
const searchQueryTerms=rawQuery=>{const raws=[].concat(rawQuery),mapped=externalAliasIndex.get(normalizeSearch(raws[0]))?.query;return [...new Set([...raws,mapped].filter(Boolean).map(postgrestLike).filter(Boolean).flatMap(term=>[term,...sourceMarkupTerms(term),...anniversaryTerms(term),...cardNumberTerms(term)]))]};
// 「SV6a 090」（系列代碼、空格、卡號）在資料裡寫成「SV6a-090」；「OP-17-118」寫成「OP17-118」、「BETB EN060」寫成「BETB-EN060」。
// 分隔符號（空白、連字號）一律視為同一種：除了最後一段以外接起來當系列代碼，再以 - 接卡號；卡號是 1–2 位數時另補成三位數。
const cardNumberTerms=term=>{const text=String(term).trim(),tokens=text.split(/[\s\-‐-―]+/).filter(Boolean),head=tokens.slice(0,-1).join(''),last=tokens.at(-1)||'';if(tokens.length<2||tokens.length>3||!tokens.every(t=>/^[a-z0-9]+$/i.test(t))||!/^[a-z]{1,5}\d{0,3}[a-z]?$/i.test(head)||!/^[a-z]{0,3}\d{1,4}$/i.test(last))return [];const spellings=[`${head}-${last}`];if(/^\d{1,2}$/.test(last))spellings.push(`${head}-${last.padStart(3,'0')}`);return spellings.filter(v=>v.toLowerCase()!==text.toLowerCase())};
const sourceMarkupTerms=term=>{if(term.includes('<'))return [];const variants=[];for(let i=term.indexOf('的');i>0&&i<term.length-1&&variants.length<3;i=term.indexOf('的',i+1))variants.push(`<${term.slice(0,i+1)}>${term.slice(i+1)}`);return variants};
// Repeated searches within a minute reuse the answer (same freshness as the catalog cache); at most 200 queries, least recently used dropped first.
// Catalog data only changes in batch imports, so a 10-minute search result cache is safe; 200 entries stay within a few tens of MB.
const SEARCH_CACHE_TTL_MS=600000,SEARCH_CACHE_MAX=200,searchCache=new Map();
function recallSearch(key){const hit=searchCache.get(key);if(!hit)return null;searchCache.delete(key);if(Date.now()-hit.at>=SEARCH_CACHE_TTL_MS)return null;searchCache.set(key,hit);return hit.body}
function rememberSearch(key,body){searchCache.delete(key);searchCache.set(key,{at:Date.now(),body});while(searchCache.size>SEARCH_CACHE_MAX)searchCache.delete(searchCache.keys().next().value)}
const SEARCH_CANDIDATE_LIMIT=100;
const SEARCH_RESULT_LIMIT=40,SEARCH_PAGE_MAX=100;
// search_cards_ranked(..., p_offset, p_rarities) (migration 20261019090000) pages, filters by rarity and returns matchRank; while it is missing the four-argument version answers (first page only) and this is not retried for five minutes.
let rankedPageMissingUntil=0;
// 0 exact, 1 starts with, 2 contains (names and card number only), 3 matched only by alias, text or series. Same scale as the database's matchRank.
const cardMatchRank=(card,needles)=>{const names=[card.nameZh,card.nameJa,card.nameEn,card.nameKo,card.officialCardNumber].map(normalizeSearch).filter(Boolean);if(names.some(name=>needles.includes(name)))return 0;if(names.some(name=>needles.some(needle=>name.startsWith(needle))))return 1;if(names.some(name=>needles.some(needle=>name.includes(needle))))return 2;return 3};
// The fallbacks below exist for older databases (function missing, unexpected shape). A timeout means the
// database is busy, and the heavier fallback queries would only time out in turn (seen chaining to 30 s+
// in the Render logs); give up so /api/search answers from the loaded catalog with databaseSearch 'unavailable'.
const searchTimedOut=error=>/57014|statement timeout|aborted due to timeout|TimeoutError/i.test(`${error?.name||''} ${error?.message||error||''}`);
// A search that found nothing is retried with the database's own spelling when only spaces, middle dots or hyphens differ (日向翔陽 -> 日向 翔陽, OP-17-118 -> OP17-118):
// search_fold_names (migration 20261023140000) lists names whose folded form contains the folded query; we cut the matching span out of each. Fewer than 3 folded characters has no trigram index, so no retry.
async function foldedNameSpans(name){
  const folded=foldSearch(name);if(folded.length<3)return [];
  try{const rows=await supabaseFetch('/rpc/search_fold_names',{method:'POST',body:JSON.stringify({p_fold:folded,p_limit:5})});return [...new Set((Array.isArray(rows)?rows:[]).map(row=>foldedSpan(row?.name,folded)).filter(span=>span&&span.toLowerCase()!==String(name).trim().toLowerCase()))].slice(0,3)}
  catch(error){console.error('search fold retry failed',error.message);return []}
}
// Typo help for a search with no result: search_name_suggestion (migration 20261023150000, pg_trgm on the card names) returns the closest name, or NULL when nothing is close. Called only on zero results.
async function suggestCardName(name,region){
  const query=String(name||'').trim();if(query.length<3)return null;
  try{const value=await supabaseFetch('/rpc/search_name_suggestion',{method:'POST',body:JSON.stringify({p_q:query,p_region:region==='ALL'?null:region})}),text=typeof value==='string'?value.trim():'';return text&&text.toLowerCase()!==query.toLowerCase()?{q:text,reason:'相近的卡名'}:null}
  catch(error){console.error('search name suggestion failed',error.message);return null}
}
async function searchCatalogDatabase(rawQuery,region='ALL',limit=SEARCH_RESULT_LIMIT,{offset=0,rarities=[]}={}){
  const rarityValues=rarityMatchValues(rarities),filtered=region!=='ALL'||rarityValues.length>0;
  if(!supabaseConfigured())return {cards:[],candidateCount:0,candidateLimit:SEARCH_CANDIDATE_LIMIT,resultLimit:limit,mayHaveMore:false,searched:false};
  const terms=searchQueryTerms(rawQuery);if(!terms.length)return {cards:[],candidateCount:0,candidateLimit:SEARCH_CANDIDATE_LIMIT,resultLimit:limit,mayHaveMore:false,searched:false};
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
  // The paging/filtering version first (every parameter named, nulls included, as PostgREST resolves the function by name); missing or malformed -> the four-argument version, which only knows the first 100 groups.
  let ranked=null,paged=false;
  if(Date.now()>=rankedPageMissingUntil){try{ranked=await rankedCall({p_patterns:patterns,p_needles:terms,p_limit:limit,p_region:regionArg,p_offset:offset,p_rarities:rarityValues.length?rarityValues:null});paged=rankedShape(ranked)}catch(error){if(searchTimedOut(error))throw error;if(/PGRST202|SUPABASE_404/.test(error.message))rankedPageMissingUntil=Date.now()+300000;console.error('search ranked page rpc failed; trying the four-argument search_cards_ranked',error.message)}}
  if(!paged){ranked=null;try{ranked=await rankedCall({p_patterns:patterns,p_needles:terms,p_limit:Math.min(offset+limit,SEARCH_PAGE_MAX),p_region:regionArg})}catch(error){if(searchTimedOut(error))throw error;console.error('search ranked rpc failed; trying search_cards_with_siblings',error.message)}}
  const viaRanked=Boolean(ranked&&Array.isArray(ranked.cards)&&Number.isFinite(Number(ranked.matchCount))),rankedHits=viaRanked&&ranked.cards.length>0;
  let rpc=null;if(!viaRanked){try{rpc=await timed('rpc',supabaseFetch('/rpc/search_cards_with_siblings',{method:'POST',body:JSON.stringify({p_patterns:patterns,p_limit:SEARCH_CANDIDATE_LIMIT})}))}catch(error){if(searchTimedOut(error))throw error;console.error('search rpc failed; using PostgREST queries',error.message)}}
  const viaRpc=Boolean(rpc&&Array.isArray(rpc.hits)&&Array.isArray(rpc.siblings));
  let cards=rankedHits?ranked.cards.map(({hit,...card})=>card):viaRanked?[]:viaRpc&&rpc.hits.length?rpc.hits:viaRpc?[]:await timed('names',query(['name_zh','name_ja','name_en','name_ko','official_card_number'])),matchedSeries=rankedHits&&ranked.matchedBy==='series'?Number(ranked.matchedSeries)||1:0;
  // search_cards_ranked already tried search_text (when it reports matchedBy) and series names (matchedSeries); cards it matched but the region filter removed end the search.
  const rankedMatched=viaRanked&&Number(ranked.matchCount)>0;if(!cards?.length&&!(viaRanked&&'matchedBy' in ranked))cards=await timed('text',query(['search_text']));
  // No card matched by name or text: fall back to series names/codes (e.g. 「ナイトワンダラー」, "SV6a") and list that series' cards in card-number order.
  if(!cards?.length&&!rankedMatched&&!(viaRanked&&'matchedSeries' in ranked)){const seriesFilters=[];for(const term of terms)for(const column of ['name_zh','name_ja','name_en','name_ko','official_code'])seriesFilters.push(`${column}.ilike.*${term}*`);const series=await supabaseFetch(`/tcg_series?${new URLSearchParams({select:'id',or:`(${seriesFilters.join(',')})`,limit:'5'})}`);if(series?.length){matchedSeries=series.length;const seriesIds=series.map(s=>`"${String(s.id).replaceAll('"','')}"`).join(','),rows=await supabaseFetch(`/tcg_printings?${new URLSearchParams({select:'cardId:card_id',series_id:`in.(${seriesIds})`,order:'series_id.asc,local_card_number.asc,card_id.asc',limit:String(SEARCH_CANDIDATE_LIMIT)})}`),cardIds=[...new Set((rows||[]).map(r=>r.cardId))];if(cardIds.length){const order=new Map(cardIds.map((id,index)=>[id,index]));cards=(await cardsFetch({id:`in.(${cardIds.map(id=>`"${String(id).replaceAll('"','')}"`).join(',')})`,limit:String(SEARCH_CANDIDATE_LIMIT)})||[]).sort((a,b)=>(order.get(a.id)??SEARCH_CANDIDATE_LIMIT)-(order.get(b.id)??SEARCH_CANDIDATE_LIMIT))}}}
  if(!cards?.length)return {cards:[],candidateCount:0,candidateLimit:SEARCH_CANDIDATE_LIMIT,resultLimit:limit,mayHaveMore:false,searched:true,matchedSeries,timings,...(paged&&offset&&Number(ranked.groupCount)>0?{total:Number(ranked.groupCount),paged}:{})};
  const needles=terms.map(normalizeSearch),score=card=>{const names=[card.nameZh,card.nameJa,card.nameEn,card.nameKo,...(card.aliases||[]),card.officialCardNumber].map(normalizeSearch).filter(Boolean);if(names.some(name=>needles.some(needle=>name===needle)))return 0;if(names.some(name=>needles.some(needle=>name.startsWith(needle))))return 1;if(names.some(name=>needles.some(needle=>name.includes(needle))))return 2;return 3};if(!matchedSeries&&!rankedHits)cards.sort((a,b)=>score(a)-score(b)||String(a.nameEn||a.nameZh||'').localeCompare(String(b.nameEn||b.nameZh||'')));
  // Pull in the other cards of each matched canonical (e.g. the TW twin of a JP card, ADR 0003) so one result lists every printing; a failure here only loses the extra printings.
  const candidateCount=rankedHits?Number(ranked.matchCount):cards.length,knownIds=new Set(cards.map(c=>c.id)),canonicalIds=[...new Set(cards.map(c=>c.canonicalId).filter(Boolean))];
  if(canonicalIds.length&&viaRpc&&!matchedSeries&&rpc.hits.length){for(const sibling of rpc.siblings)if(!knownIds.has(sibling.id)){knownIds.add(sibling.id);cards.push(sibling)}}
  else if(canonicalIds.length&&!rankedHits){try{const siblings=await timed('siblings',cardsFetch({canonical_id:`in.(${canonicalIds.map(id=>`"${String(id).replaceAll('"','')}"`).join(',')})`,limit:String(SEARCH_CANDIDATE_LIMIT*2)}));for(const sibling of siblings||[])if(!knownIds.has(sibling.id)){knownIds.add(sibling.id);cards.push(sibling)}}catch(error){console.error('search sibling cards failed',error.message)}}
  // Card queries embed their printings, saving a round trip; rows that come back without the embed still get a separate printing fetch.
  const unembedded=cards.filter(c=>!Array.isArray(c.printings)),ids=unembedded.map(c=>`"${String(c.id).replaceAll('"','')}"`).join(','),printings=[...cards.flatMap(c=>Array.isArray(c.printings)?c.printings:[]),...(ids?await timed('printings',supabaseFetch(`/tcg_printings?${new URLSearchParams({select:BROWSE_PRINTING_SELECT,card_id:`in.(${ids})`,limit:'1000'})}`))||[]:[])],byCard=new Map();
  for(const p of printings){if((region!=='ALL'&&p.region!==region)||!printingMatchesRarity(p,rarityValues))continue;const list=byCard.get(p.cardId)||[];list.push(p);byCard.set(p.cardId,list)}
  const canonicalCards=canonicalizeCatalog({cards:cards.filter(c=>!filtered||byCard.has(c.id)).map(c=>({...c,printings:byCard.get(c.id)||[],region:byCard.get(c.id)?.[0]?.region||null,language:byCard.get(c.id)?.[0]?.language||null,...cardImageFields(c,byCard.get(c.id))}))}).cards;
  // Paged answers are already one page in the database's order; older paths slice here. total is the real number of canonical cards (paged), a lower bound otherwise.
  const page=paged?canonicalCards.slice(0,limit):canonicalCards.slice(offset,offset+limit),total=paged?Math.max(Number(ranked.groupCount)||0,offset+page.length):rankedHits&&!rarityValues.length?Math.max(Number(ranked.groupCount)||0,page.length):canonicalCards.length;
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
async function loadCardFromDatabase(cardId){
  if(!supabaseConfigured())return null;const viaRpc=await loadCardDetailRpc(cardId);if(viaRpc!==undefined)return viaRpc;const safe=String(cardId).replace(/[(),]/g,''),cardSelect='id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases,metadata',params=new URLSearchParams({select:cardSelect,or:`(id.eq.${safe},canonical_id.eq.${safe})`,limit:'100'}),cards=await supabaseFetch(`/tcg_cards?${params}`);if(!cards?.length)return null;
  // A card linked into another canonical (e.g. a JP card joining its TW twin, ADR 0003) must bring that canonical's other printings along.
  const knownIds=new Set(cards.map(c=>c.id)),siblingCanonicals=[...new Set(cards.map(c=>c.canonicalId).filter(id=>id&&id!==safe))];
  if(siblingCanonicals.length){const siblings=await supabaseFetch(`/tcg_cards?${new URLSearchParams({select:cardSelect,canonical_id:`in.(${siblingCanonicals.map(id=>`"${String(id).replaceAll('"','')}"`).join(',')})`,limit:'100'})}`);for(const sibling of siblings||[])if(!knownIds.has(sibling.id)){knownIds.add(sibling.id);cards.push(sibling)}}
  const ids=cards.map(c=>`"${String(c.id).replaceAll('"','')}"`).join(','),printingParams=new URLSearchParams({select:BROWSE_PRINTING_SELECT,card_id:`in.(${ids})`,limit:'1000'}),printings=await supabaseFetch(`/tcg_printings?${printingParams}`),byCard=new Map();for(const p of printings||[]){const list=byCard.get(p.cardId)||[];list.push(p);byCard.set(p.cardId,list)}
  const hydrated=cards.map(c=>({...c,printings:byCard.get(c.id)||[],region:byCard.get(c.id)?.[0]?.region||null,language:byCard.get(c.id)?.[0]?.language||null,imageUrl:byCard.get(c.id)?.find(p=>p.imageUrl&&!p.imageRehostRequired)?.imageUrl||null})),canonical=canonicalizeCatalog({cards:hydrated}).cards.find(c=>c.id===cardId)||canonicalizeCatalog({cards:hydrated}).cards[0],seriesIds=[...new Set((canonical?.printings||[]).map(p=>p.seriesId).concat(canonical?.seriesId).filter(Boolean))],series=seriesIds.length?await supabaseFetch(`/tcg_series?select=id,game:game_id,officialCode:official_code,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,region,releaseDate:release_date&${new URLSearchParams({id:`in.(${seriesIds.map(x=>`"${x}"`).join(',')})`})}`):[],games=await supabaseFetch(`/tcg_games?select=id,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko&id=eq.${encodeURIComponent(canonical.game)}`);return {catalog:{source:'supabase-full-catalog',cards:[canonical],series:series||[],games:games||[]},card:canonical};
}
// The detail page and its market tab ask for the same card at once: share the database load and keep it briefly.
const CARD_CACHE_TTL_MS=600000,CARD_CACHE_MAX=500,cardCache=new Map();
function loadCardCached(cardId){const hit=cardCache.get(cardId);if(hit&&(hit.pending||Date.now()-hit.at<CARD_CACHE_TTL_MS))return hit.promise;const entry={pending:true,at:0,promise:null};entry.promise=loadCardFromDatabase(cardId).then(value=>{entry.pending=false;entry.at=Date.now();if(!value)cardCache.delete(cardId);return value},error=>{cardCache.delete(cardId);throw error});cardCache.set(cardId,entry);while(cardCache.size>CARD_CACHE_MAX)cardCache.delete(cardCache.keys().next().value);return entry.promise}
async function getCard(cardId){const fromDatabase=supabaseConfigured()?loadCardCached(cardId).catch(()=>null):Promise.resolve(null),catalog=await loadCatalog(),card=catalog.cards.find(c=>c.id===cardId);if(card)return {catalog,card};const found=await fromDatabase;return found?structuredClone(found):{catalog,card:null}}
// eq. takes the value literally (URLSearchParams does the URL encoding); the old ilike-style backslash escaping made card numbers containing . _ % never match.
async function yuyuteiMarket(card,fx){if(!supabaseConfigured()||!card.officialCardNumber)return [];const params=new URLSearchParams({select:'cardName:card_name,cardNumber:card_number,rarity,price,currency,cardUrl:card_url,imageUrl:image_url,setCode:set_code,setName:set_name,scrapedAt:scraped_at',card_number:`eq.${card.officialCardNumber}`,order:'scraped_at.desc',limit:'10'}),rows=await supabaseFetch(`/jp_buyback_prices?${params}`);return (rows||[]).map(r=>({...withTwd(normalizeMarketRecord({provider:'yuyutei',market:'JP',cardId:card.id,cardName:r.cardName,cardNumber:r.cardNumber,setCode:r.setCode,rarity:r.rarity,language:'ja-JP',priceType:'buyback',amount:r.price,currency:r.currency,imageUrl:r.imageUrl,sourceUrl:r.cardUrl,observedAt:r.scrapedAt}),fx),region:'JP'}))}
// ADR 0037: series where official-import JP cards were checked against TCGdex (unique card numbers, Japanese names present). Evidence: docs/evidence/pokemon-jp/tcgdex-pricing-official-match-20261013.json
// ADR 0038: US (PokemonTCG) series mapped to TCGdex English sets by card-by-card comparison. Evidence: docs/evidence/pokemon-us/tcgdex-en-match-20261013.json
const TCGDEX_EN_SET_MAP=JSON.parse(await readFile(new URL('./data/tcgdex-en-set-map.json',import.meta.url),'utf8')).sets;
// 與每日參考價快照共用同一套查詢規則（providers/tcgdex-pricing.mjs 的 tcgdexLookupForPrinting）。
function tcgdexLookups(card){const seen=new Map();for(const x of [card,...(card.printings||[])]){const l=tcgdexLookupForPrinting(x,card,{enSetMap:TCGDEX_EN_SET_MAP});if(l&&!seen.has(`${l.language}:${l.id}`))seen.set(`${l.language}:${l.id}`,l)}return [...seen.values()].slice(0,3)}
// 跨版本價格對照（詳細頁「價格」分頁，只並列、不排名、不加總、不混來源與價格種類）。每個 printing（一個 tcg_cards 列）一組，prices 只放「這個 printing」自己的價格：
//  * 該 printing 自己的每日參考價快照（price_snapshots，只取 7 天內）永遠屬於它；
//  * 即時行情（records，只帶地區）只在同一地區只有一個 printing 時才能確定屬於它；同地區有多個 printing 就不掛，避免把別版的價格放到這一版。
// 即時行情與快照來源相同（同一平台＋variant）時只留即時的一筆。沒有任何價格的版本 prices 為空，由介面寫「目前沒有可靠價格」。
const VERSION_REGION_ORDER=['JP','TW','US','KR','ASIA'],SNAPSHOT_SOURCE_NAMES={cardmarket:'Cardmarket',tcgplayer:'TCGplayer'};
function buildVersionPrices(card,records=[],snapshotCards=[],{fx=null}={}){
  const printings=new Map();
  for(const p of card?.printings||[])if(p?.cardId&&!printings.has(p.cardId))printings.set(p.cardId,p);
  if(!printings.size&&card?.id)printings.set(card.id,{cardId:card.id,region:card.region,language:card.language,localCardNumber:card.officialCardNumber});
  const perRegion=new Map();for(const p of printings.values())perRegion.set(p.region||'',(perRegion.get(p.region||'')||0)+1);
  const snapshots=new Map((snapshotCards||[]).map(entry=>[entry.cardId,entry.prices||[]])),order=region=>{const index=VERSION_REGION_ORDER.indexOf(region);return index<0?VERSION_REGION_ORDER.length:index};
  const text=(a,b)=>a<b?-1:a>b?1:0;
  return [...printings.values()].sort((a,b)=>order(a.region)-order(b.region)||text(String(a.localCardNumber||''),String(b.localCardNumber||''))||text(String(a.cardId),String(b.cardId))).map(p=>{
    const live=perRegion.get(p.region||'')===1?(records||[]).filter(r=>r?.region===p.region&&Number.isFinite(Number(r.amount))).map(r=>({provider:r.provider,source:r.provider==='yuyutei'?'遊々亭':(r.market||r.provider),priceType:r.priceType,variant:r.variant||'',currency:r.currency,amount:Number(r.amount),amountTwd:r.priceTwd??amountToTwd(r.amount,r.currency,fx),observedAt:r.observedAt||null,origin:'market'})):[];
    const has=new Set(live.filter(r=>r.priceType==='market').map(r=>`${r.source}|${r.variant}`));
    const snapshot=(snapshots.get(p.cardId)||[]).filter(r=>!r.stale&&SNAPSHOT_SOURCE_NAMES[r.provider]&&!has.has(`${SNAPSHOT_SOURCE_NAMES[r.provider]}|${r.variant||''}`)).map(r=>({provider:r.provider,source:SNAPSHOT_SOURCE_NAMES[r.provider],priceType:'market',variant:r.variant||'',currency:r.currency,amount:r.amount,amountTwd:r.amountTwd??null,observedAt:r.snapshotDate?`${r.snapshotDate}T00:00:00.000Z`:null,origin:'snapshot'}));
    return {cardId:p.cardId,region:p.region||null,language:p.language||null,localSetCode:p.localSetCode||null,localCardNumber:p.localCardNumber||null,variantName:p.metadata?.variantName||null,prices:[...live,...snapshot].sort((a,b)=>text(a.source,b.source)||text(a.priceType,b.priceType)||text(a.variant,b.variant))};
  });
}
// Snapshots of every printing of the card (the same read as the collection valuation); a failure only means the table falls back to the live records.
async function loadVersionSnapshots(card,fx){
  const ids=priceHistoryCardIds(card,card?.id);if(card?.game!=='pokemon'||ids.length<2||!supabaseConfigured())return [];
  try{return buildReferencePrices(await supabaseFetch(`/price_snapshots?${new URLSearchParams(referenceQueryParams(ids))}`),ids,{fx,amountToTwd}).cards}catch(error){console.error('version price snapshots failed',error.message);return []}
}
async function unifiedMarket(card){
  const fx=await getTwdRates(),snapshotsPending=loadVersionSnapshots(card,fx),tasks=sourceDisplayDenied('yuyutei')?[]:[['yuyutei',()=>yuyuteiMarket(card,fx)]];
  // 只顯示「這個 printing」的價：YGOPRODeck 的 card_prices 是跨版本最低價，不能當單一版本的價；改用 card_sets[].set_price，依 printing 卡號＋稀有度精確配對，配不到就不顯示（日版 -JP 一律不配）。
  // set_price 的來源平台 YGOPRODeck 文件只寫「$ value」，所以標「YGOPRODeck 參考價（USD）」，不稱 TCGplayer 或成交價。
  if(card.game==='yugioh')tasks.push(['ygoprodeck',async()=>{const wanted=String(card.nameEn||'').trim().toLowerCase();if(!wanted)return [];const found=await searchYgoProDeck(card.nameEn,{limit:20}),match=found.find(x=>String(x.name).trim().toLowerCase()===wanted);if(!match)return [];
    const printings=card.printings?.length?card.printings.map(p=>({number:p.localCardNumber,rarity:p.rarity,region:p.region})):[{number:card.officialCardNumber,rarity:card.rarity,region:card.region}],seen=new Set(),rows=[];
    for(const p of printings){if(p.region==='JP')continue;const set=matchYgoprodeckSet(match.sets,p),key=set&&`${set.setCode}|${set.rarity}`;if(!set||seen.has(key))continue;seen.add(key);rows.push({...withTwd(normalizeMarketRecord({provider:'ygoprodeck',market:'YGOPRODeck',cardId:card.id,providerCardId:match.providerCardId,cardName:match.name,cardNumber:set.setCode,setCode:set.setCode,rarity:set.rarity,priceType:'market',amount:set.setPriceUsd,currency:'USD',observedAt:match.observedAt}),fx),region:p.region||null,scope:'printing-set-price'})}
    if(!rows.length)rows.notice='沒有這個版本的 YGOPRODeck set price；不顯示跨版本最低價。';return rows}]);
  // ADR 0036/0037: tcgdex-ja printings by provider_id; official-import JP printings only in checked series and only when TCGdex's Japanese name matches. No TW or US mapping. The registry switch stops it.
  if(card.game==='pokemon'&&catalogCollectionAllowed('tcgdexPricing')){const lookups=tcgdexLookups(card);if(lookups.length)tasks.push(['tcgdex',async()=>(await Promise.all(lookups.map(x=>(x.language==='en'?fetchTcgdexPricingEn:fetchTcgdexPricing)(x.id,{expectedName:x.expectedName}).then(rows=>rows.map(r=>({...r,en:x.language==='en'})))))).flat().map(r=>({...withTwd(normalizeMarketRecord({provider:r.provider,market:r.market,cardId:card.id,providerCardId:r.providerCardId,cardName:r.en?(card.nameEn||card.nameZh):(card.nameJa||card.nameZh),cardNumber:card.officialCardNumber,language:r.en?'en-US':'ja-JP',priceType:r.priceType,amount:r.amount,currency:r.currency,sourceUrl:r.sourceUrl,observedAt:r.observedAt}),fx),variant:r.variant,idProduct:r.idProduct,region:r.en?'US':'JP'}))])}
  const settled=await Promise.all(tasks.map(async([source,run])=>{try{return {source,status:'ok',data:await run()}}catch(error){return {source,status:'unavailable',error:publicReason(`market source ${source} failed`,error)}}})),records=settled.flatMap(x=>Array.isArray(x.data)?x.data:[]);
  // 上游把不同的卡對到同一個 Cardmarket 商品時標出來（price_products_shared）；查不到就不標，不影響價格本身。
  let sharedPriceCardIds=[];if(card.game==='pokemon'&&supabaseConfigured()&&records.some(r=>r.market==='Cardmarket')){try{sharedPriceCardIds=(await supabaseFetch('/rpc/price_products_shared',{method:'POST',body:JSON.stringify({p_ids:priceHistoryCardIds(card,card.id)})}))||[]}catch(error){console.error('price shared lookup failed',error.message)}}
  return {records,versions:buildVersionPrices(card,records,await snapshotsPending,{fx}),sources:settled.map(x=>({source:x.source,status:x.status,error:x.error||null,notice:x.data?.notice||null})),meta:{sharedPriceCardIds,exchangeRates:fx,priceTypes:{listing:'最低掛牌價',buyback:'店家買取／回收',market:'平台參考價',sale:'可驗證成交',user_report:'使用者回報（未驗證）'},warning:'不同價格性質不混算中位價；目前沒有可靠成交來源時，不顯示成交價或交易量。'}}
}

// ADR 0042：參考價走勢（public.price_snapshots，只存平台參考價）。同作品層的實體卡各自成線；每條線只屬於一張實體卡＋來源＋variant，不合併。台幣以今日匯率換算。
const PRICE_HISTORY_DAYS=180,PRICE_HISTORY_TTL_MS=3600000,PRICE_HISTORY_CACHE_MAX=300,PRICE_HISTORY_IDS_MAX=30,priceHistoryCache=new Map();
// ADR 0046：30 天前的列在私有 Storage bucket `price-archive`（分片 gzip JSON），讀取時與資料庫的列合併成同一份資料；沒有設定 Supabase 就沒有封存。
const archiveStorage=createArchiveStorage(),archiveReader=createArchiveReader({storage:archiveStorage});
// 來源名稱依資料實際有的列出：TCGdex 現在不回 TCGplayer，快照裡的 TCGplayer 只到舊日期，不寫死兩個平台。
const PRICE_SOURCE_LABELS={cardmarket:'Cardmarket',tcgplayer:'TCGplayer'};
const priceHistoryNote=series=>{const names=[...new Set((series||[]).map(x=>PRICE_SOURCE_LABELS[x.provider]).filter(Boolean))];return `參考價為${names.length?` ${names.join('／')} 的`:''}平台參考價（經 TCGdex 轉供），不是成交價或台灣行情；新台幣以今日匯率換算，歷史點位不代表當時匯率。`};
function priceHistoryCardIds(card,requestedId){return [...new Set([requestedId,card?.id,...(card?.printings||[]).map(p=>p.cardId)].filter(id=>typeof id==='string'&&id))].slice(0,PRICE_HISTORY_IDS_MAX)}
function buildPriceHistory(rows,{card,requestedId,fx,now=Date.now()}){
  const groups=new Map(),regionOf=cardId=>(card?.printings||[]).find(p=>p.cardId===cardId)?.region||(card?.id===cardId?card.region:null)||null;
  for(const row of rows||[]){const amount=Number(row.amount);if(!row?.card_id||!row.snapshot_date||!Number.isFinite(amount))continue;const key=JSON.stringify([row.card_id,row.provider,row.variant||'',row.currency]);let group=groups.get(key);if(!group){group={cardId:row.card_id,region:regionOf(row.card_id),provider:row.provider,variant:row.variant||'',currency:row.currency,points:[]};groups.set(key,group)}group.points.push({date:String(row.snapshot_date).slice(0,10),amount,amountTwd:amountToTwd(amount,row.currency,fx),observedAt:row.observed_at||null})}
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
  const body=buildPriceHistory(mergeSnapshotRows(rows,archived),{card,requestedId,fx});if(archiveUnavailable)body.meta.archiveUnavailable=true;return body;
}
// 一小時快取（以請求的卡片 ID 為鍵、合併同時的請求）；失敗不快取。
function priceHistoryCached(card,requestedId){const hit=priceHistoryCache.get(requestedId);if(hit&&(hit.pending||Date.now()-hit.at<PRICE_HISTORY_TTL_MS))return hit.promise;const entry={pending:true,at:0,promise:null};entry.promise=loadPriceHistory(card,requestedId).then(value=>{entry.pending=false;entry.at=Date.now()-(value.meta?.archiveUnavailable?PRICE_HISTORY_TTL_MS-60000:0);return value},error=>{priceHistoryCache.delete(requestedId);throw error});priceHistoryCache.set(requestedId,entry);while(priceHistoryCache.size>PRICE_HISTORY_CACHE_MAX)priceHistoryCache.delete(priceHistoryCache.keys().next().value);return entry.promise}
// 參考價漲跌榜（/api/price-movers）：資料庫函式 price_movers 算好排名，這裡只換算新台幣；一小時快取、合併同時的請求，失敗不快取。
const PRICE_MOVERS_TTL_MS=3600000,PRICE_MOVERS_DAYS=14,PRICE_MOVERS_MIN_EUR=5;let priceMoversCache=null;
function buildPriceMovers(rows,fx,now=Date.now()){
  const up=[],down=[];
  for(const row of rows||[]){const from=Number(row.from_amount),to=Number(row.to_amount),change=Number(row.change_percent);if(!row?.card_id||!Number.isFinite(from)||!Number.isFinite(to)||!Number.isFinite(change))continue;
    (row.direction==='up'?up:down).push({cardId:row.card_id,name:row.name_zh||row.name_ja||row.card_number||row.card_id,nameJa:row.name_ja||null,cardNumber:row.card_number||null,seriesCode:row.series_code||null,seriesName:row.series_name||null,imageUrl:row.image_url||null,variant:row.variant||'',currency:row.currency,changePercent:change,
      from:{date:String(row.from_date).slice(0,10),amount:from,amountTwd:amountToTwd(from,row.currency,fx)},to:{date:String(row.to_date).slice(0,10),amount:to,amountTwd:amountToTwd(to,row.currency,fx)}})}
  return {data:{up,down},meta:{provider:'cardmarket',windowDays:PRICE_MOVERS_DAYS,minAmount:PRICE_MOVERS_MIN_EUR,currency:'EUR',note:'Cardmarket 平台參考價（經 TCGdex 轉供）的變動，不是成交價、買取價或台灣行情，也不代表能賺到的價差；新台幣以今日匯率換算。',generatedAt:new Date(now).toISOString()}};
}
function loadPriceMovers(){
  if(priceMoversCache&&(priceMoversCache.pending||Date.now()-priceMoversCache.at<PRICE_MOVERS_TTL_MS))return priceMoversCache.promise;
  const entry={pending:true,at:0,promise:null};
  entry.promise=Promise.all([supabaseFetch('/rpc/price_movers',{method:'POST',body:JSON.stringify({p_days:PRICE_MOVERS_DAYS,p_min:PRICE_MOVERS_MIN_EUR,p_limit:20})}),getTwdRates()]).then(([rows,fx])=>{entry.pending=false;entry.at=Date.now();return buildPriceMovers(rows,fx)},error=>{priceMoversCache=null;throw error});
  priceMoversCache=entry;return entry.promise;
}
async function priceHistoryResponse(requestedId){
  let loaded=null;try{loaded=await getCard(requestedId)}catch{return {status:200,body:{series:[],meta:{unavailable:'price-history-unavailable',note:priceHistoryNote([]),generatedAt:new Date().toISOString()}}}}
  if(!loaded?.card)return {status:404,body:{error:'找不到這張卡'}};
  if(!supabaseConfigured())return {status:200,body:{series:[],meta:{note:priceHistoryNote([]),windowDays:PRICE_HISTORY_DAYS,generatedAt:new Date().toISOString()}}};
  try{return {status:200,body:await priceHistoryCached(loaded.card,requestedId)}}catch{return {status:200,body:{series:[],meta:{unavailable:'price-history-unavailable',note:priceHistoryNote([]),windowDays:PRICE_HISTORY_DAYS,generatedAt:new Date().toISOString()}}}}
}

const ALLOWED_PLATFORMS=['卡拍拍','露天拍賣','蝦皮購物','露天/蝦皮以外的台灣賣場','其他'];const ALLOWED_CURRENCIES=['TWD','USD','JPY','EUR'];const MAX_PRICE=5000000;const PUBLIC_SELECT='id,cardName:card_name,cardId:card_id,game,platform,currency,price,condition,note,tradedAt:traded_at,createdAt:created_at,status';
function readJsonBody(req,maxBytes=10000){return new Promise((resolve,reject)=>{let size=0;const chunks=[];req.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){reject(new Error('BODY_TOO_LARGE'));req.destroy();return}chunks.push(chunk)});req.on('end',()=>{if(!chunks.length)return resolve({});try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(new Error('INVALID_JSON'))}});req.on('error',reject)})}
function median(nums){const s=[...nums].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}function buildStats(rows){const groups={};for(const r of rows){(groups[r.currency]??=[]).push(Number(r.price))}const stats={};for(const [currency,p]of Object.entries(groups))stats[currency]={count:p.length,min:Math.min(...p),max:Math.max(...p),median:median(p),avg:Math.round(p.reduce((a,b)=>a+b,0)/p.length*100)/100};return stats}

async function scrapeYuyutei(targetUrl){const response=await fetch(targetUrl,{headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'ja,en-US;q=0.9'}});if(!response.ok)throw new Error(`FETCH_${response.status}`);const html=(await response.text()).replace(/\s+/g,' '),setTitle=html.match(/<h3 class="fw-bold py-3">\s*<span class="line1"><\/span>\s*([^<]+)<\/h3>/)?.[1]?.trim()||null,game=targetUrl.match(/\/buy\/([a-z0-9]+)\//i)?.[1]||'unknown',tokens=[];let m;const rarityRe=/<span class="py-2 d-inline-block px-2 me-2 text-white fw-bold">([^<]+)<\/span>\s*Card List/g;while((m=rarityRe.exec(html)))tokens.push({type:'rarity',index:m.index,value:m[1].trim()});const cardRe=/<div class="card-product position-relative mt-4[^"]*"/g;while((m=cardRe.exec(html)))tokens.push({type:'card',index:m.index});tokens.sort((a,b)=>a.index-b.index);const found=[];let rarity=null;for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.type==='rarity'){rarity=t.value;continue}const end=i+1<tokens.length?tokens[i+1].index:Math.min(html.length,t.index+3000),chunk=html.slice(t.index,end),ver=chunk.match(/value="([^"]+)" class="cart_ver"/)?.[1],cid=chunk.match(/value="([^"]+)" class="cart_cid"/)?.[1],number=chunk.match(/text-center my-2">([^<]+)<\/span>/)?.[1]?.trim()||null,name=chunk.match(/text-primary fw-bold">([^<]+)<\/h4>/)?.[1]?.trim()||null,price=chunk.match(/<strong class="d-block text-end[^"]*">\s*([\d,]+)\s*円/)?.[1];if(!ver||!cid||!price)continue;found.push({setCode:ver,cardCode:cid,number,name,rarity,price:Number(price.replace(/,/g,'')),cardUrl:`https://yuyu-tei.jp/buy/${game}/card/${ver}/${cid}`,imageUrl:`https://card.yuyu-tei.jp/${game}/100_140/${ver}/${cid}.jpg`})}return {game,setTitle,cards:found}}

// SEO（providers/seo.mjs）：卡片／系列網址的 head 標籤、robots.txt 與 sitemap。網址一律用 PUBLIC_BASE_URL（預設正式站），不採用請求的 Host。
const PUBLIC_BASE_URL=normalizeBaseUrl(process.env.PUBLIC_BASE_URL);
const SEO_LOAD_TIMEOUT_MS=1500,SEO_CACHE_TTL_MS=600000,SEO_NEGATIVE_TTL_MS=60000,SEO_CACHE_MAX=500,seoCache=new Map();
const SITEMAP_TTL_MS=24*60*60*1000,SITEMAP_PAGE_SIZE=1000,SITEMAP_URLS_PER_FILE=Math.min(SITEMAP_MAX_URLS,Math.max(1,Number(process.env.SITEMAP_URLS_PER_FILE)||SITEMAP_MAX_URLS)),sitemapCache={value:null,expiresAt:0,promise:null};
const withTimeout=(promise,ms)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('SEO_TIMEOUT')),ms);promise.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})});
function seoCacheGet(key){const hit=seoCache.get(key);if(hit&&hit.expiresAt>Date.now())return hit.value;seoCache.delete(key);return undefined}
function seoCacheSet(key,value,ttlMs){seoCache.delete(key);seoCache.set(key,{value,expiresAt:Date.now()+ttlMs});while(seoCache.size>SEO_CACHE_MAX)seoCache.delete(seoCache.keys().next().value)}
function seoRequestTarget(url){const clean=value=>{const text=String(value||'').trim();return text&&text.length<=200&&!/[\u0000-\u001f]/.test(text)?text:null},card=clean(url.searchParams.get('card'));if(card)return {kind:'card',id:card};const series=clean(url.searchParams.get('series'));return series?{kind:'series',id:series}:null}
async function loadSeoForCard(cardId){
  const loaded=supabaseConfigured()?await loadCardCached(cardId):await getCard(cardId);if(!loaded?.card)return null;
  const {catalog,card}=loaded,seriesId=card.printings?.[0]?.seriesId||card.seriesId,series=(catalog.series||[]).find(s=>s.id===seriesId)||null,game=(catalog.games||[]).find(g=>g.id===card.game)||null;
  return cardSeo({card,series,game,baseUrl:PUBLIC_BASE_URL,rarityLabel:rarityDisplayLabel});
}
async function loadSeoForSeries(seriesId){
  let series=null,printingCount=null;
  if(supabaseConfigured()){
    const rows=await supabaseFetch(`/tcg_series?${new URLSearchParams({select:'id,game:game_id,officialCode:official_code,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,region,releaseDate:release_date',id:`eq.${seriesId}`,limit:'1'})}`);series=rows?.[0]||null;
    // The count is a nicety: never let it hold the page back or fail it.
    if(series)printingCount=await withTimeout(supabaseFetchPage(`/tcg_printings?${new URLSearchParams({select:'id',series_id:`eq.${seriesId}`,limit:'1'})}`).then(page=>page.total),800).catch(()=>null);
  }else series=(await loadCatalog()).series.find(s=>s.id===seriesId)||null;
  return series?seriesSeo({series,baseUrl:PUBLIC_BASE_URL,printingCount}):null;
}
// 有 card／series 參數時改寫 head；查詢失敗或逾時就回原本的 index（200），查無才回 404。
async function serveSeoIndex(res,target){
  let html;try{html=await readFile(join(root,'index.html'),'utf8')}catch{return json(res,404,{error:'Not found'})}
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':types['.html']});res.end(body)},key=`${target.kind}:${target.id}`;let entry=seoCacheGet(key);
  if(entry===undefined){try{const seo=await withTimeout(target.kind==='card'?loadSeoForCard(target.id):loadSeoForSeries(target.id),SEO_LOAD_TIMEOUT_MS);entry=seo?{seo}:{missing:true};seoCacheSet(key,entry,seo?SEO_CACHE_TTL_MS:SEO_NEGATIVE_TTL_MS)}catch(error){console.error('seo lookup failed',error.message);return send(200,html)}}
  return entry.missing?send(404,applyNoindexToHtml(html)):send(200,applySeoToHtml(html,entry.seo));
}
// Keyset paging (id > last) keeps every page cheap however deep the table is.
async function forEachKeysetPage(table,select,onRows){let last=null;for(let pages=0;pages<1000;pages++){const params=new URLSearchParams({select,order:'id.asc',limit:String(SITEMAP_PAGE_SIZE)});if(last!==null)params.set('id',`gt.${last}`);const rows=await supabaseFetch(`/${table}?${params}`);if(!Array.isArray(rows))throw new Error('SITEMAP_BAD_RESPONSE');onRows(rows);if(rows.length<SITEMAP_PAGE_SIZE)return;const next=rows.at(-1)?.id;if(!next||next===last)throw new Error('SITEMAP_PAGING_STALLED');last=next}throw new Error('SITEMAP_TOO_MANY_PAGES')}
async function buildSitemaps(){
  const groups=new Map(),seriesRows=[];
  // 先用資料庫一次分組好的結果（public.sitemap_card_groups，約 1 秒）；失敗或格式不符才退回逐頁抓卡片（冷啟動 40–60 秒）。
  let grouped=null;try{const rows=await supabaseFetch('/rpc/sitemap_card_groups',{method:'POST',body:'{}',signal:AbortSignal.timeout(45000)});if(Array.isArray(rows)&&rows.length&&rows.every(r=>Array.isArray(r)&&typeof r[0]==='string'))grouped=rows}catch(error){console.error('sitemap rpc failed',error.message)}
  if(grouped)for(const [id,game,lastmod] of grouped)groups.set(id,{id,game:game||null,lastmod:lastmod||null});
  else await forEachKeysetPage('tcg_cards','id,canonical_id,game_id,updated_at,name_zh,name_ja,name_en,name_ko',rows=>mergeCardSitemapRows(rows,groups));
  await forEachKeysetPage('tcg_series','id,game_id,region,official_code,name_zh,name_ja,name_en,name_ko,updated_at',rows=>seriesRows.push(...rows));
  const generated=new Date().toISOString().slice(0,10),cardFiles=chunkEntries(cardSitemapEntries(PUBLIC_BASE_URL,groups),SITEMAP_URLS_PER_FILE).map(renderUrlSet),index=[{loc:`${PUBLIC_BASE_URL}/sitemaps/pages.xml`,lastmod:generated},{loc:`${PUBLIC_BASE_URL}/sitemaps/series.xml`,lastmod:generated},...cardFiles.map((_,i)=>({loc:`${PUBLIC_BASE_URL}/sitemaps/cards-${i+1}.xml`,lastmod:generated}))];
  return {index:renderSitemapIndex(index),pages:renderUrlSet(pageSitemapEntries(PUBLIC_BASE_URL,[...CATALOG_GAME_IDS])),series:renderUrlSet(seriesSitemapEntries(PUBLIC_BASE_URL,seriesRows)),cards:cardFiles,cardCount:groups.size};
}
// Built at most once at a time and kept 24 hours; a failed build is never cached.
function loadSitemaps(){if(sitemapCache.value&&sitemapCache.expiresAt>Date.now())return Promise.resolve(sitemapCache.value);if(!sitemapCache.promise)sitemapCache.promise=buildSitemaps().then(value=>{sitemapCache.value=value;sitemapCache.expiresAt=Date.now()+SITEMAP_TTL_MS;return value}).finally(()=>{sitemapCache.promise=null});return sitemapCache.promise}
async function serveSitemap(res,pathname){
  const xml=body=>{res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'});res.end(body)},cardFile=pathname.match(/^\/sitemaps\/cards-(\d+)\.xml$/);
  if(pathname==='/sitemaps/pages.xml')return xml(renderUrlSet(pageSitemapEntries(PUBLIC_BASE_URL,[...CATALOG_GAME_IDS])));
  if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});
  let built;try{built=await loadSitemaps()}catch(error){console.error('sitemap build failed',error.message);return json(res,503,{error:'Sitemap 暫時無法產生'})}
  if(pathname==='/sitemap.xml')return xml(built.index);
  if(pathname==='/sitemaps/series.xml')return xml(built.series);
  const body=cardFile?built.cards[Number(cardFile[1])-1]:null;return body?xml(body):json(res,404,{error:'Not found'});
}

// 記憶體警戒（2026-10-21 Render 免費方案 512 MB 被 OOM 重啟，免費方案沒有請求紀錄）：RSS 超過門檻時，把當下處理中的請求寫進日誌，下次就知道是哪個請求。
const MEMORY_WARN_BYTES=(Number(process.env.MEMORY_WARN_MB)||380)*1024*1024,inflightRequests=new Set();let memoryWarnedAt=0;
setInterval(()=>{const m=process.memoryUsage();if(m.rss<MEMORY_WARN_BYTES||Date.now()-memoryWarnedAt<60000)return;memoryWarnedAt=Date.now();console.warn('memory high',JSON.stringify({rssMb:Math.round(m.rss/1048576),heapMb:Math.round(m.heapUsed/1048576),inflight:[...inflightRequests].slice(0,15)}))},2000).unref();
const handleRequest=async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host}`);const inflightKey=`${req.method} ${url.pathname}${url.search.slice(0,160)} ${String(req.headers['user-agent']||'').slice(0,60)}`;inflightRequests.add(inflightKey);res.once('close',()=>inflightRequests.delete(inflightKey));
  if(url.pathname==='/api/images/onepiece'&&req.method==='GET')return proxyOnePieceImage(res,url.searchParams.get('url'));
  if(url.pathname==='/api/providers')return json(res,200,{data:providerStatus()});
  if(url.pathname==='/api/catalog/image-status'&&req.method==='GET'){try{return json(res,200,{data:await yugiohImageStatus(supabaseFetch)})}catch(e){return failJson(res,502,'image status failed',e)}}
  if(url.pathname==='/api/admin/catalog/cache-images'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});if(!imageCollectionAllowed('yugioh'))return json(res,409,{error:'來源尚未明確允許保存卡圖，圖片快取已暫停'});try{return json(res,200,{data:await cacheYugiohImages(supabaseFetch,{limit:Number(process.env.CARD_IMAGE_CACHE_LIMIT||15000),concurrency:Number(process.env.CARD_IMAGE_CACHE_CONCURRENCY||4)})})}catch(e){return json(res,502,{error:e.message})}}
  if(url.pathname==='/api/catalog'&&req.method==='GET'){const data=await loadCatalog();return json(res,200,{data,meta:{source:data.source,fallbackReason:data.fallbackReason||null}},data.fallbackReason?{}:SHORT_CACHE)}
  if(url.pathname==='/api/catalog/coverage'&&req.method==='GET'){return json(res,200,{data:await loadCatalogCoverage()},SHORT_CACHE)}
  // 外部監測（UptimeRobot 預設 HEAD）只需確認服務活著並保持喚醒，不查資料庫。
  if(url.pathname==='/api/catalog/health'&&req.method==='HEAD'){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return res.end()}
  if(url.pathname==='/api/catalog/health'&&req.method==='GET'){return json(res,200,{data:await loadCatalogHealth()})}
  if(url.pathname==='/api/catalog/sources'&&req.method==='GET'){return json(res,200,{data:publicSourcePolicies(),meta:sourcePolicySummary()})}
  if(url.pathname==='/api/admin/catalog/health'&&req.method==='GET'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；請使用 Authorization Bearer 或 x-scrape-token 標頭'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});try{return json(res,200,{data:await loadAdminCatalogHealth()})}catch(e){return json(res,502,{error:e.message})}}
  if(url.pathname==='/api/trends'&&req.method==='GET'){
    const requestedLimit=Number(url.searchParams.get('limit')),limit=Math.min(Math.max(Number.isFinite(requestedLimit)&&requestedLimit>0?requestedLimit:12,1),50);
    // Trends come only from Yuyu-tei buyback history; Yuyu-tei declined reuse (2026-10-12), so the section is switched off rather than shown empty forever.
    if(sourceDisplayDenied('yuyutei'))return json(res,200,{data:[],meta:{...trendMeta({status:'unavailable',rowsScanned:0,validRows:0,uniqueCards:0,observationWindow:trendObservationWindow([])}),disabled:true,disabledReason:'source-denied'}});
    if(!supabaseConfigured())return json(res,200,{data:[],meta:trendMeta({status:'unavailable',rowsScanned:0,validRows:0,uniqueCards:0,observationWindow:trendObservationWindow([])})});
    try{const snapshot=await loadTrendSnapshot();return json(res,200,{data:snapshot.data.slice(0,limit),meta:trendMeta(snapshot)})}catch(e){console.error('trend snapshot failed',e.message);return json(res,502,{error:'資料暫時無法讀取',meta:trendMeta({status:'unavailable',rowsScanned:0,validRows:0,uniqueCards:0,observationWindow:trendObservationWindow([])})})}
  }
  if(url.pathname==='/api/buyback-prices'&&req.method==='GET'){
    if(!supabaseConfigured())return json(res,200,{data:[],meta:{source:'yuyutei-buyback',warning:'沒有資料庫時不建立示範價格'}});
    const requestedGame=(url.searchParams.get('game')||'').trim().toLowerCase(),providerGame=sourceDisplayDenied('yuyutei')?null:{pokemon:'poc'}[requestedGame];
    if(!providerGame)return json(res,200,{data:[],meta:{source:'yuyutei-buyback',warning:'此 IP 目前沒有可驗證的買取價格來源，因此不顯示價格。'}});
    try{
      const rows=await cachedBrowseRows(`buyback:${providerGame}`,()=>supabaseFetch(`/jp_buyback_prices?select=game,cardNumber:card_number,rarity,cardName:card_name,price,currency,cardUrl:card_url,updatedAt:scraped_at&source=eq.yuyutei&game=eq.${providerGame}&order=scraped_at.desc&limit=500`)),seen=new Set(),data=[];
      for(const row of rows||[]){const key=String(row.cardNumber||'').trim().toUpperCase();if(!key||seen.has(key)||!Number.isFinite(Number(row.price)))continue;seen.add(key);data.push({...row,price:Number(row.price),priceType:'buyback'})}
      return json(res,200,{data,meta:{source:'yuyutei-buyback',label:'遊々亭日版買取價',warning:'只用於篩選與排序有可靠對應的卡片；不是成交價、掛牌價或市場均價。'}});
    }catch(e){return failJson(res,502,'buyback prices failed',e)}
  }
  if(url.pathname==='/api/products'&&req.method==='GET'){try{const catalog=await loadProductSets();return json(res,200,{data:catalog.products,series:catalog.series,meta:productFeedMeta(catalog)},SHORT_CACHE)}catch(e){return failJson(res,502,'products failed',e)}}
  if(url.pathname==='/api/price-movers'&&req.method==='GET'){if(!supabaseConfigured())return json(res,200,{data:{up:[],down:[]},meta:{unavailable:'not-configured'}});try{return json(res,200,await loadPriceMovers(),SHORT_CACHE)}catch(e){console.error('price movers failed',e.message);return json(res,502,{error:'資料暫時無法讀取'})}}
  if(url.pathname==='/api/exchange-rates'&&req.method==='GET')return json(res,200,{data:await getTwdRates()});
  if(url.pathname==='/api/cards'&&req.method==='GET'){const requestedGame=(url.searchParams.get('game')||'').trim();if(requestedGame&&!CATALOG_GAME_IDS.has(requestedGame))return json(res,400,{error:'請選擇單一卡牌遊戲'});const region=normalizeBrowseRegion(url.searchParams.get('region')),rarity=normalizeBrowseRarity(url.searchParams.get('rarity')),sort=normalizeBrowseSort(url.searchParams.get('sort'),requestedGame),seriesId=(url.searchParams.get('series')||'').trim()||null,limit=Math.min(Math.max(Number(url.searchParams.get('limit'))||60,1),BROWSE_PAGE_MAX),offset=Math.min(Math.max(Math.floor(Number(url.searchParams.get('offset')))||0,0),200000);if(region&&!CATALOG_REGION_IDS.has(region))return json(res,400,{error:'不支援的版本地區'});if(rarity&&!BROWSE_RARITY_FORMAT.test(rarity))return json(res,400,{error:'稀有度格式不正確'});if(requestedGame&&supabaseConfigured()){try{const started=performance.now(),page=await browseDatabaseCards(requestedGame,{region,rarity,seriesId,sort,limit,offset});if(requestedGame==='pokemon')await attachReferencePrices(page.data);return json(res,200,{data:page.data,meta:{source:'supabase-full-catalog',game:requestedGame,seriesId,region,rarity,sort,limit,offset,hasMore:page.hasMore,total:page.total,facets:page.facets,facetStatus:page.facetStatus,errors:page.errors}},{...SHORT_CACHE,'Server-Timing':`${Object.entries(page.timings||{}).map(([name,dur])=>`${name};dur=${dur}`).concat(`total;dur=${Math.round(performance.now()-started)}`).join(', ')}`})}catch(e){if(e.code==='BROWSE_BUSY')return json(res,503,{error:e.message},{'Retry-After':'5'});if(e.code==='BROWSE_REFUSED')return json(res,502,{error:e.message});return failJson(res,502,'browse failed',e)}}const catalog=await loadCatalog(),printingByCard=buildPrintingIndex(catalog.cards.flatMap(card=>(card.printings||[]).map(printing=>({...printing,cardId:printing.cardId||card.id})))),page=buildBrowsePage(requestedGame?catalog.cards.filter(card=>card.game===requestedGame):catalog.cards,{region,rarity,seriesId,sort,limit,offset,printingByCard});return json(res,200,{data:page.data,meta:{source:catalog.source,game:requestedGame||null,seriesId,region,rarity,sort,limit,offset,hasMore:page.hasMore,total:page.total,facets:page.facets,facetStatus:page.facetStatus}},catalog.fallbackReason?{}:SHORT_CACHE)}
  if(url.pathname==='/api/search'&&req.method==='GET'){
    // ADR 0044 Q6/Q7: rarity codes and version words in the query become filters (parsed), the rest is the card name; results are one page (offset/limit) with the real total.
    const rawQ=(url.searchParams.get('q')||'').trim().slice(0,100),regionParam=(url.searchParams.get('region')||'all').toUpperCase(),parsedQuery=parseSearchQuery(rawQ),region=regionParam!=='ALL'?regionParam:(parsedQuery.region||'ALL'),searchName=parsedQuery.name,rarities=parsedQuery.rarities,rarityValues=rarityMatchValues(rarities);
    const limit=Math.min(Math.max(Math.floor(Number(url.searchParams.get('limit')))||SEARCH_RESULT_LIMIT,1),SEARCH_PAGE_MAX),offset=Math.min(Math.max(Math.floor(Number(url.searchParams.get('offset')))||0,0),200000),parsed={q:rawQ,name:searchName,rarities,region:regionParam!=='ALL'?null:parsedQuery.region,...(parsedQuery.rarityOnly?{rarityOnly:true}:{})};
    const searchCacheKey=[regionParam,rawQ,searchName,rarities.join(','),parsed.region||'',offset,limit].join('|'),cachedSearch=recallSearch(searchCacheKey);if(cachedSearch)return json(res,200,cachedSearch,{...SHORT_CACHE,'Server-Timing':'cache;desc="hit", total;dur=0'});
    // A bare rarity code (SAR, UR 日版) names no card: say so instead of matching it against card names, and offer a working example.
    if(parsedQuery.rarityOnly){let example=rarityOnlyExample(rarities);
    // Only offer the example when it really has results (皮卡丘 MUR does not).
    if(example){const check=parseSearchQuery(example);try{if(!supabaseConfigured()||!(await searchCatalogDatabase(check.name,'ALL',1,{rarities:check.rarities})).cards.length)example=null}catch{example=null}}
    const body={data:[],meta:{source:'rarity-only',architecture:'canonical-card-with-printings',match:'rarity-only',resultLimit:limit,mayHaveMore:false,queryTerms:[],total:0,offset,limit,hasMore:false,parsed,suggestion:example?{q:example,reason:'稀有度請搭配卡名一起搜'}:null,hint:{kind:'rarity-only',message:'只輸入稀有度無法判斷是哪一張卡，請加上卡名'+(example?`，例如「${example}」`:'')+'。'}}};rememberSearch(searchCacheKey,body);return json(res,200,body,SHORT_CACHE)}
    // 只有符號（. _ % 之類）或空查詢無從比對卡名：回空結果與提示，不拿備援樣本卡充數。
    if(!/[\p{L}\p{N}]/u.test(normalizeSearch(searchName)))return json(res,200,{data:[],meta:{source:'symbols-only',architecture:'canonical-card-with-printings',match:'symbols-only',resultLimit:limit,mayHaveMore:false,queryTerms:[],total:0,offset,limit,hasMore:false,parsed,suggestion:null,hint:{kind:'symbols-only',message:'請輸入卡名、卡號或系列名稱。'}}},SHORT_CACHE);
    const q=normalizeSearch(searchName),searchStarted=performance.now(),databasePending=supabaseConfigured()?searchCatalogDatabase(searchName,region,limit,{offset,rarities}).then(value=>({value,doneAt:performance.now()}),error=>({error})):null,catalog=await loadCatalog(),catalogDoneAt=performance.now(),seriesById=new Map(catalog.series.map(s=>[s.id,s])),nameValues=c=>[c.nameZh,c.nameJa,c.nameEn,c.nameKo,...(c.aliases||[]),...(c.printings||[]).flatMap(p=>[p.nameZh,p.nameJa,p.nameEn,p.nameKo])];
    const found=catalog.cards.filter(c=>{if(region!=='ALL'&&c.region!==region&&!c.printings?.some(p=>p.region===region))return false;const series=[seriesById.get(c.seriesId)||{},...(c.printings||[]).map(p=>seriesById.get(p.seriesId)||{})],values=[...nameValues(c),c.officialCardNumber,...(c.printings||[]).flatMap(p=>[p.localSetCode,p.localCardNumber]),...series.flatMap(s=>[s.officialCode,s.nameZh,s.nameJa,s.nameEn,s.nameKo,...(s.aliases||[])])];return !q||values.some(v=>normalizeSearch(v).includes(q))}),exact=q?found.filter(c=>nameValues(c).some(v=>normalizeSearch(v)===q)):[];
    // Local-catalog answers (no database, or the database has nothing) apply the parsed filters to printings too, then page and rank like the database ones.
    const localNeedles=searchQueryTerms(searchName).map(normalizeSearch),narrowing=rarityValues.length>0||(regionParam==='ALL'&&Boolean(parsedQuery.region)),narrowLocal=list=>narrowing?list.map(c=>({...c,printings:(c.printings||[]).filter(p=>(region==='ALL'||p.region===region)&&printingMatchesRarity(p,rarityValues))})).filter(c=>c.printings.length):list,withRank=list=>list.map(c=>c.matchRank===undefined?{...c,matchRank:cardMatchRank(c,localNeedles)}:c);
    const pageLocal=list=>{const items=narrowLocal(list);return {data:withRank(items.slice(offset,offset+limit)),total:items.length}};
    const gameHint=gameHintFor(searchName),withPaging=(meta,data,total,suggestion=null)=>{const hasMore=offset+data.length<total;return {data,meta:{...meta,resultLimit:limit,mayHaveMore:hasMore,queryTerms:searchQueryTerms(searchName),total,offset,limit,hasMore,parsed,suggestion,...(gameHint?{gameHint:gameHint.gameId,franchiseHint:gameHint.franchiseId}:{})}}};
    // The database's answer as one page: its own page when it paged, otherwise merged with the exact local matches; no database hits -> the loaded catalog.
    const settle=db=>{if(db.cards.length>0&&db.paged)return {data:db.cards,total:db.total};/* offset 超過結果數：資料庫的頁是空的，但總數仍是真的 */if(db.paged&&db.total>0)return {data:[],total:db.total};if(db.cards.length>0){const merged=offset?db.cards:narrowLocal(canonicalizeCatalog({...catalog,cards:[...exact,...db.cards]}).cards);return {data:withRank(merged.slice(0,limit)),total:Math.max(db.total||0,offset+merged.length)}}const page=pageLocal(exact.length?exact:found);return {data:page.data,total:page.total}};
    if(!supabaseConfigured()){
      const page=pageLocal(exact.length?exact:found);
      return json(res,200,withPaging({source:catalog.source,architecture:'canonical-card-with-printings',match:exact.length?'exact-name':'substring'},page.data,page.total))
    }
    try{
      const settled=await databasePending;if(settled.error)throw settled.error;let database=settled.value,hasDatabaseMatches=database.cards.length>0,{data,total}=settle(database),matchedAs=null,retryMs=0;
      // Nothing found: retry once with the database's own spelling (spaces, middle dots, hyphens ignored); the paging, ranking and rarity filters are the normal path again.
      if(total===0){const retryStarted=performance.now(),spans=await foldedNameSpans(searchName);if(spans.length){try{const again=await searchCatalogDatabase(spans,region,limit,{offset,rarities});if(again.cards.length){database=again;hasDatabaseMatches=true;({data,total}=settle(again));matchedAs=spans}}catch(error){console.error('search fold retry failed',error.message)}}retryMs=performance.now()-retryStarted}
      const timing=Object.entries({catalog:catalogDoneAt-searchStarted,db:settled.doneAt-searchStarted,...database.timings,...(retryMs?{retry:retryMs}:{}),total:performance.now()-searchStarted}).map(([name,ms])=>`${name};dur=${Math.round(ms)}`).join(', ');
      // Nothing found with the parsed filters: say whether the name alone would have results.
      let suggestion=null;
      if(total===0&&(rarities.length||parsed.region)){try{const nameOnly=await searchCatalogDatabase(searchName,regionParam,1);if(nameOnly.cards.length)suggestion={q:searchName,reason:'name-only'}}catch(error){console.error('search suggestion failed',error.message)}}
      // 卡號後面多一個單字母（OP05-001 R：單字母不是稀有度代碼，只會被當成卡名的一部分）：去掉它若有結果就當建議。
      else if(total===0){const trimmed=searchName.replace(/\s+[A-Za-z]$/,'');if(trimmed&&trimmed!==searchName)try{const base=await searchCatalogDatabase(trimmed,regionParam,1);if(base.cards.length)suggestion={q:trimmed,reason:'去掉結尾的單一字母'}}catch(error){console.error('search suggestion failed',error.message)}}
      // Still nothing (typo?): offer the closest card name; an IP name that has no cards of its own (排球少年) is not a typo.
      if(total===0&&!suggestion&&!gameHint)suggestion=await suggestCardName(searchName,region);
      const searchBody=withPaging({...(matchedAs?{matchedAs}:{}),source:hasDatabaseMatches?'supabase-search':catalog.source,architecture:'canonical-card-with-printings',match:hasDatabaseMatches?(database.matchedSeries?'database-series':exact.length?'exact-name+database-substring':'database-substring'):(exact.length?'exact-name':'substring'),databaseSearch:database.searched?'available':'skipped',searchScope:hasDatabaseMatches?'bounded-database-query':'loaded-catalog-only',candidateCount:database.candidateCount,candidateLimit:database.candidateLimit},data,total,suggestion);rememberSearch(searchCacheKey,searchBody);return json(res,200,searchBody,{...SHORT_CACHE,'Server-Timing':timing})
    }catch(error){
      console.error('catalog search failed',error.message);
      const page=pageLocal(exact.length?exact:found);
      return json(res,200,withPaging({source:catalog.source,architecture:'canonical-card-with-printings',match:exact.length?'exact-name':'substring',databaseSearch:'unavailable',searchScope:'loaded-catalog-only'},page.data,page.total))
    }
  }
  if(url.pathname.startsWith('/api/cards/')&&req.method==='GET'){const tail=decodeURIComponent(url.pathname.slice(11));if(tail.endsWith('/price-history')){const result=await priceHistoryResponse(tail.slice(0,-14));return json(res,result.status,result.body)}if(tail.endsWith('/market')){const id=tail.slice(0,-7),{card}=await getCard(id);if(!card)return json(res,404,{error:'找不到這張卡'});return json(res,200,{data:await unifiedMarket(card)})}const {catalog,card}=await getCard(tail);if(!card)return json(res,404,{error:'找不到這張卡'});const series=catalog.series.find(s=>s.id===card.seriesId)||null,game=catalog.games.find(g=>g.id===card.game)||null;return json(res,200,{data:{...card,series,game},meta:{source:catalog.source,imagePolicy:'優先使用已保存或來源允許的圖片；不長期 hotlink YGOPRODeck 圖片。'}},catalog.fallbackReason?{}:SHORT_CACHE)}
  if(url.pathname==='/api/reports/meta')return json(res,200,{data:{platforms:ALLOWED_PLATFORMS,currencies:ALLOWED_CURRENCIES,maxPrice:MAX_PRICE}});
  // ADR 0045：免登入收藏的參考總值。最多 100 張卡、一次查詢 price_snapshots、不打外部來源。
  if(url.pathname==='/api/prices/reference'&&req.method==='POST'){let body;try{body=await readJsonBody(req,REFERENCE_BODY_MAX_BYTES)}catch(error){return json(res,error.message==='BODY_TOO_LARGE'?413:400,{error:error.message==='BODY_TOO_LARGE'?'請求內容過大':'JSON 格式錯誤'})}const v=validateReferenceRequest(body);if(v.error)return json(res,400,{error:v.error});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});try{const [rows,fx]=await Promise.all([supabaseFetch(`/price_snapshots?${new URLSearchParams(referenceQueryParams(v.ids))}`),getTwdRates()]);return json(res,200,{data:buildReferencePrices(rows,v.ids,{fx,amountToTwd})})}catch{return json(res,502,{error:'參考價查詢失敗'})}}
  if(url.pathname==='/api/reports'&&req.method==='GET'){const cardId=url.searchParams.get('cardId'),cardName=url.searchParams.get('cardName'),game=url.searchParams.get('game'),limit=Math.min(Number(url.searchParams.get('limit'))||20,100);if(!cardId&&!cardName)return json(res,400,{error:'請提供 cardId 或 cardName'});if(!supabaseConfigured())return json(res,200,{data:{reports:[],stats:[],total:0},meta:{status:'unavailable',reason:'尚未設定使用者回報資料庫'}});const base=new URLSearchParams();if(cardId)base.set('card_id',`eq.${cardId}`);else base.set('card_name',`ilike.*${cardName}*`);if(game)base.set('game',`eq.${game}`);try{const statsParams=new URLSearchParams(base);statsParams.set('select','currency,price');const recentParams=new URLSearchParams(base);recentParams.set('select',PUBLIC_SELECT);recentParams.set('order','traded_at.desc');recentParams.set('limit',String(limit));const [all,recent]=await Promise.all([supabaseFetch(`/reports?${statsParams}`),supabaseFetch(`/reports?${recentParams}`)]);return json(res,200,{data:{reports:recent,stats:buildStats(all),total:all.length}})}catch{return json(res,502,{error:'資料庫查詢失敗'})}}
  if(url.pathname==='/api/admin/scrape/yuyutei'&&(req.method==='POST'||req.method==='GET')){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});if(!catalogCollectionAllowed('yuyutei'))return json(res,409,{error:'來源權利尚未確認，已由來源政策暫停自動抓取'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});let targetUrl=url.searchParams.get('url');if(req.method==='POST'){try{targetUrl=(await readJsonBody(req)).url||targetUrl}catch{return json(res,400,{error:'JSON 格式錯誤'})}}if(!targetUrl?.startsWith('https://yuyu-tei.jp/buy/'))return json(res,400,{error:'請提供合法的遊々亭買取頁'});try{const {game,setTitle,cards:found}=await scrapeYuyutei(targetUrl),rows=found.map(c=>({source:'yuyutei',game,set_code:c.setCode,set_name:setTitle,card_code:c.cardCode,card_number:c.number,rarity:c.rarity,card_name:c.name,price:c.price,currency:'JPY',card_url:c.cardUrl,image_url:null,scraped_at:new Date().toISOString()}));for(let i=0;i<rows.length;i+=200)await supabaseFetch('/jp_buyback_prices?on_conflict=source,game,set_code,card_code',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify(rows.slice(i,i+200))});return json(res,200,{data:{message:'抓取並存檔成功',game,setTitle,count:rows.length}})}catch(e){return json(res,502,{error:`抓取失敗：${e.message}`})}}
  if(url.pathname==='/api/catalog/sync-status'&&req.method==='GET'){if(!supabaseConfigured())return json(res,200,{data:[]});try{const data=await supabaseFetch('/catalog_sync_runs?select=provider,scope,status,rowsSeen:rows_seen,rowsWritten:rows_written,error,metadata,startedAt:started_at,finishedAt:finished_at&provider=not.in.(price-snapshot,price-archive)&order=started_at.desc&limit=12');return json(res,200,{data})}catch(e){return failJson(res,502,'sync status failed',e)}}
  // ADR 0042：每日參考價快照的狀態、手動觸發與停止。
  if(url.pathname==='/api/admin/price-snapshot'&&req.method==='GET'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});return json(res,200,{data:priceSnapshot.status()})}
  if(url.pathname==='/api/admin/price-snapshot/run'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});const result=await priceSnapshot.runNow();return json(res,result.started?202:409,{data:result})}
  if(url.pathname==='/api/admin/price-archive'&&req.method==='GET'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});return json(res,200,{data:priceArchive.status()})}
  if(url.pathname==='/api/admin/price-archive/run'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});const result=await priceArchive.runNow();return json(res,result.started?202:409,{data:result})}
  if(url.pathname==='/api/admin/price-snapshot/stop'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});return json(res,200,{data:priceSnapshot.stop()})}
  if(url.pathname==='/api/admin/catalog/sync'&&req.method==='POST'){if(!adminAuthorized(req))return json(res,401,{error:'未授權；管理密鑰不可放在網址'});if(!supabaseConfigured())return json(res,503,{error:'尚未設定資料庫'});const requested=(url.searchParams.get('provider')||'all').toLowerCase(),aliases={pokemontw:'pokemonZhTw',pokemonzh:'pokemonZhTw',weissfrieren:'weissFrieren',frieren:'weissFrieren',dragonball:'dragonballFw',dbs:'dragonballFw'},selected=aliases[requested]||requested,tcgdexTw=process.env.TCGDEX_TW_SYNC==='true',candidates=requested==='all'?['pokemon',...(tcgdexTw?['pokemonZhTw']:[]),'onepiece','yugioh','haikyuu','weissFrieren','dragonballFw']:[selected];if(candidates.some(p=>!['pokemon','pokemonZhTw','onepiece','yugioh','haikyuu','weissFrieren','dragonballFw'].includes(p)))return json(res,400,{error:'不支援的 provider'});if(candidates.includes('pokemonZhTw')&&!tcgdexTw)return json(res,409,{error:'TCGdex 台版同步會覆寫台灣官方補正的資料，需設定 TCGDEX_TW_SYNC=true 才能執行'});const providers=filterAllowedCatalogProviders(candidates),blocked=candidates.filter(provider=>!providers.includes(provider));if(!providers.length)return json(res,409,{error:'所選來源尚未通過來源政策',blocked});syncCatalog(supabaseFetch,{providers}).then(result=>console.log('catalog sync complete',JSON.stringify(result))).catch(error=>console.error('catalog sync failed',error));return json(res,202,{data:{message:'Catalog 同步已在背景開始',providers,blocked}})}
  if((req.method==='GET'||req.method==='HEAD')&&url.pathname==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=3600'});return res.end(renderRobotsTxt(PUBLIC_BASE_URL))}
  if((req.method==='GET'||req.method==='HEAD')&&(url.pathname==='/sitemap.xml'||/^\/sitemaps\/(?:pages|series|cards-\d+)\.xml$/.test(url.pathname)))return serveSitemap(res,url.pathname);
  if((req.method==='GET'||req.method==='HEAD')&&url.pathname==='/'){const seoTarget=seoRequestTarget(url);if(seoTarget)return serveSeoIndex(res,seoTarget)}
  let pathname=url.pathname==='/'?'/index.html':url.pathname;if(!PUBLIC_STATIC.test(pathname))return notFound(res,url.pathname);const file=normalize(join(root,pathname));if(!file.startsWith(root))return json(res,403,{error:'Forbidden'});try{const raw=await readFile(file),ext=extname(file),game=url.searchParams.get('game'),
    // 首頁與遊戲頁補 canonical／og:image／遊戲專屬標題（index.html 是靜態檔）；帶 view 的子頁維持原樣。
    content=url.pathname==='/'&&!url.searchParams.has('view')?applySeoToHtml(raw.toString('utf8'),homeSeo({gameId:CATALOG_GAME_IDS.has(game)?game:'',baseUrl:PUBLIC_BASE_URL})):raw,headers={'Content-Type':types[ext]||'application/octet-stream'};
    // html/js/css: always revalidate (no-cache) with a content ETag, so a deploy reaches browsers at once and an unchanged file is a 304. Images keep their existing handling.
    if(['.html','.js','.css','.webmanifest'].includes(ext)){const etag=`"${createHash('sha1').update(content).digest('hex')}"`;headers['Cache-Control']='no-cache';headers.ETag=etag;if(String(req.headers['if-none-match']||'').split(',').some(value=>value.trim().replace(/^W\//,'')===etag)){res.writeHead(304,{'Cache-Control':'no-cache',ETag:etag});return res.end()}}
    res.writeHead(200,headers);res.end(content)}catch{notFound(res,url.pathname)}
};
// 任何未預期的例外只讓這一個請求失敗，不讓整個服務崩潰（2026-10-23 審查：壞掉的 % 編碼曾讓程序結束）。
const server=createServer((req,res)=>{
  // 先設在 res 上，每一種回應（SEO 頁、sitemap、robots、圖片代理、404、錯誤）寫標頭時都會帶上，不必各處手寫。
  for(const [name,value] of Object.entries(SECURITY_HEADERS))res.setHeader(name,value);
  if(!String(req.url).startsWith('/api/'))res.setHeader('Content-Security-Policy',CSP);
  handleRequest(req,res).catch(error=>{
  const badInput=error instanceof URIError||error?.code==='ERR_INVALID_URL';
  if(!badInput)console.error('request failed',req.method,String(req.url).slice(0,200),error?.stack||error);
  if(!res.headersSent)json(res,badInput?400:500,{error:badInput?'網址格式錯誤':'伺服器暫時發生錯誤'});else res.end();
})});
process.on('unhandledRejection',error=>console.error('unhandled rejection',error?.stack||error));

const priceSnapshot=createPriceSnapshotController({db:supabaseFetch,isBlocked:()=>priceArchive.status().running});
// 封存器不和快照輪次、目錄同步同時跑（HANDOFF 99 的 OOM）：快照在跑就延後，目錄同步看 catalog_sync_runs。
const priceArchive=createPriceArchiveController({db:supabaseFetch,storage:archiveStorage,reader:archiveReader,isBusy:()=>priceSnapshot.status().running,enabled:()=>process.env.PRICE_ARCHIVE_ENABLED!=='false'});
let sitemapWarm=null,coverageWarm=null;
server.listen(port,()=>{
  if(supabaseConfigured()&&process.env.CATALOG_WARM_ON_START!=='false'){priceSnapshot.start();priceArchive.start()}
  console.log(`CardScope is running at http://localhost:${port}`);
  // Load the catalog and product feed now so the first visitor after a deploy does not wait 2-4 s for them.
  if(process.env.CATALOG_WARM_ON_START!=='false'&&supabaseConfigured()){loadCatalog().catch(error=>console.error('catalog warm-up failed',error.message));loadCatalogHealth().catch(error=>console.error('health warm-up failed',error.message));loadProductSets().catch(error=>console.error('product warm-up failed',error.message));loadTrendSnapshot().catch(error=>console.error('trend warm-up failed',error.message));
    // Coverage pages through every card and printing (about a minute cold); start it after the lighter warm-ups so the first visitor after a restart does not wait for it.
    setTimeout(()=>{coverageWarm=loadCatalogCoverage().catch(error=>console.error('coverage warm-up failed',error.message))},30000).unref();
    // The sitemap scans every card (about a minute cold, 24-hour cache): build it after the other warm-ups so a crawler's first request is not the one that waits.
    setTimeout(()=>{sitemapWarm=loadSitemaps().catch(error=>console.error('sitemap warm-up failed',error.message))},15000).unref()}
  // A kept-warm instance can run for days, so the 72-hour freshness check repeats hourly instead of only at start-up.
  if(process.env.CATALOG_SYNC_ON_START!=='false'&&supabaseConfigured()){let syncRunning=false,firstRun=true;const runScheduledCatalogSync=async()=>{if(syncRunning)return;syncRunning=true;const startup=firstRun;firstRun=false;try{if(startup)await Promise.allSettled([sitemapWarm,coverageWarm]);const maxAgeHours=Math.max(1,Number(process.env.CATALOG_SYNC_MAX_AGE_HOURS)||72),needed=await catalogProvidersNeedingSync(supabaseFetch,maxAgeHours,{includeTcgdexTw:process.env.TCGDEX_TW_SYNC==='true'}),providers=filterAllowedCatalogProviders(needed),blocked=needed.filter(provider=>!providers.includes(provider));if(blocked.length)console.warn('source policy blocked scheduled catalog sync',blocked.join(','));if(providers.length){console.log('starting scheduled catalog sync',providers.join(','));const result=await syncCatalog(supabaseFetch,{providers});console.log('scheduled catalog sync complete',JSON.stringify(result))}{const keys=await refreshBrowseKeys(supabaseFetch);if(Object.keys(keys).length)console.log('browse keys rebuilt',JSON.stringify(keys))}const cacheSetting=process.env.CARD_IMAGE_CACHE_ON_START,shouldCacheImages=((startup&&cacheSetting==='true')||(cacheSetting!=='false'&&providers.includes('yugioh')))&&imageCollectionAllowed('yugioh');if(shouldCacheImages){console.log('starting card image cache');const images=await cacheYugiohImages(supabaseFetch,{limit:Number(process.env.CARD_IMAGE_CACHE_LIMIT||15000),concurrency:Number(process.env.CARD_IMAGE_CACHE_CONCURRENCY||4)});console.log('card image cache complete',JSON.stringify(images))}}catch(error){console.error('scheduled catalog/image sync failed',error.message)}finally{syncRunning=false}};
    // The first look waits until the sitemap and coverage warm-ups (15 s and 30 s after start) are done: a sync holds tens of MB (YGOPRODeck's card list alone is 20 MB of JSON) and must not peak together with them.
    setTimeout(runScheduledCatalogSync,process.env.CATALOG_WARM_ON_START!=='false'?45000:3000);const intervalMinutes=Number(process.env.CATALOG_SYNC_INTERVAL_MINUTES??60);if(intervalMinutes>0)setInterval(runScheduledCatalogSync,intervalMinutes*60000).unref()}
});

// Keep the pure browse helpers available to contract tests and maintenance
// tooling without changing the public HTTP surface.
export { buildPriceMovers, buildVersionPrices, referencePriceFromRow, normalizeBrowseSort, buildPriceHistory, accumulateCoverage, adjustCoverageGame, buildBrowseFacets, buildBrowsePage, buildPrintingIndex, buildCoverageGame, browseCache, cachedBrowseRows, createCoverageAccumulator, finishCoverage, browseValues, coverageMetric, rarityCanonicalCode, rarityDisplayLabel, server };


