import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_BASE_URL, SITEMAP_MAX_URLS, applyNoindexToHtml, applySeoToHtml, canonicalUrl, cardSeo, cardSitemapEntries, chunkEntries, dateOnly, escapeHtml,
  jsonLdScript, mergeCardSitemapRows, normalizeBaseUrl, pageSitemapEntries, renderRobotsTxt, renderSitemapIndex, renderUrlSet, seriesSeo, seriesSitemapEntries
} from '../providers/seo.mjs';

const BASE = 'https://cardscope.onrender.com';
const printing = (over = {}) => ({ id: 'p1', cardId: 'pokemon-tcgdex-ja-sv6a-090', seriesId: 'pokemon-tcgdex-ja-sv6a', region: 'JP', language: 'ja-JP', localSetCode: 'SV6a', localCardNumber: '090', rarity: 'SAR', imageUrl: null, ...over });
const card = (over = {}) => ({ id: 'pokemon-tcgdex-ja-sv6a-090', game: 'pokemon', nameZh: '桃歹郎ex', nameJa: 'モモワロウex', nameEn: null, nameKo: null, officialCardNumber: '090', rarity: 'SAR', imageUrl: null, printings: [printing()], ...over });
const series = { id: 'pokemon-tcgdex-ja-sv6a', game: 'pokemon', officialCode: 'SV6a', nameZh: '黑夜漫遊者', nameJa: 'ナイトワンダラー', region: 'JP', releaseDate: '2024-06-07' };
const label = (game, value) => ({ SAR: 'SAR', UR: '終極稀有' })[value] || value;
const seo = (c = card(), over = {}) => cardSeo({ card: c, series, game: { id: 'pokemon', nameZh: '寶可夢' }, baseUrl: BASE, rarityLabel: label, ...over });
const chars = value => Array.from(value).length;

test('card title puts the Chinese name and rarity first, then region, set and number', () => {
  assert.equal(seo().title, '桃歹郎ex SAR｜日版 SV6a 090｜CardScope');
  assert.equal(seo(card({ nameZh: null })).title, 'モモワロウex SAR｜日版 SV6a 090｜CardScope', 'no Chinese name: the original name');
  const us = card({ nameZh: null, nameJa: null, nameEn: 'Charizard ex', rarity: 'UR', printings: [printing({ region: 'US', language: 'en-US', localSetCode: 'sv3pt5', localCardNumber: '6', rarity: 'UR' })] });
  assert.equal(seo(us).title, 'Charizard ex 終極稀有｜美版 sv3pt5 6｜CardScope', 'the rarity uses its display label');
  assert.equal(seo(card({ rarity: 'NONE', printings: [printing({ rarity: 'NONE' })] })).title, '桃歹郎ex｜日版 SV6a 090｜CardScope', 'NONE is not a rarity to show');
  assert.equal(seo(card({ printings: [] })).title, '桃歹郎ex SAR｜SV6a 090｜CardScope', 'no printing: the series code and the card number');
  assert.equal(seo(card({ printings: [] }), { series: null }).title, '桃歹郎ex SAR｜090｜CardScope', 'no printing and no series: the card number only');
  assert.equal(seo(card({ nameZh: null, nameJa: null }), {}), null, 'a card without any name has no page');
});

test('card description names the game, series, edition, number, rarity and version count, in 80-150 characters and without price talk', () => {
  const description = seo(card({ printings: [printing(), printing({ id: 'p2', region: 'TW', localSetCode: 'SV6a', localCardNumber: '090' })] })).description;
  for (const part of ['寶可夢', '黑夜漫遊者', 'SV6a', '090', 'SAR', '2 個版本', '桃歹郎ex（モモワロウex）']) assert.match(description, new RegExp(part.replace(/[（）]/g, '\\$&')));
  assert.ok(chars(description) >= 80 && chars(description) <= 150, `length ${chars(description)}`);
  assert.doesNotMatch(description, /價|NT\$|\$|¥|円|元/);
  const long = seo(card({ nameZh: '極長的名稱'.repeat(30) })).description;
  assert.ok(chars(long) <= 150 && long.endsWith('…'), 'over-long descriptions are cut with an ellipsis');
});

