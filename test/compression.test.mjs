import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

const FETCH_BAD_PORTS = new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
async function freePort() {
  for (;;) {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    if (!FETCH_BAD_PORTS.has(port)) return port;
  }
}

async function withServer(name, { database = null, env = {} } = {}, run) {
  const mock = database ? createServer(database) : null;
  if (mock) await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const keys = ['PORT', 'CATALOG_SYNC_ON_START', 'CATALOG_WARM_ON_START', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', ...Object.keys(env)];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let app;
  try {
    Object.assign(process.env, { PORT: String(await freePort()), CATALOG_SYNC_ON_START: 'false', CATALOG_WARM_ON_START: 'false', ...env });
    if (mock) {
      process.env.SUPABASE_URL = 'http://127.0.0.1:' + mock.address().port;
      process.env.SUPABASE_SERVICE_KEY = 'test-key';
    } else {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;
    }
    ({ server: app } = await import('../server.mjs?compress-' + name));
    if (!app.listening) await new Promise(resolve => app.once('listening', resolve));
    return await run('http://127.0.0.1:' + app.address().port);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    if (app?.listening) await new Promise(resolve => app.close(resolve));
    if (mock) await new Promise(resolve => mock.close(resolve));
  }
}

function rawRequest(base, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = httpRequest({ host: u.hostname, port: u.port, path, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('response compression: br preferred over gzip, identity when unsupported, Vary always set', async () => {
  await withServer('basic', {}, async base => {
    const plain = await rawRequest(base, '/ui-enhancements.js', { headers: { 'Accept-Encoding': 'identity' } });
    const none = await rawRequest(base, '/ui-enhancements.js');
    const br = await rawRequest(base, '/ui-enhancements.js', { headers: { 'Accept-Encoding': 'gzip, deflate, br' } });
    const gz = await rawRequest(base, '/ui-enhancements.js', { headers: { 'Accept-Encoding': 'gzip, deflate' } });
    const rejected = await rawRequest(base, '/ui-enhancements.js', { headers: { 'Accept-Encoding': 'br;q=0, gzip;q=0' } });
    const brZero = await rawRequest(base, '/ui-enhancements.js', { headers: { 'Accept-Encoding': 'br;q=0, gzip;q=0.8' } });

    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(none.headers['content-encoding'], undefined);
    assert.equal(rejected.headers['content-encoding'], undefined);
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(brZero.headers['content-encoding'], 'gzip');

    for (const res of [plain, none, br, gz, rejected, brZero]) {
      assert.match(String(res.headers.vary || ''), /\bAccept-Encoding\b/i);
      assert.equal(Number(res.headers['content-length']), res.body.length);
    }

    assert.ok(br.body.length < plain.body.length, 'br shrinks JS');
    assert.ok(gz.body.length < plain.body.length, 'gzip shrinks JS');
    assert.deepEqual(brotliDecompressSync(br.body), plain.body);
    assert.deepEqual(gunzipSync(gz.body), plain.body);
    assert.deepEqual(gunzipSync(brZero.body), plain.body);

    // Second request hits the static compression cache and returns identical bytes.
    const brCached = await rawRequest(base, '/ui-enhancements.js', { headers: { 'Accept-Encoding': 'br' } });
    assert.equal(brCached.headers['content-encoding'], 'br');
    assert.deepEqual(brCached.body, br.body);
  });
});

test('response compression: compresses HTML, CSS, SVG, JSON APIs and sitemaps; skips images and <1 KB payloads', async () => {
  await withServer('types', {}, async base => {
    for (const path of ['/', '/look-v2.css', '/assets/ip-logos/pokemon.svg', '/data/game-taxonomy.json', '/api/catalog', '/api/catalog/sources']) {
      const br = await rawRequest(base, path, { headers: { 'Accept-Encoding': 'br' } });
      const raw = await rawRequest(base, path, { headers: { 'Accept-Encoding': 'identity' } });
      assert.equal(br.status, 200, path);
      assert.equal(br.headers['content-encoding'], 'br', path);
      assert.match(String(br.headers.vary || ''), /\bAccept-Encoding\b/i, path);
      assert.deepEqual(brotliDecompressSync(br.body), raw.body, path);
      assert.ok(br.body.length < raw.body.length, `${path} compressed smaller`);
    }

    // Binary image assets are never compressed.
    for (const imgPath of ['/assets/ip-logos/onepiece.webp', '/assets/ip-logos/onepiece.png']) {
      const res = await rawRequest(base, imgPath, { headers: { 'Accept-Encoding': 'br, gzip' } });
      assert.equal(res.status, 200, imgPath);
      assert.equal(res.headers['content-encoding'], undefined, imgPath);
      assert.match(String(res.headers.vary || ''), /\bAccept-Encoding\b/i, imgPath);
    }

    // Small (< 1 KB) text/JSON responses are never compressed, still carry Vary.
    for (const smallPath of ['/robots.txt', '/.well-known/security.txt', '/api/nonexistent', '/nonexistent-page']) {
      const res = await rawRequest(base, smallPath, { headers: { 'Accept-Encoding': 'br, gzip' } });
      assert.ok(res.body.length < 1024, `${smallPath} should be < 1 KB (got ${res.body.length})`);
      assert.equal(res.headers['content-encoding'], undefined, smallPath);
      assert.match(String(res.headers.vary || ''), /\bAccept-Encoding\b/i, smallPath);
    }
  });
});

test('response compression: /api/images/onepiece proxy is never compressed', async () => {
  const realFetch = globalThis.fetch;
  const fakePng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(4096, 0x41)]);
  globalThis.fetch = (input, init) => {
    const target = String(input?.url || input);
    if (target.startsWith('https://asia-tc.onepiece-cardgame.com/')) {
      return Promise.resolve(new Response(fakePng, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(fakePng.length) } }));
    }
    return realFetch(input, init);
  };
  try {
    await withServer('img-proxy', {}, async base => {
      const url = 'https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP01-001.png';
      const res = await rawRequest(base, '/api/images/onepiece?url=' + encodeURIComponent(url), { headers: { 'Accept-Encoding': 'br, gzip' } });
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'image/png');
      assert.equal(res.headers['content-encoding'], undefined);
      assert.equal(res.body.length, fakePng.length);
      assert.match(String(res.headers.vary || ''), /\bAccept-Encoding\b/i);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('response compression: ETag suffixes (-br/-gz) and 304 conditional requests work per encoding', async () => {
  await withServer('etag', {}, async base => {
    const br = await rawRequest(base, '/', { headers: { 'Accept-Encoding': 'br' } });
    const gz = await rawRequest(base, '/', { headers: { 'Accept-Encoding': 'gzip' } });
    const plain = await rawRequest(base, '/', { headers: { 'Accept-Encoding': 'identity' } });

    assert.match(String(br.headers.etag || ''), /^"[0-9a-f]{40}-br"$/);
    assert.match(String(gz.headers.etag || ''), /^"[0-9a-f]{40}-gz"$/);
    assert.match(String(plain.headers.etag || ''), /^"[0-9a-f]{40}"$/);
    assert.notEqual(br.headers.etag, gz.headers.etag);
    assert.notEqual(br.headers.etag, plain.headers.etag);

    // Matching ETag + encoding -> 304 with empty body and Vary.
    const notModBr = await rawRequest(base, '/', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': br.headers.etag } });
    assert.equal(notModBr.status, 304);
    assert.equal(notModBr.body.length, 0);
    assert.equal(notModBr.headers.etag, br.headers.etag);
    assert.match(String(notModBr.headers.vary || ''), /\bAccept-Encoding\b/i);

    // Weak ETag form still matches 304.
    const notModWeak = await rawRequest(base, '/', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': `W/${br.headers.etag}` } });
    assert.equal(notModWeak.status, 304);

    // Mismatched encoding ETag -> 200 with the requested encoding's ETag.
    const mismatch = await rawRequest(base, '/', { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': br.headers.etag } });
    assert.equal(mismatch.status, 200);
    assert.equal(mismatch.headers['content-encoding'], 'gzip');
    assert.equal(mismatch.headers.etag, gz.headers.etag);
  });
});

test('response compression: HEAD requests return headers without body', async () => {
  await withServer('head', {}, async base => {
    for (const path of ['/', '/look-v2.css', '/robots.txt', '/.well-known/security.txt', '/api/catalog/health']) {
      const head = await rawRequest(base, path, { method: 'HEAD', headers: { 'Accept-Encoding': 'br, gzip' } });
      assert.equal(head.status, 200, path);
      assert.equal(head.body.length, 0, `${path} HEAD has no body`);
      assert.match(String(head.headers.vary || ''), /\bAccept-Encoding\b/i, path);
    }

    const getBr = await rawRequest(base, '/look-v2.css', { headers: { 'Accept-Encoding': 'br' } });
    const headBr = await rawRequest(base, '/look-v2.css', { method: 'HEAD', headers: { 'Accept-Encoding': 'br' } });
    assert.equal(headBr.headers['content-encoding'], 'br');
    assert.equal(headBr.headers.etag, getBr.headers.etag);
    assert.equal(headBr.headers['content-length'], getBr.headers['content-length']);
  });
});
