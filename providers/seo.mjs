// SEO 純函式：標題、描述、canonical、Open Graph／Twitter、JSON-LD、robots.txt 與 sitemap。
// 不碰網路與資料庫；server.mjs 負責查資料後把結果交給這裡。所有輸出字串都已跳脫。

export const SITE_NAME = 'CardScope';
export const DEFAULT_BASE_URL = 'https://cardscope.onrender.com';
export const DEFAULT_IMAGE_PATH = '/assets/brand/web/rabbit-hero.webp';
export const DEFAULT_IMAGE_SIZE = { width: 860, height: 860 };
export const SITEMAP_MAX_URLS = 40000;

const GAME_NAMES = { pokemon: '寶可夢', onepiece: '航海王', yugioh: '遊戲王', haikyuu: '排球少年', 'weiss-schwarz': 'Weiß Schwarz' };
const REGION_LABELS = { JP: '日版', TW: '台版', US: '美版', CN: '陸版', KR: '韓版', ASIA: '亞洲版' };
const ONEPIECE_IMAGE_HOSTS = new Set(['asia-tc.onepiece-cardgame.com', 'asia-en.onepiece-cardgame.com']);
const DESCRIPTION_TAIL = 'CardScope 提供卡圖與版本對照，可用中、日、英文名稱查詢。';
const DESCRIPTION_MAX = 150;

const text = value => (value === null || value === undefined ? '' : String(value)).trim();
const pickFirst = (...values) => values.map(text).find(Boolean) || '';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// JSON-LD sits inside <script>: keep "<", "&" and the JS line separators from ending or breaking it.
export function jsonLdScript(data) {
  const body = JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `<script type="application/ld+json">${body}</script>`;
}

export function normalizeBaseUrl(value) {
  try {
    const url = new URL(text(value));
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
  } catch { /* fall through to the default */ }
  return DEFAULT_BASE_URL;
}

// Canonical URLs keep only the identity parameters: the same card or series is one page however it was reached.
export function canonicalUrl(baseUrl, { game, card, series } = {}) {
  const base = normalizeBaseUrl(baseUrl), params = new URLSearchParams();
  if (game) params.set('game', game);
  if (card) params.set('card', card);
  else if (series) params.set('series', series);
  const query = params.toString();
  return `${base}/${query ? `?${query}` : ''}`;
}

export const gameName = (gameId, game) => pickFirst(game?.nameZh, GAME_NAMES[gameId], game?.nameEn, game?.nameJa, gameId);
export const regionLabel = region => REGION_LABELS[String(region || '').toUpperCase()] || '';
export const seriesName = series => pickFirst(series?.nameZh, series?.nameJa, series?.nameEn, series?.nameKo, series?.officialCode);