test('canonical keeps only game and card, whatever else the request carried', () => {
  assert.equal(seo().canonical, `${BASE}/?game=pokemon&card=pokemon-tcgdex-ja-sv6a-090`);
  assert.equal(canonicalUrl(BASE, { game: 'pokemon', card: 'a b&c', series: 'ignored-when-card' }), `${BASE}/?game=pokemon&card=a+b%26c`);
  assert.equal(canonicalUrl(BASE, { game: 'yugioh', series: 's1' }), `${BASE}/?game=yugioh&series=s1`);
  assert.equal(canonicalUrl(BASE, { game: 'pokemon', series: 's1', region: 'TW' }), `${BASE}/?game=pokemon&series=s1&region=TW`, 'a series link names its region, or the front end falls back to the game default region');
  assert.equal(canonicalUrl(BASE, { game: 'pokemon', card: 'c1', region: 'TW' }), `${BASE}/?game=pokemon&card=c1`, 'a card link never carries a region');
  assert.equal(canonicalUrl(BASE, {}), `${BASE}/`);
  assert.equal(normalizeBaseUrl('https://example.test/some/path/'), 'https://example.test');
  assert.equal(normalizeBaseUrl('javascript:alert(1)'), DEFAULT_BASE_URL);
  assert.equal(normalizeBaseUrl(undefined), DEFAULT_BASE_URL);
});

test('og:image is the card art when displayable, the One Piece proxy for official art, and the site logo otherwise', () => {
  assert.equal(seo().image, `${BASE}/assets/brand/web/rabbit-hero.webp`);
  assert.equal(seo().imageIsCardArt, false);
  assert.equal(seo(card({ imageUrl: 'https://img.example.test/sv6a-090.jpg' })).image, 'https://img.example.test/sv6a-090.jpg');
  assert.equal(seo(card({ imageUrl: '/assets/cards/a.webp' })).image, `${BASE}/assets/cards/a.webp`);
  const op = 'https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP01-001.png';
  assert.equal(seo(card({ imageUrl: op })).image, `${BASE}/api/images/onepiece?url=${encodeURIComponent(op)}`);
  assert.equal(seo(card({ imageUrl: 'javascript:alert(1)' })).image, `${BASE}/assets/brand/web/rabbit-hero.webp`);
});

test('JSON-LD is a BreadcrumbList home > game > series > card, with no Product or Offer', () => {
  const [crumbs] = seo().jsonLd;
  assert.equal(crumbs['@type'], 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map(item => [item.position, item.name, item.item]), [
    [1, '首頁', `${BASE}/`], [2, '寶可夢', `${BASE}/?game=pokemon`], [3, '黑夜漫遊者', `${BASE}/?game=pokemon&series=pokemon-tcgdex-ja-sv6a`], [4, '桃歹郎ex', `${BASE}/?game=pokemon&card=pokemon-tcgdex-ja-sv6a-090`]
  ]);
  assert.equal(JSON.stringify(seo().jsonLd).includes('Product'), false);
  assert.equal(JSON.stringify(seo().jsonLd).includes('Offer'), false);
  assert.equal(seo(card(), { series: null }).jsonLd[0].itemListElement.length, 3, 'no known series: that level is skipped');
  const script = jsonLdScript({ name: '</script><script>alert(1)</script> & \u2028' });
  assert.equal(script.slice('<script type="application/ld+json">'.length, -'</script>'.length).includes('<'), false);
  assert.equal(JSON.parse(script.replace(/^<script[^>]*>|<\/script>$/g, '')).name, '</script><script>alert(1)</script> & \u2028', 'the escaping round-trips');
});

