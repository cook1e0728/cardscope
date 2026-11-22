import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import {
  API_CSP,
  NOT_FOUND_HTML,
  PUBLIC_STATIC,
  REVALIDATE_EXTENSIONS,
  SECURITY_HEADERS,
  buildPageCsp,
  computeInlineScriptSources,
  isPublicStaticPath,
  seoRequestTarget
} from '../providers/http-security.mjs';
import { prepareWorkerAssets } from '../scripts/prepare-worker-assets.mjs';
import { DEFAULT_ORIGIN_URL, createWorkerHandler, resolveOriginUrl, shouldProxyToOrigin } from '../worker/index.mjs';

const ROOT = new URL('..', import.meta.url);
const FETCH_BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080
]);

async function freePort() {
  for (;;) {
    const probe = createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', resolve);
    });
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    if (!FETCH_BAD_PORTS.has(port)) return port;
  }
}

async function withOriginServer(name, env, run) {
  const keys = ['PORT', 'CATALOG_SYNC_ON_START', 'CATALOG_WARM_ON_START', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'PUBLIC_BASE_URL', 'CANONICAL_REDIRECT', ...Object.keys(env)];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let app;
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.CANONICAL_REDIRECT;
    Object.assign(process.env, {
      PORT: String(await freePort()),
      CATALOG_SYNC_ON_START: 'false',
      CATALOG_WARM_ON_START: 'false',
      PUBLIC_BASE_URL: 'https://cardseektcg.com',
      ...env
    });
    ({ server: app } = await import(`../server.mjs?worker-parity-${name}`));
    if (!app.listening) await new Promise(resolve => app.once('listening', resolve));
    return await run(`http://127.0.0.1:${app.address().port}`);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    if (app?.listening) await new Promise(resolve => app.close(resolve));
  }
}

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json'
};

function createLocalAssetsBinding(dir) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const rel = url.pathname.replace(/^\/+/, '');
      const fullPath = join(dir, rel);
      if (!existsSync(fullPath)) return new Response('Not found', { status: 404 });
      const data = await readFile(fullPath);
      const ext = extname(fullPath).toLowerCase();
      return new Response(request.method === 'HEAD' ? null : data, {
        status: 200,
        headers: { 'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream' }
      });
    }
  };
}

