// 純 Web 標準的 Supabase REST/RPC 客戶端：顯式傳入 env 與目標庫（main / ip2），不依賴 node:* 與 AsyncLocalStorage。

export const BASE_CATALOG_GAME_IDS = Object.freeze([
  'pokemon',
  'onepiece',
  'yugioh',
  'haikyuu',
  'weiss-schwarz',
  'dragonball-fw'
]);

export const SECOND_DB_GAMES = new Set(['union-arena']);
export const CATALOG_REGION_IDS = new Set(['JP', 'TW', 'US', 'CN', 'KR', 'ASIA']);

// 價格、統計、健康快照、匯率、買取與回報只存在主庫，即使目前視圖是第二庫遊戲也不走 ip2。
export const MAIN_ONLY_PATH = /^\/(?:rpc\/)?(?:price_|card_hot|page_stats|catalog_health|catalog_sync|exchange_rates|jp_buyback|reports)/;

export const dbForGame = game => (SECOND_DB_GAMES.has(String(game || '')) ? 'ip2' : 'main');

export const dbForId = id => ([...SECOND_DB_GAMES].some(game => String(id || '').startsWith(`${game}-`)) ? 'ip2' : 'main');

/**
 * 建立綁定特定環境變數與 fetch 實作的 Supabase 客戶端。
 * Worker 與 Node 可共用相同呼叫介面，避免依賴全域 process.env 或 AsyncLocalStorage。
 */
export function createSupabaseClient({ env = {}, fetchFn = globalThis.fetch, defaultTimeoutMs = 12000 } = {}) {
  const supabaseConfigured = () => Boolean(env?.SUPABASE_URL && env?.SUPABASE_SERVICE_KEY);
  const secondDbConfigured = () => Boolean(env?.SUPABASE2_URL && env?.SUPABASE2_SERVICE_KEY);
  const secondDbTimeoutMs = Math.max(100, Number(env?.SUPABASE2_TIMEOUT_MS || 4000));

  function catalogGameIds() {
    const ids = new Set(BASE_CATALOG_GAME_IDS);
    if (secondDbConfigured()) {
      for (const game of SECOND_DB_GAMES) ids.add(game);
    }
    return ids;
  }

  function resolveDb(pathAndQuery, db) {
    if (db) return db;
    return MAIN_ONLY_PATH.test(pathAndQuery) ? 'main' : 'main';
  }

  function target(pathAndQuery, db) {
    const which = resolveDb(pathAndQuery, db);
    const [base, key] = which === 'ip2'
      ? [env?.SUPABASE2_URL, env?.SUPABASE2_SERVICE_KEY]
      : [env?.SUPABASE_URL, env?.SUPABASE_SERVICE_KEY];
    if (!base || !key) {
      throw new Error(which === 'ip2' ? 'SUPABASE2_NOT_CONFIGURED' : 'SUPABASE_NOT_CONFIGURED');
    }
    return { base: String(base).replace(/\/+$/, ''), key: String(key), db: which };
  }

  async function fetchJson(pathAndQuery, { db, timeoutMs, signal, headers, ...options } = {}) {
    const { base, key } = target(pathAndQuery, db);
    const effectiveSignal = signal || AbortSignal.timeout(timeoutMs || defaultTimeoutMs);
    const response = await fetchFn(`${base}/rest/v1${pathAndQuery}`, {
      ...options,
      signal: effectiveSignal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(headers || {})
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`SUPABASE_${response.status}:${text.slice(0, 200)}`);
    }
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function fetchPage(pathAndQuery, { db, timeoutMs, signal } = {}) {
    const { base, key } = target(pathAndQuery, db);
    const effectiveSignal = signal || AbortSignal.timeout(timeoutMs || defaultTimeoutMs);
    const response = await fetchFn(`${base}/rest/v1${pathAndQuery}`, {
      signal: effectiveSignal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        Prefer: 'count=exact'
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`SUPABASE_${response.status}:${text.slice(0, 200)}`);
    }
    const contentRange = String(response.headers.get('content-range') || '');
    const totalToken = contentRange.split('/').at(-1);
    const total = /^\d+$/.test(totalToken) ? Number(totalToken) : null;
    return { data: await response.json(), total };
  }

  async function fetchAll(pathAndQuery, pageSize = 1000, { db, maxPages = Infinity, timeoutMs } = {}) {
    const rows = [];
    let pages = 0;
    for (let offset = 0; ; offset += pageSize) {
      if (pages >= maxPages) throw new Error('SUPABASE_MAX_PAGES_EXCEEDED');
      pages++;
      const separator = pathAndQuery.includes('?') ? '&' : '?';
      const batch = await fetchJson(`${pathAndQuery}${separator}limit=${pageSize}&offset=${offset}`, { db, timeoutMs });
      rows.push(...(batch || []));
      if (!batch || batch.length < pageSize) return rows;
    }
  }

  return {
    supabaseConfigured,
    secondDbConfigured,
    secondDbTimeoutMs,
    catalogGameIds,
    target,
    fetchJson,
    fetchPage,
    fetchAll
  };
}
