// Node 與 Cloudflare Worker 共用的 Google 登入（PKCE）與收藏雲端同步純函式與控制器（零 node:*、零 Buffer、零 AsyncLocalStorage）。
import '../collection-store.js';

export const SYNC_REVISION_MAX = 2147483646;
export const AUTH_CODE = /^[A-Za-z0-9._~-]{8,512}$/;
export const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
export const AUTH_TOKEN = /^[A-Za-z0-9._~+/=-]{8,4096}$/;
export const AUTH_BODY_MAX_BYTES = 10000;
export const SYNC_SMALL_BODY_MAX_BYTES = 1024;
export const SYNC_SMALL_PUSH_DECLARED_BYTES = 4096;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(String(text || '')));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function decodeBase64UrlUtf8(segment) {
  const base64 = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = globalThis.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return TEXT_DECODER.decode(bytes);
}

// JWT 的 exp（秒）；讀不到就不限制。快取不會留到 token 過期之後。
export function tokenExpiry(token) {
  try {
    const exp = JSON.parse(decodeBase64UrlUtf8(String(token || '').split('.')[1])).exp;
    return Number.isFinite(exp) ? exp * 1000 : Infinity;
  } catch {
    return Infinity;
  }
}

export const authConfigured = env => Boolean(env?.SUPABASE2_URL && env?.SUPABASE2_ANON_KEY);
export const secondDbConfigured = env => Boolean(env?.SUPABASE2_URL && env?.SUPABASE2_SERVICE_KEY);