test('series pages get a title, description, canonical and breadcrumb of their own', () => {
  const result = seriesSeo({ series, baseUrl: BASE, printingCount: 106 });
  assert.equal(result.title, '黑夜漫遊者 SV6a｜寶可夢日版系列卡表｜CardScope');
  assert.equal(result.canonical, `${BASE}/?game=pokemon&series=pokemon-tcgdex-ja-sv6a&region=JP`);
  assert.match(result.description, /黑夜漫遊者（SV6a）是寶可夢日版的卡牌系列，發售日 2024-06-07，共收錄 106 個卡片版本/);
  assert.ok(chars(result.description) >= 80 && chars(result.description) <= 150);
  assert.deepEqual(result.jsonLd[0].itemListElement.map(item => item.name), ['首頁', '寶可夢', '黑夜漫遊者']);
  assert.equal(seriesSeo({ series: { ...series, nameZh: null, nameJa: null, officialCode: null }, baseUrl: BASE }), null);
  assert.doesNotMatch(seriesSeo({ series, baseUrl: BASE }).description, /共收錄/, 'no count: the sentence is left out');
});

test('every string is HTML-escaped in the head and the noscript summary, and "$&" in a name stays literal', () => {
  const hostile = card({ nameZh: '<img src=x onerror=alert(1)> "q" \'s\' & $& $1', imageUrl: 'https://img.example.test/a.jpg?x=1&y="2"' });
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>CardScope｜TCG 卡牌圖鑑</title><meta name="description" content="old"><meta property="og:title" content="old"><meta property="og:type" content="website"></head><body><main>x</main></body></html>';
  const out = applySeoToHtml(html, seo(hostile));
  assert.equal(out.includes('<img src=x'), false, 'no raw tag from the name');
  assert.equal(out.includes('onerror=alert(1)>'), false);
  assert.match(out, /<title>&lt;img src=x onerror=alert\(1\)&gt; &quot;q&quot; &#39;s&#39; &amp; \$&amp; \$1 /);
  assert.ok(out.includes('<meta property="og:image" content="https://img.example.test/a.jpg?x=1&amp;y=%222%22">'));
  assert.match(out, /<noscript><section aria-label="卡片摘要"><h2>&lt;img/);
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.equal((out.match(/name="description"/g) || []).length, 1, 'the old description is replaced, not duplicated');
  assert.equal((out.match(/property="og:title"/g) || []).length, 1);
  assert.equal((out.match(/property="og:type"/g) || []).length, 1, 'tags we do not override stay');
  assert.match(out, /<link rel="canonical" href="https:\/\/cardscope\.onrender\.com\/\?game=pokemon&amp;card=/);
  assert.match(out, /<meta name="twitter:card" content="summary">/);
  assert.match(out, /<body><noscript>/);
  assert.equal(applyNoindexToHtml(html).includes('<meta name="robots" content="noindex"></head>'), true);
});

test('noscript carries the visible card facts only', () => {
  const out = applySeoToHtml('<html><head></head><body class="x"><main></main></body></html>', seo());
  const noscript = out.match(/<noscript>[\s\S]*?<\/noscript>/)[0];
  for (const part of ['桃歹郎ex', '寶可夢', '黑夜漫遊者', '日版', '090', 'SAR']) assert.ok(noscript.includes(part), part);
  assert.equal(/display:\s*none|hidden/i.test(noscript), false);
  assert.ok(out.startsWith('<html><head><title>'), 'a missing title is added');
});

test('robots.txt allows everything but /api/, and points to the sitemap index', () => {
  const robots = renderRobotsTxt('https://example.test/');
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
  assert.match(robots, /\nDisallow: \/api\/\n/);
  assert.match(robots, /\nSitemap: https:\/\/example\.test\/sitemap\.xml\n$/);
  assert.ok(robots.indexOf('Allow: /api/images/') < robots.indexOf('Disallow: /api/'), 'the image proxy stays reachable for link previews');
});

test('sitemap helpers: index and url set format, escaped URLs, 40,000-URL files, canonical card rows', () => {
  const urlset = renderUrlSet([{ loc: `${BASE}/?game=pokemon&card=a`, lastmod: '2026-10-14' }, { loc: `${BASE}/` }]);
  assert.match(urlset, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.ok(urlset.includes('<url><loc>https://cardscope.onrender.com/?game=pokemon&amp;card=a</loc><lastmod>2026-10-14</lastmod></url>'));
  assert.ok(urlset.includes('<url><loc>https://cardscope.onrender.com/</loc></url>'));
  const index = renderSitemapIndex([{ loc: `${BASE}/sitemaps/cards-1.xml`, lastmod: '2026-10-15' }]);
  assert.ok(index.includes('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://cardscope.onrender.com/sitemaps/cards-1.xml</loc><lastmod>2026-10-15</lastmod></sitemap></sitemapindex>'));
  const many = Array.from({ length: SITEMAP_MAX_URLS * 2 + 1 }, (_, i) => ({ loc: `u${i}` }));
  assert.deepEqual(chunkEntries(many).map(part => part.length), [SITEMAP_MAX_URLS, SITEMAP_MAX_URLS, 1]);
  assert.equal(chunkEntries(many.slice(0, 5), 10 ** 9).length, 1, 'a size above 40,000 is capped');
  assert.deepEqual(chunkEntries([]), []);
  assert.deepEqual(pageSitemapEntries(BASE, ['pokemon', 'yugioh']).map(entry => entry.loc), [`${BASE}/`, `${BASE}/?game=pokemon`, `${BASE}/?game=yugioh`]);
  assert.equal(dateOnly('2026-10-14 08:19:19.5761+00'), '2026-10-14');
  assert.equal(dateOnly('nonsense'), '');

  const groups = mergeCardSitemapRows([
    { id: 'a', canonical_id: 'g1', game_id: 'pokemon', updated_at: '2026-10-01T00:00:00Z', name_zh: '甲', name_ja: null, name_en: null, name_ko: null },
    { id: 'b', canonical_id: 'g1', game_id: 'pokemon', updated_at: '2026-10-14T00:00:00Z', name_zh: null, name_ja: 'ビー', name_en: null, name_ko: null },
    { id: 'c', canonical_id: 'c', game_id: 'yugioh', updated_at: '2026-09-01T00:00:00Z', name_zh: '  ', name_ja: '', name_en: null, name_ko: null },
    { id: 'd', canonical_id: null, game_id: 'yugioh', updated_at: '2026-08-01T00:00:00Z', name_zh: null, name_ja: null, name_en: 'Dee', name_ko: null }
  ]);
  assert.deepEqual(cardSitemapEntries(BASE, groups), [{ loc: `${BASE}/?game=yugioh&card=d`, lastmod: '2026-08-01' }, { loc: `${BASE}/?game=pokemon&card=g1`, lastmod: '2026-10-14' }], 'sorted by id, one entry per canonical id');
  assert.equal(seriesSitemapEntries(BASE, [{ id: 's1', game_id: 'pokemon', name_zh: '一', updated_at: '2026-10-02T00:00:00Z' }, { id: 's2', game_id: 'pokemon' }, { id: 's3', name_zh: '無遊戲' }]).length, 1, 'nameless or gameless series are left out');
});

// --- Over HTTP, with Supabase replaced by a fixture server ---

const root = new URL('..', import.meta.url);
const listen = httpServer => new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', () => resolve(httpServer.address().port)); });
const SITEMAP_CARD_SELECT = 'id,canonical_id,game_id,updated_at,name_zh,name_ja,name_en,name_ko';
const named = { name_zh: '卡', name_ja: null, name_en: null, name_ko: null };
const cardRows = Array.from({ length: 2100 }, (_, i) => ({ id: `c${String(i).padStart(4, '0')}`, canonical_id: `c${String(i).padStart(4, '0')}`, game_id: i % 2 ? 'yugioh' : 'pokemon', updated_at: '2026-10-01T00:00:00+00:00', ...named }));
Object.assign(cardRows[1], { canonical_id: 'group-a', updated_at: '2026-10-01T00:00:00+00:00' });
Object.assign(cardRows[2], { canonical_id: 'group-a', updated_at: '2026-10-14T08:19:19+00:00' });
Object.assign(cardRows[3], { name_zh: '', name_ja: null, name_en: '   ', name_ko: null });
const EXPECTED_CARD_URLS = 2100 - 1 - 1; // one nameless row, and two rows sharing one canonical page
const seriesRows = [{ id: 'pokemon-tcgdex-ja-sv6a', game_id: 'pokemon', region: 'JP', official_code: 'SV6a', name_zh: '黑夜漫遊者', updated_at: '2026-10-02T00:00:00+00:00', name_ja: null, name_en: null, name_ko: null }, { id: 'yugioh-x', game_id: 'yugioh', region: 'US', official_code: null, name_zh: null, name_ja: null, name_en: 'X Set', name_ko: null, updated_at: '2026-10-03T00:00:00+00:00' }, { id: 'ghost', game_id: 'pokemon', official_code: null, name_zh: null, name_ja: null, name_en: null, name_ko: null, updated_at: '2026-10-03T00:00:00+00:00' }];
const detail = (cardRow, seriesRow = series) => ({ cards: [cardRow], series: [seriesRow], games: [{ id: cardRow.game, nameZh: '寶可夢' }] });
const detailBase = { canonicalId: null, seriesId: series.id, officialCardNumber: '090', nameEn: null, nameKo: null, aliases: [], metadata: {} };
const fixtureCards = {
  'pokemon-tcgdex-ja-sv6a-090': detail({ ...detailBase, id: 'pokemon-tcgdex-ja-sv6a-090', game: 'pokemon', rarity: 'SAR', nameZh: '桃歹郎ex', nameJa: 'モモワロウex', printings: [{ ...printing(), source: 'pokemon-card-official-jp', providerId: 'x', imageUrl: 'https://img.example.test/sv6a-090.jpg', imageRehostRequired: false, imageRightsStatus: 'not-provided', metadata: {} }] }),
  'pokemon-noimage': detail({ ...detailBase, id: 'pokemon-noimage', game: 'pokemon', rarity: 'RR', nameZh: null, nameJa: null, nameEn: 'Charizard ex', officialCardNumber: '6', printings: [{ ...printing({ id: 'p9', cardId: 'pokemon-noimage', region: 'US', language: 'en-US', localSetCode: 'sv3pt5', localCardNumber: '6', rarity: 'RR' }), source: 'tcgdex-ja', providerId: 'y', imageUrl: 'https://img.example.test/hidden.jpg', imageRehostRequired: false, imageRightsStatus: 'not-provided', metadata: {} }] }),
  'pokemon-hostile': detail({ ...detailBase, id: 'pokemon-hostile', game: 'pokemon', rarity: 'RR', nameZh: '</title><script>alert(1)</script>', nameJa: null, printings: [{ ...printing({ id: 'p8', cardId: 'pokemon-hostile' }), source: 'tcgdex-ja', providerId: 'z', imageRehostRequired: false, metadata: {} }] })
};
const mock = { server: null, port: 0, sitemapPages: 0, failSitemap: false };
let app, appPort, indexHtml;

before(async () => {
  indexHtml = await readFile(new URL('index.html', root), 'utf8');
  mock.server = createServer((req, res) => {
    const url = new URL(req.url, 'http://mock-supabase'), table = url.pathname.split('/').at(-1);
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const reply = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
      const cardId = table === 'get_card_detail' ? JSON.parse(raw || '{}').p_id : null;
      if (cardId === 'pokemon-slow') return void setTimeout(() => { try { reply(200, { cards: [], series: [], games: [] }); } catch { /* the server hung up first */ } }, 4000);
      if (cardId === 'pokemon-broken') return reply(500, { message: 'boom' });
      if (cardId !== null) return reply(200, fixtureCards[cardId] || { cards: [], series: [], games: [] });
      if (table === 'tcg_cards' && url.searchParams.get('select') === SITEMAP_CARD_SELECT) {
        mock.sitemapPages += 1;
        if (mock.failSitemap) return reply(500, { message: 'sitemap boom' });
        const after = (url.searchParams.get('id') || '').replace(/^gt\./, ''), limit = Number(url.searchParams.get('limit'));
        assert.equal(url.searchParams.get('order'), 'id.asc');
        assert.ok(limit <= 1000, 'pages are at most 1000 rows');
        return reply(200, cardRows.filter(row => row.id > after).slice(0, limit));
      }
      if (table === 'tcg_cards') return reply(500, { message: 'broken' });
      if (table === 'tcg_series' && url.searchParams.get('id')?.startsWith('eq.')) {
        const row = seriesRows.find(item => `eq.${item.id}` === url.searchParams.get('id'));
        return reply(200, row ? [{ id: row.id, game: row.game_id, officialCode: row.official_code, nameZh: row.name_zh, nameJa: row.name_ja, nameEn: row.name_en, nameKo: row.name_ko, region: 'JP', releaseDate: '2024-06-07' }] : []);
      }
      if (table === 'tcg_series') {
        const after = (url.searchParams.get('id') || '').replace(/^gt\./, '');
        return reply(200, seriesRows.filter(row => row.id > after).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, Number(url.searchParams.get('limit'))));
      }
      if (table === 'tcg_printings' && url.searchParams.get('series_id')) return reply(200, [{ id: 'p' }], { 'content-range': '0-0/106' });
      reply(200, []);
    });
  });
  mock.port = await listen(mock.server);
  const probe = createServer();
  appPort = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  app = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(appPort), SUPABASE_URL: `http://127.0.0.1:${mock.port}`, SUPABASE_SERVICE_KEY: 'local-fixture-key', PUBLIC_BASE_URL: 'https://seo.example.test', SITEMAP_URLS_PER_FILE: '1000', CATALOG_WARM_ON_START: 'false', CATALOG_SYNC_ON_START: 'false', CARD_IMAGE_CACHE_ON_START: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`seo fixture start timeout: ${output}`)), 8000);
    app.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`seo fixture exited (${code ?? signal}): ${output}`)); });
    const onData = chunk => { output += String(chunk); if (output.includes('CardScope is running')) { clearTimeout(timer); resolve(); } };
    app.stdout.on('data', onData); app.stderr.on('data', onData);
  });
});