const clamp = (value, max) => { const chars = Array.from(value); return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`; };

// Chinese name first; without one, the name in the language of the reference printing, then any other.
function cardNames(card, printing) {
  const region = String(printing?.region || card?.region || '').toUpperCase();
  const original = region === 'JP' ? card?.nameJa : region === 'KR' ? card?.nameKo : region === 'US' ? card?.nameEn : null;
  const all = [card?.nameZh, original, card?.nameJa, card?.nameEn, card?.nameKo].map(text).filter(Boolean);
  const primary = all[0] || '';
  return { primary, alternate: all.find(name => name !== primary) || '' };
}

function absoluteImage(baseUrl, imageUrl) {
  const raw = text(imageUrl), base = normalizeBaseUrl(baseUrl);
  if (!raw) return null;
  try {
    const url = new URL(raw, `${base}/`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // One Piece art is only served through the same-origin proxy (the browser does the same).
    if (ONEPIECE_IMAGE_HOSTS.has(url.hostname) && url.pathname.startsWith('/images/cardlist/card/')) return `${base}/api/images/onepiece?url=${encodeURIComponent(url.href)}`;
    return url.href;
  } catch { return null; }
}

const defaultImage = baseUrl => `${normalizeBaseUrl(baseUrl)}${DEFAULT_IMAGE_PATH}`;

function breadcrumbList(items) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })) };
}

function describe(parts, tail = DESCRIPTION_TAIL) { return clamp(`${parts}${tail}`, DESCRIPTION_MAX); }

// card: canonical card with printings (as returned by the card detail loader); series: that card's reference series.
export function cardSeo({ card, series = null, game = null, baseUrl = DEFAULT_BASE_URL, rarityLabel = (gameId, value) => value } = {}) {
  if (!card?.id) return null;
  const base = normalizeBaseUrl(baseUrl), printings = Array.isArray(card.printings) ? card.printings : [], printing = printings[0] || null;
  const names = cardNames(card, printing);
  if (!names.primary) return null;
  const gameId = card.game || game?.id || '', gameLabel = gameName(gameId, game);
  const region = regionLabel(printing?.region || card.region), setCode = pickFirst(printing?.localSetCode, series?.officialCode);
  const number = pickFirst(printing?.localCardNumber, card.officialCardNumber);
  const rawRarity = pickFirst(printing?.rarityCode, printing?.rarity, card.rarity);
  let rarity = rawRarity && rawRarity.toUpperCase() !== 'NONE' ? pickFirst(rarityLabel(gameId, rawRarity), printing?.rarityLabel, rawRarity) : '';
  if (rarity.toUpperCase() === 'NONE') rarity = '';
  const seriesLabel = seriesName(series), edition = [region, setCode, number].filter(Boolean).join(' ');
  const title = `${[names.primary, rarity].filter(Boolean).join(' ')}｜${edition ? `${edition}｜` : ''}${SITE_NAME}`;
  const intro = `${names.primary}${names.alternate ? `（${names.alternate}）` : ''}是${gameLabel}卡牌`;
  const where = seriesLabel ? `，收錄於${region}「${seriesLabel}」${setCode ? `${setCode} ` : ''}系列` : edition ? `，${edition}` : '';
  const details = [number ? `卡號 ${number}` : '', rarity ? `稀有度 ${rarity}` : '', printings.length ? `共整理 ${printings.length} 個版本` : ''].filter(Boolean).join('，');
  const description = describe(`${intro}${where}${details ? `，${details}` : ''}。`);
  const gameId2 = gameId || undefined, canonical = canonicalUrl(base, { game: gameId2, card: card.id });
  const image = absoluteImage(base, card.imageUrl), hasArt = Boolean(image);
  const crumbs = [{ name: '首頁', url: `${base}/` }];
  if (gameId2) crumbs.push({ name: gameLabel, url: canonicalUrl(base, { game: gameId2 }) });
  if (series?.id && seriesLabel) crumbs.push({ name: seriesLabel, url: canonicalUrl(base, { game: gameId2, series: series.id }) });
  crumbs.push({ name: names.primary, url: canonical });
  return {
    kind: 'card', title, description, canonical,
    image: image || defaultImage(base), imageAlt: hasArt ? `${names.primary} 卡圖` : `${SITE_NAME} 標誌`, imageIsCardArt: hasArt,
    jsonLd: [breadcrumbList(crumbs)],
    summary: { heading: names.primary, lines: [['遊戲', gameLabel], ['系列', [seriesLabel, setCode && seriesLabel ? `（${setCode}）` : ''].join('')], ['版本', region], ['卡號', number], ['稀有度', rarity]].filter(([, value]) => value) }
  };
}

export function seriesSeo({ series, game = null, baseUrl = DEFAULT_BASE_URL, printingCount = null } = {}) {
  if (!series?.id) return null;
  const base = normalizeBaseUrl(baseUrl), label = seriesName(series);
  if (!label) return null;
  const gameId = series.game || game?.id || '', gameLabel = gameName(gameId, game), region = regionLabel(series.region), code = text(series.officialCode);
  const title = `${label}${code && code !== label ? ` ${code}` : ''}｜${gameLabel}${region}系列卡表｜${SITE_NAME}`;
  const release = text(series.releaseDate).slice(0, 10), count = Number(printingCount);
  const facts = [release ? `發售日 ${release}` : '', Number.isFinite(count) && count > 0 ? `共收錄 ${count} 個卡片版本` : ''].filter(Boolean).join('，');
  const description = describe(`${label}${code && code !== label ? `（${code}）` : ''}是${gameLabel}${region}的卡牌系列${facts ? `，${facts}` : ''}。`);
  const canonical = canonicalUrl(base, { game: gameId || undefined, series: series.id });
  const crumbs = [{ name: '首頁', url: `${base}/` }];
  if (gameId) crumbs.push({ name: gameLabel, url: canonicalUrl(base, { game: gameId }) });
  crumbs.push({ name: label, url: canonical });
  return {
    kind: 'series', title, description, canonical, image: defaultImage(base), imageAlt: `${SITE_NAME} 標誌`, imageIsCardArt: false,
    jsonLd: [breadcrumbList(crumbs)],
    summary: { heading: label, lines: [['遊戲', gameLabel], ['版本', region], ['系列代碼', code && code !== label ? code : ''], ['發售日', release], ['收錄版本數', Number.isFinite(count) && count > 0 ? String(count) : '']].filter(([, value]) => value) }
  };
}

const metaTag = (attr, key, content) => `<meta ${attr}="${key}" content="${escapeHtml(content)}">`;

export function seoHeadTags(seo) {
  const tags = [
    metaTag('name', 'description', seo.description),
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}">`,
    metaTag('property', 'og:title', seo.title), metaTag('property', 'og:description', seo.description), metaTag('property', 'og:url', seo.canonical),
    metaTag('property', 'og:image', seo.image), metaTag('property', 'og:image:alt', seo.imageAlt)
  ];
  if (!seo.imageIsCardArt) tags.push(metaTag('property', 'og:image:width', DEFAULT_IMAGE_SIZE.width), metaTag('property', 'og:image:height', DEFAULT_IMAGE_SIZE.height));
  // Card art is portrait, so the small "summary" card avoids a bad crop; the square logo fits it too.
  tags.push(metaTag('name', 'twitter:card', 'summary'), metaTag('name', 'twitter:title', seo.title), metaTag('name', 'twitter:description', seo.description), metaTag('name', 'twitter:image', seo.image), metaTag('name', 'twitter:image:alt', seo.imageAlt));
  for (const data of seo.jsonLd || []) tags.push(jsonLdScript(data));
  return tags.join('');
}

