// 首頁統計、收錄覆蓋率（pack-prizes、series-hits、catalog/coverage）與 Sitemap 的 Workers KV 快照鍵名、無資料降級格式、預產運算與 Cloudflare KV API 讀寫器。
// 零 node:*、零 Buffer、零 AsyncLocalStorage，可同時由 Worker（唯讀 KV + 降級）與 Node CLI 預產腳本匯入。
import packPrizesConfig from '../data/pack-prizes.json' with { type: 'json' };
import {
  PACK_PRIZE_GAMES,
  PACK_PRIZE_LIMIT,
  PACK_PRIZE_WINDOW_DAYS,
  SERIES_HIT_FETCH,
  SERIES_HIT_PER_GAME,
  bandSeries,
  buildSeriesHits,
  mergePrizeRows,
  pickSeriesHits,
  prizeCards,
  prizeRow,
  prizeSeriesCandidates
} from './pack-prizes.mjs';
import {
  SITEMAP_MAX_URLS,
  cardSitemapEntries,
  chunkEntries,
  mergeCardSitemapRows,
  normalizeBaseUrl,
  pageSitemapEntries,
  renderSitemapIndex,
  renderUrlSet,
  seriesSitemapEntries
} from './seo.mjs';
import { createSupabaseClient, dbForGame, dbForId } from './supabase-client.mjs';
import {
  BROWSE_CARD_SELECT,
  BROWSE_IMAGE_SELECT,
  BROWSE_PAGE_MAX,
  BROWSE_PRINTING_SELECT,
  CATALOG_GAMES_PATH,
  CATALOG_SERIES_PATH,
  UPSTREAM_ERROR,
  accumulateCoverage,
  adjustCoverageGame,
  attachCatalogBaselines,
  browseHasUsableImage,
  buildBrowsePage,
  buildFallbackCatalogCoverage,
  buildPrintingIndex,
  canonicalizeCatalog,
  cardImageFields,
  catalogBaselineReport,
  coverageFreshness,
  coverageIso,
  createCoverageAccumulator,
  finishCoverage,
  getFallbackCatalogCopy,
  mergeCatalogRows,
  referenceChange,
  referencePriceFromRow,
  uniqueValues,
  withTimeout
} from './catalog-core.mjs';

export const KV_KEYS = Object.freeze({
  packPrizes: 'snapshot:pack-prizes:v1',
  seriesHits: 'snapshot:series-hits:v1',
  catalogCoverage: 'snapshot:catalog-coverage:v1',
  sitemapIndex: 'snapshot:sitemap-index:v1',
  sitemapSeries: 'snapshot:sitemap-series:v1',
  sitemapCardsPrefix: 'snapshot:sitemap-cards:v1:',
  gradedCachePrefix: 'graded:cache:v1:',
  gradedQuota: 'graded:quota:v1',
  ebayToken: 'ebay:token:v1',
  ebayQuota: 'ebay:quota:v1'
});

export function sitemapCardsKvKey(index) {
  return `${KV_KEYS.sitemapCardsPrefix}${index}`;
}

export const PACK_PRIZE_PINNED = Object.freeze(
  Array.isArray(packPrizesConfig?.pinned) ? packPrizesConfig.pinned.filter(id => typeof id === 'string' && id) : []
);

const DEFAULT_COVERAGE_CARD_CHUNK = 400;
const DEFAULT_RELATION_SCAN_PAGE_SIZE = 500;
const DEFAULT_SITEMAP_PAGE_SIZE = 1000;
const DEFAULT_COVERAGE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_COVERAGE_MAX_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * 計算 KV 無資料（或尚未設定 DB）時的 /api/pack-prizes 降級回應，與 server.mjs 無資料庫行為完全一致。
 */
export function buildFallbackPackPrizes(nowMs = Date.now()) {
  const catalog = canonicalizeCatalog({ ...getFallbackCatalogCopy(), source: 'catalog.json' });
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const seriesById = new Map((catalog.series || []).map(s => [s.id, s]));
  const games = [];
  for (const rule of PACK_PRIZE_GAMES) {
    const gameCards = catalog.cards.filter(card => card.game === rule.game);
    const printingByCard = buildPrintingIndex(
      gameCards.flatMap(card => (card.printings || []).map(printing => ({ ...printing, cardId: printing.cardId || card.id })))
    );
    for (const release of prizeSeriesCandidates(catalog.series, rule, today).slice(0, 3)) {
      const versions = [];
      for (const series of release) {
        const cards = buildBrowsePage(gameCards, {
          region: series.region,
          seriesId: series.id,
          sort: 'rarity-desc',
          limit: BROWSE_PAGE_MAX,
          offset: 0,
          printingByCard
        }).data;
        versions.push({
          region: series.region,
          rows: prizeCards(rule.game, rule.top, cards, { seriesId: series.id, limit: BROWSE_PAGE_MAX }).map(card => prizeRow(card, series))
        });
      }
      const data = mergePrizeRows(rule.game, versions);
      if (data.length < 3) continue;
      const [series] = release;
      games.push({
        game: rule.game,
        seriesId: series.id,
        region: series.region,
        seriesName: series.nameZh || series.nameJa || series.nameEn || series.officialCode,
        releaseDate: series.releaseDate,
        data
      });
      break;
    }
  }
  const pinnedCards = [];
  for (const id of PACK_PRIZE_PINNED) {
    const match = catalog.cards.find(c => c.id === id)
      || catalog.cards.find(c => c.physicalCardIds?.includes(id) || c.printings?.some(p => p.cardId === id || p.id === id));
    if (match) pinnedCards.push(match);
  }
  const pinned = pinnedCards.map(card => {
    const seriesId = card.seriesId || card.printings?.[0]?.seriesId;
    return prizeRow(card, seriesById.get(seriesId));
  });
  return {
    pinned,
    games,
    meta: {
      windowDays: PACK_PRIZE_WINDOW_DAYS,
      limit: PACK_PRIZE_LIMIT,
      generatedAt: new Date(nowMs).toISOString()
    }
  };
}

