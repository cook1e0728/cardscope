// 第 2 步第二批 Cloudflare Worker：送出靜態檔、無資料庫 SEO 頁、20 支讀取 API、7 支認證／收藏雲端同步寫入 API，以及 3 支讀 Workers KV 的首頁統計與覆蓋率端點。
import { createRateLimiter } from '../providers/backend-reliability.mjs';
import {
  API_CSP,
  NOT_FOUND_HTML,
  REVALIDATE_EXTENSIONS,
  buildPageCsp,
  computeInlineScriptSources,
  isPublicStaticPath,
  mergeVaryHeader,
  renderSecurityTxt,
  securityHeadersForPath,
  seoRequestTarget
} from '../providers/http-security.mjs';
import { KV_KEYS } from '../providers/kv-snapshots.mjs';
import { createReadApi } from '../providers/read-api.mjs';
import { applySeoToHtml, homeSeo, normalizeBaseUrl, renderRobotsTxt, viewSeo } from '../providers/seo.mjs';

export { KV_KEYS };

export const DEFAULT_ORIGIN_URL = 'https://cardscope.onrender.com';
export const WORKER_GAME_IDS = Object.freeze([
  'pokemon',
  'onepiece',
  'yugioh',
  'haikyuu',
  'weiss-schwarz',
  'dragonball-fw',
  'union-arena'
]);

export const DEFAULT_MIGRATED_APIS = Object.freeze([
  'catalog-health',
  'providers',
  'catalog-sources',
  'catalog-sync-status',
  'trends',
  'buyback-prices',
  'images-onepiece',
  'catalog',
  'products',
  'cards',
  'search',
  'card-detail',
  'card-market',
  'exchange-rates',
  'hot-cards',
  'market-events',
  'price-movers',
  'prices-reference',
  'reports-meta',
  'reports',
  'auth-config',
  'auth-exchange',
  'auth-refresh',
  'auth-logout',
  'sync-pull',
  'sync-push',
  'sync-delete',
  'pack-prizes',
  'series-hits',
  'catalog-coverage'
]);

const DEFAULT_MIGRATED_SET = new Set(DEFAULT_MIGRATED_APIS);

const MIGRATED_API_ALIASES = new Map([
  ['/api/catalog/health', 'catalog-health'],
  ['/api/providers', 'providers'],
  ['/api/catalog/sources', 'catalog-sources'],
  ['/api/catalog/sync-status', 'catalog-sync-status'],
  ['/api/trends', 'trends'],
  ['/api/buyback-prices', 'buyback-prices'],
  ['/api/images/onepiece', 'images-onepiece'],
  ['/api/catalog', 'catalog'],
  ['/api/products', 'products'],
  ['/api/cards', 'cards'],
  ['/api/search', 'search'],
  ['/api/cards/:id', 'card-detail'],
  ['/api/cards/:id/market', 'card-market'],
  ['/api/exchange-rates', 'exchange-rates'],
  ['/api/hot-cards', 'hot-cards'],
  ['/api/market-events', 'market-events'],
  ['/api/price-movers', 'price-movers'],
  ['/api/prices/reference', 'prices-reference'],
  ['/api/reports/meta', 'reports-meta'],
  ['/api/reports', 'reports'],
  ['/api/auth/config', 'auth-config'],
  ['/api/auth/exchange', 'auth-exchange'],
  ['/api/auth/refresh', 'auth-refresh'],
  ['/api/auth/logout', 'auth-logout'],
  ['/api/sync/pull', 'sync-pull'],
  ['/api/sync/push', 'sync-push'],
  ['/api/sync/delete', 'sync-delete'],
  ['/api/pack-prizes', 'pack-prizes'],
  ['/api/series-hits', 'series-hits'],
  ['/api/catalog/coverage', 'catalog-coverage'],
  ['coverage', 'catalog-coverage']
]);

