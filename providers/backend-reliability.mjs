const DEFAULT_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SNAPSHOT_MAX_STALE_MS = 30 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX_KEYS = 10000;
const PUBLIC_SNAPSHOT_ERROR = 'UPSTREAM_UNAVAILABLE';

function duration(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function timestamp(value) {
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function iso(value) {
  return new Date(value).toISOString();
}

/**
 * Keep the last successful read available for a bounded stale window.
 *
 * The cache deliberately returns metadata alongside the snapshot so callers
 * can disclose a stale read instead of presenting it as a fresh observation.
 * A failed refresh never replaces a successful value; once the stale window
 * expires the original error is propagated to the caller.
 */
/**
 * Cloudflare Workers：一個請求建立的 promise 只能在那個請求裡完成。建立它的請求若先結束（關頁、逾時），
 * 共用中的單飛 promise 就永遠不會完成，別的請求 await 它會收到這個錯。這時丟掉它（clear 只清掉仍是同一個的），
 * 改由目前的請求自己重查（retry）。2026-11-25 正式站搜尋、目錄、漲跌榜就是卡在這裡。
 */
export function isOrphanedPromiseError(error) {
  return /created by a request that has since ended|can never settle/i.test(String(error?.message || error || ''));
}
export function joinInFlight(shared, clear, retry) {
  return Promise.resolve(shared).catch(error => {
    if (!isOrphanedPromiseError(error)) throw error;
    clear();
    return retry();
  });
}

export function createBoundedSnapshotCache({
  ttlMs = DEFAULT_SNAPSHOT_TTL_MS,
  maxStaleMs = DEFAULT_SNAPSHOT_MAX_STALE_MS,
  now = () => Date.now(),
  // When true, an expired snapshot still inside the stale window is returned at once while one
  // background load refreshes it (for snapshots that take many seconds to compute).
  serveStaleWhileRevalidate = false
} = {}) {
  const ttl = duration(ttlMs, DEFAULT_SNAPSHOT_TTL_MS);
  const maxStale = duration(maxStaleMs, DEFAULT_SNAPSHOT_MAX_STALE_MS);
  let lastSuccess = null;
  let pending = null;

  const result = (data, status, observedAt, error = null) => {
    const nowMs = timestamp(now());
    const staleUntil = observedAt + ttl + maxStale;
    return {
      data,
      cache: {
        status,
        stale: status === 'stale',
        lastSuccessAt: iso(observedAt),
        ageMs: Math.max(0, nowMs - observedAt),
        expiresAt: iso(observedAt + ttl),
        staleUntil: iso(staleUntil),
        error: error ? PUBLIC_SNAPSHOT_ERROR : null
      }
    };
  };

  const read = async (loader, options = {}) => {
    if (typeof loader !== 'function') throw new TypeError('snapshot loader must be a function');
    const waitUntil = options?.waitUntil;
    const nowMs = timestamp(now());
    if (lastSuccess && nowMs < lastSuccess.expiresAt) return result(lastSuccess.data, 'fresh', lastSuccess.observedAt);
    const staleUsable = serveStaleWhileRevalidate && lastSuccess && nowMs - lastSuccess.observedAt <= ttl + maxStale;
    if (pending) {
      if (staleUsable) {
        if (typeof waitUntil === 'function') waitUntil(pending.catch(() => {}));
        return result(lastSuccess.data, 'stale', lastSuccess.observedAt);
      }
      const shared = pending;
      return joinInFlight(shared, () => { if (pending === shared) pending = null; }, () => read(loader, options));
    }

    pending = Promise.resolve().then(loader).then(data => {
      if (data === undefined) throw new Error('snapshot loader returned undefined');
      const observedAt = timestamp(now());
      lastSuccess = { data, observedAt, expiresAt: observedAt + ttl };
      return result(data, 'fresh', observedAt);
    }).catch(error => {
      const failedAt = timestamp(now());
      if (lastSuccess && failedAt - lastSuccess.observedAt <= ttl + maxStale) {
        console.error('snapshot cache refresh failed; serving stale snapshot', errorMessage(error));
        return result(lastSuccess.data, 'stale', lastSuccess.observedAt, PUBLIC_SNAPSHOT_ERROR);
      }
      throw error;
    }).finally(() => {
      pending = null;
    });
    if (staleUsable) {
      const background = pending.catch(() => {});
      if (typeof waitUntil === 'function') waitUntil(background);
      return result(lastSuccess.data, 'stale', lastSuccess.observedAt);
    }
    return pending;
  };

  return {
    get: read,
    clear() {
      lastSuccess = null;
      pending = null;
    },
    peek() {
      return lastSuccess ? { ...lastSuccess } : null;
    },
    limits: { ttlMs: ttl, maxStaleMs: maxStale }
  };
}

export function chunkCardIds(cardIds = [], batchSize = 500) {
  const size = Math.max(1, Math.floor(Number(batchSize) || 500));
  const unique = [...new Set((Array.isArray(cardIds) ? cardIds : []).map(value => String(value || '').trim()).filter(Boolean))];
  const chunks = [];
  for (let index = 0; index < unique.length; index += size) chunks.push(unique.slice(index, index + size));
  return chunks;
}

export function imageSourceOf(row = {}) {
  return [row.imageSource, row.image_source, row.source, row.providerId, row.provider_id, row.metadata?.source, row.metadata?.provider]
    .map(value => String(value || '').trim())
    .find(Boolean) || null;
}

function imageUrlOf(row = {}) {
  return String(row.imageUrl ?? row.image_url ?? '').trim() || null;
}

export function summarizeImageHealth({ cards = [], printings = [], images = [], isDisplayable = () => false, isPolicyEligible = () => false } = {}) {
  const rows = [
    ...(Array.isArray(printings) ? printings : []),
    ...(Array.isArray(images) ? images : [])
  ];
  const urlRows = rows.filter(row => imageUrlOf(row));
  const policyEligibleRows = urlRows.filter(row => isPolicyEligible(row) === true);
  const policyUnknownRows = urlRows.filter(row => isPolicyEligible(row) === 'unknown');
  const displayableCardIds = new Set();
  for (const row of urlRows) {
    if (!isDisplayable(row)) continue;
    const cardId = String(row.cardId ?? row.card_id ?? '').trim();
    if (cardId) displayableCardIds.add(cardId);
  }
  return {
    urlRecords: urlRows.length,
    policyEligibleUrlRecords: policyEligibleRows.length,
    policyUnknownUrlRecords: policyUnknownRows.length,
    policyExcludedUrlRecords: Math.max(0, urlRows.length - policyEligibleRows.length - policyUnknownRows.length),
    displayableCards: displayableCardIds.size,
    sampledLoadCount: null,
    sampledLoadStatus: 'unknown',
    sampledLoadReason: '未執行實際圖片取樣載入；URL 存在不代表可成功載入。',
    cardCount: Array.isArray(cards) ? cards.length : 0
  };
}

// 固定時間窗計數；為防偽造 IP 膨脹記憶體，限制最大鍵數（滿時先清過期鍵，仍滿則驅逐最舊鍵）。
// shortcut: 計數只在單一程序內，之後開多個執行個體時要改用共用儲存。
export function createRateLimiter({ limit, windowMs = 60000, maxKeys = DEFAULT_RATE_LIMIT_MAX_KEYS, now = Date.now }) {
  const hits = new Map();
  const cap = Math.max(1, Math.floor(Number(maxKeys) || DEFAULT_RATE_LIMIT_MAX_KEYS));
  return key => {
    const current = now();
    const existing = hits.get(key);
    if (existing && existing.expiresAt > current) {
      existing.count += 1;
      return existing.count <= limit;
    }
    if (existing) hits.delete(key);
    if (hits.size >= cap) {
      for (const [entryKey, entry] of hits) {
        if (entry.expiresAt <= current) hits.delete(entryKey);
      }
      while (hits.size >= cap) hits.delete(hits.keys().next().value);
    }
    hits.set(key, { count: 1, expiresAt: current + windowMs });
    return 1 <= limit;
  };
}

const auditClean = value => String(value || '').trim();
const auditRowId = row => auditClean(row?.id);
const auditRowCardId = row => auditClean(row?.cardId ?? row?.card_id);
const auditRowGameId = row => auditClean(row?.gameId ?? row?.game_id ?? row?.game);
const auditRowProviderId = row => auditClean(row?.providerId ?? row?.provider_id);
const auditRowCardNumber = row => auditClean(row?.officialCardNumber ?? row?.official_card_number ?? row?.localCardNumber ?? row?.local_card_number);
const auditRowImageUrl = row => auditClean(row?.imageUrl ?? row?.image_url);
const auditRowChineseName = row => auditClean(row?.nameZh ?? row?.name_zh);

/**
 * Audit catalog relationships without guessing identity from names. The
 * returned shape is intentionally JSON-safe so it can be attached to public
 * coverage responses or written to a sync-run metadata object.
 */
export function auditCatalogLinks({ cards = [], printings = [], images = [], providerKeys = new Map() } = {}) {
  const cardRows = (cards || []).filter(row => row && typeof row === 'object');
  const cardIds = new Set(cardRows.map(auditRowId).filter(Boolean));
  const cardById = new Map(cardRows.map(row => [auditRowId(row), row]));
  const printingRows = (printings || []).filter(row => row && typeof row === 'object');
  const imageRows = (images || []).filter(row => row && typeof row === 'object');
  const printingsWithKnownCard = printingRows.filter(row => cardIds.has(auditRowCardId(row)));
  const imagesWithKnownCard = imageRows.filter(row => cardIds.has(auditRowCardId(row)));
  const cardsWithPrintings = new Set(printingsWithKnownCard.map(auditRowCardId));
  const cardsWithImages = new Set([...imagesWithKnownCard, ...printingsWithKnownCard.filter(auditRowImageUrl)].map(auditRowCardId));
  const stableIdentityRows = cardRows.filter(row => auditRowId(row) && auditRowGameId(row) && (auditRowProviderId(row) || auditRowCardNumber(row)));
  const missingImages = cardRows.filter(row => !cardsWithImages.has(auditRowId(row)) && !auditRowImageUrl(row));
  const missingChineseNames = cardRows.filter(row => !auditRowChineseName(row));
  const orphanPrintings = printingRows.filter(row => !cardIds.has(auditRowCardId(row)));
  const orphanImages = imageRows.filter(row => !cardIds.has(auditRowCardId(row)));
  const crossGameReferences = printingRows.filter(row => {
    const card = cardById.get(auditRowCardId(row));
    const printingGame = auditRowGameId(row);
    return Boolean(card && printingGame && auditRowGameId(card) && printingGame !== auditRowGameId(card));
  });
  for (const row of cardRows) {
    const provider = auditRowProviderId(row);
    const game = auditRowGameId(row);
    if (!provider || !game) continue;
    const key = `${game}\u001f${provider}`;
    const list = providerKeys.get(key) || [];
    list.push(auditRowId(row));
    providerKeys.set(key, list);
  }
  const duplicateProviderKeys = [...providerKeys.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key: key.replace('\u001f', ':'), cardIds: ids }));
  const sample = rows => rows.map(row => auditRowId(row) || auditRowCardId(row)).filter(Boolean).slice(0, 50);
  return {
    status: 'observed',
    cards: cardRows.length,
    stableIdentityCards: stableIdentityRows.length,
    unkeyedCards: cardRows.length - stableIdentityRows.length,
    cardsWithPrintings: cardsWithPrintings.size,
    cardsWithImages: cardsWithImages.size,
    printingReferences: printingRows.length,
    linkedPrintingReferences: printingsWithKnownCard.length,
    imageReferences: imageRows.length,
    linkedImageReferences: imagesWithKnownCard.length,
    orphanPrintings: orphanPrintings.length,
    orphanImages: orphanImages.length,
    crossGameReferences: crossGameReferences.length,
    duplicateProviderKeys,
    missingImages: { count: missingImages.length, sampleIds: sample(missingImages) },
    missingChineseNames: { count: missingChineseNames.length, sampleIds: sample(missingChineseNames) },
    complete: cardRows.length > 0 && stableIdentityRows.length === cardRows.length && orphanPrintings.length === 0 && orphanImages.length === 0 && crossGameReferences.length === 0
  };
}

export { DEFAULT_SNAPSHOT_TTL_MS, DEFAULT_SNAPSHOT_MAX_STALE_MS, DEFAULT_RATE_LIMIT_MAX_KEYS };