after(async () => {
  if (app && app.exitCode === null && app.signalCode === null) await new Promise(resolve => { app.once('exit', resolve); app.kill(); });
  if (mock.server) { mock.server.closeAllConnections(); await new Promise(resolve => mock.server.close(resolve)); }
});

const get = async path => { const response = await fetch(`http://127.0.0.1:${appPort}${path}`); return { status: response.status, type: response.headers.get('content-type'), headers: response.headers, body: await response.text() }; };
const head = body => body.slice(0, body.indexOf('</head>'));

test('HTTP: a card URL gets its own title, description, canonical, Open Graph, JSON-LD and noscript summary', async () => {
  const page = await get('/?game=pokemon&card=pokemon-tcgdex-ja-sv6a-090&region=JP&sort=rarity-desc&q=%E6%A1%83');
  assert.equal(page.status, 200);
  assert.match(page.type, /^text\/html/);
  assert.match(head(page.body), /<title>桃歹郎ex SAR｜日版 SV6a 090｜CardScope<\/title>/);
  assert.match(head(page.body), /<link rel="canonical" href="https:\/\/seo\.example\.test\/\?game=pokemon&amp;card=pokemon-tcgdex-ja-sv6a-090">/);
  assert.match(head(page.body), /<meta property="og:image" content="https:\/\/img\.example\.test\/sv6a-090\.jpg">/);
  assert.match(head(page.body), /<meta property="og:title" content="桃歹郎ex SAR｜日版 SV6a 090｜CardScope">/);
  assert.match(head(page.body), /<meta name="description" content="桃歹郎ex（モモワロウex）是寶可夢卡牌，收錄於日版「黑夜漫遊者」SV6a 系列/);
  assert.match(head(page.body), /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"BreadcrumbList"/);
  assert.equal((page.body.match(/<title>/g) || []).length, 1);
  assert.equal((page.body.match(/<link rel="canonical"/g) || []).length, 1);
  assert.match(page.body, /<body><noscript><section aria-label="卡片摘要"><h2>桃歹郎ex<\/h2>/);
  assert.equal(page.body.includes('og:image" content="https://img.example.test/hidden.jpg'), false);
  assert.ok(page.body.includes('<main class="wrap"'), 'the rest of the page is untouched');
});

test('HTTP: a card without a displayable image uses the site logo and its original name', async () => {
  const page = await get('/?game=pokemon&card=pokemon-noimage');
  assert.equal(page.status, 200);
  assert.match(head(page.body), /<title>Charizard ex RR｜美版 sv3pt5 6｜CardScope<\/title>/);
  assert.match(head(page.body), /<meta property="og:image" content="https:\/\/seo\.example\.test\/assets\/brand\/web\/rabbit-hero\.webp">/);
  assert.equal(head(page.body).includes('hidden.jpg'), false, 'an image the policy does not allow is never advertised');
});

test('HTTP: card names cannot break out of the head', async () => {
  const page = await get('/?game=pokemon&card=pokemon-hostile');
  assert.equal(page.status, 200);
  assert.equal(head(page.body).includes('<script>alert(1)</script>'), false);
  assert.match(head(page.body), /<title>&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; SAR｜/);
  assert.equal(page.body.includes('<noscript><section aria-label="卡片摘要"><h2></title>'), false);
});

test('HTTP: a series URL gets a series title and canonical', async () => {
  const page = await get('/?game=pokemon&series=pokemon-tcgdex-ja-sv6a&region=JP');
  assert.equal(page.status, 200);
  assert.match(head(page.body), /<title>黑夜漫遊者 SV6a｜寶可夢日版系列卡表｜CardScope<\/title>/);
  assert.match(head(page.body), /<link rel="canonical" href="https:\/\/seo\.example\.test\/\?game=pokemon&amp;series=pokemon-tcgdex-ja-sv6a&amp;region=JP">/);
  assert.match(head(page.body), /共收錄 106 個卡片版本/);
  assert.match(page.body, /<noscript><section aria-label="系列摘要">/);
});

test('HTTP: a card or series that does not exist is a 404 with the normal page and noindex', async () => {
  for (const path of ['/?game=pokemon&card=no-such-card', '/?game=pokemon&series=no-such-series']) {
    const page = await get(path);
    assert.equal(page.status, 404, path);
    assert.match(page.type, /^text\/html/);
    assert.ok(page.body.includes('<main class="wrap"'), 'the front end still loads to show its own not-found state');
    assert.match(head(page.body), /<meta name="robots" content="noindex">/);
    assert.match(head(page.body), /<title>CardScope｜TCG 卡牌圖鑑<\/title>/);
  }
});

test('HTTP: every kind of response carries the security headers; pages also carry the report-only CSP', async () => {
  for (const path of ['/', '/?game=pokemon&card=no-such-card', '/?game=pokemon&series=pokemon-tcgdex-ja-sv6a', '/robots.txt', '/sitemaps/pages.xml', '/no-such-file', '/api/providers']) {
    const { headers } = await get(path);
    assert.equal(headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN', path);
    assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin', path);
    assert.ok(headers.get('strict-transport-security'), path);
    assert.equal(headers.has('content-security-policy-report-only'), !path.startsWith('/api/'), path);
  }
  const csp = (await get('/')).headers.get('content-security-policy-report-only');
  assert.ok(csp.includes('https://images.pokemontcg.io'));
  assert.equal((await get('/')).headers.has('content-security-policy'), false, 'report-only: nothing is blocked yet');
});

test('HTTP: a database failure or a slow database serves the original page with 200', async () => {
  const broken = await get('/?game=pokemon&card=pokemon-broken');
  assert.equal(broken.status, 200);
  assert.equal(broken.body, indexHtml);
  const started = Date.now(), slow = await get('/?game=pokemon&card=pokemon-slow');
  assert.equal(slow.status, 200);
  assert.equal(slow.body, indexHtml);
  assert.ok(Date.now() - started < 3500, `answered after the 1.5 s limit (${Date.now() - started} ms), not after the database`);
});

test('HTTP: without card or series the page is exactly the original, and other parameters change nothing', async () => {
  for (const path of ['/', '/?game=pokemon', '/?game=yugioh&region=JP&sort=rarity-desc&q=x&pages=2']) {
    const page = await get(path);
    assert.equal(page.status, 200, path);
    assert.equal(page.body, indexHtml, path);
  }
});

test('HTTP: /robots.txt allows everything but /api/ and names the sitemap index', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.type, /^text\/plain/);
  assert.match(robots.body, /^User-agent: \*\nAllow: \/\n/);
  assert.match(robots.body, /\nDisallow: \/api\/\n/);
  assert.match(robots.body, /\nSitemap: https:\/\/seo\.example\.test\/sitemap\.xml\n$/);
});