/**
 * 計算 KV 無資料（或尚未設定 DB）時的 /api/series-hits 降級回應，與 server.mjs 無資料庫行為完全一致。
 */
export async function buildFallbackSeriesHits(nowMs = Date.now()) {
  const catalog = canonicalizeCatalog({ ...getFallbackCatalogCopy(), source: 'catalog.json' });
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const sets = await buildSeriesHits({
    series: catalog.series,
    today,
    fetchCards: async series => {
      const cards = catalog.cards.filter(card => card.game === series.game);
      const printingByCard = buildPrintingIndex(
        cards.flatMap(card => (card.printings || []).map(printing => ({ ...printing, cardId: printing.cardId || card.id })))
      );
      return buildBrowsePage(cards, {
        region: series.region,
        seriesId: series.id,
        sort: 'rarity-desc',
        limit: SERIES_HIT_FETCH,
        offset: 0,
        printingByCard
      }).data;
    }
  });
  return {
    data: {
      sets,
      meta: {
        perGame: SERIES_HIT_PER_GAME,
        generatedAt: new Date(nowMs).toISOString()
      }
    }
  };
}

/**
 * 正規化從 KV 讀出的 pack-prizes JSON；若格式不合法回傳 null。
 */
export function normalizeKvPackPrizes(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const candidate = parsed.data && typeof parsed.data === 'object' && Array.isArray(parsed.data.games) ? parsed.data : parsed;
  if (!Array.isArray(candidate.pinned) || !Array.isArray(candidate.games)) return null;
  const meta = {
    windowDays: Number(candidate.meta?.windowDays) || PACK_PRIZE_WINDOW_DAYS,
    limit: Number(candidate.meta?.limit) || PACK_PRIZE_LIMIT,
    generatedAt: typeof candidate.meta?.generatedAt === 'string' ? candidate.meta.generatedAt : new Date().toISOString()
  };
  if (candidate.meta?.partial) meta.partial = true;
  if (Array.isArray(candidate.meta?.missingGames) && candidate.meta.missingGames.length) meta.missingGames = candidate.meta.missingGames;
  if (Array.isArray(candidate.meta?.staleGames) && candidate.meta.staleGames.length) meta.staleGames = candidate.meta.staleGames;
  return {
    pinned: candidate.pinned,
    games: candidate.games,
    meta
  };
}

/**
 * 正規化從 KV 讀出的 series-hits JSON；若格式不合法回傳 null。
 */
export function normalizeKvSeriesHits(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const inner = parsed.data && typeof parsed.data === 'object' && Array.isArray(parsed.data.sets)
    ? parsed.data
    : (Array.isArray(parsed.sets) ? parsed : null);
  if (!inner) return null;
  const meta = {
    perGame: Number(inner.meta?.perGame) || SERIES_HIT_PER_GAME,
    generatedAt: typeof inner.meta?.generatedAt === 'string' ? inner.meta.generatedAt : new Date().toISOString()
  };
  if (inner.meta?.partial) meta.partial = true;
  if (Array.isArray(inner.meta?.missingGames) && inner.meta.missingGames.length) meta.missingGames = inner.meta.missingGames;
  if (Array.isArray(inner.meta?.staleGames) && inner.meta.staleGames.length) meta.staleGames = inner.meta.staleGames;
  return {
    data: {
      sets: inner.sets,
      meta
    }
  };
}

/**
 * 正規化從 KV 讀出的 catalog/coverage JSON，並依目前時間動態更新 cache.ageMs 與 cache.stale；若格式不合法回傳 null。
 */
export function normalizeKvCatalogCoverage(raw, { nowMs = Date.now(), ttlMs = DEFAULT_COVERAGE_TTL_MS, maxStaleMs = DEFAULT_COVERAGE_MAX_STALE_MS } = {}) {
  let parsed = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const report = parsed.data && typeof parsed.data === 'object' && parsed.data.games && typeof parsed.data.games === 'object'
    ? parsed.data
    : (parsed.games && typeof parsed.games === 'object' ? parsed : null);
  if (!report) return null;

  const baseIso = report.cache?.lastSuccessAt || report.updatedAt || null;
  const baseMs = baseIso ? Date.parse(baseIso) : NaN;
  const effectiveBaseMs = Number.isFinite(baseMs) ? baseMs : nowMs;
  const ageMs = Math.max(0, nowMs - effectiveBaseMs);
  const stale = ageMs >= ttlMs || Boolean(report.cache?.stale);
  const cache = {
    status: stale ? 'stale' : (report.cache?.status || 'hit'),
    stale,
    ageMs,
    lastSuccessAt: new Date(effectiveBaseMs).toISOString(),
    expiresAt: new Date(effectiveBaseMs + ttlMs).toISOString(),
    staleUntil: new Date(effectiveBaseMs + maxStaleMs).toISOString(),
    refreshing: false,
    error: report.cache?.error ?? null
  };
  return {
    data: {
      ...report,
      freshness: coverageFreshness(report.updatedAt, nowMs),
      scope: report.scope
        ? { ...report.scope, freshness: coverageFreshness(report.updatedAt, nowMs) }
        : report.scope,
      cache
    }
  };
}

/**
 * 正規化從 KV 讀出的 sitemap index（支援純 XML 字串或 { index, cardFileCount, generatedAt } JSON）。
 */
export function normalizeKvSitemapIndex(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<sitemapindex')) {
      const cardMatches = [...trimmed.matchAll(/\/sitemaps\/cards-(\d+)\.xml/g)].map(m => Number(m[1])).filter(Number.isFinite);
      const cardFileCount = cardMatches.length ? Math.max(...cardMatches) : 0;
      return { xml: raw, cardFileCount };
    }
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const xml = typeof raw.index === 'string' ? raw.index : (typeof raw.xml === 'string' ? raw.xml : null);
  if (!xml || (!xml.includes('<sitemapindex') && !xml.includes('<urlset'))) return null;
  const cardMatches = [...xml.matchAll(/\/sitemaps\/cards-(\d+)\.xml/g)].map(m => Number(m[1])).filter(Number.isFinite);
  const inferredCount = cardMatches.length ? Math.max(...cardMatches) : 0;
  const cardFileCount = Number.isInteger(raw.cardFileCount) && raw.cardFileCount >= 0 ? raw.cardFileCount : inferredCount;
  return { xml, cardFileCount };
}

