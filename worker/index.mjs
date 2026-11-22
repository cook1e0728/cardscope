// 第 1 步 Cloudflare Worker：提供前端靜態檔與無資料庫 SEO 頁；/api/*、/sitemap* 與需查庫的 ?card=/?series= 先代理回 Render 原點。
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
import { applySeoToHtml, homeSeo, normalizeBaseUrl, renderRobotsTxt, viewSeo } from '../providers/seo.mjs';

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

export function shouldProxyToOrigin(url, method) {
  if (url.pathname.startsWith('/api/')) return 'api';
  if ((method === 'GET' || method === 'HEAD') && (url.pathname === '/sitemap.xml' || /^\/sitemaps\/(?:pages|series|cards-\d+)\.xml$/.test(url.pathname))) {
    return 'sitemap';
  }
  if ((method === 'GET' || method === 'HEAD') && url.pathname === '/' && Boolean(seoRequestTarget(url))) {
    return 'seo-db';
  }
  return null;
}

async function sha1Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
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

export function createWorkerHandler({ fetchFn = globalThis.fetch, now = Date.now } = {}) {
  let cachedIndex = null;

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
    async fetch(request, env) {
      let url;
      try {
        url = new URL(request.url);
        decodeURIComponent(url.pathname);
      } catch {
        const pageCsp = cachedIndex?.pageCsp || buildPageCsp([]);
        return respondJson('/api/bad-url', 400, { error: '網址格式錯誤' }, pageCsp);
      }

      const { indexHtml, pageCsp } = await loadIndexAndCsp(env, url.origin);
      const publicBaseUrl = normalizeBaseUrl(env?.PUBLIC_BASE_URL);
      const canonicalHost = new URL(publicBaseUrl).hostname.toLowerCase();

      if (url.hostname.toLowerCase() === `www.${canonicalHost}`) {
        const headers = new Headers({
          Location: `${publicBaseUrl}${url.pathname}${url.search}`,
          'Cache-Control': 'public, max-age=86400'
        });
        applyHeaders(headers, url.pathname, pageCsp);
        return new Response(null, { status: 301, headers });
      }

      const proxyKind = shouldProxyToOrigin(url, request.method);
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
