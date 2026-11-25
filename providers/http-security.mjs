// HTTP 安全標頭、CSP、靜態白名單與共用回應輔助（無 node:* 依賴，Node 與 Cloudflare Workers 共用單一事實來源）。

export const PUBLIC_STATIC = /^\/(?:[a-z0-9-]+\.(?:js|css)|manifest\.webmanifest|index\.html|googlefb9a9f93e94c056f\.html|assets\/(?:[\w.-]+\/)*[\w.-]+\.(?:png|jpe?g|webp|svg|ico|woff2?)|data\/(?:rarity-rankings|game-taxonomy)\.json)$/;

export const REVALIDATE_EXTENSIONS = new Set(['.html', '.js', '.css', '.webmanifest']);

export const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Strict-Transport-Security': 'max-age=15552000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), gyroscope=(self), accelerometer=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin'
});

export const API_CSP = "default-src 'none'";

const PAGE_IMG_SOURCES = [
  "'self'",
  'data:',
  'https://www.pokemon-card.com',
  'https://asia.pokemon-card.com',
  'https://images.pokemontcg.io',
  'https://*.supabase.co',
  'https://lh3.googleusercontent.com',
  'https://*.onepiece-cardgame.com',
  'https://assets.tcgdex.net',
  'https://images.ygoprodeck.com',
  'https://images.scrydex.com',
  'https://ws-tcg.com',
  'https://en.ws-tcg.com',
  'https://www.takaratomy.co.jp',
  'https://www.dbs-cardgame.com',
  'https://www.unionarena-tcg.com',
  'https://www.db.yugioh-card.com',
  'https://product-images.tcgplayer.com',
  'https://i.ebayimg.com'
];

export const inlineScripts = html =>
  [...String(html || '').matchAll(/<script(?![^>]*\s(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);

export function buildPageCsp(inlineScriptSources = []) {
  const sources = ["'self'", ...inlineScriptSources].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src ${sources.join(' ')}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    `img-src ${PAGE_IMG_SOURCES.join(' ')}`,
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'"
  ].join('; ');
}

export async function computeInlineScriptSources(html) {
  const scripts = inlineScripts(html);
  const encoder = new TextEncoder();
  const sources = [];
  for (const code of scripts) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(code));
    const bytes = new Uint8Array(digest);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    sources.push(`'sha256-${btoa(binary)}'`);
  }
  return sources;
}

export function cspForPath(pathname, pageCsp) {
  return String(pathname || '').startsWith('/api/') ? API_CSP : pageCsp;
}

export function securityHeadersForPath(pathname, pageCsp) {
  return {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': cspForPath(pathname, pageCsp)
  };
}

export function mergeVaryHeader(existing, token = 'Accept-Encoding') {
  const list = String(existing || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!list.some(v => v.toLowerCase() === token.toLowerCase())) list.push(token);
  return list.join(', ');
}

export const NOT_FOUND_HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>找不到頁面｜CardSeek</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#efeae0;color:#171717;font:16px/1.6 system-ui,"Noto Sans TC",sans-serif;text-align:center}main{padding:24px}h1{margin:0 0 8px;font-size:24px}a{display:inline-block;margin-top:16px;padding:10px 22px;border-radius:8px;background:#171717;color:#fff;text-decoration:none}</style></head><body><main><h1>找不到這個頁面</h1><p>網址可能打錯了，或這個頁面已經移除。</p><a href="/">回 CardSeek 首頁</a></main></body></html>';

export function renderSecurityTxt(baseUrl = 'https://cardseektcg.com', now = Date.now()) {
  let base = 'https://cardseektcg.com';
  try {
    const url = new URL(String(baseUrl || '').trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') base = url.origin;
  } catch { /* 退回正式站預設網址 */ }
  return [
    'Contact: mailto:contact@cardseektcg.com',
    `Expires: ${new Date(now + 365 * 86400000).toISOString()}`,
    'Preferred-Languages: zh-TW, en',
    `Canonical: ${base}/.well-known/security.txt`,
    ''
  ].join('\n');
}

export const SEO_ID_PATTERN = /^[\w:.\-/]{1,128}$/;

export function seoRequestTarget(url) {
  const clean = value => {
    const text = String(value || '').trim();
    return SEO_ID_PATTERN.test(text) ? text : null;
  };
  const card = clean(url.searchParams.get('card'));
  if (card) return { kind: 'card', id: card };
  const series = clean(url.searchParams.get('series'));
  return series ? { kind: 'series', id: series } : null;
}

export function isPublicStaticPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  if (pathname.includes('\\') || pathname.includes('\0')) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.includes('\\') || decoded.includes('\0')) return false;
  if (decoded.split('/').some(seg => seg === '.' || seg === '..')) return false;
  return PUBLIC_STATIC.test(pathname) && PUBLIC_STATIC.test(decoded);
}

export function renderCloudflareHeadersFile({ pageCsp, revalidatePaths = [] }) {
  const lines = ['/*'];
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    lines.push(`  ${name}: ${value}`);
  }
  lines.push(`  Content-Security-Policy: ${pageCsp}`);

  const sortedPaths = [...new Set(revalidatePaths.map(p => (p.startsWith('/') ? p : `/${p}`)))].sort();
  for (const path of sortedPaths) {
    lines.push('');
    lines.push(path);
    lines.push('  Cache-Control: no-cache');
  }
  lines.push('');
  return lines.join('\n');
}