/**
 * 正規化從 KV 讀出的單一 sitemap XML（series.xml 或 cards-N.xml，支援純 XML 字串或 { xml } JSON）。
 */
export function normalizeKvSitemapXml(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<urlset') || trimmed.startsWith('<sitemapindex')) {
      return raw;
    }
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const xml = typeof raw.xml === 'string' ? raw.xml : (typeof raw.series === 'string' ? raw.series : null);
  return xml && (xml.includes('<urlset') || xml.includes('<sitemapindex')) ? xml : null;
}

export function slimCoverageGame(entry) {
  const keys = entry.linkAudit?.duplicateProviderKeys || [];
  return {
    ...entry,
    sources: undefined,
    sourceCount: entry.sources?.length ?? 0,
    linkAudit: {
      ...entry.linkAudit,
      duplicateProviderKeys: keys.slice(0, 20),
      duplicateProviderKeyCount: keys.length
    }
  };
}

function relationPaginationError(reason) {
  const error = new Error(`RELATION_PAGINATION_${reason.toUpperCase().replaceAll('-', '_')}`);
  error.code = 'RELATION_PAGINATION_INVALID';
  return error;
}

const sleep = ms => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * 供 GitHub Actions / CLI 預產腳本使用的完整快照產生器（在 Node 執行，無 10 ms CPU 與 50 subrequest 限制）。
 */