// 前端導向 Google 登入用的副庫網址：只回 origin，不回任何金鑰；沒開登入時回 null。
export function authPublicUrl(env) {
  if (!authConfigured(env)) return null;
  try {
    const url = new URL(env.SUPABASE2_URL);
    return url.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

export function bearerOfHeader(authorizationHeader) {
  const hit = /^Bearer (\S+)$/.exec(String(authorizationHeader || ''));
  return hit && AUTH_TOKEN.test(hit[1]) ? hit[1] : '';
}

// Supabase 的 session → 前端要的四個欄位；欄位不齊就當上游壞掉。
export function authSession(data, nowMs = Date.now()) {
  const expiresAt = Number.isFinite(data?.expires_at)
    ? data.expires_at
    : Number.isFinite(data?.expires_in)
      ? Math.floor(nowMs / 1000) + data.expires_in
      : NaN;
  if (
    typeof data?.access_token !== 'string' ||
    !AUTH_TOKEN.test(data.access_token) ||
    typeof data.refresh_token !== 'string' ||
    !AUTH_TOKEN.test(data.refresh_token) ||
    !Number.isFinite(expiresAt)
  ) {
    return null;
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    email: typeof data.user?.email === 'string' ? data.user.email.slice(0, 320) : ''
  };
}

export function validateAuthPayload(action, body) {
  const keys = Object.keys(body && typeof body === 'object' && !Array.isArray(body) ? body : {}).sort().join();
  if (action === 'exchange') {
    return (
      keys === 'code,verifier' &&
      typeof body.code === 'string' &&
      AUTH_CODE.test(body.code) &&
      typeof body.verifier === 'string' &&
      PKCE_VERIFIER.test(body.verifier)
    );
  }
  if (action === 'refresh') {
    return keys === 'refreshToken' && typeof body.refreshToken === 'string' && AUTH_TOKEN.test(body.refreshToken);
  }
  return false;
}

/**
 * 建立 Node 與 Cloudflare Worker 共用的認證與收藏雲端同步控制器。
 * 統一 PKCE 交換、Bearer 驗證（/auth/v1/user 短暫記憶體快取）、同步碼與 Google 鍵空間隔離、
 * revision 樂觀鎖、輸入驗證與錯誤不外洩規則。
 */
export function createAuthSyncController({
  getEnv = () => ({}),
  fetchFn = globalThis.fetch,
  supabaseFetch,
  now = Date.now
} = {}) {
  const authCache = new Map();

  function cacheLimits(env) {
    const cacheMs = Math.min(300000, Math.max(60000, Number(env?.AUTH_CACHE_MS || 120000)));
    const cacheMax = Math.max(1, Number(env?.AUTH_CACHE_MAX || 2000));
    return { cacheMs, cacheMax };
  }

  async function supabaseAuth(env, path, { method = 'POST', body, token } = {}) {
    const base = String(env?.SUPABASE2_URL || '').replace(/\/+$/, '');
    const response = await fetchFn(`${base}/auth/v1${path}`, {
      method,
      redirect: 'manual', // Workers fetch 不支援 'error'，會直接丟例外
      signal: AbortSignal.timeout(12000),
      headers: {
        apikey: String(env?.SUPABASE2_ANON_KEY || ''),
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return {
      status: response.status,
      ok: response.ok,
      data: await response.json().catch(() => null)
    };
  }

  // Bearer → 這個 Google 帳號的同步鍵。'' = token 無效（401）；上游壞掉丟錯（502）。只快取成功的結果，以 token 的 SHA-256 為鍵、有上限筆數。
  async function googleSyncKey(env, token) {
    const id = await sha256Hex(token);
    const currentNow = now();
    const hit = authCache.get(id);
    if (hit && hit.until > currentNow) return hit.key;
    if (hit) authCache.delete(id);

    const reply = await supabaseAuth(env, '/user', { method: 'GET', token });
    if (reply.status >= 400 && reply.status < 500) return '';
    if (!reply.ok) throw new Error(`AUTH_${reply.status}`);
    const userId = reply.data?.id;
    if (typeof userId !== 'string' || !userId) return '';

    const { cacheMs, cacheMax } = cacheLimits(env);
    const key = await sha256Hex(`google:${userId}`);
    const until = Math.min(currentNow + cacheMs, tokenExpiry(token));
    if (until <= currentNow) return key;

    if (authCache.size >= cacheMax) {
      for (const [entry, value] of authCache) {
        if (value.until <= currentNow) authCache.delete(entry);
      }
      while (authCache.size >= cacheMax) {
        authCache.delete(authCache.keys().next().value);
      }
    }
    authCache.set(id, { key, until });
    return key;
  }

  function configUrl() {
    return authPublicUrl(getEnv());
  }

  async function handleAuth({ action, authorizationHeader, readBody }) {
    const env = getEnv();
    if (action === 'logout') {
      // 登出：盡量請 Supabase 撤銷這個 session；成不成功都回 204（本機的 token 前端已經清掉）。
      const token = bearerOfHeader(authorizationHeader);
      if (token) {
        authCache.delete(await sha256Hex(token));
        if (authConfigured(env)) {
          await supabaseAuth(env, '/logout?scope=local', { token }).catch(() => null);
        }
      }
      return { status: 204, body: null, headers: { 'Cache-Control': 'no-store' } };
    }

    let body;
    try {
      body = await readBody(AUTH_BODY_MAX_BYTES);
    } catch (error) {
      return {
        status: error?.message === 'BODY_TOO_LARGE' ? 413 : 400,
        body: { error: error?.message === 'BODY_TOO_LARGE' ? '請求內容過大' : 'JSON 格式錯誤' }
      };
    }

    if (!validateAuthPayload(action, body)) {
      return { status: 400, body: { error: '登入請求格式不正確' } };
    }
    if (!authConfigured(env)) {
      return { status: 503, body: { error: 'Google 登入尚未開放' } };
    }

    try {
      const reply = action === 'exchange'
        ? await supabaseAuth(env, '/token?grant_type=pkce', { body: { auth_code: body.code, code_verifier: body.verifier } })
        : await supabaseAuth(env, '/token?grant_type=refresh_token', { body: { refresh_token: body.refreshToken } });
      if (reply.status >= 400 && reply.status < 500) {
        return { status: 401, body: { error: '登入已失效，請重新用 Google 登入' } };
      }
      const session = reply.ok && authSession(reply.data, now());
      if (!session) {
        return { status: 502, body: { error: '登入服務暫時無法使用' } };
      }
      return { status: 200, body: { data: session } };
    } catch {
      return { status: 502, body: { error: '登入服務暫時無法使用' } };
    }
  }

  async function handleSync({ action, authorizationHeader, contentLengthHeader, readBody }) {
    const env = getEnv();
    const CollectionStore = globalThis.CollectionStore;
    const { LIMITS } = CollectionStore;

    // 帶 Authorization 就是 Google 登入：body 不帶 code，鍵由 token 換到的帳號 ID 決定。標頭格式不對直接 401。
    const google = authorizationHeader !== undefined && authorizationHeader !== null;
    const token = google ? bearerOfHeader(authorizationHeader) : '';
    if (google && !token) {
      return { status: 401, body: { error: '登入已失效，請重新用 Google 登入' } };
    }

    const maxBodyBytes = action === 'push' ? LIMITS.fileMaxChars : SYNC_SMALL_BODY_MAX_BYTES;
    const declaredLength = contentLengthHeader !== undefined && contentLengthHeader !== null && contentLengthHeader !== ''
      ? Number(contentLengthHeader)
      : NaN;
    const smallPushDeclared = action === 'push' && Number.isFinite(declaredLength) && declaredLength >= 0 && declaredLength <= SYNC_SMALL_PUSH_DECLARED_BYTES;
    let hash = '';

    // Google 登入的 push 若 body 較大或未知大小（chunked），先驗 token 再讀 2 MB body，避免未授權請求放大 CPU/記憶體負載。
    if (google && action === 'push' && !smallPushDeclared) {
      if (!secondDbConfigured(env) || !authConfigured(env)) {
        return { status: 503, body: { error: '雲端同步尚未開啟' } };
      }
      try {
        hash = await googleSyncKey(env, token);
      } catch {
        return { status: 502, body: { error: '同步服務暫時無法使用' } };
      }
      if (!hash) {
        return { status: 401, body: { error: '登入已失效，請重新用 Google 登入' } };
      }
    }

    let body;
    try {
      body = await readBody(google && action === 'push' && smallPushDeclared ? SYNC_SMALL_PUSH_DECLARED_BYTES : maxBodyBytes);
    } catch (error) {
      return {
        status: error?.message === 'BODY_TOO_LARGE' ? 413 : 400,
        body: { error: error?.message === 'BODY_TOO_LARGE' ? '請求內容過大' : 'JSON 格式錯誤' }
      };
    }

    const keys = Object.keys(body && typeof body === 'object' && !Array.isArray(body) ? body : {}).sort().join();
    const code = google ? '' : CollectionStore.normalizeSyncCode(body?.code);
    const expected = google ? (action === 'push' ? 'items,revision' : '') : (action === 'push' ? 'code,items,revision' : 'code');
    if (keys !== expected || (!google && !code)) {
      return { status: 400, body: { error: '同步碼或請求格式不正確' } };
    }

    if (google && !hash) {
      if (!secondDbConfigured(env) || !authConfigured(env)) {
        return { status: 503, body: { error: '雲端同步尚未開啟' } };
      }
      try {
        hash = await googleSyncKey(env, token);
      } catch {
        return { status: 502, body: { error: '同步服務暫時無法使用' } };
      }
      if (!hash) {
        return { status: 401, body: { error: '登入已失效，請重新用 Google 登入' } };
      }
    }

    let clean = null;
    let revision = 0;
    const currentNow = now();
    if (action === 'push') {
      ({ revision } = body);
      if (
        !Number.isInteger(revision) ||
        revision < 0 ||
        revision > SYNC_REVISION_MAX ||
        !Array.isArray(body.items) ||
        body.items.length > LIMITS.itemsMax
      ) {
        return { status: 400, body: { error: '同步碼或請求格式不正確' } };
      }
      const seen = new Set();
      const rows = [];
      for (const [index, raw] of body.items.entries()) {
        const entry = CollectionStore.normalizeSyncEntry(raw);
        if (!entry) return { status: 400, body: { error: '收藏資料格式不正確', index: index + 1 } };
        if (seen.has(entry.id)) return { status: 400, body: { error: '收藏資料有重複的卡片', index: index + 1 } };
        seen.add(entry.id);
        // 裝置時鐘太超前的時間會讓這筆永遠贏過其他裝置：超過一天就當成現在。
        rows.push(
          Date.parse(entry.updatedAt) > currentNow + CollectionStore.SYNC_FUTURE_MS
            ? { ...entry, updatedAt: new Date(currentNow).toISOString() }
            : entry
        );
      }
      clean = CollectionStore.mergeSync([], rows, currentNow); // 同時清掉過期的墓碑、排好順序
      if (JSON.stringify(clean).length > LIMITS.fileMaxChars) {
        return { status: 413, body: { error: '收藏資料過大' } };
      }
    }

    if (!secondDbConfigured(env) || (google && !authConfigured(env))) {
      return { status: 503, body: { error: '雲端同步尚未開啟' } };
    }
    if (!google) hash = await sha256Hex(code);

    try {
      if (action === 'delete') {
        await supabaseFetch(`/collection_sync?sync_key_hash=eq.${hash}`, {
          db: 'ip2',
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' }
        });
        return { status: 200, body: { data: { deleted: true } } };
      }
      if (action === 'pull') {
        const rows = await supabaseFetch(`/collection_sync?sync_key_hash=eq.${hash}&select=items,revision,updated_at&limit=1`, { db: 'ip2' });
        const row = rows?.[0];
        return {
          status: 200,
          body: {
            data: {
              items: Array.isArray(row?.items) ? row.items : [],
              revision: row?.revision || 0,
              updatedAt: row?.updated_at || null
            }
          }
        };
      }
      const updatedAt = new Date(currentNow).toISOString();
      const conflict = () => ({ status: 409, body: { error: '雲端資料已被另一台裝置更新，請先同步再試一次' } });
      if (revision === 0) {
        try {
          await supabaseFetch('/collection_sync', {
            db: 'ip2',
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ sync_key_hash: hash, items: clean, revision: 1, updated_at: updatedAt })
          });
        } catch (error) {
          if (String(error?.message || '').startsWith('SUPABASE_409')) return conflict();
          throw error;
        }
      } else {
        const rows = await supabaseFetch(
          `/collection_sync?sync_key_hash=eq.${hash}&revision=eq.${revision}&select=revision`,
          {
            db: 'ip2',
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ items: clean, revision: revision + 1, updated_at: updatedAt })
          }
        );
        if (!Array.isArray(rows) || !rows.length) return conflict();
      }
      return { status: 200, body: { data: { revision: revision + 1, updatedAt } } };
    } catch {
      return { status: 502, body: { error: '同步服務暫時無法使用' } };
    }
  }

  return {
    configUrl,
    handleAuth,
    handleSync,
    googleSyncKey
  };
}