test('prepareWorkerAssets copies only PUBLIC_STATIC allowlist, blocks secrets/server files, and generates valid _headers', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'cardseek-worker-assets-'));
  try {
    const result = await prepareWorkerAssets({ outDir });
    assert.ok(result.copied.includes('/index.html'));
    assert.ok(result.copied.includes('/look-v2.css'));
    assert.ok(result.copied.includes('/sw.js'));
    assert.ok(result.copied.includes('/manifest.webmanifest'));
    assert.ok(result.copied.includes('/data/game-taxonomy.json'));
    assert.ok(result.copied.includes('/data/rarity-rankings.json'));
    assert.ok(result.copied.some(p => p.startsWith('/assets/brand/web/')));

    for (const forbidden of [
      'server.mjs',
      'wrangler.toml',
      'package.json',
      'TASK.md',
      'providers',
      'docs',
      'scripts',
      'supabase',
      'test',
      'data/catalog.json',
      'data/source-registry.json',
      'assets/brand/voice'
    ]) {
      assert.equal(existsSync(join(outDir, forbidden)), false, `must not copy ${forbidden}`);
    }

    const headersText = await readFile(join(outDir, '_headers'), 'utf8');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.ok(headersText.includes(`  ${name}: ${value}`), `missing ${name}`);
    }
    assert.ok(headersText.includes(`  Content-Security-Policy: ${result.pageCsp}`));
    assert.ok(headersText.includes('\n/index.html\n  Cache-Control: no-cache\n'));
    assert.ok(headersText.includes('\n/look-v2.css\n  Cache-Control: no-cache\n'));
    assert.ok(headersText.includes('\n/manifest.webmanifest\n  Cache-Control: no-cache\n'));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('prepareWorkerAssets never copies .env* or non-allowlisted files from a synthetic repo', async () => {
  const fakeRepo = await mkdtemp(join(tmpdir(), 'cardseek-fake-repo-'));
  const outDir = await mkdtemp(join(tmpdir(), 'cardseek-fake-out-'));
  try {
    await writeFile(join(fakeRepo, 'index.html'), '<!doctype html><script>console.log(1)</script>');
    await writeFile(join(fakeRepo, 'app.js'), 'console.log(1);');
    await writeFile(join(fakeRepo, 'server.mjs'), 'console.log("secret");');
    await writeFile(join(fakeRepo, '.env'), 'SECRET=1');
    await writeFile(join(fakeRepo, '.env.local'), 'SECRET=2');
    await mkdir(join(fakeRepo, 'providers'), { recursive: true });
    await writeFile(join(fakeRepo, 'providers', 'secret.mjs'), 'export default 1;');
    await mkdir(join(fakeRepo, 'data'), { recursive: true });
    await writeFile(join(fakeRepo, 'data', 'game-taxonomy.json'), '{}');
    await writeFile(join(fakeRepo, 'data', 'catalog.json'), '{}');

    const result = await prepareWorkerAssets({ rootDir: fakeRepo, outDir });
    assert.deepEqual(result.copied, ['/app.js', '/data/game-taxonomy.json', '/index.html']);
    for (const denied of ['.env', '.env.local', 'server.mjs', 'providers', 'data/catalog.json']) {
      assert.equal(existsSync(join(outDir, denied)), false, `synthetic ${denied} must not be copied`);
    }
  } finally {
    await rm(fakeRepo, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test('worker blocks private/non-allowlisted paths without ever touching ASSETS, and returns 400 on malformed URLs', async () => {
  let assetCalls = 0;
  const handler = createWorkerHandler({
    fetchFn: async () => {
      throw new Error('origin should not be called');
    }
  });
  const env = {
    ASSETS: {
      async fetch(req) {
        assetCalls++;
        const url = new URL(req.url);
        if (url.pathname === '/index.html') {
          return new Response('<!doctype html><title>好卡在 CardSeek</title><script>console.log(1)</script>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        return new Response('LEAKED', { status: 200 });
      }
    }
  };

  // 暖一次讀取 index.html
  await handler.fetch(new Request('https://cardseektcg.com/'), env);
  const callsAfterWarmup = assetCalls;

  for (const path of [
    '/server.mjs',
    '/providers/seo.mjs',
    '/docs/PRODUCT_PLAN.md',
    '/.env',
    '/.env.local',
    '/package.json',
    '/wrangler.toml',
    '/data/catalog.json',
    '/data/source-registry.json',
    '/assets/../../server.mjs',
    '/assets/%2e%2e/server.mjs',
    '/_headers',
    '/.git/config'
  ]) {
    const res = await handler.fetch(new Request(`https://cardseektcg.com${path}`), env);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get('cache-control'), 'no-store', path);
    const body = await res.text();
    assert.ok(body.includes('找不到這個頁面'), path);
    assert.equal(body.includes('LEAKED'), false, path);
  }
  assert.equal(assetCalls, callsAfterWarmup, 'blocked paths must never invoke ASSETS.fetch');

  const badPct = await handler.fetch(new Request('https://cardseektcg.com/%E0%A4%A'), env);
  assert.equal(badPct.status, 400);
  assert.deepEqual(await badPct.json(), { error: '網址格式錯誤' });

  const postStatic = await handler.fetch(new Request('https://cardseektcg.com/look-v2.css', { method: 'POST' }), env);
  assert.equal(postStatic.status, 405);
  assert.equal(postStatic.headers.get('allow'), 'GET, HEAD');
});

test('worker security headers, inline script SHA-256 hashes, and CSP match server.mjs 100%', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'cardseek-worker-parity-'));
  try {
    await prepareWorkerAssets({ outDir });
    const indexHtml = await readFile(new URL('index.html', ROOT), 'utf8');
    const webHashes = await computeInlineScriptSources(indexHtml);
    assert.equal(webHashes.length >= 3, true);
    assert.equal(buildPageCsp(webHashes).includes("'unsafe-inline' '"), false);

    // 確認 Web Crypto 與 Node createHash 完全等價
    const nodeFirst = `'sha256-${createHash('sha256').update(indexHtml.match(/<script(?![^>]*\s(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/)[1]).digest('base64')}'`;
    assert.equal(webHashes[0], nodeFirst);

    await withOriginServer('headers', {}, async originUrl => {
      const handler = createWorkerHandler();
      const env = {
        ORIGIN_URL: originUrl,
        PUBLIC_BASE_URL: 'https://cardseektcg.com',
        ASSETS: createLocalAssetsBinding(outDir)
      };

      const checkHeaders = [
        'x-content-type-options',
        'referrer-policy',
        'x-frame-options',
        'strict-transport-security',
        'permissions-policy',
        'cross-origin-opener-policy',
        'content-security-policy'
      ];

      for (const path of [
        '/',
        '/?game=pokemon',
        '/?view=about',
        '/?view=collection',
        '/index.html',
        '/look-v2.css',
        '/robots.txt',
        '/.well-known/security.txt',
        '/nonexistent',
        '/api/providers',
        '/api/nonexistent'
      ]) {
        const originRes = await fetch(`${originUrl}${path}`);
        const workerRes = await handler.fetch(new Request(`https://cardseektcg.com${path}`), env);
        assert.equal(workerRes.status, originRes.status, `status mismatch on ${path}`);
        for (const h of checkHeaders) {
          assert.equal(workerRes.headers.get(h), originRes.headers.get(h), `${path} header ${h} mismatch`);
        }
        assert.match(String(workerRes.headers.get('vary') || ''), /\bAccept-Encoding\b/i, path);
        assert.equal(
          workerRes.headers.get('content-security-policy') === API_CSP,
          path.startsWith('/api/'),
          `API CSP rule on ${path}`
        );
        await originRes.arrayBuffer();
        await workerRes.arrayBuffer();
      }
    });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('worker serves static SEO pages, ETag 304, HEAD, robots.txt, security.txt and www redirect without calling origin', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'cardseek-worker-seo-'));
  let originCalls = 0;
  try {
    await prepareWorkerAssets({ outDir });
    const handler = createWorkerHandler({
      fetchFn: async () => {
        originCalls++;
        throw new Error('origin must not be called for static routes');
      },
      now: () => Date.UTC(2026, 10, 23, 0, 0, 0)
    });
    const env = {
      PUBLIC_BASE_URL: 'https://cardseektcg.com',
      ASSETS: createLocalAssetsBinding(outDir)
    };

    const www = await handler.fetch(new Request('https://www.cardseektcg.com/?game=pokemon'), env);
    assert.equal(www.status, 301);
    assert.equal(www.headers.get('location'), 'https://cardseektcg.com/?game=pokemon');
    assert.equal(www.headers.get('cache-control'), 'public, max-age=86400');

    const home = await handler.fetch(new Request('https://cardseektcg.com/'), env);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('cache-control'), 'no-cache');
    const etag = home.headers.get('etag');
    assert.match(etag, /^"[0-9a-f]{40}"$/);
    assert.match(await home.text(), /<link rel="canonical" href="https:\/\/cardseektcg\.com\/">/);

    for (const inm of [etag, `W/${etag}`, `"other", ${etag}`]) {
      const notMod = await handler.fetch(new Request('https://cardseektcg.com/', { headers: { 'if-none-match': inm } }), env);
      assert.equal(notMod.status, 304);
      assert.equal(notMod.headers.get('etag'), etag);
      assert.equal(await notMod.text(), '');
    }

    const headHome = await handler.fetch(new Request('https://cardseektcg.com/?game=pokemon', { method: 'HEAD' }), env);
    assert.equal(headHome.status, 200);
    assert.equal(await headHome.text(), '');

    const pokemon = await handler.fetch(new Request('https://cardseektcg.com/?game=pokemon'), env);
    assert.match(await pokemon.text(), /<title>寶可夢卡牌圖鑑｜好卡在 CardSeek<\/title>/);

    const ua = await handler.fetch(new Request('https://cardseektcg.com/?game=union-arena'), env);
    const uaBody = await ua.text();
    assert.match(uaBody, /<title>union-arena卡牌圖鑑｜好卡在 CardSeek<\/title>/);
    assert.match(uaBody, /<link rel="canonical" href="https:\/\/cardseektcg\.com\/\?game=union-arena">/);

    const collection = await handler.fetch(new Request('https://cardseektcg.com/?view=collection'), env);
    assert.match(await collection.text(), /<meta name="robots" content="noindex">/);

    const otherView = await handler.fetch(new Request('https://cardseektcg.com/?view=other'), env);
    assert.equal(await otherView.text(), await readFile(new URL('index.html', ROOT), 'utf8'));

    const robots = await handler.fetch(new Request('https://cardseektcg.com/robots.txt'), env);
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /Sitemap: https:\/\/cardseektcg\.com\/sitemap\.xml/);

    const secTxt = await handler.fetch(new Request('https://cardseektcg.com/.well-known/security.txt'), env);
    assert.equal(secTxt.status, 200);
    const secBody = await secTxt.text();
    assert.match(secBody, /Contact: mailto:contact@cardseektcg\.com/);
    assert.match(secBody, /Canonical: https:\/\/cardseektcg\.com\/\.well-known\/security\.txt/);

    const badSeoId = await handler.fetch(new Request(`https://cardseektcg.com/?card=${encodeURIComponent('bad id;drop')}`), env);
    assert.equal(badSeoId.status, 200);
    assert.equal(originCalls, 0, 'invalid SEO ID must not call origin');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('worker proxies /api/*, /sitemap*, and DB-backed SEO pages to origin with x-client-ip and ORIGIN_VERIFY_SECRET', async () => {
  assert.equal(resolveOriginUrl(undefined), DEFAULT_ORIGIN_URL);
  assert.equal(resolveOriginUrl({ ORIGIN_URL: 'https://origin.example.test/ignored/path' }), 'https://origin.example.test');
  assert.equal(resolveOriginUrl({ ORIGIN_URL: 'javascript:alert(1)' }), DEFAULT_ORIGIN_URL);

  assert.equal(shouldProxyToOrigin(new URL('https://x/api/search?q=a'), 'GET'), 'api');
  assert.equal(shouldProxyToOrigin(new URL('https://x/api/sync/push'), 'POST'), 'api');
  assert.equal(shouldProxyToOrigin(new URL('https://x/sitemap.xml'), 'GET'), 'sitemap');
  assert.equal(shouldProxyToOrigin(new URL('https://x/sitemaps/cards-1.xml'), 'HEAD'), 'sitemap');
  assert.equal(shouldProxyToOrigin(new URL('https://x/sitemaps/../server.mjs'), 'GET'), null);
  assert.equal(shouldProxyToOrigin(new URL('https://x/?card=pokemon-a'), 'GET'), 'seo-db');
  assert.equal(shouldProxyToOrigin(new URL('https://x/?series=pokemon-s1'), 'HEAD'), 'seo-db');
  assert.equal(shouldProxyToOrigin(new URL('https://x/?game=pokemon'), 'GET'), null);
  assert.equal(seoRequestTarget(new URL('https://x/?card=pokemon-a'))?.kind, 'card');

  const seen = [];
  const handler = createWorkerHandler({
    fetchFn: async (target, init) => {
      const headers = new Headers(init.headers);
      let bodyText = '';
      if (init.body) {
        bodyText = await new Response(init.body).text();
      }
      seen.push({ target, method: init.method, redirect: init.redirect, headers, bodyText });
      return new Response(JSON.stringify({ ok: true, target }), {
        status: 201,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Upstream': 'render' }
      });
    }
  });
  const env = {
    ORIGIN_URL: 'https://render-origin.example.test',
    ORIGIN_VERIFY_SECRET: 'shared-edge-secret',
    ASSETS: {
      async fetch() {
        return new Response('<!doctype html><title>CardSeek</title><script>1</script>', { status: 200 });
      }
    }
  };

  const apiPost = await handler.fetch(
    new Request('https://cardseektcg.com/api/sync/push?v=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-jwt',
        'cf-connecting-ip': '203.0.113.5',
        'x-origin-verify': 'spoofed-by-client',
        'cf-ray': 'ray-123'
      },
      body: JSON.stringify({ items: [], revision: 0 })
    }),
    env
  );
  assert.equal(apiPost.status, 201);
  assert.equal(apiPost.headers.get('content-security-policy'), API_CSP);
  assert.equal(apiPost.headers.get('x-upstream'), 'render');
  assert.equal(seen[0].target, 'https://render-origin.example.test/api/sync/push?v=1');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].redirect, 'manual');
  assert.equal(seen[0].headers.get('x-client-ip'), '203.0.113.5');
  assert.equal(seen[0].headers.get('cf-connecting-ip'), null, 'Render 前的 Cloudflare 會覆寫 cf-connecting-ip，不轉送');
  assert.equal(seen[0].headers.get('x-origin-verify'), 'shared-edge-secret');
  assert.equal(seen[0].headers.get('cf-ray'), null);
  assert.equal(seen[0].headers.get('authorization'), 'Bearer test-jwt');
  assert.equal(seen[0].bodyText, '{"items":[],"revision":0}');

  const headHealth = await handler.fetch(new Request('https://cardseektcg.com/api/catalog/health', { method: 'HEAD' }), env);
  assert.equal(headHealth.status, 201);
  assert.equal(await headHealth.text(), '');

  await handler.fetch(new Request('https://cardseektcg.com/sitemaps/pages.xml'), env);
  assert.equal(seen[2].target, 'https://render-origin.example.test/sitemaps/pages.xml');

  await handler.fetch(new Request('https://cardseektcg.com/?card=pokemon-sv2a-025&region=JP'), env);
  assert.equal(seen[3].target, 'https://render-origin.example.test/?card=pokemon-sv2a-025&region=JP');
});