export function createSnapshotGenerator({
  env = {},
  fetchFn = globalThis.fetch,
  now = Date.now,
  maxRetries = Number(env?.SNAPSHOT_QUERY_RETRIES ?? 3),
  retryDelayMs = Number(env?.SNAPSHOT_RETRY_DELAY_MS ?? 300),
  cardChunkSize = Number(env?.COVERAGE_CARD_CHUNK) || DEFAULT_COVERAGE_CARD_CHUNK,
  relationPageSize = Number(env?.COVERAGE_RELATION_PAGE_SIZE) || DEFAULT_RELATION_SCAN_PAGE_SIZE
} = {}) {
  const db = createSupabaseClient({ env, fetchFn, defaultTimeoutMs: 25000 });
  const jpyToTwdFallback = Number(env?.JPY_TO_TWD || 0.22);
  const usdToTwdFallback = Number(env?.USD_TO_TWD || 32);
  const retries = Math.max(1, Math.floor(Number(maxRetries) || 3));
  const baseDelay = Math.max(0, Number(retryDelayMs) || 0);

  async function withRetry(fn, { attempts = retries, onRetry = null } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn(attempt);
      } catch (error) {
        lastError = error;
        if (error?.code === 'RELATION_PAGINATION_INVALID' || attempt >= attempts) break;
        const delay = baseDelay * (2 ** (attempt - 1));
        onRetry?.(attempt, error, delay);
        await sleep(delay);
      }
    }
    throw lastError;
  }

  async function loadRates() {
    if (!db.supabaseConfigured()) {
      return { TWD: 1, JPY: jpyToTwdFallback, USD: usdToTwdFallback, EUR: 35 };
    }
    try {
      const rows = await withRetry(() => db.fetchJson('/exchange_rates?select=currency,rate_to_twd,fetched_at&order=fetched_at.desc&limit=30', { db: 'main' }));
      const rates = { TWD: 1, JPY: jpyToTwdFallback, USD: usdToTwdFallback, EUR: 35 };
      const seen = new Set();
      for (const row of rows || []) {
        if (!seen.has(row.currency)) {
          seen.add(row.currency);
          const r = Number(row.rate_to_twd);
          if (Number.isFinite(r) && r > 0) rates[row.currency] = r;
        }
      }
      return rates;
    } catch {
      return { TWD: 1, JPY: jpyToTwdFallback, USD: usdToTwdFallback, EUR: 35 };
    }
  }

  async function attachReferencePrices(cards) {
    const unique = [...new Set((cards || []).map(c => c?.id).filter(Boolean))].sort();
    if (!unique.length || !db.supabaseConfigured()) return cards;
    try {
      const [rows, priorRows, rates] = await Promise.all([
        withRetry(() => db.fetchJson('/rpc/price_reference_best', { db: 'main', method: 'POST', body: JSON.stringify({ p_ids: unique }) })),
        withRetry(() => db.fetchJson('/rpc/price_reference_prior', { db: 'main', method: 'POST', body: JSON.stringify({ p_ids: unique, p_days: 7 }) })).catch(() => []),
        loadRates()
      ]);
      const priorByKey = new Map((Array.isArray(priorRows) ? priorRows : []).map(row => [`${row.card_id}|${row.provider}|${row.variant || ''}`, row]));
      const prices = new Map();
      for (const row of Array.isArray(rows) ? rows : []) {
        const price = referencePriceFromRow(row);
        if (price) prices.set(row.card_id, { ...price, ...referenceChange(price, priorByKey.get(`${row.card_id}|${price.source}|${price.variant || ''}`)) });
      }
      for (const card of cards || []) {
        const price = prices.get(card.id);
        const rate = Number(rates[price?.currency]);
        if (price) card.referencePrice = rate > 0 ? { ...price, amountTwd: Math.round(price.amount * rate) } : price;
      }
    } catch (error) {
      console.error('snapshot reference price lookup failed', error?.message || error);
    }
    return cards;
  }

  async function loadCatalogForSnapshot() {
    const fallback = getFallbackCatalogCopy();
    if (!db.supabaseConfigured()) {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    }
    const secondPromise = db.secondDbConfigured()
      ? withTimeout((async () => {
          const [g, s] = await Promise.all([
            withRetry(() => db.fetchJson(CATALOG_GAMES_PATH, { db: 'ip2', timeoutMs: db.secondDbTimeoutMs }), { attempts: 2 }),
            withRetry(() => db.fetchAll(CATALOG_SERIES_PATH, 1000, { db: 'ip2', timeoutMs: db.secondDbTimeoutMs }), { attempts: 2 })
          ]);
          return { games: g || [], series: s || [] };
        })(), db.secondDbTimeoutMs * 2, 'SECOND_DB_TIMEOUT').catch(() => ({ games: [], series: [] }))
      : Promise.resolve({ games: [], series: [] });

    const [games, series, cards, second] = await Promise.all([
      withRetry(() => db.fetchJson(CATALOG_GAMES_PATH, { db: 'main' })),
      withRetry(() => db.fetchAll(CATALOG_SERIES_PATH, 1000, { db: 'main' })),
      withRetry(() => db.fetchJson('/tcg_cards?select=id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases&order=created_at.asc&limit=250', { db: 'main' })),
      secondPromise
    ]);
    return canonicalizeCatalog({
      version: 3,
      updatedAt: new Date(now()).toISOString(),
      source: 'supabase+catalog.json',
      games: mergeCatalogRows(fallback.games, [...(games || []), ...second.games]),
      series: mergeCatalogRows(fallback.series, [...(series || []), ...second.series], { keepFallbackOnly: false }),
      cards: mergeCatalogRows(fallback.cards, cards || [], { keepFallbackOnly: false })
    });
  }

  async function browseSeriesCards(game, { region, seriesId, sort = 'rarity-desc', limit = BROWSE_PAGE_MAX, offset = 0 } = {}) {
    const safeGame = String(game).replace(/[^a-z0-9-]/gi, '');
    const safeSeries = String(seriesId || '').replace(/[^a-z0-9:_-]/gi, '');
    const targetDb = dbForGame(safeGame);
    if (targetDb === 'ip2' && !db.secondDbConfigured()) return [];
    const rpc = await withRetry(() =>
      db.fetchJson('/rpc/browse_series_cards', {
        db: targetDb,
        method: 'POST',
        body: JSON.stringify({ p_game: safeGame, p_series: safeSeries })
      })
    );
    if (rpc && Array.isArray(rpc.printings) && Array.isArray(rpc.cards) && Array.isArray(rpc.images)) {
      if (!rpc.cards.length) return [];
      const printingByCard = buildPrintingIndex(rpc.printings);
      const imageByCard = new Map();
      for (const image of rpc.images) {
        const list = imageByCard.get(image.cardId) || [];
        list.push(image);
        imageByCard.set(image.cardId, list);
      }
      const siblingUrls = new Map();
      for (const image of Array.isArray(rpc.siblingImages) ? rpc.siblingImages : []) {
        if (!browseHasUsableImage(image)) continue;
        const list = siblingUrls.get(image.groupId) || [];
        if (!list.includes(image.imageUrl)) list.push(image.imageUrl);
        siblingUrls.set(image.groupId, list);
      }
      for (const card of rpc.cards) {
        const urls = siblingUrls.get(card.canonicalId || card.id);
        if (urls?.length) card.fallbackImageUrls = urls.slice(0, 3);
      }
      return buildBrowsePage(rpc.cards, {
        region,
        seriesId: safeSeries,
        sort,
        limit,
        offset,
        printingByCard,
        imageByCard,
        facetStatus: 'complete'
      }).data;
    }
    return [];
  }

  async function loadPinnedCard(cardId) {
    const targetDb = dbForId(cardId);
    if (targetDb === 'ip2' && !db.secondDbConfigured()) return null;
    try {
      const detail = await withRetry(() =>
        db.fetchJson('/rpc/get_card_detail', {
          db: targetDb,
          method: 'POST',
          body: JSON.stringify({ p_id: String(cardId) })
        })
      );
      if (!detail || !Array.isArray(detail.cards) || !detail.cards.length) return null;
      const hydrated = detail.cards.map(c => ({
        ...c,
        printings: c.printings || [],
        region: c.printings?.[0]?.region || null,
        language: c.printings?.[0]?.language || null,
        ...cardImageFields(c, c.printings)
      }));
      const cards = canonicalizeCatalog({ cards: hydrated }).cards;
      return cards.find(c => c.id === cardId) || cards[0] || null;
    } catch {
      return null;
    }
  }

  async function computePackPrizesSnapshot(existingCatalog = null, { previousSnapshot = null, loadPrevious = null } = {}) {
    const catalog = existingCatalog || await loadCatalogForSnapshot();
    const today = new Date(now()).toISOString().slice(0, 10);
    const seriesById = new Map((catalog.series || []).map(s => [s.id, s]));
    const games = [];
    const missingGames = [];
    const staleGames = [];
    let resolvedPrevious = previousSnapshot;
    let previousLoaded = previousSnapshot !== null;
    const getPrevious = async () => {
      if (!previousLoaded && typeof loadPrevious === 'function') {
        previousLoaded = true;
        resolvedPrevious = normalizeKvPackPrizes(await loadPrevious().catch(() => null));
      } else if (resolvedPrevious) {
        resolvedPrevious = normalizeKvPackPrizes(resolvedPrevious);
      }
      return resolvedPrevious;
    };

    let attemptedGames = 0;
    let failedGames = 0;

    for (const rule of PACK_PRIZE_GAMES) {
      const candidates = prizeSeriesCandidates(catalog.series, rule, today).slice(0, 3);
      if (!candidates.length) continue;
      attemptedGames++;
      let gameFailed = false;
      let gameAdded = false;
      for (const release of candidates) {
        try {
          const versions = [];
          for (const series of release) {
            const cards = await browseSeriesCards(rule.game, {
              region: series.region,
              seriesId: series.id,
              sort: 'rarity-desc',
              limit: BROWSE_PAGE_MAX,
              offset: 0
            });
            if (rule.game === 'pokemon') await attachReferencePrices(cards);
            versions.push({
              region: series.region,
              rows: prizeCards(rule.game, rule.top, cards, { seriesId: series.id, limit: BROWSE_PAGE_MAX }).map(card => prizeRow(card, series))
            });
          }
          const data = mergePrizeRows(rule.game, versions);
          if (data.length < 3) continue;
          const [series] = release;
          games.push({
            game: rule.game,
            seriesId: series.id,
            region: series.region,
            seriesName: series.nameZh || series.nameJa || series.nameEn || series.officialCode,
            releaseDate: series.releaseDate,
            data
          });
          gameAdded = true;
          break;
        } catch (error) {
          gameFailed = true;
          console.error('pack-prizes game release failed', rule.game, error?.message || error);
        }
      }
      if (!gameAdded && gameFailed) {
        failedGames++;
        missingGames.push(rule.game);
        const prev = await getPrevious();
        const prevGame = prev?.games?.find(g => g?.game === rule.game);
        if (prevGame) {
          games.push({ ...prevGame, stale: true });
          staleGames.push(rule.game);
        }
      }
    }

    if (attemptedGames > 0 && failedGames === attemptedGames) {
      throw new Error('PACK_PRIZES_ALL_GAMES_FAILED');
    }

    const pinnedCards = [];
    for (const id of PACK_PRIZE_PINNED) {
      const card = await loadPinnedCard(id);
      if (card) pinnedCards.push(card);
    }
    const pokemonPinned = pinnedCards.filter(card => card.game === 'pokemon');
    if (pokemonPinned.length) await attachReferencePrices(pokemonPinned);
    const pinned = pinnedCards.map(card => {
      const seriesId = card.seriesId || card.printings?.[0]?.seriesId;
      return prizeRow(card, seriesById.get(seriesId));
    });
    return {
      pinned,
      games,
      meta: {
        windowDays: PACK_PRIZE_WINDOW_DAYS,
        limit: PACK_PRIZE_LIMIT,
        generatedAt: new Date(now()).toISOString(),
        ...(missingGames.length ? { partial: true, missingGames } : {}),
        ...(staleGames.length ? { staleGames } : {})
      }
    };
  }

  async function computeSeriesHitsSnapshot(existingCatalog = null, { previousSnapshot = null, loadPrevious = null } = {}) {
    const catalog = existingCatalog || await loadCatalogForSnapshot();
    const today = new Date(now()).toISOString().slice(0, 10);
    const list = bandSeries(catalog.series, today, SERIES_HIT_PER_GAME);
    const byGame = new Map();
    for (const s of list) {
      if (!byGame.has(s.game)) byGame.set(s.game, []);
      byGame.get(s.game).push(s);
    }

    let resolvedPrevious = previousSnapshot;
    let previousLoaded = previousSnapshot !== null;
    const getPrevious = async () => {
      if (!previousLoaded && typeof loadPrevious === 'function') {
        previousLoaded = true;
        resolvedPrevious = normalizeKvSeriesHits(await loadPrevious().catch(() => null));
      } else if (resolvedPrevious) {
        resolvedPrevious = normalizeKvSeriesHits(resolvedPrevious);
      }
      return resolvedPrevious;
    };

    const sets = [];
    const missingGames = [];
    const staleGames = [];
    let failedGames = 0;

    for (const [gameId, gameSeriesList] of byGame.entries()) {
      let gameFailedCount = 0;
      const gameSets = [];
      for (const item of gameSeriesList) {
        try {
          const cards = await browseSeriesCards(item.game, {
            region: item.region,
            seriesId: item.id,
            sort: 'rarity-desc',
            limit: SERIES_HIT_FETCH,
            offset: 0
          });
          const hits = pickSeriesHits(item, cards);
          if (hits.length) {
            gameSets.push({
              game: item.game,
              region: item.region || null,
              seriesIds: [item.id],
              code: item.officialCode || null,
              hits
            });
          }
        } catch (error) {
          gameFailedCount++;
          console.error('series-hits series failed', gameId, item.id, error?.message || error);
        }
      }
      if (gameFailedCount > 0 && gameSets.length === 0) {
        failedGames++;
        missingGames.push(gameId);
        const prev = await getPrevious();
        const prevSets = (prev?.data?.sets || []).filter(s => s?.game === gameId).map(s => ({ ...s, stale: true }));
        if (prevSets.length) {
          sets.push(...prevSets);
          staleGames.push(gameId);
        }
      } else {
        sets.push(...gameSets);
        if (gameFailedCount > 0) missingGames.push(gameId);
      }
    }

    if (byGame.size > 0 && failedGames === byGame.size) {
      throw new Error('SERIES_HITS_ALL_GAMES_FAILED');
    }

    return {
      data: {
        sets,
        meta: {
          perGame: SERIES_HIT_PER_GAME,
          generatedAt: new Date(now()).toISOString(),
          ...(missingGames.length ? { partial: true, missingGames } : {}),
          ...(staleGames.length ? { staleGames } : {})
        }
      }
    };
  }

  async function loadCoverageRelationRange(table, select, firstId, lastId, targetDb) {
    const rows = [];
    const seenIds = new Set();
    let currentLimit = Math.max(50, Math.min(1000, relationPageSize));
    for (let offset = 0, pages = 0; ; pages++) {
      if (pages >= 1000) throw relationPaginationError('too-many-pages');
      const page = await withRetry(
        attempt => {
          const effectiveLimit = attempt === 1 ? currentLimit : Math.max(100, Math.floor(currentLimit / (2 ** (attempt - 1))));
          const query = new URLSearchParams({
            select,
            order: 'card_id.asc,id.asc',
            limit: String(effectiveLimit),
            offset: String(offset)
          });
          query.append('card_id', `gte.${firstId}`);
          query.append('card_id', `lte.${lastId}`);
          return db.fetchJson(`/${table}?${query}`, { db: targetDb });
        },
        {
          onRetry: (attempt, err) => {
            currentLimit = Math.max(100, Math.floor(currentLimit / 2));
            console.warn(`coverage relation ${table} retry #${attempt} (limit=${currentLimit})`, err?.message || err);
          }
        }
      );
      if (!Array.isArray(page) || page.length > relationPageSize) {
        throw relationPaginationError('invalid-page');
      }
      if (!page.length) return rows;
      const firstPageId = page[0]?.id;
      if (firstPageId !== undefined && seenIds.has(firstPageId)) {
        throw relationPaginationError('stalled');
      }
      for (const item of page) {
        if (item?.id !== undefined) seenIds.add(item.id);
      }
      rows.push(...page);
      offset += page.length;
    }
  }

  function createCoverageRelation(table, select, legacySelect, targetDb) {
    const state = {
      status: 'complete',
      error: null,
      legacy: false,
      async load(firstId, lastId) {
        if (state.status !== 'complete') return [];
        try {
          if (!state.legacy) {
            try {
              return await loadCoverageRelationRange(table, select, firstId, lastId, targetDb);
            } catch (error) {
              if (error?.code === 'RELATION_PAGINATION_INVALID') throw error;
              state.legacy = true;
            }
          }
          const rows = await loadCoverageRelationRange(table, legacySelect, firstId, lastId, targetDb);
          return table === 'card_images' ? rows.map(row => ({ ...row, imageRightsStatus: 'not-provided' })) : rows;
        } catch (error) {
          console.error('coverage relation failed', table, error?.message || error);
          state.status = 'unknown';
          state.error = UPSTREAM_ERROR;
          return [];
        }
      }
    };
    return state;
  }

  async function loadCoverageGame(gameId, printingRelation, imageRelation, targetDb) {
    const safeGame = String(gameId).replace(/[^a-z0-9-]/gi, '');
    const acc = createCoverageAccumulator();
    let last = null;
    let currentChunk = Math.max(50, Math.min(1000, cardChunkSize));
    try {
      for (;;) {
        let usedLimit = currentChunk;
        const cards = await withRetry(
          attempt => {
            usedLimit = attempt === 1 ? currentChunk : Math.max(100, Math.floor(currentChunk / (2 ** (attempt - 1))));
            const params = new URLSearchParams({
              select: BROWSE_CARD_SELECT,
              game_id: `eq.${safeGame}`,
              order: 'id.asc',
              limit: String(usedLimit)
            });
            if (last !== null) params.set('id', `gt.${last}`);
            return db.fetchJson(`/tcg_cards?${params}`, { db: targetDb });
          },
          {
            onRetry: (attempt, err) => {
              currentChunk = Math.max(100, Math.floor(currentChunk / 2));
              console.warn(`coverage game ${gameId} card page retry #${attempt} (chunk=${currentChunk})`, err?.message || err);
            }
          }
        );
        if (!Array.isArray(cards)) throw new Error('COVERAGE_BAD_CARD_PAGE');
        if (cards.length) {
          const [printings, images] = await Promise.all([
            printingRelation.load(cards[0].id, cards.at(-1).id),
            imageRelation.load(cards[0].id, cards.at(-1).id)
          ]);
          accumulateCoverage(acc, cards, printings, images);
        }
        if (cards.length < usedLimit) return { gameId, acc, status: 'complete' };
        const next = cards.at(-1)?.id;
        if (!next || next === last) throw new Error('COVERAGE_CARD_PAGING_STALLED');
        last = next;
      }
    } catch (error) {
      console.error('coverage game failed', gameId, error?.message || error);
      return { gameId, acc: createCoverageAccumulator(), status: 'unknown', error: UPSTREAM_ERROR };
    }
  }

  async function computeCatalogCoverageSnapshot({ previousSnapshot = null, loadPrevious = null } = {}) {
    if (!db.supabaseConfigured()) {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    }
    const legacyPrintingSelect = 'id,cardId:card_id,seriesId:series_id,region,language,localSetCode:local_set_code,localCardNumber:local_card_number,rarity,imageUrl:image_url,sourceUrl:source_url,source,providerId:provider_id,releaseDate:release_date,imageRehostRequired:image_rehost_required';
    const legacyImageSelect = 'id,cardId:card_id,language,source,imageUrl:image_url,sourceUrl:source_url,isPrimary:is_primary,fetchedAt:fetched_at';

    const seriesResult = await withRetry(() =>
      db.fetchAll('/tcg_series?select=id,gameId:game_id,region,language,providerId:provider_id,sourceUrl:source_url,updatedAt:updated_at,metadata&order=game_id,region,id', 1000, { db: 'main' })
    ).then(rows => ({ rows, status: 'complete' }))
      .catch(() => ({ rows: [], status: 'unknown', error: UPSTREAM_ERROR }));

    const gameIds = [...db.catalogGameIds()];
    const cardGroups = [];

    // 逐遊戲拆查詢（依序執行、各自獨立的關聯狀態），避免 6 個遊戲同時在主庫掃表引發 57014 statement timeout。
    for (const gameId of gameIds) {
      const targetDb = dbForGame(gameId);
      const printingRel = createCoverageRelation('tcg_printings', BROWSE_PRINTING_SELECT, legacyPrintingSelect, targetDb);
      const imageRel = createCoverageRelation('card_images', BROWSE_IMAGE_SELECT, legacyImageSelect, targetDb);
      const group = await loadCoverageGame(gameId, printingRel, imageRel, targetDb);
      cardGroups.push({
        ...group,
        printingStatus: printingRel.status,
        printingError: printingRel.error,
        imageStatus: imageRel.status,
        imageError: imageRel.error
      });
    }

    let resolvedPrevious = previousSnapshot;
    let previousLoaded = previousSnapshot !== null;
    const getPrevious = async () => {
      if (!previousLoaded && typeof loadPrevious === 'function') {
        previousLoaded = true;
        resolvedPrevious = normalizeKvCatalogCoverage(await loadPrevious().catch(() => null));
      } else if (resolvedPrevious) {
        resolvedPrevious = normalizeKvCatalogCoverage(resolvedPrevious);
      }
      return resolvedPrevious;
    };

    const games = {};
    const allTimestamps = [];
    const baseline = catalogBaselineReport(seriesResult.rows);
    const currentNow = now();
    const missingGames = [];
    const staleGames = [];
    let succeededGames = 0;

    for (const group of cardGroups) {
      const gameComplete = group.status === 'complete' && group.printingStatus === 'complete' && group.imageStatus === 'complete';
      if (gameComplete) {
        succeededGames++;
      } else {
        missingGames.push(group.gameId);
      }

      const options = {
        cardStatus: group.status,
        printingStatus: group.printingStatus,
        imageStatus: group.imageStatus,
        now: currentNow
      };
      let entry = slimCoverageGame(adjustCoverageGame(finishCoverage(group.acc, group.gameId, options), options));
      if (!gameComplete) {
        if (group.status !== 'complete') entry.cards = null;
        const prev = await getPrevious();
        const prevGame = prev?.data?.games?.[group.gameId];
        if (prevGame && typeof prevGame.cards === 'number') {
          entry = {
            ...prevGame,
            stale: true,
            status: 'stale',
            error: UPSTREAM_ERROR
          };
          staleGames.push(group.gameId);
        } else {
          entry.stale = true;
        }
      }
      games[group.gameId] = entry;
      if (entry.sourceTimestamp) allTimestamps.push(entry.sourceTimestamp);
    }

    if (cardGroups.length > 0 && succeededGames === 0) {
      const err = new Error('COVERAGE_ALL_GAMES_FAILED');
      throw err;
    }

    attachCatalogBaselines(games, baseline.report);
    const totalCards = Object.values(games).reduce((sum, game) => sum + (game.cards || 0), 0);
    const knownTimestamps = allTimestamps.map(coverageIso).filter(Boolean).sort();
    const coveredGames = Object.keys(games).filter(gameId => games[gameId].cards > 0);
    const coveredSets = uniqueValues(Object.values(games).flatMap(game => game.coveredSets || []));
    const freshness = coverageFreshness(knownTimestamps.at(-1), currentNow);
    const cardErrors = Object.fromEntries(cardGroups.filter(group => group.error).map(group => [group.gameId, group.error]));
    const firstPrintingError = cardGroups.find(group => group.printingError)?.printingError || null;
    const firstImageError = cardGroups.find(group => group.imageError)?.imageError || null;
    const allCardsComplete = cardGroups.every(group => group.status === 'complete');
    const allPrintingsComplete = cardGroups.every(group => group.printingStatus === 'complete');
    const allImagesComplete = cardGroups.every(group => group.imageStatus === 'complete');
    const complete = allCardsComplete && allPrintingsComplete && allImagesComplete;
    const printingMetricStatus = allPrintingsComplete ? 'complete' : (cardGroups.some(g => g.printingStatus === 'complete') ? 'partial' : 'unknown');
    const imageMetricStatus = (allPrintingsComplete && allImagesComplete)
      ? 'complete'
      : (cardGroups.some(g => g.printingStatus === 'complete' && g.imageStatus === 'complete') ? 'partial' : 'unknown');

    const expectedTotals = {
      value: null,
      status: 'unknown',
      reason: '沒有可跨地區合併的完整卡表分母；來源回報基準僅按範圍呈現'
    };
    const nowIso = new Date(currentNow).toISOString();
    const report = {
      totalCards,
      totalMatchingRecords: totalCards,
      games,
      coveredGames,
      coveredSets,
      totalSets: coveredSets.length,
      source: 'supabase-current-rows',
      updatedAt: knownTimestamps.at(-1) || nowIso,
      expectedTotals,
      baselineRegistry: {
        schemaVersion: baseline.report.schemaVersion,
        registryVersion: baseline.report.registryVersion,
        reviewedAt: baseline.report.reviewedAt,
        status: baseline.report.summary.status,
        seriesStatus: seriesResult.status,
        error: baseline.error || seriesResult.error || null
      },
      freshness,
      sample: false,
      complete,
      ...(missingGames.length ? { missingGames } : {}),
      ...(staleGames.length ? { staleGames } : {}),
      scope: {
        sample: false,
        complete,
        kind: 'supabase-current-rows',
        expectedTotal: null,
        expectedTotalStatus: 'unknown',
        totalMatchingRecords: totalCards,
        coveredGames,
        coveredSets,
        totalSets: coveredSets.length,
        freshness,
        limitations: [
          '此報告完整涵蓋目前 Supabase 查詢結果，但不把目前列數當成各 IP 完整卡表分母。',
          '來源回報的系列卡數按地區與系列隔離呈現，不跨地區加總成 IP 完整度。',
          '中文名、稀有度、版本與圖片比例的分母是目前觀測到的卡片列數。'
        ]
      },
      metricStatus: {
        cards: allCardsComplete ? 'complete' : 'partial',
        printings: printingMetricStatus,
        images: imageMetricStatus,
        chineseNames: allCardsComplete ? 'complete' : 'unknown',
        rarities: !allPrintingsComplete ? 'unknown' : (allCardsComplete ? 'complete' : 'unknown'),
        versions: printingMetricStatus,
        sourceTimestamp: knownTimestamps.length ? 'observed' : 'unknown',
        expectedTotals: 'unknown'
      },
      errors: {
        cards: cardErrors,
        printings: firstPrintingError,
        images: firstImageError,
        baselines: baseline.error || seriesResult.error || null
      },
      cache: {
        status: complete ? 'fresh' : 'partial',
        stale: !complete && staleGames.length > 0,
        ageMs: 0,
        lastSuccessAt: nowIso,
        expiresAt: new Date(currentNow + DEFAULT_COVERAGE_TTL_MS).toISOString(),
        staleUntil: new Date(currentNow + DEFAULT_COVERAGE_MAX_STALE_MS).toISOString(),
        refreshing: false,
        error: complete ? null : UPSTREAM_ERROR
      }
    };
    return { data: report };
  }

  async function forEachKeysetPage(table, select, onRows, targetDb = 'main') {
    let last = null;
    for (let pages = 0; pages < 1000; pages++) {
      const params = new URLSearchParams({
        select,
        order: 'id.asc',
        limit: String(DEFAULT_SITEMAP_PAGE_SIZE)
      });
      if (last !== null) params.set('id', `gt.${last}`);
      const rows = await withRetry(() => db.fetchJson(`/${table}?${params}`, { db: targetDb }));
      if (!Array.isArray(rows)) throw new Error('SITEMAP_BAD_RESPONSE');
      onRows(rows);
      if (rows.length < DEFAULT_SITEMAP_PAGE_SIZE) return;
      const next = rows.at(-1)?.id;
      if (!next || next === last) throw new Error('SITEMAP_PAGING_STALLED');
      last = next;
    }
    throw new Error('SITEMAP_TOO_MANY_PAGES');
  }

  async function collectSitemapRows(groups, seriesRows, targetDb = 'main') {
    let grouped = null;
    try {
      const rows = await withRetry(
        () => db.fetchJson('/rpc/sitemap_card_groups', { db: targetDb, method: 'POST', body: '{}', timeoutMs: 45000 }),
        { attempts: 2 }
      );
      if (Array.isArray(rows) && rows.length && rows.every(r => Array.isArray(r) && typeof r[0] === 'string')) {
        grouped = rows;
      }
    } catch (error) {
      console.error('sitemap rpc failed', targetDb, error?.message || error);
    }
    if (grouped) {
      for (const [id, game, lastmod] of grouped) {
        groups.set(id, { id, game: game || null, lastmod: lastmod || null });
      }
    } else {
      await forEachKeysetPage('tcg_cards', 'id,canonical_id,game_id,updated_at,name_zh,name_ja,name_en,name_ko', rows => mergeCardSitemapRows(rows, groups), targetDb);
    }
    await forEachKeysetPage('tcg_series', 'id,game_id,region,official_code,name_zh,name_ja,name_en,name_ko,updated_at', rows => seriesRows.push(...rows), targetDb);
  }

  async function computeSitemapsSnapshot() {
    if (!db.supabaseConfigured()) {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    }
    const publicBaseUrl = normalizeBaseUrl(env?.PUBLIC_BASE_URL);
    const urlsPerFile = Math.min(SITEMAP_MAX_URLS, Math.max(1, Number(env?.SITEMAP_URLS_PER_FILE) || SITEMAP_MAX_URLS));
    const groups = new Map();
    const seriesRows = [];
    await collectSitemapRows(groups, seriesRows, 'main');
    if (db.secondDbConfigured()) {
      const secondGroups = new Map();
      const secondSeries = [];
      try {
        await collectSitemapRows(secondGroups, secondSeries, 'ip2');
        for (const [id, entry] of secondGroups) groups.set(id, entry);
        seriesRows.push(...secondSeries);
      } catch (error) {
        console.error('second database sitemap failed; main rows only', error?.message || error);
      }
    }
    const currentNow = now();
    const generated = new Date(currentNow).toISOString().slice(0, 10);
    const cardFiles = chunkEntries(cardSitemapEntries(publicBaseUrl, groups), urlsPerFile).map(renderUrlSet);
    const indexEntries = [
      { loc: `${publicBaseUrl}/sitemaps/pages.xml`, lastmod: generated },
      { loc: `${publicBaseUrl}/sitemaps/series.xml`, lastmod: generated },
      ...cardFiles.map((_, i) => ({ loc: `${publicBaseUrl}/sitemaps/cards-${i + 1}.xml`, lastmod: generated }))
    ];
    return {
      index: renderSitemapIndex(indexEntries),
      pages: renderUrlSet(pageSitemapEntries(publicBaseUrl, [...db.catalogGameIds()])),
      series: renderUrlSet(seriesSitemapEntries(publicBaseUrl, seriesRows)),
      cards: cardFiles,
      cardCount: groups.size,
      cardFileCount: cardFiles.length,
      generatedAt: new Date(currentNow).toISOString()
    };
  }

  return {
    loadCatalogForSnapshot,
    computePackPrizesSnapshot,
    computeSeriesHitsSnapshot,
    computeCatalogCoverageSnapshot,
    computeSitemapsSnapshot
  };
}