const MIGRATED_API_GROUPS = new Map([
  ['auth', ['auth-config', 'auth-exchange', 'auth-refresh', 'auth-logout']],
  ['/api/auth', ['auth-config', 'auth-exchange', 'auth-refresh', 'auth-logout']],
  ['/api/auth/*', ['auth-config', 'auth-exchange', 'auth-refresh', 'auth-logout']],
  ['sync', ['sync-pull', 'sync-push', 'sync-delete']],
  ['/api/sync', ['sync-pull', 'sync-push', 'sync-delete']],
  ['/api/sync/*', ['sync-pull', 'sync-push', 'sync-delete']]
]);

const AUTH_POST_APIS = new Set(['auth-exchange', 'auth-refresh', 'auth-logout']);
const SYNC_POST_APIS = new Set(['sync-pull', 'sync-push', 'sync-delete']);

function normalizeApiTokens(token) {
  const key = String(token || '').trim().toLowerCase();
  if (!key) return [];
  const group = MIGRATED_API_GROUPS.get(key);
  if (group) return group;
  if (DEFAULT_MIGRATED_SET.has(key)) return [key];
  return [MIGRATED_API_ALIASES.get(key) || key];
}

/**
 * 解析 MIGRATED_API 環境變數：
 * - 未設定／all／default：啟用全部 DEFAULT_MIGRATED_APIS
 * - none / off / false / 0：全部切回代理 Render
 * - "-cards,-search,-sync-push,-auth-exchange"（或群組 "-auth,-sync"）：在預設清單中關閉指定端點以便單支回滾
 * - "all,-cards,-search" / "default,-catalog"：全部啟用後再扣除指定端點
 * - "cards,search"（或搭配 "-search"）：先加入正向白名單再扣除負向項目
 */
export function resolveMigratedApis(env) {
  const raw = env?.MIGRATED_API;
  if (raw === undefined || raw === null) return new Set(DEFAULT_MIGRATED_APIS);
  const text = String(raw).trim();
  if (!text || text.toLowerCase() === 'all' || text.toLowerCase() === 'default') return new Set(DEFAULT_MIGRATED_APIS);
  if (['none', 'off', 'false', '0'].includes(text.toLowerCase())) return new Set();

  const tokens = text.split(',').map(part => part.trim()).filter(Boolean);
  if (!tokens.length) return new Set(DEFAULT_MIGRATED_APIS);

  const allNegative = tokens.every(token => token.startsWith('-'));
  let hasAll = false;
  const positives = [];
  const negatives = [];
  for (const token of tokens) {
    if (token.startsWith('-')) {
      for (const key of normalizeApiTokens(token.slice(1))) {
        if (key) negatives.push(key);
      }
      continue;
    }
    const lower = token.toLowerCase();
    if (lower === 'all' || lower === 'default') {
      hasAll = true;
      continue;
    }
    for (const key of normalizeApiTokens(token)) {
      if (DEFAULT_MIGRATED_SET.has(key)) positives.push(key);
    }
  }

  const enabled = (allNegative || hasAll)
    ? new Set(DEFAULT_MIGRATED_APIS)
    : new Set(positives);
  for (const key of negatives) enabled.delete(key);
  return enabled;
}

const EXACT_GET_API_MAP = new Map([
  ['/api/providers', 'providers'],
  ['/api/catalog/sources', 'catalog-sources'],
  ['/api/catalog/sync-status', 'catalog-sync-status'],
  ['/api/trends', 'trends'],
  ['/api/buyback-prices', 'buyback-prices'],
  ['/api/images/onepiece', 'images-onepiece'],
  ['/api/catalog', 'catalog'],
  ['/api/products', 'products'],
  ['/api/cards', 'cards'],
  ['/api/search', 'search'],
  ['/api/exchange-rates', 'exchange-rates'],
  ['/api/hot-cards', 'hot-cards'],
  ['/api/market-events', 'market-events'],
  ['/api/price-movers', 'price-movers'],
  ['/api/reports/meta', 'reports-meta'],
  ['/api/reports', 'reports'],
  ['/api/auth/config', 'auth-config'],
  ['/api/pack-prizes', 'pack-prizes'],
  ['/api/series-hits', 'series-hits'],
  ['/api/catalog/coverage', 'catalog-coverage']
]);