test('worker degrades gracefully when origin is unreachable (502 API, 503 sitemap, 200 static fallback for SEO)', async () => {
  const indexHtml = '<!doctype html><title>好卡在 CardSeek</title><script>console.log(1)</script>';
  const handler = createWorkerHandler({
    fetchFn: async () => {
      throw new Error('SECRET_INTERNAL_UPSTREAM_HOST:5432 ECONNREFUSED');
    }
  });
  const env = {
    ORIGIN_URL: 'https://cardscope.onrender.com',
    ASSETS: {
      async fetch() {
        return new Response(indexHtml, { status: 200 });
      }
    }
  };

  const apiFail = await handler.fetch(new Request('https://cardseektcg.com/api/search?q=pikachu'), env);
  assert.equal(apiFail.status, 502);
  assert.equal(apiFail.headers.get('cache-control'), 'no-store');
  assert.equal(apiFail.headers.get('content-security-policy'), API_CSP);
  const apiText = await apiFail.text();
  assert.deepEqual(JSON.parse(apiText), { error: '資料暫時無法讀取' });
  assert.equal(apiText.includes('SECRET_INTERNAL'), false);

  const sitemapFail = await handler.fetch(new Request('https://cardseektcg.com/sitemap.xml'), env);
  assert.equal(sitemapFail.status, 503);
  assert.deepEqual(await sitemapFail.json(), { error: 'Sitemap 暫時無法產生' });

  const seoFallback = await handler.fetch(new Request('https://cardseektcg.com/?card=pokemon-a'), env);
  assert.equal(seoFallback.status, 200);
  assert.equal(seoFallback.headers.get('cache-control'), 'no-cache');
  assert.equal(await seoFallback.text(), indexHtml);

  // 檢驗 NOT_FOUND_HTML 與 PUBLIC_STATIC / REVALIDATE_EXTENSIONS 常數仍被正確維持
  assert.ok(NOT_FOUND_HTML.includes('找不到這個頁面'));
  assert.ok(PUBLIC_STATIC.test('/index.html'));
  assert.ok(REVALIDATE_EXTENSIONS.has('.webmanifest'));
  assert.equal(isPublicStaticPath('/server.mjs'), false);
});

test('wrangler.toml targets worker/index.mjs, worker/public, default origin, and exposes no secrets', async () => {
  const toml = await readFile(new URL('wrangler.toml', ROOT), 'utf8');
  assert.match(toml, /^main\s*=\s*"worker\/index\.mjs"/m);
  assert.match(toml, /^command\s*=\s*"node scripts\/prepare-worker-assets\.mjs"/m);
  assert.match(toml, /^directory\s*=\s*"\.\/worker\/public"/m);
  assert.doesNotMatch(toml, /^directory\s*=\s*"\.\/?"/m, 'never serve repo root as static assets');
  assert.match(toml, /^ORIGIN_URL\s*=\s*"https:\/\/cardscope\.onrender\.com"/m);
  assert.match(toml, /^PUBLIC_BASE_URL\s*=\s*"https:\/\/cardseektcg\.com"/m);
  assert.doesNotMatch(toml, /SERVICE_KEY|SCRAPE_SECRET|EBAY_CLIENT_SECRET|POKEMONPRICETRACKER/i);
});