/**
 * 透過 Cloudflare Workers KV REST API 讀取單一鍵值（失敗或 404 時回傳 null，不拋錯）。
 */
export async function getCloudflareKvValue({
  accountId,
  namespaceId,
  apiToken,
  key,
  apiBaseUrl = 'https://api.cloudflare.com/client/v4',
  fetchFn = globalThis.fetch
}) {
  if (!accountId || !namespaceId || !apiToken) return null;
  const base = String(apiBaseUrl).replace(/\/+$/, '');
  const url = `${base}/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`;
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return null;
  }
}

/**
 * 透過 Cloudflare Workers KV REST API 寫入單一鍵值。
 */
export async function putCloudflareKvValue({
  accountId,
  namespaceId,
  apiToken,
  key,
  value,
  apiBaseUrl = 'https://api.cloudflare.com/client/v4',
  fetchFn = globalThis.fetch
}) {
  if (!accountId || !namespaceId || !apiToken) {
    throw new Error('CLOUDFLARE_KV_CREDENTIALS_MISSING');
  }
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const base = String(apiBaseUrl).replace(/\/+$/, '');
  const url = `${base}/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`;
  const res = await fetchFn(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body,
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    throw new Error(`CLOUDFLARE_KV_PUT_${res.status}`);
  }
  const result = await res.json().catch(() => null);
  if (result && result.success === false) {
    throw new Error('CLOUDFLARE_KV_PUT_FAILED');
  }
  return { key, bytes: new TextEncoder().encode(body).byteLength };
}
