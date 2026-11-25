// Worker 與共用讀取端點引擎（零 node:*、零 Buffer、零 AsyncLocalStorage）。
import { marketEventsFor, catalogEventsFrom, mergeMarketEvents } from './market-events.mjs';
import { normalizeMarketRecord, withTwd } from './normalize.mjs';
import { REFERENCE_BODY_MAX_BYTES, buildReferencePrices, referenceQueryParams, validateReferenceRequest } from './collection-valuation.mjs';
import { createAuthSyncController } from './auth-sync.mjs';
import {
  EBAY_DAILY_LOOKUPS,
  EBAY_SEARCH_URL,
  EBAY_TOKEN_URL,
  EBAY_TTL_MS,
  ebayQuery,
  pickListings
} from './ebay-listings.mjs';
import {
  GRADED_DAILY_LOOKUPS,
  GRADED_ENDPOINT,
  GRADED_TTL_MS,
  gradedQuery,
  pickGradedCard,
  summarizeGrades
} from './graded-prices.mjs';
import {
  KV_KEYS,
  buildFallbackPackPrizes,
  buildFallbackSeriesHits,
  normalizeKvCatalogCoverage,
  normalizeKvPackPrizes,
  normalizeKvSeriesHits,
  normalizeKvSitemapIndex,
  normalizeKvSitemapXml,
  sitemapCardsKvKey
} from './kv-snapshots.mjs';
import {
  applyNoindexToHtml,
  applySeoToHtml,
  cardSeo,
  normalizeBaseUrl,
  pageSitemapEntries,
  renderUrlSet,
  seriesSeo
} from './seo.mjs';
import { buildSeriesIndex, foldSearch, foldedSpan, gameHintFor, parseSearchQuery, printingMatchesRarity, rarityMatchValues, rarityOnlyExample } from './search-query.mjs';
import { catalogCollectionAllowed, imageDisplayPolicies, publicSourcePolicies, sourceDisplayDenied, sourcePolicySummary } from './source-policy.mjs';
import { createTcgdexPricing } from './tcgdex-pricing.mjs';
import { createYgoProDeckClient, crossVersionLowestPrices, matchYgoprodeckSet } from './ygoprodeck.mjs';
import { chunkCardIds, createBoundedSnapshotCache, joinInFlight } from './backend-reliability.mjs';
import { CARD_ID_PATTERN, isBot, pageKind, taipeiDay } from './page-stats.mjs';
import { CATALOG_REGION_IDS, createSupabaseClient, dbForGame, dbForId, getResponseByteSize } from './supabase-client.mjs';
import {
  ALLOWED_CURRENCIES,
  ALLOWED_PLATFORMS,
  BROWSE_CACHE_MS,
  BROWSE_CARD_SELECT,
  BROWSE_IMAGE_SELECT,
  BROWSE_PAGE_MAX,
  BROWSE_PRICE_SORTS,
  BROWSE_PRINTING_SELECT,
  BROWSE_RARITY_FORMAT,
  CATALOG_GAMES_PATH,
  CATALOG_SERIES_PATH,
  FX_CACHE_MS,
  FX_JUMP_WINDOW_MS,
  HOME_EVENTS_PAST_DAYS,
  HOT_CARDS_DAYS,
  HOT_CARDS_LIMIT,
  HOT_CARDS_MIN_OPENS,
  MARKET_CACHE_MS,
  MAX_PRICE,
  ONEPIECE_IMAGE_MAX_BYTES,
  ONEPIECE_IMAGE_MIMES,
  PRICE_HISTORY_DAYS,
  PRICE_MOVERS_DAYS,
  PRICE_MOVERS_MIN_EUR,
  PUBLIC_REPORT_SELECT,
  SEARCH_CANDIDATE_LIMIT,
  SEARCH_PAGE_MAX,
  SEARCH_PATTERNS_MAX,
  SEARCH_RESULT_LIMIT,
  SEARCH_SERIES_IDS_MAX,
  SERIES_ZH_ENTRIES,
  SHORT_CACHE,
  UPSTREAM_ERROR,
  amountToTwd,
  browseHasUsableImage,
  buildBrowseFacets,
  buildBrowsePage,
  buildCuratedProducts,
  buildFallbackCatalogCoverage,
  buildHotCardsPayload,
  buildPriceMovers,
  buildPrintingIndex,
  buildProductSetsFromSources,
  buildStats,
  buildVersionPrices,
  canonicalizeCatalog,
  cardImageFields,
  cardMatchRank,
  chunkDatabaseRelationCardIds,
  databaseRelationQuery,
  filterBrowseCards,
  fxJump,
  getFallbackCatalogCopy,
  hydrateBrowseCard,
  mergeCatalogRows,
  normalizeBrowseRarity,
  normalizeBrowseRegion,
  normalizeBrowseSort,
  normalizeSearch,
  onePieceImageTarget,
  prepareBrowseSeriesSorted,
  priceHistoryCardIds,
  productFeedMeta,
  providerStatusFromEnv,
  rarityCanonicalCode,
  rarityCanonicalToken,
  rarityDisplayLabel,
  browseRarityRank,
  readBoundedBytes,
  referenceChange,
  referencePriceFromRow,
  regionLabel,
  searchQueryTerms,
  searchTimedOut,
  storageStatus,
  suggestBody,
  tcgdexLookups,
  trendMeta,
  trendObservationWindow,
  trendRecordKey,
  uniqueValues,
  validCardId,
  withTimeout
} from './catalog-core.mjs';

const WORKER_SERIES_FALLBACK_MAX = 500;
const BROWSE_HEAVY_TIMEOUT_MS = 25000;
const RELATION_BATCH_SIZE = 100;
const RELATION_QUERY_MAX_BYTES = 8 * 1024;
const RELATION_QUERY_CONCURRENCY = 4;
const SEARCH_SUBREQUEST_BUDGET = 30;
const BUYBACK_PROVIDER_GAMES = new Map([['pokemon', 'poc']]);
const YUGIOH_CACHE_SOURCE = 'cardscope-yugioh-cache';

const ARCHIVE_BUCKET = 'price-archive';
const ARCHIVE_PREFIX = 'v1';
const ARCHIVE_SHARDS = 32;
const ARCHIVE_FORMAT_VERSION = 1;
const ARCHIVE_DECODED_MAX_BYTES = 64 * 1024 * 1024;
const ARCHIVE_CACHE_MAX_ENTRIES = 16;
const ARCHIVE_CACHE_MAX_ROWS = 120000;
const ARCHIVE_CACHE_TTL_MS = 60 * 60 * 1000;
const ARCHIVE_MANIFEST_TTL_MS = 5 * 60 * 1000;
const ARCHIVE_STORAGE_TIMEOUT_MS = 20000;
const ARCHIVE_READ_DEADLINE_MS = 8000;
const DEFAULT_ARCHIVE_SHARD_BUDGET = 6;
const ARCHIVE_DIGEST_LENGTH = 12;
const ARCHIVE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ARCHIVE_PROVIDERS = new Set(['cardmarket', 'tcgplayer']);
const ARCHIVE_CURRENCIES = new Set(['EUR', 'USD']);
const PRICE_HISTORY_TTL_MS = 3600000;
const PRICE_HISTORY_CACHE_MAX = 150;
const PRICE_SOURCE_LABELS = { cardmarket: 'Cardmarket', tcgplayer: 'TCGplayer' };
const SEO_LOAD_TIMEOUT_MS = 1500;
const SEO_CACHE_TTL_MS = 600000;
const SEO_NEGATIVE_TTL_MS = 60000;
const SEO_CACHE_MAX = 500;

export function priceHistoryNote(series) {
  const names = [...new Set((series || []).map(x => PRICE_SOURCE_LABELS[x.provider]).filter(Boolean))];
  return `參考價為${names.length ? ` ${names.join('／')} 的` : ''}平台參考價（經 TCGdex 轉供），不是成交價或台灣行情；新台幣以今日匯率換算，歷史點位不代表當時匯率。`;
}

export function buildPriceHistory(rows, { card, requestedId, fx, now = Date.now() }) {
  const groups = new Map();
  const regionOf = cardId => (card?.printings || []).find(p => p.cardId === cardId)?.region || (card?.id === cardId ? card.region : null) || null;
  for (const row of rows || []) {
    const amount = Number(row.amount);
    if (!row?.card_id || !row.snapshot_date || !Number.isFinite(amount)) continue;
    const variant = row.provider === 'tcgplayer' ? String(row.variant || '').replace(/^tcgapi-/, '') : (row.variant || '');
    const key = JSON.stringify([row.card_id, row.provider, variant, row.currency]);
    let group = groups.get(key);
    if (!group) {
      group = {
        cardId: row.card_id,
        region: regionOf(row.card_id),
        provider: row.provider,
        variant,
        currency: row.currency,
        points: []
      };
      groups.set(key, group);
    }
    group.points.push({
      date: String(row.snapshot_date).slice(0, 10),
      amount,
      amountTwd: amountToTwd(amount, row.currency, fx),
      observedAt: row.observed_at || null
    });
  }
  const series = [...groups.values()].map(g => ({
    ...g,
    points: g.points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }));
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  series.sort((a, b) =>
    (b.cardId === requestedId) - (a.cardId === requestedId) ||
    b.points.length - a.points.length ||
    cmp(b.points.at(-1).date, a.points.at(-1).date) ||
    cmp(a.cardId + a.provider + a.variant, b.cardId + b.provider + b.variant)
  );
  const from = new Date(now - PRICE_HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  return {
    series,
    meta: {
      exchangeRates: fx,
      note: priceHistoryNote(series),
      windowDays: PRICE_HISTORY_DAYS,
      from,
      events: marketEventsFor(card?.game, from, now),
      generatedAt: new Date(now).toISOString()
    }
  };
}

const archivePad = shard => String(shard).padStart(2, '0');
const archiveMonthOf = date => String(date).slice(0, 7);
const archiveRowKey = row => `${row.card_id}\u0000${row.provider}\u0000${row.variant ?? ''}\u0000${String(row.snapshot_date).slice(0, 10)}`;
const archiveCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const compareArchiveRows = (a, b) =>
  archiveCmp(a.card_id, b.card_id) ||
  archiveCmp(a.provider, b.provider) ||
  archiveCmp(a.variant, b.variant) ||
  archiveCmp(a.snapshot_date, b.snapshot_date);
const archiveShortDigest = digest => String(digest).slice(0, ARCHIVE_DIGEST_LENGTH);

function normalizeArchiveRowWeb(row) {
  const amount = Number(row?.amount);
  const date = String(row?.snapshot_date ?? '').slice(0, 10);
  if (
    !row ||
    typeof row.card_id !== 'string' ||
    !row.card_id ||
    row.card_id.length > 200 ||
    !ARCHIVE_PROVIDERS.has(row.provider) ||
    typeof (row.variant ?? '') !== 'string' ||
    !ARCHIVE_CURRENCIES.has(row.currency) ||
    !ARCHIVE_DATE_RE.test(date) ||
    !Number.isFinite(amount) ||
    !(amount > 0)
  ) {
    throw new Error(`ARCHIVE_ROW_INVALID: ${JSON.stringify(row)?.slice(0, 120)}`);
  }
  return {
    card_id: row.card_id,
    provider: row.provider,
    variant: row.variant ?? '',
    currency: row.currency,
    snapshot_date: date,
    amount: Math.round(amount * 100) / 100
  };
}

function mergeSnapshotRowsWeb(dbRows, archiveRows) {
  const map = new Map();
  for (const row of archiveRows || []) map.set(archiveRowKey(row), row);
  for (const row of dbRows || []) map.set(archiveRowKey(row), row);
  return [...map.values()].sort(compareArchiveRows);
}

const shardMemo = new Map();
async function shardOfWeb(cardId, shards = ARCHIVE_SHARDS) {
  const key = `${shards}:${cardId}`;
  const cached = shardMemo.get(key);
  if (cached !== undefined) return cached;
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(String(cardId)));
  const shard = new DataView(digest).getUint32(0, false) % shards;
  shardMemo.set(key, shard);
  while (shardMemo.size > 5000) shardMemo.delete(shardMemo.keys().next().value);
  return shard;
}