// The same facts a visitor sees in the detail view, for visitors and crawlers that run without JavaScript. Never hidden by CSS.
export function seoNoscript(seo) {
  const items = seo.summary.lines.map(([label, value]) => `<li>${escapeHtml(label)}：${escapeHtml(value)}</li>`).join('');
  return `<noscript><section aria-label="${escapeHtml(seo.kind === 'card' ? '卡片摘要' : '系列摘要')}"><h2>${escapeHtml(seo.summary.heading)}</h2><ul>${items}</ul></section></noscript>`;
}

const SEO_HEAD_META = /<meta\b[^>]*\b(?:name|property)\s*=\s*["'](?:description|og:title|og:description|og:url|og:image[^"']*|twitter:[^"']*)["'][^>]*>/gi;
const CANONICAL_LINK = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi;

// Function replacers throughout: card names may contain "$&" and the like, which a string replacement would interpret.
export function applySeoToHtml(html, seo) {
  let out = String(html);
  out = out.replace(SEO_HEAD_META, () => '').replace(CANONICAL_LINK, () => '');
  const title = `<title>${escapeHtml(seo.title)}</title>`;
  out = /<title\b[^>]*>[\s\S]*?<\/title>/i.test(out) ? out.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => title) : out.replace(/<\/head>/i, () => `${title}</head>`);
  out = out.replace(/<\/head>/i, () => `${seoHeadTags(seo)}</head>`);
  out = out.replace(/<body\b[^>]*>/i, match => `${match}${seoNoscript(seo)}`);
  return out;
}

// A card or series that does not exist: the page still loads (the front end shows its own "not found"), but stays out of search results.
export function applyNoindexToHtml(html) {
  return String(html).replace(/<\/head>/i, () => '<meta name="robots" content="noindex"></head>');
}

export function renderRobotsTxt(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  return ['User-agent: *', 'Allow: /', 'Allow: /api/images/', 'Disallow: /api/', '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';
export const escapeXml = escapeHtml;
export const dateOnly = value => { const ms = Date.parse(value); return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ''; };
const xmlEntry = (tag, { loc, lastmod }) => `<${tag}><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}</${tag}>`;

export function renderUrlSet(entries) {
  return `${XML_HEADER}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(entry => xmlEntry('url', entry)).join('\n')}</urlset>\n`;
}
export function renderSitemapIndex(entries) {
  return `${XML_HEADER}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(entry => xmlEntry('sitemap', entry)).join('\n')}</sitemapindex>\n`;
}
export function chunkEntries(entries, size = SITEMAP_MAX_URLS) {
  const limit = Math.max(1, Math.min(SITEMAP_MAX_URLS, Math.floor(size) || SITEMAP_MAX_URLS)), chunks = [];
  for (let index = 0; index < entries.length; index += limit) chunks.push(entries.slice(index, index + limit));
  return chunks;
}

export function pageSitemapEntries(baseUrl, gameIds) {
  const base = normalizeBaseUrl(baseUrl);
  return [{ loc: `${base}/` }, ...gameIds.map(game => ({ loc: canonicalUrl(base, { game }) }))];
}

// Rows are physical cards (id, canonical_id, game_id, updated_at, names). Linked cards share one canonical page, so one URL per
// canonical id with its newest updated_at; a card without any name is left out. Pass a Map to keep merging across pages.
export function mergeCardSitemapRows(rows, groups = new Map()) {
  for (const row of rows) {
    if (!row?.id || ![row.name_zh, row.name_ja, row.name_en, row.name_ko].some(name => text(name))) continue;
    const id = text(row.canonical_id) || row.id, updated = dateOnly(row.updated_at), known = groups.get(id);
    if (!known) groups.set(id, { id, game: text(row.game_id), lastmod: updated });
    else if (updated > known.lastmod) known.lastmod = updated;
  }
  return groups;
}
export function cardSitemapEntries(baseUrl, groups) {
  return [...groups.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(group => ({ loc: canonicalUrl(baseUrl, { game: group.game || undefined, card: group.id }), lastmod: group.lastmod }));
}
export function seriesSitemapEntries(baseUrl, rows) {
  return rows.filter(row => row?.id && row.game_id && [row.name_zh, row.name_ja, row.name_en, row.name_ko, row.official_code].some(name => text(name)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(row => ({ loc: canonicalUrl(baseUrl, { game: row.game_id, series: row.id }), lastmod: dateOnly(row.updated_at) }));
}