const EXACT_POST_API_MAP = new Map([
  ['/api/prices/reference', 'prices-reference'],
  ['/api/auth/exchange', 'auth-exchange'],
  ['/api/auth/refresh', 'auth-refresh'],
  ['/api/auth/logout', 'auth-logout'],
  ['/api/sync/pull', 'sync-pull'],
  ['/api/sync/push', 'sync-push'],
  ['/api/sync/delete', 'sync-delete']
]);

/** 判斷請求是否對應已搬遷的端點 key；未搬遷（price-history、graded/ebay、admin 等）回 null。 */
export function matchMigratedApi(url, method = 'GET') {
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return null;
  if (pathname === '/api/catalog/health' && (method === 'GET' || method === 'HEAD')) return 'catalog-health';
  if (method === 'POST') return EXACT_POST_API_MAP.get(pathname) || null;
  if (method !== 'GET') return null;

  const exact = EXACT_GET_API_MAP.get(pathname);
  if (exact) return exact;

  if (pathname.startsWith('/api/cards/')) {
    let tail = '';
    try {
      tail = decodeURIComponent(pathname.slice(11));
    } catch {
      return 'card-detail';
    }
    if (tail.endsWith('/price-history')) return null;
    if (tail.endsWith('/market')) return 'card-market';
    return 'card-detail';
  }
  return null;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host'
]);

export function resolveOriginUrl(env) {
  const raw = String(env?.ORIGIN_URL || '').trim();
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
    } catch { /* 退回預設原點 */ }
  }
  return DEFAULT_ORIGIN_URL;
}

export function shouldProxyToOrigin(url, method, env) {
  if (url.pathname.startsWith('/api/')) {
    const apiKey = matchMigratedApi(url, method);
    if (apiKey && resolveMigratedApis(env).has(apiKey)) return null;
    return 'api';
  }
  if ((method === 'GET' || method === 'HEAD') && (url.pathname === '/sitemap.xml' || /^\/sitemaps\/(?:pages|series|cards-\d+)\.xml$/.test(url.pathname))) {
    return 'sitemap';
  }
  if ((method === 'GET' || method === 'HEAD') && url.pathname === '/' && Boolean(seoRequestTarget(url))) {
    return 'seo-db';
  }
  return null;
}

const TEXT_ENCODER = new TextEncoder();

async function sha1Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', TEXT_ENCODER.encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(text));
  return new Uint8Array(digest);
}