async function sha256HexBytes(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function gunzipWebBounded(gzBytes, maxBytes = ARCHIVE_DECODED_MAX_BYTES) {
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new Error('ARCHIVE_CORRUPT: DecompressionStream unavailable');
  }
  const ds = new globalThis.DecompressionStream('gzip');
  const stream = new Blob([gzBytes]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('maxOutputLength exceeded');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    throw new Error(`ARCHIVE_CORRUPT: gunzip ${error?.message || error}`);
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

async function decodeShardWeb(gzBytes, { month, shard } = {}) {
  const bytes = await gunzipWebBounded(gzBytes, ARCHIVE_DECODED_MAX_BYTES);
  let doc;
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('ARCHIVE_CORRUPT: json');
  }
  if (doc?.v !== ARCHIVE_FORMAT_VERSION || !Array.isArray(doc.rows) || doc.shards !== ARCHIVE_SHARDS) {
    throw new Error('ARCHIVE_CORRUPT: header');
  }
  if ((month != null && doc.month !== month) || (shard != null && doc.shard !== shard)) {
    throw new Error(`ARCHIVE_CORRUPT: expected ${month}/${shard}, got ${doc.month}/${doc.shard}`);
  }
  const rows = doc.rows.map(tuple =>
    normalizeArchiveRowWeb({
      card_id: tuple?.[0],
      provider: tuple?.[1],
      variant: tuple?.[2],
      currency: tuple?.[3],
      snapshot_date: tuple?.[4],
      amount: tuple?.[5]
    })
  );
  for (const row of rows) {
    if (archiveMonthOf(row.snapshot_date) !== doc.month || (await shardOfWeb(row.card_id)) !== doc.shard) {
      throw new Error(`ARCHIVE_CORRUPT: row outside ${doc.month}/${doc.shard}`);
    }
  }
  const digest = await sha256HexBytes(bytes);
  return { rows, digest, month: doc.month, shard: doc.shard };
}

function createWebArchiveReader({ getEnv, fetchFn, now }) {
  const cache = new Map();
  const pending = new Map();
  let manifestEntry = null;
  let manifestPending = null;
  let cachedRows = 0;

  const evict = () => {
    while (cache.size > ARCHIVE_CACHE_MAX_ENTRIES || (cachedRows > ARCHIVE_CACHE_MAX_ROWS && cache.size)) {
      const [key, value] = cache.entries().next().value;
      cache.delete(key);
      cachedRows -= value.rowCount;
    }
  };
  const drop = key => {
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cachedRows -= hit.rowCount;
    }
  };

  function getStorageConfig() {
    const activeEnv = getEnv() || {};
    const baseUrl = String(activeEnv.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const key = String(activeEnv.SUPABASE_SERVICE_KEY || '').trim();
    if (!baseUrl || !key) return null;
    const rawBudget = Number(activeEnv.PRICE_ARCHIVE_SHARD_BUDGET);
    const shardBudget = Number.isFinite(rawBudget) && rawBudget > 0
      ? Math.max(1, Math.floor(rawBudget))
      : DEFAULT_ARCHIVE_SHARD_BUDGET;
    return { baseUrl, key, shardBudget };
  }

  async function storageGetBytes(cfg, path, { version } = {}) {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const bust = version
      ? `?v=${encodeURIComponent(version)}`
      : `?n=${now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const url = `${cfg.baseUrl}/storage/v1/object/authenticated/${ARCHIVE_BUCKET}/${encodedPath}${bust}`;
    const response = await fetchFn(url, {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Cache-Control': 'no-cache'
      },
      signal: AbortSignal.timeout(ARCHIVE_STORAGE_TIMEOUT_MS)
    });
    if (response.status === 404) return null;
    if (response.status === 400) {
      const text = await response.clone().text().catch(() => '');
      if (/"statusCode"\s*:\s*"?404/.test(text) || /not[_ ]found/i.test(text)) return null;
    }
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 160);
      throw new Error(`ARCHIVE_STORAGE_GET_${response.status}: ${text}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  function parseManifestBytes(bytes) {
    if (!bytes) return { v: ARCHIVE_FORMAT_VERSION, months: {} };
    let doc;
    try {
      doc = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error('ARCHIVE_MANIFEST_CORRUPT: json');
    }
    if (doc?.v !== ARCHIVE_FORMAT_VERSION || !doc.months || typeof doc.months !== 'object') {
      throw new Error('ARCHIVE_MANIFEST_CORRUPT: header');
    }
    return doc;
  }

  async function loadManifest(cfg) {
    if (manifestEntry && now() - manifestEntry.at < ARCHIVE_MANIFEST_TTL_MS) return manifestEntry.value;
    if (manifestPending) { const shared = manifestPending; return joinInFlight(shared, () => { if (manifestPending === shared) manifestPending = null; }, () => loadManifest(cfg)); }
    manifestPending = storageGetBytes(cfg, `${ARCHIVE_PREFIX}/manifest.json`)
      .then(bytes => {
        const value = parseManifestBytes(bytes);
        manifestEntry = { at: now(), value };
        return value;
      })
      .finally(() => {
        manifestPending = null;
      });
    return manifestPending;
  }

  async function loadShardRows(cfg, month, shard, expected) {
    const key = `${month}|${shard}|${expected}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ARCHIVE_CACHE_TTL_MS) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.byCard;
    }
    if (hit) drop(key);
    if (pending.has(key)) { const shared = pending.get(key); return joinInFlight(shared, () => { if (pending.get(key) === shared) pending.delete(key); }, () => loadShardRows(cfg, month, shard, expected)); }
    const task = (async () => {
      const path = `${ARCHIVE_PREFIX}/${month}/${archivePad(shard)}.json.gz`;
      let bytes = await storageGetBytes(cfg, path, { version: expected });
      if (!bytes) throw new Error(`ARCHIVE_FILE_MISSING: ${month}/${archivePad(shard)} is in the manifest but not in the bucket`);
      let decoded = await decodeShardWeb(bytes, { month, shard });
      if (archiveShortDigest(decoded.digest) !== expected) {
        bytes = await storageGetBytes(cfg, path);
        decoded = bytes ? await decodeShardWeb(bytes, { month, shard }) : decoded;
        if (archiveShortDigest(decoded.digest) !== expected) {
          throw new Error(`ARCHIVE_STALE: ${month}/${archivePad(shard)} expected ${expected}, got ${archiveShortDigest(decoded.digest)}`);
        }
      }
      const byCard = new Map();
      for (const row of decoded.rows) {
        const list = byCard.get(row.card_id);
        if (list) list.push(row);
        else byCard.set(row.card_id, [row]);
      }
      if (decoded.rows.length <= ARCHIVE_CACHE_MAX_ROWS) {
        cache.set(key, { at: now(), rowCount: decoded.rows.length, byCard });
        cachedRows += decoded.rows.length;
        evict();
      }
      return byCard;
    })().finally(() => {
      pending.delete(key);
    });
    pending.set(key, task);
    return task;
  }

  return {
    async rowsFor(cardIds, { from } = {}) {
      const cfg = getStorageConfig();
      if (!cfg || !cardIds?.length) return [];
      const ids = [...new Set(cardIds)];
      const wanted = new Set(ids);
      const fromMonth = from ? archiveMonthOf(from) : '0000-00';
      const doc = await loadManifest(cfg);
      const shards = [...new Set(await Promise.all(ids.map(id => shardOfWeb(id))))];
      const plan = [];
      for (const month of Object.keys(doc.months).sort()) {
        if (month < fromMonth) continue;
        for (const shard of shards) {
          const entry = doc.months[month]?.[archivePad(shard)];
          if (entry) plan.push([month, shard, entry.d]);
        }
      }
      if (plan.length > cfg.shardBudget) {
        throw new Error(`ARCHIVE_SHARD_BUDGET_EXCEEDED: ${plan.length} shards needed, budget is ${cfg.shardBudget}`);
      }
      const out = [];
      const started = now();
      const concurrency = 4;
      for (let i = 0; i < plan.length; i += concurrency) {
        if (now() - started > ARCHIVE_READ_DEADLINE_MS) {
          throw new Error(`ARCHIVE_READ_TIMEOUT: ${i} of ${plan.length} files read`);
        }
        const loaded = await Promise.all(
          plan.slice(i, i + concurrency).map(([month, shard, digest]) => loadShardRows(cfg, month, shard, digest))
        );
        for (const byCard of loaded) {
          for (const id of wanted) {
            for (const row of byCard.get(id) || []) {
              if (!from || row.snapshot_date >= from) out.push(row);
            }
          }
        }
      }
      return out.sort(compareArchiveRows);
    }
  };
}

function createSearchBudget(limit = SEARCH_SUBREQUEST_BUDGET) {
  let used = 0;
  return {
    get used() { return used; },
    get remaining() { return Math.max(0, limit - used); },
    exhausted() { return used >= limit; },
    consume(n = 1) {
      if (used + n > limit) return false;
      used += n;
      return true;
    }
  };
}

function shortHash(text) {
  let h = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

async function sha1Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(String(text || '')));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readJsonBodyBounded(request, maxBytes) {
  const contentLength = request.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined && contentLength !== '') {
    const len = Number(contentLength);
    if (Number.isFinite(len) && len > maxBytes) {
      await request.body?.cancel?.().catch(() => {});
      throw new Error('BODY_TOO_LARGE');
    }
  }
  if (!request.body || typeof request.body.getReader !== 'function') {
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.byteLength > maxBytes) throw new Error('BODY_TOO_LARGE');
    if (!raw.byteLength) return {};
    try {
      return JSON.parse(new TextDecoder().decode(raw));
    } catch {
      throw new Error('INVALID_JSON');
    }
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('BODY_TOO_LARGE');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) return {};
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    throw new Error('INVALID_JSON');
  }
}

/**
 * 建立 Worker 讀取 API 引擎，綁定 env、fetchFn、now 與選用的 Edge Cache，完全不使用 Node 專屬 API。
 */
export function createReadApi({ env = {}, fetchFn = globalThis.fetch, now = Date.now, edgeCache = undefined } = {}) {
  let currentEnv = env;
  const db = createSupabaseClient({ env, fetchFn });
  const authSync = createAuthSyncController({
    getEnv: () => currentEnv,
    fetchFn,
    supabaseFetch: (path, opts) => db.fetchJson(path, opts),
    now
  });
  const jpyToTwdFallback = Number(env?.JPY_TO_TWD || 0.22);
  const usdToTwdFallback = Number(env?.USD_TO_TWD || 32);
  const resolvedEdgeCache = edgeCache === undefined ? (globalThis.caches?.default || null) : edgeCache;
  const cacheNamespace = shortHash([
    env?.SUPABASE_URL || '',
    env?.SUPABASE_SERVICE_KEY ? '1' : '0',
    env?.SUPABASE2_URL || '',
    env?.SUPABASE2_SERVICE_KEY ? '1' : '0',
    env?.SCRAPE_SECRET ? '1' : '0'
  ].join('|'));

  const searchYgo = createYgoProDeckClient({ fetchFn, now });
  const fetchTcgdexJa = createTcgdexPricing({ language: 'ja', fetch: fetchFn, now });
  const fetchTcgdexEn = createTcgdexPricing({ language: 'en', fetch: fetchFn, now });

  // Isolate 記憶體快取（遵守 Workers 單實例上限，避免膨脹）
  const browseCache = new Map();
  const BROWSE_CACHE_ROWS_MAX = 5000;
  const BROWSE_CACHE_BYTES_MAX = 12 * 1024 * 1024;
  const BROWSE_CACHE_KEYS_MAX = 200;
  const SNAPSHOT_TTL_MS = Math.max(1000, Number(env?.CATALOG_SNAPSHOT_CACHE_MS) || BROWSE_CACHE_MS);
  const COVERAGE_TTL_MS = Math.max(1000, Number(env?.CATALOG_SNAPSHOT_CACHE_MS) || 60 * 60 * 1000);
  const SNAPSHOT_MAX_STALE_MS = Math.max(1000, Number(env?.CATALOG_SNAPSHOT_MAX_STALE_MS) || 24 * 60 * 60 * 1000);
  const CATALOG_CACHE_TTL_MS = Number(env?.CATALOG_CACHE_TTL_MS ?? 600000);
  const PRODUCT_CACHE_TTL_MS = Number(env?.PRODUCT_CACHE_TTL_MS ?? 600000);

  const fxCache = { data: null, expiresAt: 0 };
  const catalogHealthCache = createBoundedSnapshotCache({ ttlMs: SNAPSHOT_TTL_MS, maxStaleMs: SNAPSHOT_MAX_STALE_MS, now, serveStaleWhileRevalidate: true });
  const catalogCoverageFallbackCache = createBoundedSnapshotCache({ ttlMs: COVERAGE_TTL_MS, maxStaleMs: SNAPSHOT_MAX_STALE_MS, now, serveStaleWhileRevalidate: true });
  const trendCache = { data: null, expiresAt: 0, promise: null };
  const TREND_CACHE_MS = 5 * 60 * 1000;
  const storageCaches = {
    main: { data: null, expiresAt: 0, promise: null, retryAt: 0 },
    ip2: { data: null, expiresAt: 0, promise: null, retryAt: 0 }
  };
  let productCache = { value: null, at: 0, pending: null };
  let catalogCache = { value: null, at: 0, pending: null };
  const seriesIndexCache = new WeakMap();
  const seriesByIdCache = new WeakMap();
  const localCardSearchCache = new WeakMap();
  const catalogJsonCache = new WeakMap();
  const productJsonCache = new WeakMap();
  const marketFxCacheable = new WeakMap();
  const SEARCH_CACHE_TTL_MS = 600000;
  const SEARCH_CACHE_MAX = 150;
  const searchCache = new Map();
  let rankedPageMissingUntil = 0;
  let rankedSeriesMissingUntil = 0;
  const CARD_CACHE_TTL_MS = 600000;
  const CARD_CACHE_MAX = 200;
  const cardCache = new Map();
  const MARKET_CACHE_MAX = 150;
  const marketCache = new Map();
  let catalogEventsCache = null;
  const priceMoversCache = createBoundedSnapshotCache({ ttlMs: 3600000, maxStaleMs: 24 * 60 * 60 * 1000, now, serveStaleWhileRevalidate: true });
  const hotCardsCache = createBoundedSnapshotCache({ ttlMs: 3600000, maxStaleMs: 24 * 60 * 60 * 1000, now, serveStaleWhileRevalidate: true });
  const browseFacetFailures = new Map();
  const seriesBundleCache = new WeakMap();
  const priceHistoryCache = new Map();
  const archiveReader = createWebArchiveReader({ getEnv: () => currentEnv, fetchFn, now });
  const seoCache = new Map();
  const gradedCache = new Map();
  const gradedPending = new Map();
  let gradedQuota = { day: '', used: 0, syncedFromKv: false };
  const ebayCache = new Map();
  const ebayPending = new Map();
  let ebayToken = null;
  let ebayTokenPending = null;
  let ebayQuota = { day: '', used: 0, syncedFromKv: false };

  function publicReason(label, error) {
    console.error(label, error?.message || error);
    return UPSTREAM_ERROR;
  }

  function jsonRes(status, body, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders
      }
    });
  }

  function canonicalEdgeKeyRequest(scope, pathname, params = null) {
    const search = new URLSearchParams();
    if (params && typeof params === 'object') {
      for (const key of Object.keys(params).sort()) {
        const value = params[key];
        if (value === null || value === undefined || value === '') continue;
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    return new Request(`https://cardseek-cache.invalid/${cacheNamespace}/${scope}${pathname}${qs ? `?${qs}` : ''}`, { method: 'GET' });
  }

  function writeEdgeCache(ctx, cacheReq, response, cacheControlForEdge = null) {
    if (!resolvedEdgeCache || typeof resolvedEdgeCache.put !== 'function') return;
    let toStore = response.clone();
    if (cacheControlForEdge) {
      const headers = new Headers(toStore.headers);
      headers.set('Cache-Control', cacheControlForEdge);
      toStore = new Response(toStore.body, { status: toStore.status, statusText: toStore.statusText, headers });
    }
    const task = resolvedEdgeCache.put(cacheReq, toStore).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  }

  async function matchEdgeCache(cacheReq, clientCacheControl = null) {
    if (!resolvedEdgeCache || typeof resolvedEdgeCache.match !== 'function') return null;
    try {
      const hit = await resolvedEdgeCache.match(cacheReq);
      if (!hit) return null;
      if (!clientCacheControl) return hit;
      const headers = new Headers(hit.headers);
      headers.set('Cache-Control', clientCacheControl);
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    } catch {
      return null;
    }
  }

  function browseCacheBytes(data) {
    const known = getResponseByteSize(data);
    if (known !== null) return known;
    try {
      return JSON.stringify(data)?.length || 0;
    } catch {
      return 0;
    }
  }

  function trimBrowseCacheBytes() {
    let total = 0;
    for (const entry of browseCache.values()) total += entry.bytes || 0;
    for (const [entryKey, entry] of browseCache) {
      if (total <= BROWSE_CACHE_BYTES_MAX) break;
      if (entry.bytes) {
        browseCache.delete(entryKey);
        total -= entry.bytes;
      }
    }
  }

  async function cachedBrowseRows(key, loader, ttlMs = BROWSE_CACHE_MS) {
    const current = now();
    const cached = browseCache.get(key);
    if (cached?.data && cached.expiresAt > current) return cached.data;
    if (cached?.promise) return joinInFlight(cached.promise, () => { if (browseCache.get(key) === cached) browseCache.delete(key); }, () => cachedBrowseRows(key, loader, ttlMs));
    const promise = Promise.resolve().then(loader).then(data => {
      if (Array.isArray(data) && data.length > BROWSE_CACHE_ROWS_MAX) {
        browseCache.delete(key);
      } else {
        const bytes = browseCacheBytes(data);
        if (bytes > BROWSE_CACHE_BYTES_MAX / 2) browseCache.delete(key);
        else {
          browseCache.set(key, { data, expiresAt: now() + ttlMs, bytes });
          trimBrowseCacheBytes();
        }
      }
      return data;
    }).catch(error => {
      browseCache.delete(key);
      throw error;
    });
    browseCache.set(key, { promise, expiresAt: current + ttlMs });
    for (const [entryKey, entry] of browseCache) {
      if (entry.data && entry.expiresAt <= current) browseCache.delete(entryKey);
    }
    while (browseCache.size > BROWSE_CACHE_KEYS_MAX) browseCache.delete(browseCache.keys().next().value);
    return promise;
  }

  // ---- 匯率（純讀取，絕不在 Worker 寫入資料庫）----
  async function loadStoredTwdRates() {
    try {
      const rows = await db.fetchJson('/exchange_rates?select=currency,rate_to_twd,rate_date,source,fetched_at&order=fetched_at.desc&limit=30', { db: 'main' });
      if (!Array.isArray(rows) || !rows.length) return null;
      const latest = new Map();
      for (const row of rows) if (!latest.has(row.currency)) latest.set(row.currency, row);
      if (!['JPY', 'USD', 'EUR'].every(c => latest.has(c))) return null;
      const times = [...latest.values()].map(r => new Date(r.fetched_at).getTime()).filter(Number.isFinite).sort((a, b) => b - a);
      if (!times[0]) return null;
      const rates = { TWD: 1 };
      for (const [currency, row] of latest) {
        const rate = Number(row.rate_to_twd);
        if (Number.isFinite(rate) && rate > 0) rates[currency] = rate;
      }
      return {
        rates,
        updatedAt: latest.get('JPY')?.rate_date || null,
        fetchedAt: new Date(times[0]).toISOString(),
        source: `Supabase cache (${latest.get('JPY')?.source || 'unknown'})`
      };
    } catch {
      return null;
    }
  }

  async function getTwdRates() {
    const current = now();
    if (fxCache.data && fxCache.expiresAt > current) return { data: fxCache.data, cacheable: true };
    const stored = db.supabaseConfigured() ? await loadStoredTwdRates() : null;
    const storedAge = stored ? current - new Date(stored.fetchedAt).getTime() : Infinity;
    if (storedAge < FX_CACHE_MS) {
      fxCache.data = stored;
      fxCache.expiresAt = current + Math.max(60000, FX_CACHE_MS - storedAge);
      return { data: stored, cacheable: true };
    }
    const fallback = stored || {
      rates: { TWD: 1, JPY: jpyToTwdFallback, USD: usdToTwdFallback, EUR: 35 },
      updatedAt: null,
      fetchedAt: new Date(current).toISOString(),
      source: 'fallback'
    };
    try {
      const response = await fetchFn('https://open.er-api.com/v6/latest/TWD', { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`FX_${response.status}`);
      const body = await response.json();
      const rates = { TWD: 1 };
      if (body.result !== 'success') throw new Error('FX_RESULT');
      for (const currency of ['JPY', 'USD', 'EUR', 'KRW', 'HKD']) {
        const value = Number(body.rates?.[currency]);
        if (Number.isFinite(value) && value > 0) rates[currency] = 1 / value;
      }
      if (!['JPY', 'USD', 'EUR'].every(c => rates[c])) throw new Error('FX_INCOMPLETE');
      const jump = storedAge < FX_JUMP_WINDOW_MS && fxJump(stored.rates, rates);
      if (jump) throw new Error(`FX_JUMP_${jump}`);
      const data = {
        rates,
        updatedAt: body.time_last_update_utc ? new Date(body.time_last_update_utc).toISOString().slice(0, 10) : null,
        fetchedAt: new Date(now()).toISOString(),
        source: 'ExchangeRate-API'
      };
      fxCache.data = data;
      fxCache.expiresAt = now() + FX_CACHE_MS;
      return { data, cacheable: true };
    } catch (error) {
      console.error('fx fetch failed', error?.message || error);
      fxCache.data = fallback;
      fxCache.expiresAt = now() + 60 * 60 * 1000;
      return { data: fallback, cacheable: false };
    }
  }

  // ---- Storage / Health ----
  function loadStorageReport(targetDb = 'main') {
    if (!(targetDb === 'ip2' ? db.secondDbConfigured() : db.supabaseConfigured())) return Promise.resolve(null);
    const cache = storageCaches[targetDb];
    const current = now();
    if (cache.data && cache.expiresAt > current) return Promise.resolve(cache.data);
    if (cache.promise) { const shared = cache.promise; return joinInFlight(shared, () => { if (cache.promise === shared) cache.promise = null; }, () => loadStorageReport(targetDb)); }
    if (current < cache.retryAt) return Promise.resolve(cache.data);
    return cache.promise = db.fetchJson('/rpc/db_size_report', {
      db: targetDb,
      method: 'POST',
      body: '{}',
      timeoutMs: 15000
    }).then(report => {
      if (!Number.isFinite(Number(report?.databaseBytes))) throw new Error('bad db_size_report');
      cache.data = report;
      cache.expiresAt = now() + 60 * 60 * 1000;
      return report;
    }).catch(error => {
      console.warn('db size report failed', targetDb, error?.message);
      cache.retryAt = now() + 60 * 1000;
      return cache.data;
    }).finally(() => {
      cache.promise = null;
    });
  }

  async function loadCatalogHealth(ctx = null) {
    const cacheOpts = { waitUntil: p => ctx?.waitUntil?.(p) };
    if (!db.supabaseConfigured()) {
      const snapshot = await catalogHealthCache.get(async () => buildFallbackCatalogCoverage(getFallbackCatalogCopy(), {}, now()), cacheOpts);
      return { ...snapshot.data, cache: snapshot.cache, policy: sourcePolicySummary(), _fallback: false };
    }
    try {
      const cached = await catalogHealthCache.get(async () => {
        const policies = imageDisplayPolicies();
        try {
          return await db.fetchJson('/rpc/catalog_health_snapshot_v2', {
            db: 'main',
            method: 'POST',
            body: JSON.stringify({ p_display_policies: policies }),
            timeoutMs: 60000
          });
        } catch (v2Error) {
          console.error('catalog health v2 snapshot failed; falling back to legacy snapshot', v2Error?.message || v2Error);
          const legacy = await db.fetchJson('/rpc/catalog_health_snapshot', { db: 'main', method: 'POST', body: '{}' });
          return { ...legacy, metricStatus: { ...(legacy.metricStatus || {}), images: 'legacy-strict' }, healthCompatibilityWarning: 'v2 snapshot unavailable' };
        }
      }, cacheOpts);
      return { ...cached.data, policy: sourcePolicySummary(), cache: cached.cache, _fallback: false };
    } catch (error) {
      // Worker 不得在 RPC 雙雙失敗時退回全庫掃描（會超過 CPU／subrequest 上限），直接退回靜態備援摘要。
      const reason = publicReason('catalog health failed', error);
      const fallback = buildFallbackCatalogCoverage(getFallbackCatalogCopy(), {}, now());
      return { ...fallback, policy: sourcePolicySummary(), healthFallbackReason: reason, _fallback: true };
    }
  }

  // ---- Catalog & Products ----
  async function loadSecondDbCatalogRows() {
    if (!db.secondDbConfigured()) return { games: [], series: [] };
    try {
      return await withTimeout((async () => {
        const [games, series] = await Promise.all([
          db.fetchJson(CATALOG_GAMES_PATH, { db: 'ip2', timeoutMs: db.secondDbTimeoutMs }),
          db.fetchAll(CATALOG_SERIES_PATH, 1000, { db: 'ip2', maxPages: 15, timeoutMs: db.secondDbTimeoutMs })
        ]);
        return { games: games || [], series: series || [] };
      })(), db.secondDbTimeoutMs, 'SECOND_DB_TIMEOUT');
    } catch (error) {
      console.error('second database catalog failed; main catalog only', error?.message || error);
      return { games: [], series: [] };
    }
  }

  async function loadCatalogUncached() {
    const fallback = getFallbackCatalogCopy();
    if (!db.supabaseConfigured()) return canonicalizeCatalog({ ...fallback, source: 'catalog.json' });
    try {
      const [games, series, cards, second] = await Promise.all([
        db.fetchJson(CATALOG_GAMES_PATH, { db: 'main' }),
        db.fetchAll(CATALOG_SERIES_PATH, 1000, { db: 'main', maxPages: 15 }),
        db.fetchJson('/tcg_cards?select=id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases&order=created_at.asc&limit=250', { db: 'main' }),
        loadSecondDbCatalogRows()
      ]);
      const cardIds = (cards || []).map(c => `"${String(c.id).replaceAll('"', '')}"`).join(',');
      const [printings, images] = cardIds
        ? await Promise.all([
            db.fetchAll(`/tcg_printings?${new URLSearchParams({ select: BROWSE_PRINTING_SELECT, card_id: `in.(${cardIds})` })}`, 1000, { db: 'main', maxPages: 10 }),
            db.fetchJson(`/card_images?${new URLSearchParams({ select: BROWSE_IMAGE_SELECT, card_id: `in.(${cardIds})`, order: 'is_primary.desc,fetched_at.desc', limit: '1000' })}`, { db: 'main' }).catch(() => [])
          ])
        : [[], []];
      const printingByCard = new Map();
      const imageByCard = new Map();
      for (const p of printings || []) {
        const list = printingByCard.get(p.cardId) || [];
        list.push(p);
        printingByCard.set(p.cardId, list);
      }
      for (const i of images || []) {
        const list = imageByCard.get(i.cardId) || [];
        list.push(i);
        imageByCard.set(i.cardId, list);
      }
      const databaseCards = (cards || []).map(c => {
        const ps = printingByCard.get(c.id) || [];
        const imgs = imageByCard.get(c.id) || [];
        const primary = imgs.find(browseHasUsableImage) || ps.find(browseHasUsableImage);
        return {
          ...c,
          region: ps[0]?.region || null,
          language: ps[0]?.language || null,
          imageUrl: primary?.imageUrl || null,
          imageSource: primary?.source || null,
          imageRightsStatus: primary?.imageRightsStatus || null,
          printings: ps,
          images: imgs
        };
      });
      const merged = {
        version: 3,
        updatedAt: new Date(now()).toISOString(),
        source: 'supabase+catalog.json',
        games: mergeCatalogRows(fallback.games, [...(games || []), ...second.games]),
        series: mergeCatalogRows(fallback.series, [...(series || []), ...second.series], { keepFallbackOnly: false }),
        cards: mergeCatalogRows(fallback.cards, databaseCards, { keepFallbackOnly: false })
      };
      return canonicalizeCatalog(merged);
    } catch (error) {
      return canonicalizeCatalog({ ...fallback, source: 'catalog.json', fallbackReason: publicReason('catalog load failed; using catalog.json', error) });
    }
  }

  function loadCatalogShared(ctx = null) {
    const refresh = () => {
      if (!catalogCache.pending) {
        catalogCache.pending = loadCatalogUncached().then(value => {
          if (!value.fallbackReason) catalogCache = { value, at: now(), pending: null };
          else catalogCache.pending = null;
          return value;
        }, error => {
          catalogCache.pending = null;
          throw error;
        });
        return catalogCache.pending;
      }
      const shared = catalogCache.pending;
      return joinInFlight(shared, () => { if (catalogCache.pending === shared) catalogCache.pending = null; }, refresh);
    };
    if (catalogCache.value) {
      if (now() - catalogCache.at >= CATALOG_CACHE_TTL_MS) {
        const task = refresh().catch(() => {});
        ctx?.waitUntil?.(task);
      }
      return Promise.resolve(catalogCache.value);
    }
    return refresh();
  }

  async function loadStoredProducts() {
    if (!db.supabaseConfigured()) return [];
    const rows = await db.fetchAll(
      '/tcg_products?select=id,game:game_id,seriesId:series_id,officialCode:official_code,productType:product_type,nameZh:name_zh,nameJa:name_ja,name:name_en,nameKo:name_ko,region,language,releaseDate:release_date,imageUrl:image_url,imageKind:image_kind,source,sourceUrl:source_url,metadata&order=release_date.desc.nullslast',
      1000,
      { db: 'main', maxPages: 20 }
    );
    return rows.map(row => ({
      ...row,
      versionLabel: regionLabel(row.region, row.language, row.game),
      cardsCount: row.metadata?.cardsCount ?? row.metadata?.total ?? null
    }));
  }

  async function loadProductSetsUncached() {
    let storedFailed = false;
    const stored = await loadStoredProducts().catch(() => { storedFailed = true; return []; });
    const curated = buildCuratedProducts(getFallbackCatalogCopy());
    const twSeriesNames = new Map();
    if (db.supabaseConfigured()) {
      try {
        const rows = await db.fetchAll('/tcg_series?select=game:game_id,code:official_code,nameZh:name_zh,source&region=eq.TW&name_zh=not.is.null', 1000, { db: 'main', maxPages: 20 });
        for (const row of rows) {
          const key = `${row.game}:${String(row.code || '').toUpperCase()}`;
          if (!twSeriesNames.has(key) || row.source === 'asia-pokemon-card-official-tw') twSeriesNames.set(key, row.nameZh);
        }
      } catch (error) {
        console.error('tw series names for products failed', error?.message || error);
      }
    }
    const { products, series } = buildProductSetsFromSources({ stored, curated, twSeriesNames, seriesTranslations: SERIES_ZH_ENTRIES });
    return storedFailed ? { products, series, partial: true } : { products, series };
  }

  async function loadProductSets(ctx = null) {
    const refresh = () => {
      if (!productCache.pending) {
        productCache.pending = loadProductSetsUncached().then(value => {
          if (!value.partial) productCache = { value, at: now(), pending: null };
          else productCache.pending = null;
          return value;
        }, error => {
          productCache.pending = null;
          throw error;
        });
        return productCache.pending;
      }
      const shared = productCache.pending;
      return joinInFlight(shared, () => { if (productCache.pending === shared) productCache.pending = null; }, refresh);
    };
    if (productCache.value) {
      if (now() - productCache.at >= PRODUCT_CACHE_TTL_MS) {
        const task = refresh().catch(() => {});
        ctx?.waitUntil?.(task);
      }
      return productCache.value;
    }
    return refresh();
  }

  // ---- Reference Prices ----
  async function referenceRpc(key, name, args) {
    let timer;
    return Promise.race([
      cachedBrowseRows(key, () => db.fetchJson(`/rpc/${name}`, { db: 'main', method: 'POST', body: JSON.stringify(args) }), 10 * 60 * 1000),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('REFERENCE_PRICE_TIMEOUT')), 1500); })
    ]).finally(() => clearTimeout(timer));
  }

  async function loadReferencePrices(ids, { prior = false } = {}) {
    const unique = [...new Set((ids || []).filter(id => typeof id === 'string' && id))].sort();
    const prices = new Map();
    if (!unique.length || !db.supabaseConfigured()) return prices;
    const hash = await sha1Hex(unique.join('|'));
    try {
      const [rows, priorRows] = await Promise.all([
        referenceRpc(`refprice:${hash}`, 'price_reference_best', { p_ids: unique }),
        prior
          ? referenceRpc(`refprior:${hash}`, 'price_reference_prior', { p_ids: unique, p_days: 7 }).catch(error => {
              console.error('reference prior lookup failed; no change shown', error?.message || error);
              return [];
            })
          : []
      ]);
      const priorByKey = new Map((Array.isArray(priorRows) ? priorRows : []).map(row => [`${row.card_id}|${row.provider}|${row.variant || ''}`, row]));
      for (const row of Array.isArray(rows) ? rows : []) {
        const price = referencePriceFromRow(row);
        if (price) prices.set(row.card_id, { ...price, ...referenceChange(price, priorByKey.get(`${row.card_id}|${price.source}|${price.variant || ''}`)) });
      }
    } catch (error) {
      prices.failed = true;
      console.error('reference price lookup failed; cards go out without it', error?.message || error);
    }
    return prices;
  }

  async function attachReferencePrices(cards) {
    const prices = await loadReferencePrices((cards || []).map(card => card.id), { prior: true });
    let rates = {};
    if (prices.size) {
      try {
        rates = (await getTwdRates()).data.rates || {};
      } catch (error) {
        console.error('reference price fx failed', error?.message || error);
      }
    }
    for (const card of cards || []) {
      const price = prices.get(card.id);
      const rate = Number(rates[price?.currency]);
      if (price) card.referencePrice = rate > 0 ? { ...price, amountTwd: Math.round(price.amount * rate) } : price;
    }
    return Object.assign(cards, { referenceFailed: !!prices.failed });
  }

  async function seriesPriceMap(cards, sort) {
    if (!BROWSE_PRICE_SORTS.has(sort)) return null;
    const prices = await loadReferencePrices(cards.map(card => card.id));
    let usdToEur = null;
    if ([...prices.values()].some(price => price.currency === 'USD')) {
      try {
        const r = (await getTwdRates()).data.rates || {};
        usdToEur = Number(r.USD) / Number(r.EUR) || null;
      } catch (error) {
        console.error('series price fx failed', error?.message || error);
      }
    }
    return new Map([...prices].flatMap(([id, price]) => price.currency === 'EUR' ? [[id, price.amount]] : usdToEur ? [[id, Math.round(price.amount * usdToEur * 100) / 100]] : []));
  }

  async function seriesReferencePricedCount(game, cards) {
    if (game !== 'pokemon' || !cards?.length) return null;
    const prices = await loadReferencePrices(cards.map(card => card.id));
    return prices.failed ? null : prices.size;
  }

  // ---- Browse (/api/cards) ----
  async function loadDatabasePageRelations(table, select, cardIds, targetDb, { legacySelect = null } = {}) {
    if (!cardIds.length) return [];
    try {
      return await db.fetchAll(databaseRelationQuery(table, select, cardIds), 1000, { db: targetDb, maxPages: 10 });
    } catch (error) {
      if (!legacySelect) throw error;
      const rows = await db.fetchAll(databaseRelationQuery(table, legacySelect, cardIds), 1000, { db: targetDb, maxPages: 10 });
      return table === 'card_images' ? rows.map(row => ({ ...row, imageRightsStatus: 'not-provided' })) : rows;
    }
  }

  async function loadDatabaseRelationsForCards(table, select, cardIds, targetDb, { legacySelect = null } = {}) {
    const supabaseUrl = targetDb === 'ip2' ? (env?.SUPABASE2_URL || '') : (env?.SUPABASE_URL || '');
    const batches = chunkDatabaseRelationCardIds(table, select, cardIds, legacySelect, {
      batchSize: RELATION_BATCH_SIZE,
      supabaseUrl,
      maxBytes: RELATION_QUERY_MAX_BYTES
    });
    if (!batches.length) return [];
    const rows = [];
    for (let index = 0; index < batches.length; index += RELATION_QUERY_CONCURRENCY) {
      const pageRows = await Promise.all(batches.slice(index, index + RELATION_QUERY_CONCURRENCY).map(batch => loadDatabasePageRelations(table, select, batch, targetDb, { legacySelect })));
      rows.push(...pageRows.flat());
    }
    return rows;
  }

  async function loadDatabaseImages(cardIds = [], targetDb = 'main') {
    if (!Array.isArray(cardIds) || !cardIds.length) return [];
    const hash = await sha1Hex(cardIds.join('|'));
    const key = `images:${targetDb}:${hash}`;
    return cachedBrowseRows(key, async () => {
      const legacy = 'id,cardId:card_id,language,source,imageUrl:image_url,sourceUrl:source_url,isPrimary:is_primary,fetchedAt:fetched_at';
      return loadDatabaseRelationsForCards('card_images', BROWSE_IMAGE_SELECT, cardIds, targetDb, { legacySelect: legacy });
    });
  }

  function databaseFastBrowseEligible({ rarity = null, seriesId = null, sort = 'number-asc' } = {}) {
    return !rarity && !seriesId && (sort === 'number-asc' || sort === 'number-desc');
  }

  async function loadBrowseRarityMap(game, targetDb, { refresh = false } = {}) {
    const key = `rarity-values:${targetDb}:${game}`;
    if (refresh) browseCache.delete(key);
    const values = await cachedBrowseRows(
      key,
      () => db.fetchJson('/rpc/browse_rarity_values', { db: targetDb, method: 'POST', body: JSON.stringify({ p_game: game }), timeoutMs: BROWSE_HEAVY_TIMEOUT_MS }),
      60 * 60 * 1000
    );
    return (Array.isArray(values) ? values : []).map(raw => {
      const code = rarityCanonicalCode(game, raw);
      const rank = code ? browseRarityRank(game, code) : Number.MAX_SAFE_INTEGER;
      return { raw, code, token: code ? rarityCanonicalToken(game, code) : null, rank: rank === Number.MAX_SAFE_INTEGER ? null : rank };
    });
  }

  async function browseDatabaseCardsFiltered(game, options = {}, targetDb = 'main') {
    const safeGame = String(game).replace(/[^a-z0-9-]/gi, '');
    const take = Math.min(Math.max(Number(options.limit) || 60, 1), BROWSE_PAGE_MAX);
    const skip = Math.max(Number(options.offset) || 0, 0);
    const sort = normalizeBrowseSort(options.sort, safeGame);
    const region = normalizeBrowseRegion(options.region);
    const priceSort = BROWSE_PRICE_SORTS.has(sort);
    const token = options.rarity ? rarityCanonicalToken(safeGame, options.rarity) : '';
    const rpcCall = (name, body) => db.fetchJson(`/rpc/${name}`, { db: targetDb, method: 'POST', body: JSON.stringify(body), timeoutMs: BROWSE_HEAVY_TIMEOUT_MS });

    for (let attempt = 0; ; attempt++) {
      const rmap = await loadBrowseRarityMap(safeGame, targetDb, { refresh: attempt > 0 });
      const pageKey = `rpc:browse_cards_filtered:${targetDb}:${safeGame}|${region || ''}|${token}|${sort}|${take}|${skip}`;
      const facetKey = `rpc:browse_cards_facets:${targetDb}:${safeGame}|${region || ''}`;
      let page;
      try {
        page = await cachedBrowseRows(pageKey, () =>
          priceSort
            ? rpcCall('browse_cards_priced', { p_game: safeGame, p_region: region || null, p_token: token || null, p_desc: sort === 'price-desc', p_limit: take, p_offset: skip, p_rmap: rmap })
            : rpcCall('browse_cards_filtered', { p_game: safeGame, p_region: region || null, p_token: token || null, p_sort: sort, p_limit: take, p_offset: skip, p_rmap: rmap })
        );
      } catch (error) {
        if (!priceSort) throw error;
        console.error('price-sorted browse failed; using number order', error?.message || error);
        return browseDatabaseCardsFiltered(game, { ...options, sort: 'number-asc' }, targetDb);
      }
      let facets = null;
      if (now() - (browseFacetFailures.get(facetKey) || 0) >= 60000) {
        try {
          facets = await cachedBrowseRows(
            facetKey,
            () => rpcCall('browse_cards_facets', { p_game: safeGame, p_region: region || null, p_rmap: rmap }),
            30 * 60 * 1000
          );
          if (!facets || typeof facets.rarity !== 'object') facets = null;
        } catch (error) {
          browseFacetFailures.set(facetKey, now());
          console.error('browse facets failed; page sent without them', error?.message || error);
        }
      }
      if (!page || !Array.isArray(page.cards) || !Number.isFinite(Number(page.total))) throw new Error('BROWSE_FILTERED_BAD_RESPONSE');
      if ((page.unmapped || facets?.unmapped) && attempt === 0) {
        browseCache.delete(pageKey);
        browseCache.delete(facetKey);
        continue;
      }
      const cards = page.cards.slice(0, take);
      const printingByCard = buildPrintingIndex(cards.flatMap(card => card.printings || []));
      const imageByCard = new Map(cards.map(card => [card.id, card.images || []]));
      const data = cards.map(({ printings, images, ...card }) => hydrateBrowseCard(card, printingByCard, imageByCard));
      const total = Number(page.total);
      const rarityLabels = {};
      if (facets) for (const value of Object.keys(facets.rarity)) if (value !== 'unknown') rarityLabels[value] = rarityDisplayLabel(safeGame, value);
      return {
        data,
        total,
        hasMore: skip + data.length < total,
        facets: facets ? { rarity: { ...facets.rarity }, region: { ...facets.region }, language: { ...facets.language }, rarityLabels } : null,
        facetStatus: facets ? 'complete' : 'deferred',
        limit: take,
        offset: skip,
        errors: { printings: null, images: null }
      };
    }
  }

  async function browseDatabasePageFast(game, options = {}, targetDb = 'main') {
    const safeGame = String(game).replace(/[^a-z0-9-]/gi, '');
    const take = Math.min(Math.max(Number(options.limit) || 60, 1), BROWSE_PAGE_MAX);
    const skip = Math.max(Number(options.offset) || 0, 0);
    const direction = options.sort === 'number-desc' ? 'desc' : 'asc';
    const region = normalizeBrowseRegion(options.region);
    let rpc = null;
    try {
      rpc = await cachedBrowseRows(`rpc:browse_cards_page:${targetDb}:${safeGame}|${take}|${skip}|${direction}|${region || ''}`, () =>
        db.fetchJson('/rpc/browse_cards_page', {
          db: targetDb,
          method: 'POST',
          body: JSON.stringify({ p_game: safeGame, p_limit: take, p_offset: skip, p_desc: direction === 'desc', ...(region ? { p_region: region } : {}) })
        })
      );
    } catch (error) {
      console.error('browse rpc failed; using PostgREST queries', error?.message || error);
    }
    if (rpc && Array.isArray(rpc.cards) && Number.isFinite(Number(rpc.total))) {
      const cards = rpc.cards.slice(0, take);
      const printingByCard = buildPrintingIndex(cards.flatMap(card => card.printings || []));
      const imageByCard = new Map(cards.map(card => [card.id, card.images || []]));
      const data = cards.map(({ printings, images, ...card }) => hydrateBrowseCard(card, printingByCard, imageByCard));
      const total = Number(rpc.total);
      return { data, total, hasMore: skip + data.length < total, facets: null, facetStatus: 'deferred', limit: take, offset: skip, errors: { printings: null, images: null } };
    }
    if (region) return browseDatabaseCardsFiltered(game, { ...options, rarity: null }, targetDb);
    const params = new URLSearchParams({ select: BROWSE_CARD_SELECT, game_id: `eq.${safeGame}`, order: `official_card_number.${direction},id.${direction}`, limit: String(take + 1), offset: String(skip) });
    const page = await db.fetchPage(`/tcg_cards?${params}`, { db: targetDb });
    const cards = (page.data || []).slice(0, take);
    const cardIds = cards.map(card => card.id);
    const fallbackPrintingSelect = 'id,cardId:card_id,seriesId:series_id,region,language,localSetCode:local_set_code,localCardNumber:local_card_number,rarity,imageUrl:image_url,sourceUrl:source_url,releaseDate:release_date,imageRehostRequired:image_rehost_required';
    const legacyImageSelect = 'id,cardId:card_id,language,source,imageUrl:image_url,sourceUrl:source_url,isPrimary:is_primary,fetchedAt:fetched_at';
    const [printingResult, imageResult] = await Promise.all([
      loadDatabasePageRelations('tcg_printings', BROWSE_PRINTING_SELECT, cardIds, targetDb, { legacySelect: fallbackPrintingSelect }).then(rows => ({ rows, status: 'complete' })).catch(error => ({ rows: [], status: 'partial', error })),
      loadDatabasePageRelations('card_images', BROWSE_IMAGE_SELECT, cardIds, targetDb, { legacySelect: legacyImageSelect }).then(rows => ({ rows, status: 'complete' })).catch(error => ({ rows: [], status: 'unknown', error }))
    ]);
    const printingByCard = buildPrintingIndex(printingResult.rows);
    const imageByCard = new Map();
    for (const image of imageResult.rows) {
      const list = imageByCard.get(image.cardId) || [];
      list.push(image);
      imageByCard.set(image.cardId, list);
    }
    const data = cards.map(card => hydrateBrowseCard(card, printingByCard, imageByCard));
    const total = page.total ?? skip + data.length + (page.data?.length > take ? 1 : 0);
    return {
      data,
      total,
      hasMore: skip + data.length < total,
      facets: null,
      facetStatus: 'deferred',
      limit: take,
      offset: skip,
      errors: { printings: printingResult.error ? publicReason('browse printings failed', printingResult.error) : null, images: imageResult.status === 'complete' ? null : '圖片資料暫時無法讀取' }
    };
  }

  function prepareSeriesBundle(rawRpc) {
    const printingByCard = buildPrintingIndex(rawRpc.printings);
    const imageByCard = new Map();
    for (const image of rawRpc.images) {
      const list = imageByCard.get(image.cardId) || [];
      list.push(image);
      imageByCard.set(image.cardId, list);
    }
    const siblingUrls = new Map();
    for (const image of Array.isArray(rawRpc.siblingImages) ? rawRpc.siblingImages : []) {
      if (!browseHasUsableImage(image)) continue;
      const list = siblingUrls.get(image.groupId) || [];
      if (!list.includes(image.imageUrl)) list.push(image.imageUrl);
      siblingUrls.set(image.groupId, list);
    }
    return {
      cards: rawRpc.cards,
      printingByCard,
      imageByCard,
      siblingUrls,
      facetsByRegion: new Map(),
      sortedByKey: new Map()
    };
  }

  async function browseDatabaseSeriesCards(game, options = {}, targetDb = 'main') {
    const safeGame = String(game).replace(/[^a-z0-9-]/gi, '');
    const safeSeries = String(options.seriesId || '').replace(/[^a-z0-9:_-]/gi, '');
    if (!safeSeries) return browseDatabasePageFast(game, options, targetDb);
    const timings = {};
    const mark = (name, started) => { timings[name] = Math.round(performance.now() - started); };
    let bundle = null;
    let started = performance.now();
    try {
      const cached = await cachedBrowseRows(`rpc:browse_series_cards:${targetDb}:${safeGame}|${safeSeries}`, () =>
        db.fetchJson('/rpc/browse_series_cards', { db: targetDb, method: 'POST', body: JSON.stringify({ p_game: safeGame, p_series: safeSeries }) })
      );
      mark('rpc', started);
      if (cached && Array.isArray(cached.printings) && Array.isArray(cached.cards) && Array.isArray(cached.images)) {
        if (!cached.cards.length) {
          return { data: [], total: 0, hasMore: false, facets: { rarity: {}, region: {}, language: {}, rarityLabels: {} }, facetStatus: 'complete', limit: options.limit, offset: options.offset, errors: { printings: null, images: null }, timings };
        }
        started = performance.now();
        bundle = seriesBundleCache.get(cached);
        if (!bundle) {
          bundle = prepareSeriesBundle(cached);
          seriesBundleCache.set(cached, bundle);
        }
        mark('prep', started);
      }
    } catch (error) {
      console.error('series browse rpc failed; using PostgREST queries', error?.message || error);
    }
    if (bundle) {
      const [priceByCard, referencePriced] = await Promise.all([
        seriesPriceMap(bundle.cards, options.sort),
        seriesReferencePricedCount(safeGame, bundle.cards)
      ]);
      started = performance.now();
      let precomputedFacets = null;
      let precomputedSorted = null;
      if (options.seriesId === safeSeries) {
        const regionToken = normalizeBrowseRegion(options.region);
        const regionKey = regionToken || '';
        precomputedFacets = bundle.facetsByRegion.get(regionKey);
        if (!precomputedFacets) {
          const matching = filterBrowseCards(bundle.cards, {
            region: regionToken,
            seriesId: safeSeries,
            printingByCard: bundle.printingByCard
          });
          precomputedFacets = buildBrowseFacets(matching, bundle.printingByCard);
          bundle.facetsByRegion.set(regionKey, precomputedFacets);
        }
        const sort = normalizeBrowseSort(options.sort, safeGame);
        if (!BROWSE_PRICE_SORTS.has(sort)) {
          const rarity = normalizeBrowseRarity(options.rarity);
          const rarityKey = rarity ? rarityCanonicalToken(safeGame, rarity) : '';
          const sortKey = `${regionKey}|${rarityKey}|${sort}`;
          precomputedSorted = bundle.sortedByKey.get(sortKey);
          if (precomputedSorted) {
            bundle.sortedByKey.delete(sortKey);
            bundle.sortedByKey.set(sortKey, precomputedSorted);
          } else {
            precomputedSorted = prepareBrowseSeriesSorted(bundle.cards, {
              region: regionToken,
              rarity,
              seriesId: safeSeries,
              sort,
              printingByCard: bundle.printingByCard
            });
            bundle.sortedByKey.set(sortKey, precomputedSorted);
            while (bundle.sortedByKey.size > 16) bundle.sortedByKey.delete(bundle.sortedByKey.keys().next().value);
          }
        }
      }
      const page = buildBrowsePage(bundle.cards, {
        ...options,
        printingByCard: bundle.printingByCard,
        imageByCard: bundle.imageByCard,
        facetStatus: 'complete',
        priceByCard,
        precomputedFacets,
        precomputedSorted,
        siblingUrls: bundle.siblingUrls
      });
      mark('page', started);
      return { ...page, referencePriced, errors: { printings: null, images: null }, timings };
    }

    const printingParams = new URLSearchParams({ select: BROWSE_PRINTING_SELECT, series_id: `eq.${safeSeries}`, order: 'local_card_number.asc,id.asc' });
    const printings = await db.fetchAll(`/tcg_printings?${printingParams}`, 1000, { db: targetDb, maxPages: 6 });
    const cardIds = [...new Set((printings || []).map(printing => printing.cardId).filter(Boolean))];
    if (!cardIds.length) return { data: [], total: 0, hasMore: false, facets: { rarity: {}, region: {}, language: {}, rarityLabels: {} }, facetStatus: 'complete', limit: options.limit, offset: options.offset, errors: { printings: null, images: null } };
    if (cardIds.length > WORKER_SERIES_FALLBACK_MAX) throw Object.assign(new Error('這個系列太大，無法在備援模式下載入'), { code: 'BROWSE_REFUSED' });
    const cardBatches = chunkCardIds(cardIds, RELATION_BATCH_SIZE);
    const cards = [];
    for (let index = 0; index < cardBatches.length; index += RELATION_QUERY_CONCURRENCY) {
      const chunkResults = await Promise.all(cardBatches.slice(index, index + RELATION_QUERY_CONCURRENCY).map(batch => {
        const ids = batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',');
        const params = new URLSearchParams({ select: BROWSE_CARD_SELECT, game_id: `eq.${safeGame}`, id: `in.(${ids})`, order: 'official_card_number.asc,id.asc' });
        return db.fetchAll(`/tcg_cards?${params}`, 1000, { db: targetDb, maxPages: 4 });
      }));
      cards.push(...chunkResults.flat());
    }
    const imageResult = await loadDatabaseImages(cardIds, targetDb).then(rows => ({ rows, status: 'complete' })).catch(error => ({ rows: [], status: 'unknown', error }));
    const printingByCard = buildPrintingIndex(printings);
    const imageByCard = new Map();
    for (const image of imageResult.rows) {
      const list = imageByCard.get(image.cardId) || [];
      list.push(image);
      imageByCard.set(image.cardId, list);
    }
    const result = buildBrowsePage(cards, { ...options, printingByCard, imageByCard, facetStatus: 'complete', priceByCard: await seriesPriceMap(cards, options.sort) });
    return { ...result, errors: { printings: null, images: imageResult.status === 'complete' ? null : '圖片資料暫時無法讀取' } };
  }

  async function browseDatabaseCards(game, options) {
    const targetDb = dbForGame(game);
    if (options.seriesId) return browseDatabaseSeriesCards(game, options, targetDb);
    if (databaseFastBrowseEligible(options)) return browseDatabasePageFast(game, options, targetDb);
    return browseDatabaseCardsFiltered(game, options, targetDb);
  }

  // ---- Search (/api/search) ----
  function getSeriesSearchIndex(catalog) {
    const list = catalog?.series;
    if (!Array.isArray(list)) return buildSeriesIndex([]);
    let idx = seriesIndexCache.get(list);
    if (!idx) {
      idx = buildSeriesIndex(list);
      seriesIndexCache.set(list, idx);
    }
    return idx;
  }

  function getSeriesById(catalog) {
    const list = catalog?.series;
    if (!Array.isArray(list)) return new Map();
    let map = seriesByIdCache.get(list);
    if (!map) {
      map = new Map(list.map(s => [s.id, s]));
      seriesByIdCache.set(list, map);
    }
    return map;
  }

  function getLocalCardSearchEntries(catalog) {
    const cards = catalog?.cards;
    if (!Array.isArray(cards)) return [];
    const seriesList = catalog?.series;
    const cached = localCardSearchCache.get(cards);
    if (cached && cached.seriesList === seriesList) return cached.entries;

    const seriesById = getSeriesById(catalog);
    const seriesTermsCache = new Map();
    const normSeriesTerms = seriesId => {
      if (!seriesId) return [];
      let terms = seriesTermsCache.get(seriesId);
      if (terms) return terms;
      const s = seriesById.get(seriesId);
      terms = s
        ? [s.officialCode, s.nameZh, s.nameJa, s.nameEn, s.nameKo, ...(s.aliases || [])]
            .map(normalizeSearch)
            .filter(Boolean)
        : [];
      seriesTermsCache.set(seriesId, terms);
      return terms;
    };

    const entries = cards.map(c => {
      const printings = Array.isArray(c.printings) ? c.printings : [];
      const normNames = [
        c.nameZh,
        c.nameJa,
        c.nameEn,
        c.nameKo,
        ...(c.aliases || []),
        ...printings.flatMap(p => [p.nameZh, p.nameJa, p.nameEn, p.nameKo])
      ].map(normalizeSearch).filter(Boolean);
      const normOfficialNum = normalizeSearch(c.officialCardNumber);
      const normPrintings = printings.map(p => ({
        seriesId: p.seriesId,
        region: p.region,
        normSetCode: normalizeSearch(p.localSetCode),
        normCardNumber: normalizeSearch(p.localCardNumber)
      }));
      const regionSet = new Set();
      if (c.region) regionSet.add(c.region);
      for (const p of printings) if (p.region) regionSet.add(p.region);

      const allSet = new Set(normNames);
      if (normOfficialNum) allSet.add(normOfficialNum);
      for (const p of normPrintings) {
        if (p.normSetCode) allSet.add(p.normSetCode);
        if (p.normCardNumber) allSet.add(p.normCardNumber);
      }
      for (const t of normSeriesTerms(c.seriesId)) allSet.add(t);
      for (const p of printings) for (const t of normSeriesTerms(p.seriesId)) allSet.add(t);

      return {
        card: c,
        regionSet,
        normNames,
        normOfficialNum,
        normPrintings,
        allValues: [...allSet]
      };
    });

    localCardSearchCache.set(cards, { seriesList, entries });
    return entries;
  }

  function recallSearch(key) {
    const hit = searchCache.get(key);
    if (!hit) return null;
    searchCache.delete(key);
    if (now() - hit.at >= SEARCH_CACHE_TTL_MS) return null;
    searchCache.set(key, hit);
    return hit.body;
  }

  function rememberSearch(key, body) {
    searchCache.delete(key);
    searchCache.set(key, { at: now(), body });
    while (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
  }

  async function foldedNameSpans(name, budget = null) {
    const folded = foldSearch(name);
    if (folded.length < 3 || budget?.exhausted()) return [];
    try {
      const ask = targetDb => {
        if (budget && !budget.consume()) return Promise.resolve([]);
        return db.fetchJson('/rpc/search_fold_names', {
          db: targetDb,
          method: 'POST',
          body: JSON.stringify({ p_fold: folded, p_limit: 5 }),
          ...(targetDb === 'ip2' ? { timeoutMs: db.secondDbTimeoutMs } : {})
        });
      };
      const [rows, secondRows] = await Promise.all([
        ask('main'),
        db.secondDbConfigured() && !budget?.exhausted()
          ? withTimeout(ask('ip2'), db.secondDbTimeoutMs, 'SECOND_DB_TIMEOUT').catch(() => [])
          : []
      ]);
      return [...new Set([...(Array.isArray(rows) ? rows : []), ...(Array.isArray(secondRows) ? secondRows : [])]
        .map(row => foldedSpan(row?.name, folded))
        .filter(span => span && span.toLowerCase() !== String(name).trim().toLowerCase()))].slice(0, 3);
    } catch (error) {
      console.error('search fold retry failed', error?.message || error);
      return [];
    }
  }

  async function suggestCardName(name, region, budget = null) {
    const query = String(name || '').trim();
    if (query.length < 3 || budget?.exhausted()) return null;
    try {
      const ask = targetDb => {
        if (budget && !budget.consume()) return Promise.resolve(null);
        return db.fetchJson('/rpc/search_name_suggestion', {
          db: targetDb,
          method: 'POST',
          body: JSON.stringify({ p_q: query, p_region: region === 'ALL' ? null : region }),
          ...(targetDb === 'ip2' ? { timeoutMs: db.secondDbTimeoutMs } : {})
        });
      };
      let value = await ask('main');
      if (typeof value !== 'string' && db.secondDbConfigured() && !budget?.exhausted()) {
        value = await withTimeout(ask('ip2'), db.secondDbTimeoutMs, 'SECOND_DB_TIMEOUT').catch(() => null);
      }
      const text = typeof value === 'string' ? value.trim() : '';
      return text && text.toLowerCase() !== query.toLowerCase() ? { q: text, reason: '相近的卡名' } : null;
    } catch (error) {
      console.error('search name suggestion failed', error?.message || error);
      return null;
    }
  }

  async function searchCatalogDatabaseIn(rawQuery, region = 'ALL', limit = SEARCH_RESULT_LIMIT, { offset = 0, rarities = [], seriesIds = [], budget = null } = {}, targetDb = 'main') {
    const scopedSeries = [...new Set((seriesIds || []).map(id => String(id || '').trim()).filter(Boolean))].slice(0, SEARCH_SERIES_IDS_MAX);
    const hasSeriesScope = scopedSeries.length > 0;
    const seriesIdSet = hasSeriesScope ? new Set(scopedSeries) : null;
    const rarityValues = rarityMatchValues(rarities);
    const filtered = region !== 'ALL' || rarityValues.length > 0 || hasSeriesScope;
    if (!db.supabaseConfigured()) return { cards: [], candidateCount: 0, candidateLimit: SEARCH_CANDIDATE_LIMIT, resultLimit: limit, mayHaveMore: false, searched: false };
    const terms = searchQueryTerms(rawQuery).slice(0, SEARCH_PATTERNS_MAX);
    if (!terms.length) return { cards: [], candidateCount: 0, candidateLimit: SEARCH_CANDIDATE_LIMIT, resultLimit: limit, mayHaveMore: false, searched: false };

    const dbTimeoutOpt = targetDb === 'ip2' ? { timeoutMs: db.secondDbTimeoutMs } : {};
    const dbFetch = (pathAndQuery, opts = {}) => {
      if (budget && !budget.consume()) {
        return Promise.reject(Object.assign(new Error('SEARCH_SUBREQUEST_BUDGET'), { code: 'SEARCH_BUDGET_EXCEEDED' }));
      }
      return db.fetchJson(pathAndQuery, { db: targetDb, ...dbTimeoutOpt, ...opts });
    };

    const plainSelect = 'id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases,metadata,searchText:search_text';
    let select = `${plainSelect},printings:tcg_printings!tcg_printings_card_id_fkey(${BROWSE_PRINTING_SELECT})`;
    const cardsFetch = async params => {
      try {
        return await dbFetch(`/tcg_cards?${new URLSearchParams({ select, ...params })}`);
      } catch (error) {
        if (select === plainSelect || searchTimedOut(error) || error?.code === 'SEARCH_BUDGET_EXCEEDED') throw error;
        console.error('search printing embed failed; retrying without it', error?.message || error);
        select = plainSelect;
        return dbFetch(`/tcg_cards?${new URLSearchParams({ select, ...params })}`);
      }
    };
    const timings = {};
    const timed = async (name, work) => {
      const started = performance.now();
      try { return await work; } finally { timings[name] = Math.round((timings[name] || 0) + performance.now() - started); }
    };
    const query = columns => {
      const filters = [];
      for (const term of terms) for (const column of columns) filters.push(`${column}.ilike.*${term}*`);
      return cardsFetch({ or: `(${filters.join(',')})`, limit: String(SEARCH_CANDIDATE_LIMIT) });
    };
    const patterns = terms.map(term => `%${term}%`);
    const rankedCall = body => timed('rpc', dbFetch('/rpc/search_cards_ranked', { method: 'POST', body: JSON.stringify(body) }));
    const rankedShape = value => Boolean(value && Array.isArray(value.cards) && Number.isFinite(Number(value.matchCount)));
    const regionArg = region === 'ALL' ? null : region;
    const needles = terms.map(normalizeSearch);
    let ranked = null;
    let paged = false;
    let viaRanked = false;
    let rankedHits = false;
    let rpc = null;
    let viaRpc = false;
    let cards = [];
    let matchedSeries = 0;

    if (hasSeriesScope) {
      if (now() >= rankedSeriesMissingUntil && !budget?.exhausted()) {
        try {
          ranked = await rankedCall({ p_patterns: patterns, p_needles: terms, p_limit: limit, p_region: regionArg, p_offset: offset, p_rarities: rarityValues.length ? rarityValues : null, p_series_ids: scopedSeries });
          paged = rankedShape(ranked);
        } catch (error) {
          if (searchTimedOut(error) || error?.code === 'SEARCH_BUDGET_EXCEEDED') throw error;
          if (/PGRST202|SUPABASE_404/.test(error?.message || '')) rankedSeriesMissingUntil = now() + 300000;
          console.error('search ranked series rpc failed; using PostgREST series intersection', error?.message || error);
        }
      }
      viaRanked = paged;
      rankedHits = viaRanked && ranked.cards.length > 0;
      if (viaRanked) {
        cards = rankedHits ? ranked.cards.map(({ hit, ...card }) => card) : [];
      } else if (!budget?.exhausted()) {
        const seriesIn = scopedSeries.map(id => `"${String(id).replace(/["\\]/g, '')}"`).join(',');
        const pParams = { select: 'cardId:card_id,seriesId:series_id,region,rarity,rarityCode:rarity_code,localCardNumber:local_card_number', series_id: `in.(${seriesIn})`, order: 'series_id.asc,local_card_number.asc,card_id.asc', limit: '1000' };
        if (regionArg) pParams.region = `eq.${regionArg}`;
        const scopedPrintings = await timed('series-printings', dbFetch(`/tcg_printings?${new URLSearchParams(pParams)}`)) || [];
        const matchingCardIds = [...new Set(scopedPrintings.filter(p => printingMatchesRarity(p, rarityValues)).map(p => p.cardId))];
        if (matchingCardIds.length) {
          const fetched = [];
          for (let i = 0; i < matchingCardIds.length && fetched.length < 400 && !budget?.exhausted(); i += 100) {
            const batch = matchingCardIds.slice(i, i + 100).map(id => `"${String(id).replace(/["\\]/g, '')}"`).join(',');
            const rows = await timed('series-cards', cardsFetch({ id: `in.(${batch})`, limit: '100' })) || [];
            fetched.push(...rows);
          }
          const seriesOrder = new Map(scopedSeries.map((id, idx) => [id, idx]));
          cards = fetched.filter(c => {
            const vals = [c.nameZh, c.nameJa, c.nameEn, c.nameKo, ...(c.aliases || []), c.officialCardNumber, c.searchText, ...(c.printings || []).filter(p => seriesIdSet.has(p.seriesId) && (region === 'ALL' || p.region === region)).map(p => p.localCardNumber)];
            return vals.some(v => { const nv = normalizeSearch(v); return nv && needles.some(n => nv.includes(n)); });
          }).sort((a, b) => (seriesOrder.get(a.seriesId) ?? 999) - (seriesOrder.get(b.seriesId) ?? 999));
        }
      }
    } else {
      if (now() >= rankedPageMissingUntil && !budget?.exhausted()) {
        try {
          ranked = await rankedCall({ p_patterns: patterns, p_needles: terms, p_limit: limit, p_region: regionArg, p_offset: offset, p_rarities: rarityValues.length ? rarityValues : null });
          paged = rankedShape(ranked);
        } catch (error) {
          if (searchTimedOut(error) || error?.code === 'SEARCH_BUDGET_EXCEEDED') throw error;
          if (/PGRST202|SUPABASE_404/.test(error?.message || '')) rankedPageMissingUntil = now() + 300000;
          console.error('search ranked page rpc failed; trying the four-argument search_cards_ranked', error?.message || error);
        }
      }
      if (!paged && !budget?.exhausted()) {
        ranked = null;
        try {
          ranked = await rankedCall({ p_patterns: patterns, p_needles: terms, p_limit: Math.min(offset + limit, SEARCH_PAGE_MAX), p_region: regionArg });
        } catch (error) {
          if (searchTimedOut(error) || error?.code === 'SEARCH_BUDGET_EXCEEDED') throw error;
          console.error('search ranked rpc failed; trying search_cards_with_siblings', error?.message || error);
        }
      }
      viaRanked = Boolean(ranked && Array.isArray(ranked.cards) && Number.isFinite(Number(ranked.matchCount)));
      rankedHits = viaRanked && ranked.cards.length > 0;
      if (!viaRanked && !budget?.exhausted()) {
        try {
          rpc = await timed('rpc', dbFetch('/rpc/search_cards_with_siblings', { method: 'POST', body: JSON.stringify({ p_patterns: patterns, p_limit: SEARCH_CANDIDATE_LIMIT }) }));
        } catch (error) {
          if (searchTimedOut(error) || error?.code === 'SEARCH_BUDGET_EXCEEDED') throw error;
          console.error('search rpc failed; using PostgREST queries', error?.message || error);
        }
      }
      viaRpc = Boolean(rpc && Array.isArray(rpc.hits) && Array.isArray(rpc.siblings));
      cards = rankedHits
        ? ranked.cards.map(({ hit, ...card }) => card)
        : viaRanked
          ? []
          : viaRpc && rpc.hits.length
            ? rpc.hits
            : viaRpc || budget?.exhausted()
              ? []
              : await timed('names', query(['name_zh', 'name_ja', 'name_en', 'name_ko', 'official_card_number']));
      matchedSeries = rankedHits && ranked.matchedBy === 'series' ? Number(ranked.matchedSeries) || 1 : 0;
      const rankedMatched = viaRanked && Number(ranked.matchCount) > 0;
      if (!cards?.length && !(viaRanked && 'matchedBy' in ranked) && !budget?.exhausted()) cards = await timed('text', query(['search_text']));
      if (!cards?.length && !rankedMatched && !(viaRanked && 'matchedSeries' in ranked) && !budget?.exhausted()) {
        const seriesFilters = [];
        for (const term of terms) for (const column of ['name_zh', 'name_ja', 'name_en', 'name_ko', 'official_code']) seriesFilters.push(`${column}.ilike.*${term}*`);
        const series = await dbFetch(`/tcg_series?${new URLSearchParams({ select: 'id', or: `(${seriesFilters.join(',')})`, limit: '5' })}`);
        if (series?.length && !budget?.exhausted()) {
          matchedSeries = series.length;
          const sIds = series.map(s => `"${String(s.id).replaceAll('"', '')}"`).join(',');
          const rows = await dbFetch(`/tcg_printings?${new URLSearchParams({ select: 'cardId:card_id', series_id: `in.(${sIds})`, order: 'series_id.asc,local_card_number.asc,card_id.asc', limit: String(SEARCH_CANDIDATE_LIMIT) })}`);
          const cardIds = [...new Set((rows || []).map(r => r.cardId))];
          if (cardIds.length && !budget?.exhausted()) {
            const order = new Map(cardIds.map((id, index) => [id, index]));
            cards = (await cardsFetch({ id: `in.(${cardIds.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`, limit: String(SEARCH_CANDIDATE_LIMIT) }) || [])
              .sort((a, b) => (order.get(a.id) ?? SEARCH_CANDIDATE_LIMIT) - (order.get(b.id) ?? SEARCH_CANDIDATE_LIMIT));
          }
        }
      }
    }
    if (!cards?.length) {
      return {
        cards: [],
        candidateCount: 0,
        candidateLimit: SEARCH_CANDIDATE_LIMIT,
        resultLimit: limit,
        mayHaveMore: false,
        searched: true,
        matchedSeries,
        timings,
        ...(paged && offset && Number(ranked.groupCount) > 0 ? { total: Number(ranked.groupCount), paged } : {})
      };
    }
    const score = card => {
      const names = [card.nameZh, card.nameJa, card.nameEn, card.nameKo, ...(card.aliases || []), card.officialCardNumber].map(normalizeSearch).filter(Boolean);
      if (names.some(name => needles.some(needle => name === needle))) return 0;
      if (names.some(name => needles.some(needle => name.startsWith(needle)))) return 1;
      if (names.some(name => needles.some(needle => name.includes(needle)))) return 2;
      return 3;
    };
    if (!matchedSeries && !rankedHits) cards.sort((a, b) => score(a) - score(b) || String(a.nameEn || a.nameZh || '').localeCompare(String(b.nameEn || b.nameZh || '')));

    const candidateCount = rankedHits ? Number(ranked.matchCount) : cards.length;
    const knownIds = new Set(cards.map(c => c.id));
    const canonicalIds = [...new Set(cards.map(c => c.canonicalId).filter(Boolean))];
    if (canonicalIds.length && viaRpc && !matchedSeries && rpc.hits.length) {
      for (const sibling of rpc.siblings) if (!knownIds.has(sibling.id)) { knownIds.add(sibling.id); cards.push(sibling); }
    } else if (canonicalIds.length && !rankedHits && !budget?.exhausted()) {
      try {
        const siblings = await timed('siblings', cardsFetch({ canonical_id: `in.(${canonicalIds.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`, limit: String(SEARCH_CANDIDATE_LIMIT * 2) }));
        for (const sibling of siblings || []) if (!knownIds.has(sibling.id)) { knownIds.add(sibling.id); cards.push(sibling); }
      } catch (error) {
        console.error('search sibling cards failed', error?.message || error);
      }
    }
    const unembedded = cards.filter(c => !Array.isArray(c.printings));
    const ids = unembedded.map(c => `"${String(c.id).replaceAll('"', '')}"`).join(',');
    const printings = [
      ...cards.flatMap(c => (Array.isArray(c.printings) ? c.printings : [])),
      ...(ids && !budget?.exhausted() ? await timed('printings', dbFetch(`/tcg_printings?${new URLSearchParams({ select: BROWSE_PRINTING_SELECT, card_id: `in.(${ids})`, limit: '1000' })}`)) || [] : [])
    ];
    const byCard = new Map();
    for (const p of printings) {
      if ((region !== 'ALL' && p.region !== region) || !printingMatchesRarity(p, rarityValues) || (seriesIdSet && !seriesIdSet.has(p.seriesId))) continue;
      const list = byCard.get(p.cardId) || [];
      list.push(p);
      byCard.set(p.cardId, list);
    }
    const canonicalCards = canonicalizeCatalog({
      cards: cards.filter(c => !filtered || byCard.has(c.id)).map(c => ({
        ...c,
        printings: byCard.get(c.id) || [],
        region: byCard.get(c.id)?.[0]?.region || null,
        language: byCard.get(c.id)?.[0]?.language || null,
        ...cardImageFields(c, byCard.get(c.id))
      }))
    }).cards;

    const siblingUrls = new Map();
    if (filtered) {
      for (const c of cards) {
        const url = byCard.has(c.id) ? null : cardImageFields(c, c.printings).imageUrl;
        const key = c.canonicalId || c.id;
        if (url) {
          const list = siblingUrls.get(key) || [];
          if (!list.includes(url)) list.push(url);
          siblingUrls.set(key, list);
        }
      }
    }
    for (const card of canonicalCards) {
      const urls = siblingUrls.get(card.canonicalId || card.id);
      if (urls?.length) card.fallbackImageUrls = urls.slice(0, 3);
    }

    const page = paged ? canonicalCards.slice(0, limit) : canonicalCards.slice(offset, offset + limit);
    const total = paged
      ? Math.max(Number(ranked.groupCount) || 0, offset + page.length)
      : rankedHits && !rarityValues.length && !hasSeriesScope
        ? Math.max(Number(ranked.groupCount) || 0, page.length)
        : canonicalCards.length;
    return {
      cards: page.map(card => ({ ...card, matchRank: card.matchRank ?? cardMatchRank(card, needles) })),
      candidateCount,
      candidateLimit: SEARCH_CANDIDATE_LIMIT,
      resultLimit: limit,
      mayHaveMore: rankedHits ? Number(ranked.groupCount) > limit : candidateCount >= SEARCH_CANDIDATE_LIMIT || canonicalCards.length > limit,
      searched: true,
      matchedSeries,
      timings,
      total,
      paged
    };
  }

  async function searchCatalogDatabase(rawQuery, region = 'ALL', limit = SEARCH_RESULT_LIMIT, { offset = 0, rarities = [], seriesIds = [], budget = null } = {}) {
    const scopedSeries = [...new Set((seriesIds || []).map(id => String(id || '').trim()).filter(Boolean))].slice(0, SEARCH_SERIES_IDS_MAX);
    const mergeSecond = (main, second, mainTotal, secondOffset) => {
      if (!second.cards.length && !second.total) return main;
      const secondTotal = Number(second.total) || secondOffset + second.cards.length;
      const timings = { ...main.timings };
      for (const [name, ms] of Object.entries(second.timings || {})) timings[`second-${name}`] = ms;
      return {
        ...main,
        cards: [...main.cards, ...second.cards],
        candidateCount: main.candidateCount + second.candidateCount,
        mayHaveMore: second.mayHaveMore,
        matchedSeries: main.matchedSeries || second.matchedSeries,
        timings,
        total: mainTotal + secondTotal,
        paged: Boolean(main.cards.length ? main.paged : second.paged)
      };
    };

    if (scopedSeries.length) {
      const mainSeries = scopedSeries.filter(id => dbForId(id) === 'main');
      const secondSeries = db.secondDbConfigured() ? scopedSeries.filter(id => dbForId(id) === 'ip2') : [];
      if (!mainSeries.length && !secondSeries.length) {
        return { cards: [], candidateCount: 0, candidateLimit: SEARCH_CANDIDATE_LIMIT, resultLimit: limit, mayHaveMore: false, searched: true, matchedSeries: 0, timings: {}, total: 0, paged: false };
      }
      if (!mainSeries.length) {
        if (budget?.exhausted()) {
          return { cards: [], candidateCount: 0, candidateLimit: SEARCH_CANDIDATE_LIMIT, resultLimit: limit, mayHaveMore: false, searched: true, matchedSeries: 0, timings: {}, total: 0, paged: false };
        }
        try {
          return await withTimeout(searchCatalogDatabaseIn(rawQuery, region, limit, { offset, rarities, seriesIds: secondSeries, budget }, 'ip2'), db.secondDbTimeoutMs, 'SECOND_DB_TIMEOUT');
        } catch (error) {
          console.error('second database scoped search failed', error?.message || error);
          return { cards: [], candidateCount: 0, candidateLimit: SEARCH_CANDIDATE_LIMIT, resultLimit: limit, mayHaveMore: false, searched: true, matchedSeries: 0, timings: {}, total: 0, paged: false };
        }
      }
      const main = await searchCatalogDatabaseIn(rawQuery, region, limit, { offset, rarities, seriesIds: mainSeries, budget }, 'main');
      if (!secondSeries.length || !main.searched || main.cards.length >= limit || budget?.exhausted()) return main;
      const mainTotal = main.cards.length ? offset + main.cards.length : Number(main.total) || 0;
      const secondOffset = Math.max(offset - mainTotal, 0);
      let second;
      try {
        second = await withTimeout(searchCatalogDatabaseIn(rawQuery, region, limit - main.cards.length, { offset: secondOffset, rarities, seriesIds: secondSeries, budget }, 'ip2'), db.secondDbTimeoutMs, 'SECOND_DB_TIMEOUT');
      } catch (error) {
        console.error('second database search failed; main results only', error?.message || error);
        return main;
      }
      return mergeSecond(main, second, mainTotal, secondOffset);
    }

    const main = await searchCatalogDatabaseIn(rawQuery, region, limit, { offset, rarities, budget }, 'main');
    if (!db.secondDbConfigured() || !main.searched || main.cards.length >= limit || budget?.exhausted()) return main;
    const mainTotal = main.cards.length ? offset + main.cards.length : Number(main.total) || 0;
    const secondOffset = Math.max(offset - mainTotal, 0);
    let second;
    try {
      second = await withTimeout(searchCatalogDatabaseIn(rawQuery, region, limit - main.cards.length, { offset: secondOffset, rarities, budget }, 'ip2'), db.secondDbTimeoutMs, 'SECOND_DB_TIMEOUT');
    } catch (error) {
      console.error('second database search failed; main results only', error?.message || error);
      return main;
    }
    return mergeSecond(main, second, mainTotal, secondOffset);
  }

  // ---- Card Detail & Market ----
  async function loadCardDetailRpc(cardId, targetDb) {
    let detail = null;
    try {
      detail = await db.fetchJson('/rpc/get_card_detail', { db: targetDb, method: 'POST', body: JSON.stringify({ p_id: String(cardId) }) });
    } catch (error) {
      console.error('card detail rpc failed; using PostgREST queries', error?.message || error);
      return undefined;
    }
    if (!detail || !Array.isArray(detail.cards) || !Array.isArray(detail.series) || !Array.isArray(detail.games)) return undefined;
    if (!detail.cards.length) return null;
    const hydrated = detail.cards.map(c => ({ ...c, printings: c.printings || [], region: c.printings?.[0]?.region || null, language: c.printings?.[0]?.language || null, ...cardImageFields(c, c.printings) }));
    const cards = canonicalizeCatalog({ cards: hydrated }).cards;
    const canonical = cards.find(c => c.id === cardId) || cards[0];
    return { catalog: { source: 'supabase-full-catalog', cards: [canonical], series: detail.series, games: detail.games.filter(g => g.id === canonical.game) }, card: canonical };
  }

  async function loadCardFromDatabaseIn(cardId, targetDb) {
    if (!db.supabaseConfigured()) return null;
    const viaRpc = await loadCardDetailRpc(cardId, targetDb);
    if (viaRpc !== undefined) return viaRpc;
    const safe = String(cardId).replace(/[(),"\\]/g, '');
    if (!safe) return null;
    const cardSelect = 'id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases,metadata';
    const cards = await db.fetchJson(`/tcg_cards?${new URLSearchParams({ select: cardSelect, or: `(id.eq.${safe},canonical_id.eq.${safe})`, limit: '100' })}`, { db: targetDb });
    if (!cards?.length) return null;
    const knownIds = new Set(cards.map(c => c.id));
    const siblingCanonicals = [...new Set(cards.map(c => c.canonicalId).filter(id => id && id !== safe))];
    if (siblingCanonicals.length) {
      const siblings = await db.fetchJson(`/tcg_cards?${new URLSearchParams({ select: cardSelect, canonical_id: `in.(${siblingCanonicals.map(id => `"${String(id).replace(/["\\]/g, '')}"`).join(',')})`, limit: '100' })}`, { db: targetDb });
      for (const sibling of siblings || []) if (!knownIds.has(sibling.id)) { knownIds.add(sibling.id); cards.push(sibling); }
    }
    const ids = cards.map(c => `"${String(c.id).replace(/["\\]/g, '')}"`).join(',');
    const printings = await db.fetchJson(`/tcg_printings?${new URLSearchParams({ select: BROWSE_PRINTING_SELECT, card_id: `in.(${ids})`, limit: '1000' })}`, { db: targetDb });
    const byCard = new Map();
    for (const p of printings || []) {
      const list = byCard.get(p.cardId) || [];
      list.push(p);
      byCard.set(p.cardId, list);
    }
    const hydrated = cards.map(c => ({
      ...c,
      printings: byCard.get(c.id) || [],
      region: byCard.get(c.id)?.[0]?.region || null,
      language: byCard.get(c.id)?.[0]?.language || null,
      imageUrl: byCard.get(c.id)?.find(p => p.imageUrl && !p.imageRehostRequired)?.imageUrl || null
    }));
    const canonicalList = canonicalizeCatalog({ cards: hydrated }).cards;
    const canonical = canonicalList.find(c => c.id === cardId) || canonicalList[0];
    const seriesIds = [...new Set((canonical?.printings || []).map(p => p.seriesId).concat(canonical?.seriesId).filter(Boolean))];
    const series = seriesIds.length
      ? await db.fetchJson(`/tcg_series?select=id,game:game_id,officialCode:official_code,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,region,releaseDate:release_date&${new URLSearchParams({ id: `in.(${seriesIds.map(x => `"${String(x).replace(/["\\]/g, '')}"`).join(',')})` })}`, { db: targetDb })
      : [];
    const games = await db.fetchJson(`/tcg_games?select=id,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko&id=eq.${encodeURIComponent(canonical.game)}`, { db: targetDb });
    return { catalog: { source: 'supabase-full-catalog', cards: [canonical], series: series || [], games: games || [] }, card: canonical };
  }

  async function loadCardFromDatabase(cardId) {
    const targetDb = dbForId(cardId);
    if (targetDb === 'ip2' && !db.secondDbConfigured()) return null;
    return loadCardFromDatabaseIn(cardId, targetDb);
  }

  function loadCardCached(cardId) {
    const hit = cardCache.get(cardId);
    if (hit && (hit.pending || now() - hit.at < CARD_CACHE_TTL_MS)) return joinInFlight(hit.promise, () => { if (cardCache.get(cardId) === hit) cardCache.delete(cardId); }, () => loadCardCached(cardId));
    const entry = { pending: true, at: 0, promise: null };
    entry.promise = loadCardFromDatabase(cardId).then(value => {
      entry.pending = false;
      entry.at = now();
      if (!value) cardCache.delete(cardId);
      return value;
    }, error => {
      cardCache.delete(cardId);
      throw error;
    });
    cardCache.set(cardId, entry);
    while (cardCache.size > CARD_CACHE_MAX) cardCache.delete(cardCache.keys().next().value);
    return entry.promise;
  }

  async function getCard(cardId) {
    if (!db.supabaseConfigured()) {
      const localCatalog = canonicalizeCatalog({ ...getFallbackCatalogCopy(), source: 'catalog.json' });
      const match = localCatalog.cards.find(c => c.id === cardId)
        || localCatalog.cards.find(c => c.physicalCardIds?.includes(cardId) || c.printings?.some(p => p.cardId === cardId || p.id === cardId));
      return { catalog: localCatalog, card: match || null };
    }
    const found = await loadCardCached(cardId).catch(() => null);
    if (found) return found;
    if (catalogCache.value) {
      const shared = catalogCache.value;
      const match = shared.cards.find(c => c.id === cardId)
        || shared.cards.find(c => c.physicalCardIds?.includes(cardId) || c.printings?.some(p => p.cardId === cardId || p.id === cardId));
      if (match) return { catalog: shared, card: match };
    }
    return { catalog: { source: 'supabase-full-catalog', series: [], games: [] }, card: null };
  }

  async function yuyuteiMarket(card, fx) {
    if (!db.supabaseConfigured() || !card.officialCardNumber) return [];
    const params = new URLSearchParams({
      select: 'cardName:card_name,cardNumber:card_number,rarity,price,currency,cardUrl:card_url,imageUrl:image_url,setCode:set_code,setName:set_name,scrapedAt:scraped_at',
      card_number: `eq.${card.officialCardNumber}`,
      order: 'scraped_at.desc',
      limit: '10'
    });
    const rows = await db.fetchJson(`/jp_buyback_prices?${params}`, { db: 'main' });
    return (rows || []).map(r => ({
      ...withTwd(normalizeMarketRecord({
        provider: 'yuyutei',
        market: 'JP',
        cardId: card.id,
        cardName: r.cardName,
        cardNumber: r.cardNumber,
        setCode: r.setCode,
        rarity: r.rarity,
        language: 'ja-JP',
        priceType: 'buyback',
        amount: r.price,
        currency: r.currency,
        imageUrl: r.imageUrl,
        sourceUrl: r.cardUrl,
        observedAt: r.scrapedAt
      }), fx),
      region: 'JP'
    }));
  }

  async function loadVersionSnapshots(card, fx) {
    const ids = priceHistoryCardIds(card, card?.id);
    if (card?.game !== 'pokemon' || ids.length < 2 || !db.supabaseConfigured()) return [];
    try {
      const rows = await db.fetchJson(`/price_snapshots?${new URLSearchParams(referenceQueryParams(ids))}`, { db: 'main' });
      return buildReferencePrices(rows, ids, { fx, amountToTwd, now: now() }).cards;
    } catch (error) {
      console.error('version price snapshots failed', error?.message || error);
      return [];
    }
  }

  async function unifiedMarket(card) {
    const { data: fx, cacheable: fxCacheable } = await getTwdRates();
    const snapshotsPending = loadVersionSnapshots(card, fx);
    const tasks = sourceDisplayDenied('yuyutei') ? [] : [['yuyutei', () => yuyuteiMarket(card, fx)]];
    if (card.game === 'yugioh') {
      tasks.push(['ygoprodeck', async () => {
        const wanted = String(card.nameEn || '').trim().toLowerCase();
        if (!wanted) return [];
        const found = await searchYgo(card.nameEn, { limit: 20 });
        const match = found.find(x => String(x.name).trim().toLowerCase() === wanted);
        if (!match) return [];
        const printings = card.printings?.length
          ? card.printings.map(p => ({ number: p.localCardNumber, rarity: p.rarity, region: p.region }))
          : [{ number: card.officialCardNumber, rarity: card.rarity, region: card.region }];
        const seen = new Set();
        const rows = [];
        for (const p of printings) {
          if (p.region === 'JP') continue;
          const set = matchYgoprodeckSet(match.sets, p);
          const key = set && `${set.setCode}|${set.rarity}`;
          if (!set || seen.has(key)) continue;
          seen.add(key);
          rows.push({
            ...withTwd(normalizeMarketRecord({
              provider: 'ygoprodeck',
              market: 'YGOPRODeck',
              cardId: card.id,
              providerCardId: match.providerCardId,
              cardName: match.name,
              cardNumber: set.setCode,
              setCode: set.setCode,
              rarity: set.rarity,
              priceType: 'market',
              amount: set.setPriceUsd,
              currency: 'USD',
              observedAt: match.observedAt
            }), fx),
            region: p.region || null,
            scope: 'printing-set-price'
          });
        }
        if (!rows.length) {
          rows.notice = '沒有這個版本的 YGOPRODeck set price；改顯示跨版本最低參考價。';
          if (printings.some(p => p.region !== 'JP')) {
            for (const price of crossVersionLowestPrices(match)) {
              rows.push({
                ...withTwd(normalizeMarketRecord({
                  provider: 'ygoprodeck',
                  market: price.market,
                  cardId: card.id,
                  providerCardId: match.providerCardId,
                  cardName: match.name,
                  priceType: 'market',
                  amount: price.amount,
                  currency: price.currency,
                  observedAt: match.observedAt
                }), fx),
                scope: 'cross-version-lowest'
              });
            }
          }
        }
        return rows;
      }]);
    }
    if (card.game === 'pokemon' && catalogCollectionAllowed('tcgdexPricing')) {
      const lookups = tcgdexLookups(card);
      if (lookups.length) {
        tasks.push(['tcgdex', async () => (
          await Promise.all(lookups.map(x => (x.language === 'en' ? fetchTcgdexEn : fetchTcgdexJa)(x.id, { expectedName: x.expectedName }).then(rows => rows.map(r => ({ ...r, en: x.language === 'en' })))))
        ).flat().map(r => ({
          ...withTwd(normalizeMarketRecord({
            provider: r.provider,
            market: r.market,
            cardId: card.id,
            providerCardId: r.providerCardId,
            cardName: r.en ? (card.nameEn || card.nameZh) : (card.nameJa || card.nameZh),
            cardNumber: card.officialCardNumber,
            language: r.en ? 'en-US' : 'ja-JP',
            priceType: r.priceType,
            amount: r.amount,
            currency: r.currency,
            sourceUrl: r.sourceUrl,
            observedAt: r.observedAt
          }), fx),
          variant: r.variant,
          idProduct: r.idProduct,
          avg7: r.avg7,
          avg30: r.avg30,
          region: r.en ? 'US' : 'JP'
        }))]);
      }
    }
    const settled = await Promise.all(tasks.map(async ([source, run]) => {
      try {
        return { source, status: 'ok', data: await run() };
      } catch (error) {
        return { source, status: 'unavailable', error: publicReason(`market source ${source} failed`, error) };
      }
    }));
    const records = settled.flatMap(x => (Array.isArray(x.data) ? x.data : []));
    let sharedPriceCardIds = [];
    if (card.game === 'pokemon' && db.supabaseConfigured() && records.some(r => r.market === 'Cardmarket')) {
      try {
        sharedPriceCardIds = await db.fetchJson('/rpc/price_products_shared', { db: 'main', method: 'POST', body: JSON.stringify({ p_ids: priceHistoryCardIds(card, card.id) }) }) || [];
      } catch (error) {
        console.error('price shared lookup failed', error?.message || error);
      }
    }
    const market = {
      records,
      versions: buildVersionPrices(card, records, await snapshotsPending, { fx }),
      sources: settled.map(x => ({ source: x.source, status: x.status, error: x.error || null, notice: x.data?.notice || null })),
      meta: {
        sharedPriceCardIds,
        exchangeRates: fx,
        priceTypes: { listing: '最低掛牌價', buyback: '店家買取／回收', market: '平台參考價', sale: '可驗證成交', user_report: '使用者回報（未驗證）' },
        warning: '不同價格性質不混算中位價；目前沒有可靠成交來源時，不顯示成交價或交易量。'
      }
    };
    marketFxCacheable.set(market, fxCacheable);
    return market;
  }

  function unifiedMarketCached(card) {
    const hit = marketCache.get(card.id);
    if (hit && (hit.pending || now() - hit.at < MARKET_CACHE_MS)) return joinInFlight(hit.promise, () => { if (marketCache.get(card.id) === hit) marketCache.delete(card.id); }, () => unifiedMarketCached(card));
    const entry = { pending: true, at: 0, promise: null };
    entry.promise = unifiedMarket(card).then(value => {
      entry.pending = false;
      entry.at = now();
      if (value.sources.some(source => source.status !== 'ok') || !marketFxCacheable.get(value)) marketCache.delete(card.id);
      return value;
    }, error => {
      marketCache.delete(card.id);
      throw error;
    });
    marketCache.set(card.id, entry);
    while (marketCache.size > MARKET_CACHE_MAX) marketCache.delete(marketCache.keys().next().value);
    return entry.promise;
  }

  // ---- Events / Movers / Hot Cards / Trends ----
  function loadCatalogEvents(current = now()) {
    if (catalogEventsCache && current - catalogEventsCache.at < 3600000) { const hit = catalogEventsCache; return joinInFlight(hit.promise, () => { if (catalogEventsCache === hit) catalogEventsCache = null; }, () => loadCatalogEvents(current)); }
    const day = offset => new Date(current + offset * 86400000).toISOString().slice(0, 10);
    const entry = { at: current, promise: null };
    const path = `/tcg_series?select=game_id,region,release_date,name_zh,name_ja,name_en,source_url&release_date=gte.${day(-PRICE_HISTORY_DAYS)}&release_date=lte.${day(60)}&order=release_date.asc&limit=500`;
    const second = db.secondDbConfigured()
      ? withTimeout(db.fetchJson(path, { db: 'ip2', timeoutMs: db.secondDbTimeoutMs }), db.secondDbTimeoutMs, 'SECOND_DB_TIMEOUT').catch(error => { console.error('second database events failed', error?.message || error); return []; })
      : Promise.resolve([]);
    entry.promise = Promise.all([db.fetchJson(path, { db: 'main' }), second])
      .then(([main, extra]) => catalogEventsFrom([...(main || []), ...(extra || [])]))
      .catch(error => { catalogEventsCache = null; throw error; });
    catalogEventsCache = entry;
    return entry.promise;
  }

  async function marketEventsResult(game, current = now()) {
    const from = new Date(current - HOME_EVENTS_PAST_DAYS * 86400000).toISOString().slice(0, 10);
    let degraded = false;
    const catalog = await loadCatalogEvents(current).catch(error => {
      degraded = true;
      console.error('catalog events unavailable', error?.message || error);
      return [];
    });
    const events = mergeMarketEvents(marketEventsFor(null, from, current), catalog.filter(event => event.date >= from)).filter(event => !game || event.game === game);
    return {
      payload: { data: events, meta: { note: '發售日與官方消息，不代表會影響價格。', generatedAt: new Date(current).toISOString() } },
      degraded
    };
  }

  async function loadPriceMovers(ctx = null) {
    return priceMoversCache.get(async () => {
      const [rows, fxResult] = await Promise.all([
        db.fetchJson('/rpc/price_movers', { db: 'main', method: 'POST', body: JSON.stringify({ p_days: PRICE_MOVERS_DAYS, p_min: PRICE_MOVERS_MIN_EUR, p_limit: 20 }), timeoutMs: BROWSE_HEAVY_TIMEOUT_MS }),
        getTwdRates()
      ]);
      return buildPriceMovers(rows, fxResult.data, now());
    }, { waitUntil: p => ctx?.waitUntil?.(p) });
  }

  async function loadHotCards(ctx = null) {
    return hotCardsCache.get(async () =>
      buildHotCardsPayload(
        await db.fetchJson('/rpc/card_hot_top', { db: 'main', method: 'POST', body: JSON.stringify({ p_days: HOT_CARDS_DAYS, p_limit: HOT_CARDS_LIMIT, p_min: HOT_CARDS_MIN_OPENS }) }),
        now()
      ),
      { waitUntil: p => ctx?.waitUntil?.(p) }
    );
  }

  async function loadTrendSnapshot() {
    if (trendCache.data && trendCache.expiresAt > now()) return trendCache.data;
    if (trendCache.promise) { const shared = trendCache.promise; return joinInFlight(shared, () => { if (trendCache.promise === shared) trendCache.promise = null; }, loadTrendSnapshot); }
    const promise = Promise.resolve().then(async () => {
      const params = new URLSearchParams({
        select: 'game,setCode:set_code,setName:set_name,cardCode:card_code,cardNumber:card_number,rarity,cardName:card_name,price,previousPrice:previous_price,currency,cardUrl:card_url,imageUrl:image_url,updatedAt:scraped_at,source',
        source: 'eq.yuyutei',
        previous_price: 'not.is.null',
        order: 'scraped_at.desc'
      });
      const rows = await db.fetchAll(`/jp_buyback_prices?${params}`, 1000, { db: 'main', maxPages: 20 });
      const valid = (rows || []).filter(row => Number(row.previousPrice) > 0 && Number.isFinite(Number(row.price)) && Number(row.price) > Number(row.previousPrice));
      const byCard = new Map();
      for (const row of valid) {
        const key = trendRecordKey(row);
        if (!key) continue;
        const existing = byCard.get(key);
        const rowTime = Date.parse(String(row.updatedAt || ''));
        const existingTime = Date.parse(String(existing?.updatedAt || ''));
        if (!existing || (!Number.isFinite(existingTime) && Number.isFinite(rowTime)) || rowTime > existingTime) byCard.set(key, row);
      }
      const data = [...byCard.values()].map(row => ({
        ...row,
        price: Number(row.price),
        previousPrice: Number(row.previousPrice),
        changePercent: Math.round((Number(row.price) - Number(row.previousPrice)) / Number(row.previousPrice) * 10000) / 100,
        priceType: 'buyback'
      })).sort((a, b) => b.changePercent - a.changePercent || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return {
        status: 'complete',
        data,
        rowsScanned: (rows || []).length,
        validRows: valid.length,
        uniqueCards: data.length,
        coveredGames: uniqueValues((rows || []).map(row => row.game)),
        coveredSets: uniqueValues((rows || []).map(row => row.setCode || row.setName)),
        observationWindow: trendObservationWindow(rows || [])
      };
    }).then(data => {
      trendCache.data = data;
      trendCache.expiresAt = now() + TREND_CACHE_MS;
      return data;
    }).finally(() => {
      trendCache.promise = null;
    });
    trendCache.promise = promise;
    return promise;
  }

  async function readKvRaw(activeEnv, key) {
    const kv = activeEnv?.SNAPSHOT_KV || activeEnv?.CARDSCOPE_KV || null;
    if (!kv || typeof kv.get !== 'function') return null;
    try {
      return await kv.get(key);
    } catch (error) {
      console.error('kv snapshot read failed', key, error?.message || error);
      return null;
    }
  }

  async function writeKvRaw(activeEnv, key, value, expirationTtl = null) {
    const kv = activeEnv?.SNAPSHOT_KV || activeEnv?.CARDSCOPE_KV || null;
    if (!kv || typeof kv.put !== 'function') return false;
    try {
      const payload = typeof value === 'string' ? value : JSON.stringify(value);
      const opts = Number.isFinite(expirationTtl) && expirationTtl > 0 ? { expirationTtl: Math.floor(expirationTtl) } : undefined;
      await kv.put(key, payload, opts);
      return true;
    } catch (error) {
      console.error('kv snapshot write failed', key, error?.message || error);
      return false;
    }
  }

  function parseKvJson(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ---- Price History (/api/cards/:id/price-history) ----
  async function loadPriceHistory(card, requestedId) {
    const current = now();
    const ids = priceHistoryCardIds(card, requestedId);
    const from = new Date(current - PRICE_HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
    const [rows, fxResult] = await Promise.all([
      db.fetchAll(
        `/price_snapshots?${new URLSearchParams({
          select: 'card_id,provider,variant,currency,snapshot_date,amount,observed_at',
          card_id: `in.(${ids.map(id => `"${id.replaceAll('"', '')}"`).join(',')})`,
          snapshot_date: `gte.${from}`,
          order: 'card_id.asc,provider.asc,variant.asc,snapshot_date.asc'
        })}`,
        1000,
        { db: 'main', maxPages: 25 }
      ),
      getTwdRates()
    ]);
    let archived = [];
    let archiveUnavailable = false;
    try {
      archived = await archiveReader.rowsFor(ids, { from });
    } catch (error) {
      archiveUnavailable = true;
      console.error('price archive unavailable', error?.message || error);
    }
    const body = buildPriceHistory(mergeSnapshotRowsWeb(rows, archived), {
      card,
      requestedId,
      fx: fxResult.data,
      now: current
    });
    const catalogEvents = await loadCatalogEvents(current).catch(() => []);
    body.meta.events = mergeMarketEvents(
      body.meta.events,
      catalogEvents.filter(event => event.game === card?.game && event.date >= from)
    );
    if (archiveUnavailable) body.meta.archiveUnavailable = true;
    return body;
  }

  function priceHistoryCached(card, requestedId) {
    const current = now();
    const hit = priceHistoryCache.get(requestedId);
    if (hit && (hit.pending || current - hit.at < PRICE_HISTORY_TTL_MS)) return joinInFlight(hit.promise, () => { if (priceHistoryCache.get(requestedId) === hit) priceHistoryCache.delete(requestedId); }, () => priceHistoryCached(card, requestedId));
    const entry = { pending: true, at: 0, promise: null };
    entry.promise = loadPriceHistory(card, requestedId).then(
      value => {
        entry.pending = false;
        entry.at = now() - (value.meta?.archiveUnavailable ? PRICE_HISTORY_TTL_MS - 60000 : 0);
        return value;
      },
      error => {
        priceHistoryCache.delete(requestedId);
        throw error;
      }
    );
    priceHistoryCache.set(requestedId, entry);
    while (priceHistoryCache.size > PRICE_HISTORY_CACHE_MAX) {
      priceHistoryCache.delete(priceHistoryCache.keys().next().value);
    }
    return entry.promise;
  }

  async function priceHistoryResponse(requestedId) {
    let loaded = null;
    try {
      loaded = await getCard(requestedId);
    } catch {
      return {
        status: 200,
        body: {
          series: [],
          meta: {
            unavailable: 'price-history-unavailable',
            note: priceHistoryNote([]),
            generatedAt: new Date(now()).toISOString()
          }
        }
      };
    }
    if (!loaded?.card) return { status: 404, body: { error: '找不到這張卡' } };
    if (!db.supabaseConfigured()) {
      return {
        status: 200,
        body: {
          series: [],
          meta: {
            note: priceHistoryNote([]),
            windowDays: PRICE_HISTORY_DAYS,
            generatedAt: new Date(now()).toISOString()
          }
        }
      };
    }
    try {
      return { status: 200, body: await priceHistoryCached(loaded.card, requestedId) };
    } catch {
      return {
        status: 200,
        body: {
          series: [],
          meta: {
            unavailable: 'price-history-unavailable',
            note: priceHistoryNote([]),
            windowDays: PRICE_HISTORY_DAYS,
            generatedAt: new Date(now()).toISOString()
          }
        }
      };
    }
  }

  // ---- Graded Prices (/api/graded-prices) & eBay Listings (/api/ebay-listings) ----
  async function lookupGradedPrices(input, ctx) {
    const query = gradedQuery(input);
    if (!query) return { status: 'unsupported' };
    const apiKey = String(currentEnv?.POKEMONPRICETRACKER_API_KEY || '').trim();
    if (!apiKey) return { status: 'not-configured' };

    const current = now();
    const memHit = gradedCache.get(query.key);
    if (memHit && memHit.expiresAt > current) return memHit.value;
    if (gradedPending.has(query.key)) { const shared = gradedPending.get(query.key); return joinInFlight(shared, () => { if (gradedPending.get(query.key) === shared) gradedPending.delete(query.key); }, () => lookupGradedPrices(input, ctx)); }

    const kvCacheKey = `${KV_KEYS.gradedCachePrefix}${query.key}`;
    const kvCached = parseKvJson(await readKvRaw(currentEnv, kvCacheKey));
    if (kvCached && kvCached.value && Number(kvCached.expiresAt) > current) {
      if (gradedCache.size >= 500) gradedCache.delete(gradedCache.keys().next().value);
      gradedCache.set(query.key, { value: kvCached.value, expiresAt: Number(kvCached.expiresAt) });
      return kvCached.value;
    }

    const today = new Date(current).toISOString().slice(0, 10);
    const rawLimit = Number(currentEnv?.GRADED_DAILY_LOOKUPS);
    const dailyLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : GRADED_DAILY_LOOKUPS;
    if (gradedQuota.day !== today) {
      gradedQuota = { day: today, used: 0, syncedFromKv: false };
    }
    if (!gradedQuota.syncedFromKv) {
      const kvQuota = parseKvJson(await readKvRaw(currentEnv, KV_KEYS.gradedQuota));
      if (kvQuota && kvQuota.day === today && Number.isFinite(Number(kvQuota.used))) {
        gradedQuota.used = Math.max(gradedQuota.used, Number(kvQuota.used));
      }
      gradedQuota.syncedFromKv = true;
    }
    if (gradedQuota.used >= dailyLimit) return { status: 'daily-limit' };
    gradedQuota.used++;
    const quotaWrite = writeKvRaw(currentEnv, KV_KEYS.gradedQuota, { day: today, used: gradedQuota.used }, 172800);
    if (ctx?.waitUntil) ctx.waitUntil(quotaWrite);

    const task = (async () => {
      const [fxResult, response] = await Promise.all([
        getTwdRates(),
        fetchFn(`${GRADED_ENDPOINT}?${new URLSearchParams({ ...query.params, includeEbay: 'true', limit: '1' })}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(15000)
        })
      ]);
      if (!response.ok) throw new Error(`GRADED_${response.status}`);
      const usdToTwd = fxResult.data?.rates?.USD;
      const card = pickGradedCard(await response.json(), query);
      const grades = card ? summarizeGrades(card, usdToTwd) : [];
      const value = card
        ? {
            status: grades.length ? 'ok' : 'no-sales',
            name: card.name || null,
            setName: card.setName || null,
            updatedAt: card.ebay?.updatedAt || null,
            grades
          }
        : { status: 'no-match' };
      const expiresAt = now() + GRADED_TTL_MS;
      if (gradedCache.size >= 500) gradedCache.delete(gradedCache.keys().next().value);
      gradedCache.set(query.key, { value, expiresAt });
      const cacheWrite = writeKvRaw(currentEnv, kvCacheKey, { value, expiresAt }, Math.floor(GRADED_TTL_MS / 1000));
      if (ctx?.waitUntil) ctx.waitUntil(cacheWrite);
      return value;
    })().finally(() => {
      gradedPending.delete(query.key);
    });
    gradedPending.set(query.key, task);
    return task;
  }

  async function getEbayAccessToken(clientId, clientSecret, ctx) {
    const current = now();
    if (ebayToken && ebayToken.expiresAt - 60000 > current) return ebayToken.value;
    if (ebayTokenPending) { const shared = ebayTokenPending; return joinInFlight(shared, () => { if (ebayTokenPending === shared) ebayTokenPending = null; }, () => getEbayAccessToken(clientId, clientSecret, ctx)); }
    ebayTokenPending = (async () => {
      const kvToken = parseKvJson(await readKvRaw(currentEnv, KV_KEYS.ebayToken));
      if (kvToken && typeof kvToken.value === 'string' && Number(kvToken.expiresAt) - 60000 > now()) {
        ebayToken = { value: kvToken.value, expiresAt: Number(kvToken.expiresAt) };
        return ebayToken.value;
      }
      const response = await fetchFn(EBAY_TOKEN_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
      });
      if (!response.ok) throw new Error(`EBAY_TOKEN_${response.status}`);
      const body = await response.json();
      if (typeof body?.access_token !== 'string' || !(Number(body.expires_in) > 0)) {
        throw new Error('EBAY_TOKEN_INVALID');
      }
      const expiresInSec = Number(body.expires_in);
      ebayToken = { value: body.access_token, expiresAt: now() + expiresInSec * 1000 };
      const tokenWrite = writeKvRaw(currentEnv, KV_KEYS.ebayToken, ebayToken, Math.max(60, expiresInSec - 60));
      if (ctx?.waitUntil) ctx.waitUntil(tokenWrite);
      return ebayToken.value;
    })().finally(() => {
      ebayTokenPending = null;
    });
    return ebayTokenPending;
  }

  async function lookupEbayListings(input, ctx) {
    const clientId = String(currentEnv?.EBAY_CLIENT_ID || '').trim();
    const clientSecret = String(currentEnv?.EBAY_CLIENT_SECRET || '').trim();
    const enabled = Boolean(clientId && clientSecret);
    const query = ebayQuery(input);
    if (!query) return { status: 'unsupported', enabled, limited: false, items: [] };
    if (!enabled) return { status: 'not-configured', enabled: false, limited: false, items: [] };

    const current = now();
    const memHit = ebayCache.get(query.key);
    if (memHit && memHit.expiresAt > current) {
      return { status: memHit.items.length ? 'ok' : 'no-match', enabled: true, limited: false, items: memHit.items };
    }
    if (ebayPending.has(query.key)) return ebayPending.get(query.key);

    const today = new Date(current + 8 * 3600e3).toISOString().slice(0, 10);
    const rawLimit = Number(currentEnv?.EBAY_DAILY_LOOKUPS);
    const dailyLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : EBAY_DAILY_LOOKUPS;
    if (ebayQuota.day !== today) {
      ebayQuota = { day: today, used: 0, syncedFromKv: false };
    }
    if (!ebayQuota.syncedFromKv) {
      const kvQuota = parseKvJson(await readKvRaw(currentEnv, KV_KEYS.ebayQuota));
      if (kvQuota && kvQuota.day === today && Number.isFinite(Number(kvQuota.used))) {
        ebayQuota.used = Math.max(ebayQuota.used, Number(kvQuota.used));
      }
      ebayQuota.syncedFromKv = true;
    }
    if (ebayQuota.used >= dailyLimit) {
      return { status: 'limited', enabled: true, limited: true, items: [] };
    }
    ebayQuota.used++;
    // 控制 KV 寫入頻率（每日上限 1,000 次）：首筆、每 10 筆或達上限時同步至 KV。
    if (dailyLimit <= 50 || ebayQuota.used === 1 || ebayQuota.used >= dailyLimit || ebayQuota.used % 10 === 0) {
      const quotaWrite = writeKvRaw(currentEnv, KV_KEYS.ebayQuota, { day: today, used: ebayQuota.used }, 172800);
      if (ctx?.waitUntil) ctx.waitUntil(quotaWrite);
    }

    const task = (async () => {
      const auth = await getEbayAccessToken(clientId, clientSecret, ctx);
      const response = await fetchFn(`${EBAY_SEARCH_URL}?${new URLSearchParams(query.params)}`, {
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${auth}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          Accept: 'application/json'
        }
      });
      if (!response.ok) throw new Error(`EBAY_SEARCH_${response.status}`);
      const items = pickListings(await response.json(), query.number);
      if (ebayCache.size >= 500) ebayCache.delete(ebayCache.keys().next().value);
      ebayCache.set(query.key, { items, expiresAt: now() + EBAY_TTL_MS });
      return { status: items.length ? 'ok' : 'no-match', enabled: true, limited: false, items };
    })().finally(() => {
      ebayPending.delete(query.key);
    });
    ebayPending.set(query.key, task);
    return task;
  }

  // ---- SEO (/?card=<id>, /?series=<id>) & Sitemaps (/sitemap.xml, /sitemaps/*.xml) ----
  function seoCacheGet(key) {
    const hit = seoCache.get(key);
    if (hit && hit.expiresAt > now()) return hit.value;
    seoCache.delete(key);
    return undefined;
  }

  function seoCacheSet(key, value, ttlMs) {
    seoCache.delete(key);
    seoCache.set(key, { value, expiresAt: now() + ttlMs });
    while (seoCache.size > SEO_CACHE_MAX) seoCache.delete(seoCache.keys().next().value);
  }

  async function loadSeoForCard(cardId, publicBaseUrl) {
    const loaded = db.supabaseConfigured() ? await loadCardCached(cardId) : await getCard(cardId);
    if (!loaded?.card) return null;
    const { catalog, card } = loaded;
    const seriesId = card.printings?.[0]?.seriesId || card.seriesId;
    const series = (catalog.series || []).find(s => s.id === seriesId) || null;
    const game = (catalog.games || []).find(g => g.id === card.game) || null;
    return cardSeo({ card, series, game, baseUrl: publicBaseUrl, rarityLabel: rarityDisplayLabel });
  }

  async function loadSeoForSeries(seriesId, publicBaseUrl, ctx) {
    let series = null;
    let printingCount = null;
    const targetDb = dbForId(seriesId);
    if (targetDb === 'ip2' && !db.secondDbConfigured()) return null;
    if (db.supabaseConfigured()) {
      const rows = await db.fetchJson(
        `/tcg_series?${new URLSearchParams({
          select: 'id,game:game_id,officialCode:official_code,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,region,releaseDate:release_date',
          id: `eq.${seriesId}`,
          limit: '1'
        })}`,
        { db: targetDb }
      );
      series = rows?.[0] || null;
      if (series) {
        printingCount = await withTimeout(
          db.fetchPage(`/tcg_printings?${new URLSearchParams({ select: 'id', series_id: `eq.${seriesId}`, limit: '1' })}`, { db: targetDb }).then(page => page.total),
          800,
          'SEO_TIMEOUT'
        ).catch(() => null);
      }
    } else {
      const catalog = await loadCatalogShared(ctx);
      series = (catalog.series || []).find(s => s.id === seriesId) || null;
    }
    return series ? seriesSeo({ series, baseUrl: publicBaseUrl, printingCount }) : null;
  }

  async function loadSeo(target, publicBaseUrl, ctx = null, runtimeEnv = env) {
    currentEnv = runtimeEnv || env;
    const baseUrl = normalizeBaseUrl(publicBaseUrl || currentEnv?.PUBLIC_BASE_URL);
    const key = `${target.kind}:${target.id}:${baseUrl}`;
    let entry = seoCacheGet(key);
    if (entry === undefined) {
      try {
        const seo = await withTimeout(
          target.kind === 'card'
            ? loadSeoForCard(target.id, baseUrl)
            : loadSeoForSeries(target.id, baseUrl, ctx),
          SEO_LOAD_TIMEOUT_MS,
          'SEO_TIMEOUT'
        );
        entry = seo ? { seo } : { missing: true };
        seoCacheSet(key, entry, seo ? SEO_CACHE_TTL_MS : SEO_NEGATIVE_TTL_MS);
      } catch (error) {
        console.error('seo lookup failed', error?.message || error);
        return { fallback: true };
      }
    }
    return entry;
  }

  function xmlRes(body) {
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }

  async function handleSitemap(request, url, ctx, runtimeEnv = env) {
    currentEnv = runtimeEnv || env;
    const pathname = url.pathname;
    const publicBaseUrl = normalizeBaseUrl(currentEnv?.PUBLIC_BASE_URL);
    if (pathname === '/sitemaps/pages.xml') {
      return xmlRes(renderUrlSet(pageSitemapEntries(publicBaseUrl, [...db.catalogGameIds()])));
    }

    const cacheReq = canonicalEdgeKeyRequest('sitemap', pathname);
    const cached = await matchEdgeCache(cacheReq);
    if (cached) return cached;

    const indexDoc = normalizeKvSitemapIndex(await readKvRaw(currentEnv, KV_KEYS.sitemapIndex));
    if (!indexDoc) {
      if (!db.supabaseConfigured()) return jsonRes(503, { error: '尚未設定資料庫' });
      return jsonRes(503, { error: 'Sitemap 暫時無法產生' });
    }

    if (pathname === '/sitemap.xml') {
      const res = xmlRes(indexDoc.xml);
      writeEdgeCache(ctx, cacheReq, res);
      return res;
    }

    if (pathname === '/sitemaps/series.xml') {
      const seriesXml = normalizeKvSitemapXml(await readKvRaw(currentEnv, KV_KEYS.sitemapSeries));
      if (!seriesXml) {
        return jsonRes(503, { error: db.supabaseConfigured() ? 'Sitemap 暫時無法產生' : '尚未設定資料庫' });
      }
      const res = xmlRes(seriesXml);
      writeEdgeCache(ctx, cacheReq, res);
      return res;
    }

    const cardFile = pathname.match(/^\/sitemaps\/cards-(\d+)\.xml$/);
    const fileIndex = cardFile ? Number(cardFile[1]) : 0;
    if (!fileIndex || fileIndex < 1 || fileIndex > indexDoc.cardFileCount) {
      return jsonRes(404, { error: 'Not found' });
    }
    const cardXml = normalizeKvSitemapXml(await readKvRaw(currentEnv, sitemapCardsKvKey(fileIndex)));
    if (!cardXml) return jsonRes(404, { error: 'Not found' });
    const res = xmlRes(cardXml);
    writeEdgeCache(ctx, cacheReq, res);
    return res;
  }

  // ---- Endpoint Dispatch ----
  async function handle(apiKey, request, url, ctx, runtimeEnv = env) {
    currentEnv = runtimeEnv || env;
    try {
      switch (apiKey) {
        case 'catalog-health': {
          if (request.method === 'HEAD') {
            return new Response(null, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
          }
          const cacheReq = canonicalEdgeKeyRequest('health', '/api/catalog/health');
          const cached = await matchEdgeCache(cacheReq, 'no-store');
          if (cached) return cached;
          const [healthRaw, storage, secondStorage] = await Promise.all([loadCatalogHealth(ctx), loadStorageReport('main'), loadStorageReport('ip2')]);
          const { _fallback, ...health } = healthRaw;
          const res = jsonRes(200, {
            data: {
              ...health,
              storage: { status: storageStatus(storage) },
              ...(db.secondDbConfigured() ? { secondStorage: { status: storageStatus(secondStorage) } } : {})
            }
          });
          if (
            !_fallback &&
            db.supabaseConfigured() &&
            !healthRaw.cache?.stale &&
            storage !== null &&
            (!db.secondDbConfigured() || secondStorage !== null)
          ) {
            writeEdgeCache(ctx, cacheReq, res, 'public, max-age=300');
          }
          return res;
        }

        case 'providers':
          return jsonRes(200, { data: providerStatusFromEnv(env) });

        case 'catalog-sources':
          return jsonRes(200, { data: publicSourcePolicies(), meta: sourcePolicySummary() });

        case 'catalog-sync-status': {
          if (!db.supabaseConfigured()) return jsonRes(200, { data: [] });
          try {
            const data = await db.fetchJson('/catalog_sync_runs?select=provider,scope,status,rowsSeen:rows_seen,rowsWritten:rows_written,startedAt:started_at,finishedAt:finished_at&provider=not.in.(price-snapshot,price-archive)&order=started_at.desc&limit=12', { db: 'main' });
            return jsonRes(200, { data });
          } catch (error) {
            console.error('sync status failed', error?.message || error);
            return jsonRes(502, { error: '資料暫時無法讀取' });
          }
        }

        case 'trends': {
          const requestedLimit = Math.floor(Number(url.searchParams.get('limit')));
          const limit = Math.min(Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 12, 1), 50);
          if (sourceDisplayDenied('yuyutei')) {
            return jsonRes(200, {
              data: [],
              meta: { ...trendMeta({ status: 'unavailable', rowsScanned: 0, validRows: 0, uniqueCards: 0, observationWindow: trendObservationWindow([]) }, now()), disabled: true, disabledReason: 'source-denied' }
            });
          }
          if (!db.supabaseConfigured()) {
            return jsonRes(200, { data: [], meta: trendMeta({ status: 'unavailable', rowsScanned: 0, validRows: 0, uniqueCards: 0, observationWindow: trendObservationWindow([]) }, now()) });
          }
          try {
            const snapshot = await loadTrendSnapshot();
            return jsonRes(200, { data: snapshot.data.slice(0, limit), meta: trendMeta(snapshot, now()) });
          } catch (error) {
            console.error('trend snapshot failed', error?.message || error);
            return jsonRes(502, { error: '資料暫時無法讀取', meta: trendMeta({ status: 'unavailable', rowsScanned: 0, validRows: 0, uniqueCards: 0, observationWindow: trendObservationWindow([]) }, now()) });
          }
        }

        case 'buyback-prices': {
          if (!db.supabaseConfigured()) return jsonRes(200, { data: [], meta: { source: 'yuyutei-buyback', warning: '沒有資料庫時不建立示範價格' } });
          const requestedGame = (url.searchParams.get('game') || '').trim().toLowerCase();
          const providerGame = sourceDisplayDenied('yuyutei') ? null : BUYBACK_PROVIDER_GAMES.get(requestedGame) || null;
          if (!providerGame) return jsonRes(200, { data: [], meta: { source: 'yuyutei-buyback', warning: '此 IP 目前沒有可驗證的買取價格來源，因此不顯示價格。' } });
          try {
            const rows = await cachedBrowseRows(
              `buyback:${providerGame}`,
              () => db.fetchJson(`/jp_buyback_prices?select=game,cardNumber:card_number,rarity,cardName:card_name,price,currency,cardUrl:card_url,updatedAt:scraped_at&source=eq.yuyutei&game=eq.${providerGame}&order=scraped_at.desc&limit=500`, { db: 'main' })
            );
            const seen = new Set();
            const data = [];
            for (const row of rows || []) {
              const key = String(row.cardNumber || '').trim().toUpperCase();
              if (!key || seen.has(key) || !Number.isFinite(Number(row.price))) continue;
              seen.add(key);
              data.push({ ...row, price: Number(row.price), priceType: 'buyback' });
            }
            return jsonRes(200, { data, meta: { source: 'yuyutei-buyback', label: '遊々亭日版買取價', warning: '只用於篩選與排序有可靠對應的卡片；不是成交價、掛牌價或市場均價。' } });
          } catch (error) {
            console.error('buyback prices failed', error?.message || error);
            return jsonRes(502, { error: '資料暫時無法讀取' });
          }
        }

        case 'images-onepiece': {
          const target = onePieceImageTarget(url.searchParams.get('url'));
          if (!target) return jsonRes(400, { error: '不支援的圖片來源' });
          const cacheReq = canonicalEdgeKeyRequest('onepiece-img', '/api/images/onepiece', { url: target.href });
          const cached = await matchEdgeCache(cacheReq);
          if (cached) return cached;
          let response;
          try {
            response = await fetchFn(target.href, {
              redirect: 'manual', // Workers fetch 不支援 'error'，會直接丟例外
              headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8', 'User-Agent': 'CardScope/1.0' },
              signal: AbortSignal.timeout(20000)
            });
          } catch {
            return jsonRes(502, { error: '航海王官方圖片暫時無法讀取' });
          }
          if (response.status >= 300 && response.status < 400) {
            response.body?.cancel?.().catch(() => {});
            return jsonRes(502, { error: '航海王官方圖片暫時無法讀取' });
          }
          const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          const length = Number(response.headers.get('content-length') || 0);
          if (!response.ok || !ONEPIECE_IMAGE_MIMES.has(contentType) || (length && length > ONEPIECE_IMAGE_MAX_BYTES)) {
            response.body?.cancel?.().catch(() => {});
            return jsonRes(502, { error: '航海王官方圖片回應無效' });
          }
          let body;
          try {
            body = await readBoundedBytes(response, ONEPIECE_IMAGE_MAX_BYTES);
          } catch (error) {
            return jsonRes(502, { error: error?.code === 'IMAGE_TOO_LARGE' ? '航海王官方圖片超過大小限制' : '航海王官方圖片暫時無法讀取' });
          }
          const res = new Response(body, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(body.byteLength),
              'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
              'X-Content-Type-Options': 'nosniff'
            }
          });
          writeEdgeCache(ctx, cacheReq, res);
          return res;
        }

        case 'catalog': {
          const cacheReq = canonicalEdgeKeyRequest('catalog', '/api/catalog');
          const cached = await matchEdgeCache(cacheReq);
          if (cached) return cached;
          const data = await loadCatalogShared(ctx);
          let res;
          if (!data.fallbackReason) {
            let jsonStr = catalogJsonCache.get(data);
            if (jsonStr === undefined) {
              jsonStr = JSON.stringify({ data, meta: { source: data.source, fallbackReason: null } });
              catalogJsonCache.set(data, jsonStr);
            }
            res = new Response(jsonStr, {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                ...SHORT_CACHE
              }
            });
            writeEdgeCache(ctx, cacheReq, res);
          } else {
            res = jsonRes(200, { data, meta: { source: data.source, fallbackReason: data.fallbackReason } });
          }
          return res;
        }

        case 'products': {
          const cacheReq = canonicalEdgeKeyRequest('products', '/api/products');
          const cached = await matchEdgeCache(cacheReq);
          if (cached) return cached;
          try {
            const catalog = await loadProductSets(ctx);
            let res;
            if (!catalog.partial) {
              let jsonStr = productJsonCache.get(catalog);
              if (jsonStr === undefined) {
                jsonStr = JSON.stringify({ data: catalog.products, series: catalog.series, meta: productFeedMeta(catalog) });
                productJsonCache.set(catalog, jsonStr);
              }
              res = new Response(jsonStr, {
                status: 200,
                headers: {
                  'Content-Type': 'application/json; charset=utf-8',
                  ...SHORT_CACHE
                }
              });
              writeEdgeCache(ctx, cacheReq, res);
            } else {
              res = jsonRes(200, { data: catalog.products, series: catalog.series, meta: productFeedMeta(catalog) }, SHORT_CACHE);
            }
            return res;
          } catch (error) {
            console.error('products failed', error?.message || error);
            return jsonRes(502, { error: '資料暫時無法讀取' });
          }
        }

        case 'cards': {
          const requestedGame = (url.searchParams.get('game') || '').trim();
          const allowedGames = db.catalogGameIds();
          if (requestedGame && dbForGame(requestedGame) === 'ip2' && !db.secondDbConfigured()) return jsonRes(503, { error: '此遊戲資料暫時無法連線' });
          if (requestedGame && !allowedGames.has(requestedGame)) return jsonRes(400, { error: '請選擇單一卡牌遊戲' });
          const region = normalizeBrowseRegion(url.searchParams.get('region'));
          const rarity = normalizeBrowseRarity(url.searchParams.get('rarity'));
          const sort = normalizeBrowseSort(url.searchParams.get('sort'), requestedGame);
          const seriesId = (url.searchParams.get('series') || '').trim() || null;
          const limit = Math.min(Math.max(Math.floor(Number(url.searchParams.get('limit'))) || 60, 1), BROWSE_PAGE_MAX);
          const offset = Math.min(Math.max(Math.floor(Number(url.searchParams.get('offset'))) || 0, 0), 200000);
          if (region && !CATALOG_REGION_IDS.has(region)) return jsonRes(400, { error: '不支援的版本地區' });
          if (seriesId && seriesId.length > 128) return jsonRes(400, { error: '系列代碼過長' });
          if (rarity && !BROWSE_RARITY_FORMAT.test(rarity)) return jsonRes(400, { error: '稀有度格式不正確' });

          const cacheReq = canonicalEdgeKeyRequest('cards', '/api/cards', {
            game: requestedGame,
            region,
            rarity,
            sort,
            series: seriesId,
            limit,
            offset
          });
          const cached = await matchEdgeCache(cacheReq);
          if (cached) return cached;

          if (requestedGame && db.supabaseConfigured()) {
            try {
              const started = performance.now();
              const page = await browseDatabaseCards(requestedGame, { region, rarity, seriesId, sort, limit, offset });
              const priced = requestedGame === 'pokemon' ? await attachReferencePrices(page.data) : null;
              const serverTiming = Object.entries(page.timings || {})
                .map(([name, dur]) => `${name};dur=${dur}`)
                .concat(`total;dur=${Math.round(performance.now() - started)}`)
                .join(', ');
              const res = jsonRes(
                200,
                {
                  data: page.data,
                  meta: {
                    source: 'supabase-full-catalog',
                    game: requestedGame,
                    seriesId,
                    region,
                    rarity,
                    sort,
                    limit,
                    offset,
                    hasMore: page.hasMore,
                    total: page.total,
                    facets: page.facets,
                    facetStatus: page.facetStatus,
                    errors: page.errors,
                    referencePriced: page.referencePriced ?? null
                  }
                },
                { ...SHORT_CACHE, 'Server-Timing': serverTiming }
              );
              if (!priced?.referenceFailed) writeEdgeCache(ctx, cacheReq, res);
              return res;
            } catch (error) {
              if (error?.code === 'BROWSE_BUSY') return jsonRes(503, { error: '目前篩選與排序的請求較多，請稍後再試' }, { 'Retry-After': '5' });
              if (error?.code === 'BROWSE_REFUSED') return jsonRes(502, { error: '這個系列太大，無法在備援模式下載入' });
              console.error('browse failed', error?.message || error);
              return jsonRes(502, { error: '資料暫時無法讀取' });
            }
          }

          const catalog = await loadCatalogShared(ctx);
          const gameCards = requestedGame ? catalog.cards.filter(card => card.game === requestedGame) : catalog.cards;
          const printingByCard = buildPrintingIndex(gameCards.flatMap(card => (card.printings || []).map(printing => ({ ...printing, cardId: printing.cardId || card.id }))));
          const page = buildBrowsePage(gameCards, { region, rarity, seriesId, sort, limit, offset, printingByCard });
          const res = jsonRes(
            200,
            {
              data: page.data,
              meta: {
                source: catalog.source,
                game: requestedGame || null,
                seriesId,
                region,
                rarity,
                sort,
                limit,
                offset,
                hasMore: page.hasMore,
                total: page.total,
                facets: page.facets,
                facetStatus: page.facetStatus
              }
            },
            catalog.fallbackReason ? {} : SHORT_CACHE
          );
          if (!catalog.fallbackReason) writeEdgeCache(ctx, cacheReq, res);
          return res;
        }

        case 'search': {
          const rawRegion = (url.searchParams.get('region') || '').trim().toUpperCase();
          const regionParam = !rawRegion || rawRegion === 'ALL' ? 'ALL' : rawRegion;
          if (regionParam !== 'ALL' && !CATALOG_REGION_IDS.has(regionParam)) return jsonRes(400, { error: '不支援的版本地區' });
          const rawQ = (url.searchParams.get('q') || '').trim().slice(0, 100);
          const limit = Math.min(Math.max(Math.floor(Number(url.searchParams.get('limit'))) || SEARCH_RESULT_LIMIT, 1), SEARCH_PAGE_MAX);
          const offset = Math.min(Math.max(Math.floor(Number(url.searchParams.get('offset'))) || 0, 0), 200000);
          const suggestOnly = url.searchParams.get('fields') === 'suggest';
          const cacheReq = canonicalEdgeKeyRequest('search', '/api/search', {
            q: rawQ,
            region: regionParam,
            limit,
            offset,
            fields: suggestOnly ? 'suggest' : ''
          });
          const edgeHit = await matchEdgeCache(cacheReq);
          if (edgeHit) return edgeHit;

          if (!/[\p{L}\p{N}]/u.test(normalizeSearch(rawQ))) {
            return jsonRes(200, {
              data: [],
              meta: {
                source: 'symbols-only',
                architecture: 'canonical-card-with-printings',
                match: 'symbols-only',
                resultLimit: limit,
                mayHaveMore: false,
                queryTerms: [],
                total: 0,
                offset,
                limit,
                hasMore: false,
                parsed: { q: rawQ, name: rawQ, rarities: [], region: null },
                suggestion: null,
                hint: { kind: 'symbols-only', message: '請輸入卡名、卡號或系列名稱。' }
              }
            }, SHORT_CACHE);
          }

          const searchStarted = performance.now();
          const catalog = await loadCatalogShared(ctx);
          const catalogDoneAt = performance.now();
          const seriesIndex = getSeriesSearchIndex(catalog);
          const parsedQuery = parseSearchQuery(rawQ, { seriesIndex, region: regionParam });
          const region = regionParam !== 'ALL' ? regionParam : (parsedQuery.region || 'ALL');
          const rarities = parsedQuery.rarities;
          const rarityValues = rarityMatchValues(rarities);
          const rawSeries = parsedQuery.series || null;
          const hasSeriesFeature = Boolean(rawSeries && Array.isArray(rawSeries.allIds) && rawSeries.allIds.length > 0);
          const searchName = rawSeries && !hasSeriesFeature ? (rarities.length || parsedQuery.region ? `${rawSeries.label} ${parsedQuery.name}` : rawQ) : parsedQuery.name;
          let activeSeries = hasSeriesFeature ? { kind: rawSeries.kind, label: rawSeries.label, terms: rawSeries.terms } : null;
          const seriesIds = hasSeriesFeature ? (rawSeries.ids || []).slice(0, SEARCH_SERIES_IDS_MAX) : [];
          const allSeriesIds = hasSeriesFeature ? (rawSeries.allIds || []).slice(0, SEARCH_SERIES_IDS_MAX) : [];
          const buildParsed = (seriesMeta = activeSeries) => ({
            q: rawQ,
            name: searchName,
            rarities,
            region: regionParam !== 'ALL' ? null : parsedQuery.region,
            ...(parsedQuery.rarityOnly ? { rarityOnly: true } : {}),
            ...(seriesMeta ? { series: seriesMeta } : {})
          });
          let parsed = buildParsed();
          const slimBody = body => (suggestOnly ? suggestBody(body, region) : body);
          const seriesCacheKey = hasSeriesFeature ? `${rawSeries.label}:${seriesIds.join(',')}` : '';
          const searchCacheKey = [regionParam, rawQ, searchName, rarities.join(','), parsed.region || '', seriesCacheKey, offset, limit].join('|');
          const cachedSearch = recallSearch(searchCacheKey);
          if (cachedSearch) {
            return jsonRes(200, slimBody(cachedSearch), { ...SHORT_CACHE, 'Server-Timing': 'cache;desc="hit", total;dur=0' });
          }

          const budget = createSearchBudget();

          if (parsedQuery.rarityOnly) {
            let example = rarityOnlyExample(rarities);
            if (example) {
              const check = parseSearchQuery(example);
              try {
                if (!db.supabaseConfigured() || !(await searchCatalogDatabase(check.name, 'ALL', 1, { rarities: check.rarities, budget })).cards.length) example = null;
              } catch {
                example = null;
              }
            }
            const body = {
              data: [],
              meta: {
                source: 'rarity-only',
                architecture: 'canonical-card-with-printings',
                match: 'rarity-only',
                resultLimit: limit,
                mayHaveMore: false,
                queryTerms: [],
                total: 0,
                offset,
                limit,
                hasMore: false,
                parsed,
                suggestion: example ? { q: example, reason: '稀有度請搭配卡名一起搜' } : null,
                hint: { kind: 'rarity-only', message: '只輸入稀有度無法判斷是哪一張卡，請加上卡名' + (example ? `，例如「${example}」` : '') + '。' }
              }
            };
            rememberSearch(searchCacheKey, body);
            const res = jsonRes(200, body, SHORT_CACHE);
            writeEdgeCache(ctx, cacheReq, res);
            return res;
          }

          if (!/[\p{L}\p{N}]/u.test(normalizeSearch(searchName))) {
            return jsonRes(200, {
              data: [],
              meta: {
                source: 'symbols-only',
                architecture: 'canonical-card-with-printings',
                match: 'symbols-only',
                resultLimit: limit,
                mayHaveMore: false,
                queryTerms: [],
                total: 0,
                offset,
                limit,
                hasMore: false,
                parsed,
                suggestion: null,
                hint: { kind: 'symbols-only', message: '請輸入卡名、卡號或系列名稱。' }
              }
            }, SHORT_CACHE);
          }

          const q = normalizeSearch(searchName);
          const emptyScopedDb = { cards: [], candidateCount: 0, candidateLimit: SEARCH_CANDIDATE_LIMIT, resultLimit: limit, mayHaveMore: false, searched: true, matchedSeries: 0, timings: {}, total: 0, paged: true };
          const databasePending = db.supabaseConfigured()
            ? (hasSeriesFeature && !seriesIds.length
                ? Promise.resolve({ value: emptyScopedDb, doneAt: performance.now() })
                : searchCatalogDatabase(searchName, region, limit, { offset, rarities, seriesIds, budget }).then(value => ({ value, doneAt: performance.now() }), error => ({ error })))
            : null;

          const localNeedles = searchQueryTerms(searchName).map(normalizeSearch).filter(Boolean);
          const localSeriesSet = hasSeriesFeature ? new Set(seriesIds) : null;
          const cardEntries = getLocalCardSearchEntries(catalog);
          const foundEntries = cardEntries.filter(entry => {
            if (region !== 'ALL' && !entry.regionSet.has(region)) return false;
            if (localSeriesSet) {
              const inSeries = localSeriesSet.has(entry.card.seriesId)
                || entry.normPrintings.some(p => localSeriesSet.has(p.seriesId) && (region === 'ALL' || p.region === region));
              if (!inSeries) return false;
              if (!localNeedles.length) return true;
              if (entry.normNames.some(nv => localNeedles.some(n => nv.includes(n)))) return true;
              if (entry.normOfficialNum && localNeedles.some(n => entry.normOfficialNum.includes(n))) return true;
              return entry.normPrintings.some(p => localSeriesSet.has(p.seriesId) && (region === 'ALL' || p.region === region) && p.normCardNumber && localNeedles.some(n => p.normCardNumber.includes(n)));
            }
            return !q || entry.allValues.some(nv => nv.includes(q));
          });
          const found = foundEntries.map(entry => entry.card);
          const exact = q
            ? foundEntries.filter(entry => entry.normNames.some(nv => nv === q || (localSeriesSet && localNeedles.includes(nv)))).map(entry => entry.card)
            : [];
          const narrowing = rarityValues.length > 0 || (regionParam === 'ALL' && Boolean(parsedQuery.region)) || Boolean(localSeriesSet);
          const narrowLocal = list => narrowing ? list.map(c => ({ ...c, printings: (c.printings || []).filter(p => (region === 'ALL' || p.region === region) && printingMatchesRarity(p, rarityValues) && (!localSeriesSet || localSeriesSet.has(p.seriesId))) })).filter(c => c.printings.length) : list;
          const withRank = list => list.map(c => (c.matchRank === undefined ? { ...c, matchRank: cardMatchRank(c, localNeedles) } : c));
          const pageLocal = list => { const items = narrowLocal(list); return { data: withRank(items.slice(offset, offset + limit)), total: items.length }; };
          const gameHint = gameHintFor(searchName);
          const withPaging = (meta, data, total, suggestion = null) => {
            const hasMore = offset + data.length < total;
            const seriesTerms = activeSeries?.terms?.length ? activeSeries.terms : null;
            return {
              data,
              meta: {
                ...meta,
                resultLimit: limit,
                mayHaveMore: hasMore,
                queryTerms: searchQueryTerms(searchName),
                total,
                offset,
                limit,
                hasMore,
                parsed,
                suggestion,
                ...(seriesTerms ? { seriesTerms } : {}),
                ...(gameHint ? { gameHint: gameHint.gameId, franchiseHint: gameHint.franchiseId } : {})
              }
            };
          };
          const settle = dbRes => {
            if (dbRes.cards.length > 0 && dbRes.paged) return { data: dbRes.cards, total: dbRes.total };
            if (dbRes.paged && dbRes.total > 0) return { data: [], total: dbRes.total };
            if (dbRes.cards.length > 0) {
              const merged = offset ? dbRes.cards : narrowLocal(canonicalizeCatalog({ ...catalog, cards: [...exact, ...dbRes.cards] }).cards);
              return { data: withRank(merged.slice(0, limit)), total: Math.max(dbRes.total || 0, offset + merged.length) };
            }
            const page = pageLocal(exact.length ? exact : found);
            return { data: page.data, total: page.total };
          };

          if (!db.supabaseConfigured()) {
            const page = pageLocal(exact.length ? exact : found);
            return jsonRes(200, slimBody(withPaging({ source: catalog.source, architecture: 'canonical-card-with-printings', match: exact.length ? 'exact-name' : 'substring' }, page.data, page.total)));
          }

          try {
            const settled = await databasePending;
            if (settled.error) throw settled.error;
            let database = settled.value;
            let hasDatabaseMatches = database.cards.length > 0;
            let { data, total } = settle(database);
            let matchedAs = null;
            let retryMs = 0;

            if (total === 0 && (!hasSeriesFeature || seriesIds.length > 0) && !budget.exhausted()) {
              const retryStarted = performance.now();
              const spans = await foldedNameSpans(searchName, budget);
              if (spans.length && !budget.exhausted()) {
                try {
                  const again = await searchCatalogDatabase(spans, region, limit, { offset, rarities, seriesIds, budget });
                  if (again.cards.length) { database = again; hasDatabaseMatches = true; ({ data, total } = settle(again)); matchedAs = spans; }
                } catch (error) {
                  console.error('search fold retry failed', error?.message || error);
                }
              }
              retryMs = performance.now() - retryStarted;
            }

            if (total === 0 && hasSeriesFeature && rawQ && rawQ !== searchName && !budget.exhausted()) {
              const retryStarted = performance.now();
              try {
                const rawAgain = await searchCatalogDatabase(rawQ, region, limit, { offset, rarities, budget });
                if (rawAgain.cards.length) { database = rawAgain; hasDatabaseMatches = true; activeSeries = null; parsed = buildParsed(null); ({ data, total } = settle(rawAgain)); }
              } catch (error) {
                console.error('search raw fallback failed', error?.message || error);
              }
              retryMs += performance.now() - retryStarted;
            }

            const timing = Object.entries({ catalog: catalogDoneAt - searchStarted, db: settled.doneAt - searchStarted, ...database.timings, ...(retryMs ? { retry: retryMs } : {}), total: performance.now() - searchStarted })
              .map(([name, ms]) => `${name};dur=${Math.round(ms)}`).join(', ');
            let suggestion = null;
            let otherRegion = null;
            if (total === 0 && regionParam !== 'ALL' && !budget.exhausted()) {
              try {
                const all = await searchCatalogDatabase(searchName, 'ALL', 1, { rarities, seriesIds: hasSeriesFeature ? allSeriesIds : [], budget });
                const hit = all.cards[0];
                const other = hit && (hit.region !== region ? hit.region : hit.printings?.find(p => p.region && p.region !== region)?.region);
                if (other) otherRegion = { region: other };
              } catch (error) {
                console.error('search region hint failed', error?.message || error);
              }
            }
            if (total === 0 && (hasSeriesFeature || rarities.length || parsed.region)) {
              if (!budget.exhausted()) {
                try {
                  const nameOnly = await searchCatalogDatabase(searchName, regionParam, 1, { budget });
                  if (nameOnly.cards.length) suggestion = { q: searchName, reason: hasSeriesFeature ? 'name-only-series' : 'name-only' };
                } catch (error) {
                  console.error('search suggestion failed', error?.message || error);
                }
              }
            } else if (total === 0 && !budget.exhausted()) {
              const trimmed = searchName.replace(/\s+[A-Za-z]$/, '');
              if (trimmed && trimmed !== searchName) {
                try {
                  const base = await searchCatalogDatabase(trimmed, regionParam, 1, { budget });
                  if (base.cards.length) suggestion = { q: trimmed, reason: '去掉結尾的單一字母' };
                } catch (error) {
                  console.error('search suggestion failed', error?.message || error);
                }
              }
            }
            if (total === 0 && !suggestion && !gameHint && !otherRegion && !budget.exhausted()) suggestion = await suggestCardName(searchName, region, budget);

            const searchBody = withPaging({
              ...(matchedAs ? { matchedAs } : {}),
              ...(otherRegion ? { otherRegion } : {}),
              source: hasDatabaseMatches ? 'supabase-search' : catalog.source,
              architecture: 'canonical-card-with-printings',
              match: hasDatabaseMatches
                ? (database.matchedSeries ? 'database-series' : activeSeries ? 'database-series+name' : exact.length ? 'exact-name+database-substring' : 'database-substring')
                : (exact.length ? 'exact-name' : 'substring'),
              databaseSearch: database.searched ? 'available' : 'skipped',
              searchScope: hasDatabaseMatches ? 'bounded-database-query' : 'loaded-catalog-only',
              candidateCount: database.candidateCount,
              candidateLimit: database.candidateLimit
            }, data, total, suggestion);
            rememberSearch(searchCacheKey, searchBody);
            const res = jsonRes(200, slimBody(searchBody), { ...SHORT_CACHE, 'Server-Timing': timing });
            writeEdgeCache(ctx, cacheReq, res);
            return res;
          } catch (error) {
            console.error('catalog search failed', error?.message || error);
            const page = pageLocal(exact.length ? exact : found);
            return jsonRes(200, slimBody(withPaging({
              source: catalog.source,
              architecture: 'canonical-card-with-printings',
              match: exact.length ? 'exact-name' : 'substring',
              databaseSearch: 'unavailable',
              searchScope: 'loaded-catalog-only'
            }, page.data, page.total)));
          }
        }

        case 'card-price-history': {
          let tail;
          try {
            tail = decodeURIComponent(url.pathname.slice(11));
          } catch {
            return jsonRes(400, { error: '網址格式錯誤' });
          }
          const id = tail.slice(0, -14);
          if (!validCardId(id)) return jsonRes(400, { error: '卡片 ID 格式不正確' });
          const cacheReq = canonicalEdgeKeyRequest('price-history', `/api/cards/${encodeURIComponent(id)}/price-history`);
          const cached = await matchEdgeCache(cacheReq, 'no-store');
          if (cached) return cached;
          const result = await priceHistoryResponse(id);
          const res = jsonRes(result.status, result.body);
          if (
            result.status === 200 &&
            db.supabaseConfigured() &&
            !result.body?.meta?.archiveUnavailable &&
            !result.body?.meta?.unavailable
          ) {
            writeEdgeCache(ctx, cacheReq, res, 'public, max-age=3600');
          }
          return res;
        }

        case 'graded-prices': {
          try {
            const data = await lookupGradedPrices(
              {
                tcgPlayerId: url.searchParams.get('tcgPlayerId'),
                set: url.searchParams.get('set'),
                number: url.searchParams.get('number')
              },
              ctx
            );
            return jsonRes(200, { data });
          } catch (error) {
            console.error('graded prices failed', error?.message || error);
            return jsonRes(502, { error: '資料暫時無法讀取' });
          }
        }

        case 'ebay-listings': {
          const input = {
            name: url.searchParams.get('name') || '',
            set: url.searchParams.get('set') || '',
            number: url.searchParams.get('number') || ''
          };
          const query = ebayQuery(input);
          if (!query) return jsonRes(400, { error: '參數無效' });
          const clientId = String(currentEnv?.EBAY_CLIENT_ID || '').trim();
          const clientSecret = String(currentEnv?.EBAY_CLIENT_SECRET || '').trim();
          if (!clientId || !clientSecret) {
            return jsonRes(200, { data: { status: 'not-configured', enabled: false, limited: false, items: [] } });
          }
          const cacheReq = canonicalEdgeKeyRequest('ebay-listings', '/api/ebay-listings', { q: query.key });
          const cached = await matchEdgeCache(cacheReq, 'no-store');
          if (cached) return cached;
          try {
            const data = await lookupEbayListings(input, ctx);
            const res = jsonRes(200, { data });
            if (data.status === 'ok' || data.status === 'no-match') {
              writeEdgeCache(ctx, cacheReq, res, 'public, max-age=3600');
            }
            return res;
          } catch (error) {
            console.error('ebay listings failed', error?.message || error);
            return jsonRes(502, { error: '資料暫時無法讀取' });
          }
        }

        case 'catalog-image-status': {
          if (!db.supabaseConfigured()) return jsonRes(502, { error: '資料暫時無法讀取' });
          const cacheReq = canonicalEdgeKeyRequest('image-status', '/api/catalog/image-status');
          const cached = await matchEdgeCache(cacheReq, 'no-store');
          if (cached) return cached;
          try {
            const data = await cachedBrowseRows(
              'catalog-image-status',
              async () => {
                const [cards, cachedRows] = await Promise.all([
                  db.fetchAll('/tcg_cards?select=id&source=eq.ygoprodeck', 1000, { db: 'main', maxPages: 20 }),
                  db.fetchAll(`/card_images?select=card_id&source=eq.${YUGIOH_CACHE_SOURCE}`, 1000, { db: 'main', maxPages: 20 })
                ]);
                const total = (cards || []).length;
                const cachedCount = (cachedRows || []).length;
                return { total, cached: cachedCount, missing: Math.max(0, total - cachedCount) };
              },
              10 * 60 * 1000
            );
            const res = jsonRes(200, { data });
            writeEdgeCache(ctx, cacheReq, res, 'public, max-age=600');
            return res;
          } catch (error) {
            console.error('image status failed', error?.message || error);
            return jsonRes(502, { error: '資料暫時無法讀取' });
          }
        }

        case 'card-market': {
          let tail;
          try {
            tail = decodeURIComponent(url.pathname.slice(11));
          } catch {
            return jsonRes(400, { error: '網址格式錯誤' });
          }
          const id = tail.slice(0, -7);
          if (!validCardId(id)) return jsonRes(400, { error: '卡片 ID 格式不正確' });
          const cacheReq = canonicalEdgeKeyRequest('market', `/api/cards/${encodeURIComponent(id)}/market`);
          const cached = await matchEdgeCache(cacheReq, 'no-store');
          if (cached) return cached;
          const { card } = await getCard(id);
          if (!card) return jsonRes(404, { error: '找不到這張卡' });
          const market = await unifiedMarketCached(card);
          const allOk = market.sources.every(source => source.status === 'ok');
          const fxCacheable = marketFxCacheable.get(market) !== false;
          const res = jsonRes(200, { data: market });
          if (allOk && fxCacheable) writeEdgeCache(ctx, cacheReq, res, 'public, max-age=300');
          return res;
        }

        case 'card-detail': {
          let tail;
          try {
            tail = decodeURIComponent(url.pathname.slice(11));
          } catch {
            return jsonRes(400, { error: '網址格式錯誤' });
          }
          if (!validCardId(tail)) return jsonRes(400, { error: '卡片 ID 格式不正確' });
          const cacheReq = canonicalEdgeKeyRequest('card-detail', `/api/cards/${encodeURIComponent(tail)}`);
          const cached = await matchEdgeCache(cacheReq);
          if (cached) { recordCardOpen(request, url, tail, ctx); return cached; } // 快取裡有就代表這張卡存在
          const { catalog, card } = await getCard(tail);
          if (!card) return jsonRes(404, { error: '找不到這張卡' });
          recordCardOpen(request, url, card.id, ctx);
          const series = catalog.series.find(s => s.id === card.seriesId) || null;
          const game = catalog.games.find(g => g.id === card.game) || null;
          const data = { ...card, series, game };
          const priced = card.game === 'pokemon' ? await attachReferencePrices([data]) : null;
          if (priced?.referenceFailed) data.referencePriceFailed = true;
          const cacheable = !catalog.fallbackReason && !priced?.referenceFailed;
          const res = jsonRes(
            200,
            { data, meta: { source: catalog.source, imagePolicy: '優先使用已保存或來源允許的圖片；不長期 hotlink YGOPRODeck 圖片。' } },
            cacheable ? SHORT_CACHE : {}
          );
          if (cacheable) writeEdgeCache(ctx, cacheReq, res);
          return res;
        }

        case 'exchange-rates': {
          const cacheReq = canonicalEdgeKeyRequest('fx', '/api/exchange-rates');
          const cached = await matchEdgeCache(cacheReq, 'no-store');
          if (cached) return cached;
          const { data, cacheable } = await getTwdRates();
          const res = jsonRes(200, { data });
          if (cacheable) writeEdgeCache(ctx, cacheReq, res, 'public, max-age=3600');
          return res;
        }

        case 'hot-cards': {
          if (!db.supabaseConfigured()) return jsonRes(200, { data: [], meta: { unavailable: 'not-configured' } });
          const cacheReq = canonicalEdgeKeyRequest('hot', '/api/hot-cards');
          const cached = await matchEdgeCache(cacheReq);
          if (cached) return cached;
          try {
            const snapshot = await loadHotCards(ctx);
            const res = jsonRes(200, snapshot.data, SHORT_CACHE);
            if (!snapshot.cache?.stale) writeEdgeCache(ctx, cacheReq, res);
            return res;
          } catch (error) {
            console.error('hot cards failed', error?.message || error);
            return jsonRes(502, { error: '資料暫時無法讀取' });
          }
        }

        case 'market-events': {
          if (!db.supabaseConfigured()) return jsonRes(200, { data: [], meta: { unavailable: 'not-configured' } });
          const game = url.searchParams.get('game') || null;
          const validGame = !game || db.catalogGameIds().has(game);
          const cacheReq = canonicalEdgeKeyRequest('events', '/api/market-events', { game });
          if (validGame) {
            const cached = await matchEdgeCache(cacheReq);
            if (cached) return cached;
          }
          const { payload, degraded } = await marketEventsResult(game);
          const res = jsonRes(200, payload, SHORT_CACHE);
          if (!degraded && validGame) writeEdgeCache(ctx, cacheReq, res);
          return res;
        }

        case 'price-movers': {
          if (!db.supabaseConfigured()) return jsonRes(200, { data: { up: [], down: [] }, meta: { unavailable: 'not-configured' } });
          const cacheReq = canonicalEdgeKeyRequest('movers', '/api/price-movers');
          const cached = await matchEdgeCache(cacheReq);
          if (cached) return cached;
          try {
            const snapshot = await loadPriceMovers(ctx);
            const res = jsonRes(200, snapshot.data, SHORT_CACHE);
            if (!snapshot.cache?.stale) writeEdgeCache(ctx, cacheReq, res);
            return res;
          } catch (error) {
            console.error('price movers failed', error?.message || error);
            return jsonRes(502, { error: '資料暫時無法讀取' });
          }
        }

        case 'prices-reference': {
          let body;
          try {
            body = await readJsonBodyBounded(request, REFERENCE_BODY_MAX_BYTES);
          } catch (error) {
            return jsonRes(error.message === 'BODY_TOO_LARGE' ? 413 : 400, {
              error: error.message === 'BODY_TOO_LARGE' ? '請求內容過大' : 'JSON 格式錯誤'
            });
          }
          const v = validateReferenceRequest(body);
          if (v.error) return jsonRes(400, { error: v.error });
          if (!db.supabaseConfigured()) return jsonRes(503, { error: '尚未設定資料庫' });
          try {
            const [rows, fxResult] = await Promise.all([
              db.fetchJson(`/price_snapshots?${new URLSearchParams(referenceQueryParams(v.ids))}`, { db: 'main' }),
              getTwdRates()
            ]);
            return jsonRes(200, { data: buildReferencePrices(rows, v.ids, { fx: fxResult.data, amountToTwd, now: now() }) });
          } catch {
            return jsonRes(502, { error: '參考價查詢失敗' });
          }
        }

        case 'reports-meta':
          return jsonRes(200, { data: { platforms: ALLOWED_PLATFORMS, currencies: ALLOWED_CURRENCIES, maxPrice: MAX_PRICE } });

        case 'reports': {
          const cardId = (url.searchParams.get('cardId') || '').trim();
          const cardName = (url.searchParams.get('cardName') || '').trim();
          const game = (url.searchParams.get('game') || '').trim();
          const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('limit'))) || 20));
          if (!cardId && !cardName) return jsonRes(400, { error: '請提供 cardId 或 cardName' });
          if (cardId && (cardId.length > 128 || /[\u0000-\u001f\u007f]/.test(cardId))) return jsonRes(400, { error: 'cardId 格式不正確' });
          if (cardName && (cardName.length > 100 || /[\u0000-\u001f\u007f]/.test(cardName))) return jsonRes(400, { error: 'cardName 長度或格式不正確' });
          if (game && !db.catalogGameIds().has(game)) return jsonRes(400, { error: '不支援的卡牌遊戲' });
          if (!db.supabaseConfigured()) {
            return jsonRes(200, { data: { reports: [], stats: [], total: 0 }, meta: { status: 'unavailable', reason: '尚未設定使用者回報資料庫' } });
          }
          const base = new URLSearchParams();
          if (cardId) base.set('card_id', `eq.${cardId}`);
          else base.set('card_name', `ilike.*${cardName.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '_')}*`);
          if (game) base.set('game', `eq.${game}`);
          try {
            const statsParams = new URLSearchParams(base);
            statsParams.set('select', 'currency,price');
            statsParams.set('limit', '1000');
            const recentParams = new URLSearchParams(base);
            recentParams.set('select', PUBLIC_REPORT_SELECT);
            recentParams.set('order', 'traded_at.desc');
            recentParams.set('limit', String(limit));
            const [all, recent] = await Promise.all([
              db.fetchJson(`/reports?${statsParams}`, { db: 'main' }),
              db.fetchJson(`/reports?${recentParams}`, { db: 'main' })
            ]);
            const allRows = Array.isArray(all) ? all : [];
            const recentRows = Array.isArray(recent) ? recent : [];
            return jsonRes(200, { data: { reports: recentRows, stats: buildStats(allRows), total: allRows.length } });
          } catch {
            return jsonRes(502, { error: '資料庫查詢失敗' });
          }
        }

        case 'auth-config':
          return jsonRes(200, { data: { url: authSync.configUrl(), googleClientId: authSync.googleClientId() } });

        case 'auth-exchange':
        case 'auth-refresh':
        case 'auth-logout': {
          const action = apiKey.slice(5);
          const result = await authSync.handleAuth({
            action,
            authorizationHeader: request.headers.get('authorization'),
            readBody: maxBytes => readJsonBodyBounded(request, maxBytes)
          });
          if (result.status === 204) {
            return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
          }
          return jsonRes(result.status, result.body, result.headers || {});
        }

        case 'sync-pull':
        case 'sync-push':
        case 'sync-delete': {
          const action = apiKey.slice(5);
          const result = await authSync.handleSync({
            action,
            authorizationHeader: request.headers.has('authorization') ? request.headers.get('authorization') : undefined,
            contentLengthHeader: request.headers.get('content-length'),
            readBody: maxBytes => readJsonBodyBounded(request, maxBytes)
          });
          return jsonRes(result.status, result.body, result.headers || {});
        }

        case 'pack-prizes': {
          const cacheReq = canonicalEdgeKeyRequest('pack-prizes', '/api/pack-prizes');
          const cached = await matchEdgeCache(cacheReq);
          if (cached) return cached;
          const kvValue = normalizeKvPackPrizes(await readKvRaw(currentEnv, KV_KEYS.packPrizes));
          if (kvValue) {
            const res = jsonRes(200, kvValue, SHORT_CACHE);
            writeEdgeCache(ctx, cacheReq, res);
            return res;
          }
          return jsonRes(200, buildFallbackPackPrizes(now()), SHORT_CACHE);
        }

        case 'series-hits': {
          const cacheReq = canonicalEdgeKeyRequest('series-hits', '/api/series-hits');
          const cached = await matchEdgeCache(cacheReq);
          if (cached) return cached;
          const kvValue = normalizeKvSeriesHits(await readKvRaw(currentEnv, KV_KEYS.seriesHits));
          if (kvValue) {
            const res = jsonRes(200, kvValue, SHORT_CACHE);
            writeEdgeCache(ctx, cacheReq, res);
            return res;
          }
          return jsonRes(200, await buildFallbackSeriesHits(now()), SHORT_CACHE);
        }

        case 'catalog-coverage': {
          const cacheReq = canonicalEdgeKeyRequest('catalog-coverage', '/api/catalog/coverage');
          const cached = await matchEdgeCache(cacheReq);
          if (cached) return cached;
          const kvValue = normalizeKvCatalogCoverage(await readKvRaw(currentEnv, KV_KEYS.catalogCoverage), {
            nowMs: now(),
            ttlMs: COVERAGE_TTL_MS,
            maxStaleMs: SNAPSHOT_MAX_STALE_MS
          });
          if (kvValue) {
            const res = jsonRes(200, kvValue, SHORT_CACHE);
            if (!kvValue.data.cache?.stale) writeEdgeCache(ctx, cacheReq, res);
            return res;
          }
          const fallback = await catalogCoverageFallbackCache.get(
            async () => buildFallbackCatalogCoverage(getFallbackCatalogCopy(), {}, now()),
            { waitUntil: p => ctx?.waitUntil?.(p) }
          );
          return jsonRes(200, { data: { ...fallback.data, cache: fallback.cache } }, SHORT_CACHE);
        }

        default:
          return jsonRes(404, { error: 'Not found' });
      }
    } catch (error) {
      console.error('worker api error', apiKey, error?.message || error);
      return jsonRes(500, { error: '伺服器暫時發生錯誤' });
    }
  }

  // ---- 頁面開啟數與最熱卡（page_stats_add／card_hot_add）----
  // Render 時代在記憶體累積、每 10 分鐘寫一次；Worker 的 isolate 隨時會被回收，改成同一個 isolate 最多每 10 秒寫一次（中間的開啟數合併進下一筆）。
  // 平常流量小，幾乎每次開啟都直接寫；被大量請求時寫入次數有上限。只送頁面種類或卡號與次數，不存 IP、UA、查詢字串（與 providers/page-stats.mjs 同規則）。
  // shortcut: isolate 在兩次寫入之間被回收時，那 10 秒內合併的次數會遺失；統計本來就是概數。
  const STATS_FLUSH_MS = 10_000;
  const statsBuffers = { page_stats_add: { counts: {}, at: 0 }, card_hot_add: { counts: {}, at: 0 } };
  function bumpStats(rpc, counts, ctx) {
    if (!db.supabaseConfigured() || typeof ctx?.waitUntil !== 'function') return;
    const buffer = statsBuffers[rpc], day = taipeiDay(now());
    if (buffer.day && buffer.day !== day) buffer.counts = {}; // 換日：前一天沒寫出去的少量次數不跨日寫錯天
    buffer.day = day;
    for (const [key, n] of Object.entries(counts)) if (key in buffer.counts || Object.keys(buffer.counts).length < 200) buffer.counts[key] = (buffer.counts[key] || 0) + n;
    if (now() - buffer.at < STATS_FLUSH_MS) return;
    const sent = buffer.counts;
    buffer.counts = {}; buffer.at = now();
    ctx.waitUntil(db.fetchJson(`/rpc/${rpc}`, { db: 'main', method: 'POST', body: JSON.stringify({ p_day: day, p_counts: sent }), timeoutMs: 10000 })
      .catch(error => console.warn('stats write failed', rpc, error?.message || error)));
  }
  // 瀏覽器開頁的 Sec-Fetch-Dest 是 document；service worker 預載與 fetch() 不算開頁。
  function recordPageOpen(request, url, ctx) {
    const dest = request.headers.get('sec-fetch-dest');
    if (request.method !== 'GET' || (dest && dest !== 'document')) return;
    bumpStats('page_stats_add', { [isBot(request.headers.get('user-agent')) ? 'bot' : pageKind(url.searchParams)]: 1 }, ctx);
  }
  function recordCardOpen(request, url, cardId, ctx) {
    if (url.searchParams.get('open') !== '1' || isBot(request.headers.get('user-agent')) || !CARD_ID_PATTERN.test(String(cardId || ''))) return;
    bumpStats('card_hot_add', { [cardId]: 1 }, ctx);
  }

  return { handle, handleSitemap, loadSeo, recordPageOpen };
}
