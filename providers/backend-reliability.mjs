const DEFAULT_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SNAPSHOT_MAX_STALE_MS = 30 * 60 * 1000;

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
export function createBoundedSnapshotCache({
  ttlMs = DEFAULT_SNAPSHOT_TTL_MS,
  maxStaleMs = DEFAULT_SNAPSHOT_MAX_STALE_MS,
  now = () => Date.now()
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
        error: error ? errorMessage(error) : null
      }
    };
  };

  const read = async loader => {
    if (typeof loader !== 'function') throw new TypeError('snapshot loader must be a function');
    const nowMs = timestamp(now());
    if (lastSuccess && nowMs < lastSuccess.expiresAt) return result(lastSuccess.data, 'fresh', lastSuccess.observedAt);
    if (pending) return pending;

    pending = Promise.resolve().then(loader).then(data => {
      if (data === undefined) throw new Error('snapshot loader returned undefined');
      const observedAt = timestamp(now());
      lastSuccess = { data, observedAt, expiresAt: observedAt + ttl };
      return result(data, 'fresh', observedAt);
    }).catch(error => {
      const failedAt = timestamp(now());
      if (lastSuccess && failedAt - lastSuccess.observedAt <= ttl + maxStale) {
        return result(lastSuccess.data, 'stale', lastSuccess.observedAt, error);
      }
      throw error;
    }).finally(() => {
      pending = null;
    });
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

export { DEFAULT_SNAPSHOT_TTL_MS, DEFAULT_SNAPSHOT_MAX_STALE_MS };