async function safeTokenEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const [a, b] = await Promise.all([sha256Bytes(actual), sha256Bytes(expected)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function adminAuthorized(request, env) {
  const expected = env?.SCRAPE_SECRET;
  if (typeof expected !== 'string' || !expected) return false;
  const xScrapeToken = request.headers.get('x-scrape-token');
  const authorization = String(request.headers.get('authorization') || '');
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch ? bearerMatch[1] : null;
  const token = xScrapeToken || bearer;
  return safeTokenEqual(token, expected);
}

function etagMatches(request, etag) {
  const header = request.headers.get('if-none-match');
  if (!header) return false;
  return header.split(',').some(value => value.trim().replace(/^W\//i, '') === etag);
}

function pathExtension(pathname) {
  const base = pathname.split('/').at(-1) || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

function gameIdsForEnv(env) {
  const list = env?.SECOND_DB_ENABLED === 'false'
    ? WORKER_GAME_IDS.filter(id => id !== 'union-arena')
    : WORKER_GAME_IDS;
  return new Set(list);
}

function readApiSignature(env) {
  return [
    env?.SUPABASE_URL || '',
    env?.SUPABASE_SERVICE_KEY || '',
    env?.SUPABASE2_URL || '',
    env?.SUPABASE2_SERVICE_KEY || '',
    env?.SUPABASE2_ANON_KEY || '',
    env?.SUPABASE2_TIMEOUT_MS || '',
    env?.AUTH_CACHE_MS || '',
    env?.AUTH_CACHE_MAX || '',
    env?.SCRAPE_SECRET || '',
    env?.JPY_TO_TWD || '',
    env?.USD_TO_TWD || '',
    env?.CATALOG_CACHE_TTL_MS || '',
    env?.PRODUCT_CACHE_TTL_MS || '',
    env?.CATALOG_SNAPSHOT_CACHE_MS || '',
    env?.CATALOG_SNAPSHOT_MAX_STALE_MS || ''
  ].join('\u001f');
}

export function createWorkerHandler({ fetchFn = globalThis.fetch, now = Date.now, edgeCache = undefined } = {}) {
  let cachedIndex = null;
  const readApiInstances = new Map();
  const rateLimiters = new Map();

  function getRateLimiters(env) {
    const apiLimit = Math.max(1, Math.floor(Number(env?.API_RATE_LIMIT_PER_MINUTE) || 240));
    const imageLimit = Math.max(1, Math.floor(Number(env?.IMAGE_RATE_LIMIT_PER_MINUTE) || 1200));
    const authLimit = Math.max(1, Math.floor(Number(env?.AUTH_RATE_LIMIT_PER_MINUTE) || 10));
    const syncLimit = Math.max(1, Math.floor(Number(env?.SYNC_RATE_LIMIT_PER_MINUTE) || 6));
    const key = `${apiLimit}|${imageLimit}|${authLimit}|${syncLimit}`;
    let group = rateLimiters.get(key);
    if (!group) {
      group = {
        apiLimiter: createRateLimiter({ limit: apiLimit, windowMs: 60000, maxKeys: 2000, now }),
        imageLimiter: createRateLimiter({ limit: imageLimit, windowMs: 60000, maxKeys: 2000, now }),
        authLimiter: createRateLimiter({ limit: authLimit, windowMs: 60000, maxKeys: 2000, now }),
        syncLimiter: createRateLimiter({ limit: syncLimit, windowMs: 60000, maxKeys: 2000, now })
      };
      rateLimiters.set(key, group);
      while (rateLimiters.size > 4) rateLimiters.delete(rateLimiters.keys().next().value);
    }
    return group;
  }

  function getReadApi(env) {
    const key = readApiSignature(env);
    let instance = readApiInstances.get(key);
    if (!instance) {
      instance = createReadApi({ env, fetchFn, now, edgeCache });
      readApiInstances.set(key, instance);
      while (readApiInstances.size > 8) readApiInstances.delete(readApiInstances.keys().next().value);
    }
    return instance;
  }

  async function loadIndexAndCsp(env, origin) {
    if (cachedIndex) return cachedIndex;
    if (!env?.ASSETS?.fetch) return { indexHtml: null, pageCsp: buildPageCsp([]) };
    try {
      const res = await env.ASSETS.fetch(new Request(new URL('/index.html', origin)));
      if (!res || !res.ok) return { indexHtml: null, pageCsp: buildPageCsp([]) };
      const indexHtml = await res.text();
      const inlineSources = await computeInlineScriptSources(indexHtml);
      cachedIndex = { indexHtml, pageCsp: buildPageCsp(inlineSources) };
      return cachedIndex;
    } catch {
      return { indexHtml: null, pageCsp: buildPageCsp([]) };
    }
  }

  function applyHeaders(headers, pathname, pageCsp) {
    for (const [name, value] of Object.entries(securityHeadersForPath(pathname, pageCsp))) {
      headers.set(name, value);
    }
    headers.set('Vary', mergeVaryHeader(headers.get('Vary')));
    return headers;
  }

  function respondJson(pathname, status, body, pageCsp, extraHeaders = {}) {
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    });
    applyHeaders(headers, pathname, pageCsp);
    return new Response(JSON.stringify(body), { status, headers });
  }

  function respondText(pathname, status, body, contentType, cacheControl, pageCsp, method = 'GET') {
    const headers = new Headers({
      'Content-Type': contentType,
      'Cache-Control': cacheControl
    });
    applyHeaders(headers, pathname, pageCsp);
    return new Response(method === 'HEAD' ? null : body, { status, headers });
  }

  function respondNotFound(pathname, pageCsp, method = 'GET') {
    if (pathname.startsWith('/api/')) return respondJson(pathname, 404, { error: 'Not found' }, pageCsp);
    return respondText(pathname, 404, NOT_FOUND_HTML, 'text/html; charset=utf-8', 'no-store', pageCsp, method);
  }

  async function proxyRequest(request, url, env, proxyKind, indexHtml, pageCsp) {
    const originUrl = resolveOriginUrl(env);
    const targetUrl = new URL(`${url.pathname}${url.search}`, originUrl);
    const outReqHeaders = new Headers();
    for (const [name, value] of request.headers.entries()) {
      const lower = name.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (lower === 'x-origin-verify' || lower === 'x-client-ip') continue;
      if (lower.startsWith('cf-')) continue;
      outReqHeaders.set(name, value);
    }
    if (env?.ORIGIN_VERIFY_SECRET) {
      outReqHeaders.set('x-origin-verify', String(env.ORIGIN_VERIFY_SECRET));
      // Render 也在 Cloudflare 後面，cf-connecting-ip 會被改成 Worker 出口 IP；真實訪客 IP 改用 x-client-ip 傳，只在帶密鑰時送。
      const clientIp = request.headers.get('cf-connecting-ip');
      if (clientIp) outReqHeaders.set('x-client-ip', clientIp);
    }

    let upstream;
    try {
      const init = {
        method: request.method,
        headers: outReqHeaders,
        redirect: 'manual',
        signal: AbortSignal.timeout(proxyKind === 'seo-db' ? 1500 : 30000)
      };
      if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
        init.body = request.body;
        init.duplex = 'half';
      }
      upstream = await fetchFn(targetUrl.href, init);
    } catch {
      if (proxyKind === 'seo-db' && indexHtml !== null) {
        return respondText(url.pathname, 200, indexHtml, 'text/html; charset=utf-8', 'no-cache', pageCsp, request.method);
      }
      if (proxyKind === 'sitemap') {
        return respondJson(url.pathname, 503, { error: 'Sitemap 暫時無法產生' }, pageCsp);
      }
      return respondJson(url.pathname, 502, { error: '資料暫時無法讀取' }, pageCsp);
    }

    const resHeaders = new Headers();
    for (const [name, value] of upstream.headers.entries()) {
      if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
      resHeaders.append(name, value);
    }
    // fetch() 已自動解壓回應串流，必須移除不再對應 stream 長度與編碼的標頭，避免客戶端二次解碼失敗。
    if (request.method !== 'HEAD' && resHeaders.has('content-encoding')) {
      resHeaders.delete('content-encoding');
      resHeaders.delete('content-length');
    }
    applyHeaders(resHeaders, url.pathname, pageCsp);
    if (proxyKind === 'api') resHeaders.set('Content-Security-Policy', API_CSP);

    const noBody = request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304;
    return new Response(noBody ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: resHeaders
    });
  }

  return {
    async fetch(request, env, ctx) {
      let url;
      try {
        url = new URL(request.url);
        decodeURIComponent(url.pathname);
      } catch {
        const pageCsp = cachedIndex?.pageCsp || buildPageCsp([]);
        return respondJson('/api/bad-url', 400, { error: '網址格式錯誤' }, pageCsp);
      }

      const publicBaseUrl = normalizeBaseUrl(env?.PUBLIC_BASE_URL);
      const canonicalHost = new URL(publicBaseUrl).hostname.toLowerCase();

      if (url.hostname.toLowerCase() === `www.${canonicalHost}`) {
        const pageCsp = cachedIndex?.pageCsp || buildPageCsp([]);
        const headers = new Headers({
          Location: `${publicBaseUrl}${url.pathname}${url.search}`,
          'Cache-Control': 'public, max-age=86400'
        });
        applyHeaders(headers, url.pathname, pageCsp);
        return new Response(null, { status: 301, headers });
      }

      const apiKey = matchMigratedApi(url, request.method);
      if (apiKey && resolveMigratedApis(env).has(apiKey)) {
        const cfIp = String(request.headers.get('cf-connecting-ip') || '').trim();
        const { apiLimiter, imageLimiter, authLimiter, syncLimiter } = getRateLimiters(env);
        if (cfIp && !(await adminAuthorized(request, env))) {
          const limiter = apiKey === 'images-onepiece' ? imageLimiter : apiLimiter;
          if (!limiter(cfIp)) {
            return respondJson(url.pathname, 429, { error: '請求太頻繁，請稍後再試' }, API_CSP, { 'Retry-After': '60' });
          }
        }
        if (AUTH_POST_APIS.has(apiKey)) {
          if (!authLimiter(cfIp || 'unknown')) {
            return respondJson(url.pathname, 429, { error: '登入太頻繁，請一分鐘後再試' }, API_CSP, { 'Retry-After': '60' });
          }
        } else if (SYNC_POST_APIS.has(apiKey)) {
          if (!syncLimiter(cfIp || 'unknown')) {
            return respondJson(url.pathname, 429, { error: '同步太頻繁，請一分鐘後再試' }, API_CSP, { 'Retry-After': '60' });
          }
        }
        const apiResponse = await getReadApi(env).handle(apiKey, request, url, ctx, env);
        const headers = new Headers(apiResponse.headers);
        applyHeaders(headers, url.pathname, API_CSP);
        headers.set('Content-Security-Policy', API_CSP);
        const noBody = request.method === 'HEAD' || apiResponse.status === 204 || apiResponse.status === 304;
        return new Response(noBody ? null : apiResponse.body, {
          status: apiResponse.status,
          statusText: apiResponse.statusText,
          headers
        });
      }

      const proxyKind = shouldProxyToOrigin(url, request.method, env);
      const needsPageAsset = !proxyKind || proxyKind === 'seo-db';
      const { indexHtml, pageCsp } = needsPageAsset ? await loadIndexAndCsp(env, url.origin) : { indexHtml: null, pageCsp: API_CSP };

      if (proxyKind) {
        return proxyRequest(request, url, env, proxyKind, indexHtml, pageCsp);
      }

      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/.well-known/security.txt') {
        return respondText(
          url.pathname,
          200,
          renderSecurityTxt(publicBaseUrl, now()),
          'text/plain; charset=utf-8',
          'public, max-age=3600',
          pageCsp,
          request.method
        );
      }

      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/robots.txt') {
        return respondText(
          url.pathname,
          200,
          renderRobotsTxt(publicBaseUrl),
          'text/plain; charset=utf-8',
          'public, max-age=3600',
          pageCsp,
          request.method
        );
      }

      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/') {
        if (indexHtml === null) return respondNotFound(url.pathname, pageCsp, request.method);
        const game = url.searchParams.get('game');
        const gameSet = gameIdsForEnv(env);
        const seo = url.searchParams.has('view')
          ? viewSeo({ view: url.searchParams.get('view'), baseUrl: publicBaseUrl })
          : homeSeo({ gameId: gameSet.has(game) ? game : '', baseUrl: publicBaseUrl });
        const body = seo ? applySeoToHtml(indexHtml, seo) : indexHtml;
        const etag = `"${await sha1Hex(body)}"`;
        if (etagMatches(request, etag)) {
          const headers = new Headers({ 'Cache-Control': 'no-cache', ETag: etag });
          applyHeaders(headers, url.pathname, pageCsp);
          return new Response(null, { status: 304, headers });
        }
        const headers = new Headers({
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          ETag: etag
        });
        applyHeaders(headers, url.pathname, pageCsp);
        return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
      }

      if (!isPublicStaticPath(url.pathname)) {
        return respondNotFound(url.pathname, pageCsp, request.method);
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const headers = new Headers({ Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
        applyHeaders(headers, url.pathname, pageCsp);
        return new Response(null, { status: 405, headers });
      }

      if (!env?.ASSETS?.fetch) return respondNotFound(url.pathname, pageCsp, request.method);

      const assetReq = new Request(new URL(url.pathname, url.origin), {
        method: request.method,
        headers: request.headers
      });
      const assetRes = await env.ASSETS.fetch(assetReq);
      if (!assetRes || assetRes.status === 404) {
        return respondNotFound(url.pathname, pageCsp, request.method);
      }

      const headers = new Headers(assetRes.headers);
      applyHeaders(headers, url.pathname, pageCsp);
      if (REVALIDATE_EXTENSIONS.has(pathExtension(url.pathname))) {
        headers.set('Cache-Control', 'no-cache');
      }

      const noBody = request.method === 'HEAD' || assetRes.status === 204 || assetRes.status === 304;
      return new Response(noBody ? null : assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers
      });
    }
  };
}

export default createWorkerHandler();