test('HTTP: pages.xml needs no database', async () => {
  const pages = await get('/sitemaps/pages.xml');
  assert.equal(pages.status, 200);
  assert.match(pages.type, /^application\/xml/);
  assert.deepEqual([...pages.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replaceAll('&amp;', '&')), ['https://seo.example.test/', ...['pokemon', 'onepiece', 'yugioh', 'haikyuu', 'weiss-schwarz'].map(game => `https://seo.example.test/?game=${game}`)]);
});

test('HTTP: a failed sitemap build is a 503 and is not cached; concurrent requests share one build; keyset paging covers every card once', async () => {
  mock.failSitemap = true;
  const failed = await Promise.all([get('/sitemap.xml'), get('/sitemaps/cards-1.xml')]);
  assert.deepEqual(failed.map(r => r.status), [503, 503]);
  mock.failSitemap = false;
  mock.sitemapPages = 0;
  const [index, ...others] = await Promise.all([get('/sitemap.xml'), get('/sitemap.xml'), get('/sitemaps/cards-1.xml')]);
  assert.equal(index.status, 200, 'the failure was not remembered');
  assert.deepEqual(others.map(r => r.status), [200, 200]);
  assert.equal(mock.sitemapPages, 3, '2,100 rows at 1,000 per page is three database pages for all three requests together');
  assert.match(index.type, /^application\/xml/);
  assert.match(index.body, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const locs = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locs, ['pages', 'series', 'cards-1', 'cards-2', 'cards-3'].map(name => `https://seo.example.test/sitemaps/${name}.xml`));
  assert.match(index.body, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);

  const urls = [];
  for (const n of [1, 2, 3]) {
    const file = await get(`/sitemaps/cards-${n}.xml`);
    assert.equal(file.status, 200);
    const found = [...file.body.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map(m => ({ loc: m[1].replaceAll('&amp;', '&'), lastmod: m[2] }));
    assert.ok(found.length <= 1000);
    urls.push(...found);
  }
  assert.equal(urls.length, EXPECTED_CARD_URLS);
  assert.equal(new Set(urls.map(u => u.loc)).size, EXPECTED_CARD_URLS, 'no URL twice');
  assert.ok(urls.every(u => /^https:\/\/seo\.example\.test\/\?game=(pokemon|yugioh)&card=[A-Za-z0-9-]+$/.test(u.loc)), 'canonical format');
  assert.ok(urls.every(u => /^\d{4}-\d{2}-\d{2}$/.test(u.lastmod)));
  assert.equal(urls.some(u => u.loc.endsWith('card=c0003')), false, 'a card without a name is not listed');
  assert.equal(urls.some(u => u.loc.endsWith('card=c0001') || u.loc.endsWith('card=c0002')), false, 'linked cards are listed under their canonical id only');
  assert.equal(urls.find(u => u.loc.endsWith('card=group-a')).lastmod, '2026-10-14', 'the canonical page takes the newest updated_at');
  assert.equal((await get('/sitemaps/cards-4.xml')).status, 404);
  assert.equal((await get('/sitemaps/cards-0.xml')).status, 404);

  const series = await get('/sitemaps/series.xml');
  assert.equal(series.status, 200);
  assert.deepEqual([...series.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replaceAll('&amp;', '&')), ['https://seo.example.test/?game=pokemon&series=pokemon-tcgdex-ja-sv6a&region=JP', 'https://seo.example.test/?game=yugioh&series=yugioh-x&region=US']);
  assert.match(series.body, /<lastmod>2026-10-02<\/lastmod>/);
  assert.equal(mock.sitemapPages, 3, 'the built sitemap is served from the cache');
});

test('escapeHtml leaves safe text alone', () => {
  assert.equal(escapeHtml('桃歹郎ex'), '桃歹郎ex');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml('a&b<c>"d\'e'), 'a&amp;b&lt;c&gt;&quot;d&#39;e');
});
