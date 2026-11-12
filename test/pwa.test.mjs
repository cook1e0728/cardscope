import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';

// PWA: installable manifest + network-first shell service worker that never touches /api or third-party images.
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [manifestText, sw, server] = await Promise.all(['manifest.webmanifest', 'sw.js', 'server.mjs'].map(read));
const manifest = JSON.parse(manifestText);

test('manifest has the install fields and real icon files', async () => {
  assert.equal(manifest.name, 'CardScope 卡牌圖鑑');
  assert.equal(manifest.short_name, 'CardScope');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#F8F5EE');
  assert.equal(manifest.background_color, '#EDE8DE');
  assert.ok(manifest.icons.some(i => i.sizes === '192x192'));
  assert.ok(manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
  for (const icon of manifest.icons) await access(new URL(`..${icon.src}`, import.meta.url));
});

test('server serves the manifest with its own content type', () => {
  const pattern = new RegExp(/const PUBLIC_STATIC=\/(.*)\/;/.exec(server)[1]);
  assert.ok(pattern.test('/manifest.webmanifest') && pattern.test('/sw.js') && pattern.test('/assets/brand/web/pwa-icon-192.png'));
  assert.match(server, /'\.webmanifest':'application\/manifest\+json'/);
});

test('service worker is versioned, network-first and skips /api and cross-origin', () => {
  assert.match(sw, /const VERSION = 'cardscope-shell-v\d+'/);
  assert.match(sw, /skipWaiting\(\)/);
  assert.match(sw, /clients\.claim\(\)/);
  assert.match(sw, /caches\.delete\(key\)/);
  assert.match(sw, /url\.origin !== self\.location\.origin \|\| url\.pathname\.startsWith\('\/api\/'\)\) return/);
  assert.match(sw, /fetch\(request\)\.then[\s\S]*\.catch\(/);
  assert.match(sw, /目前離線/);
});

test('manifest theme_color matches the page meta theme-color', async () => {
  const meta = /<meta name="theme-color" content="(#[0-9A-Fa-f]{6})"/.exec(await read('index.html'));
  assert.ok(meta, 'index.html has a theme-color meta');
  assert.equal(manifest.theme_color.toLowerCase(), meta[1].toLowerCase());
});

test('service worker stores only query-less navigations under the shared / key', () => {
  assert.match(sw, /isPage \? '\/' : request/);
  assert.match(sw, /\(!url\.search && response\.headers\.get\('content-type'\)\?\.includes\('text\/html'\)\)/);
  assert.match(sw, /cardscope-shell-v(?:[2-9]|\d{2,})'/);
});

test('fetch handler writes the / cache key only for query-less pages', async () => {
  const puts = [];
  let onFetch;
  const html = () => ({ ok: true, headers: { get: () => 'text/html; charset=utf-8' }, clone() { return this; } });
  vm.runInNewContext(sw, {
    self: { location: { origin: 'https://x.test' }, addEventListener: (type, fn) => { if (type === 'fetch') onFetch = fn; } },
    caches: { open: async () => ({ put: async (key) => { puts.push(key); } }) },
    fetch: async () => html(),
    URL, Response,
  });
  const run = async url => { let p; onFetch({ request: { method: 'GET', url, mode: 'navigate' }, respondWith: x => { p = x; } }); await p; await new Promise(r => setImmediate(r)); };
  await run('https://x.test/?game=pokemon');
  await run('https://x.test/?card=abc');
  assert.deepEqual(puts, []);
  await run('https://x.test/');
  assert.deepEqual(puts, ['/']);
});
