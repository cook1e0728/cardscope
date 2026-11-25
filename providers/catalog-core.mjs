// Node 與 Cloudflare Worker 共用的無 Node 依賴核心純函式與常數（零 node:*、零 Buffer、零 AsyncLocalStorage）。
import fallbackCatalogData from '../data/catalog.json' with { type: 'json' };
import seriesZhData from '../data/series-zh.json' with { type: 'json' };
import tcgdexEnSetMapData from '../data/tcgdex-en-set-map.json' with { type: 'json' };

import { auditCatalogLinks, chunkCardIds, imageSourceOf, summarizeImageHealth } from './backend-reliability.mjs';
import { aggregateCatalogBaselines } from './catalog-baseline.mjs';
import {
  rarityCanonicalCode as normalizeRarityCanonicalCode,
  rarityDefinition as normalizeRarityDefinition,
  rarityDisplayLabel as normalizeRarityDisplayLabel,
  rarityRank as normalizeRarityRank,
  rarityToken as normalizeRarityToken
} from './normalize.mjs';
import { normalizeProduct } from './products.mjs';
import { anniversaryTerms, postgrestLike } from './search-query.mjs';
import { imageRightsAllowDisplay } from './source-policy.mjs';
import { tcgdexLookupForPrinting } from './tcgdex-pricing.mjs';

export const SHORT_CACHE = Object.freeze({ 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' });
export const UPSTREAM_ERROR = 'UPSTREAM_UNAVAILABLE';

export const FX_CACHE_MS = 24 * 60 * 60 * 1000;
export const FX_JUMP_LIMIT = 0.05;
export const FX_JUMP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MARKET_CACHE_MS = 5 * 60 * 1000;

// 官網只讓自家網站載入（Cross-Origin-Resource-Policy: same-site）的 Bandai 官方卡圖：經 /api/images/onepiece 轉送、不轉存。
// 主機 → 允許的路徑開頭；UNION ARENA 於 2026-11-25 加入（首頁大獎與卡牆的 UA 卡圖原本全部被瀏覽器擋下）。
export const PROXIED_IMAGE_PATHS = new Map([
  ['asia-tc.onepiece-cardgame.com', '/images/cardlist/card/'],
  ['asia-en.onepiece-cardgame.com', '/images/cardlist/card/'],
  ['www.unionarena-tcg.com', '/jp/images/cardlist/card/']
]);
export const ONEPIECE_IMAGE_HOSTS = new Set(PROXIED_IMAGE_PATHS.keys());
export const ONEPIECE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ONEPIECE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']);

export const BROWSE_CACHE_MS = 5 * 60 * 1000;
export const BROWSE_PAGE_MAX = 100;
export const BROWSE_SERIES_FALLBACK_MAX = 3000;
export const BROWSE_CARD_SELECT = 'id,canonicalId:canonical_id,game:game_id,seriesId:series_id,officialCardNumber:official_card_number,rarity,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,aliases,metadata,source,providerId:provider_id,createdAt:created_at,updatedAt:updated_at';
export const BROWSE_PRINTING_SELECT = 'id,cardId:card_id,seriesId:series_id,region,language,localSetCode:local_set_code,localCardNumber:local_card_number,rarity,rarityCode:rarity_code,rarityLabel:rarity_label,imageUrl:image_url,sourceUrl:source_url,source,providerId:provider_id,releaseDate:release_date,imageRehostRequired:image_rehost_required,imageRightsStatus:image_rights_status,imageLicenseExpiresAt:image_license_expires_at,metadata,createdAt:created_at,updatedAt:updated_at';
export const BROWSE_IMAGE_SELECT = 'id,cardId:card_id,language,source,imageUrl:image_url,sourceUrl:source_url,isPrimary:is_primary,fetchedAt:fetched_at,imageRightsStatus:image_rights_status,imageLicenseExpiresAt:image_license_expires_at';
export const BROWSE_RARITY_FORMAT = /^[\p{L}\p{N}\p{M}\p{S}\p{P}\p{Zs}]{1,64}$/u;
export const BROWSE_PRICE_SORTS = new Set(['price-asc', 'price-desc']);

export const DB_NEAR_LIMIT_BYTES = 430 * 1024 * 1024;
export const SEARCH_PATTERNS_MAX = 12;
export const SEARCH_SERIES_IDS_MAX = 50;
export const SEARCH_CANDIDATE_LIMIT = 100;
export const SEARCH_RESULT_LIMIT = 40;
export const SEARCH_PAGE_MAX = 100;
export const PRICE_HISTORY_DAYS = 180;
export const PRICE_HISTORY_IDS_MAX = 30;
export const HOME_EVENTS_PAST_DAYS = 45;
export const PRICE_MOVERS_DAYS = 14;
export const PRICE_MOVERS_MIN_EUR = 5;
export const HOT_CARDS_DAYS = 7;
export const HOT_CARDS_LIMIT = 12;
export const HOT_CARDS_MIN_OPENS = 3;

export const ALLOWED_PLATFORMS = ['卡拍拍', '露天拍賣', '蝦皮購物', '露天/蝦皮以外的台灣賣場', '其他'];
export const ALLOWED_CURRENCIES = ['TWD', 'USD', 'JPY', 'EUR'];
export const MAX_PRICE = 5000000;
export const PUBLIC_REPORT_SELECT = 'id,cardName:card_name,cardId:card_id,game,platform,currency,price,condition,note,tradedAt:traded_at,createdAt:created_at,status';

export const CATALOG_GAMES_PATH = '/tcg_games?select=id,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko&order=id';
export const CATALOG_SERIES_PATH = '/tcg_series?select=id,game:game_id,officialCode:official_code,nameZh:name_zh,nameJa:name_ja,nameEn:name_en,nameKo:name_ko,region,language,releaseDate:release_date,aliases,sourceUrl:source_url,imageUrl:image_url,imageKind:image_kind,metadata&order=release_date.desc';

export const TCGDEX_EN_SET_MAP = tcgdexEnSetMapData.sets;
export const SERIES_ZH_ENTRIES = Object.freeze(Array.isArray(seriesZhData.entries) ? seriesZhData.entries : []);

export const getFallbackCatalogCopy = () => structuredClone(fallbackCatalogData);

const textEncoder = new TextEncoder();
export const utf8ByteLength = value => textEncoder.encode(String(value ?? '')).byteLength;

export const withTimeout = (promise, ms, message = 'TIMEOUT') => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), ms);
  promise.then(
    value => { clearTimeout(timer); resolve(value); },
    error => { clearTimeout(timer); reject(error); }
  );
});

export const validCardId = id => Boolean(id) && String(id).length <= 128 && !/[\u0000-\u001f\u007f]/.test(String(id));

export const compareAscii = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const compareIsoDesc = (a, b) => {
  const sa = String(a || '');
  const sb = String(b || '');
  return sa === sb ? 0 : sb > sa ? 1 : -1;
};

export const uniqueValues = (...groups) => [...new Set(groups.flat().filter(Boolean).map(String))];

export const normalizeSearch = s => String(s || '').toLocaleLowerCase().normalize('NFKC').replace(/[\s・·._:：'’"\-<>\[\]​-‍⁠﻿]/g, '');

export const EXTERNAL_QUERY_ALIASES = {
  '皮卡丘': { query: 'Pikachu', game: 'pokemon' },
  pikachu: { query: 'Pikachu', game: 'pokemon' },
  'ピカチュウ': { query: 'Pikachu', game: 'pokemon' },
  '피카츄': { query: 'Pikachu', game: 'pokemon' },
  '噴火龍': { query: 'Charizard', game: 'pokemon' },
  '喷火龙': { query: 'Charizard', game: 'pokemon' },
  charizard: { query: 'Charizard', game: 'pokemon' },
  'リザードン': { query: 'Charizard', game: 'pokemon' },
  '리자몽': { query: 'Charizard', game: 'pokemon' },
  '超夢': { query: 'Mewtwo', game: 'pokemon' },
  '超梦': { query: 'Mewtwo', game: 'pokemon' },
  mewtwo: { query: 'Mewtwo', game: 'pokemon' },
  'ミュウツー': { query: 'Mewtwo', game: 'pokemon' },
  '뮤츠': { query: 'Mewtwo', game: 'pokemon' },
  '夢幻': { query: 'Mew', game: 'pokemon' },
  '梦幻': { query: 'Mew', game: 'pokemon' },
  mew: { query: 'Mew', game: 'pokemon' },
  'ミュウ': { query: 'Mew', game: 'pokemon' },
  '뮤': { query: 'Mew', game: 'pokemon' },
  '魯夫': { query: 'Luffy', game: 'one-piece' },
  '路飛': { query: 'Luffy', game: 'one-piece' },
  '路飞': { query: 'Luffy', game: 'one-piece' }
};

export const externalAliasIndex = new Map(Object.entries(EXTERNAL_QUERY_ALIASES).map(([alias, value]) => [normalizeSearch(alias), value]));

export function onePieceImageTarget(value) {
  try {
    const raw = String(value || '');
    if (!raw || raw.length > 512 || /[\u0000-\u001f\u007f\\]/.test(raw)) return null;
    const target = new URL(raw);
    if (target.protocol !== 'https:' || target.port || target.username || target.password || !ONEPIECE_IMAGE_HOSTS.has(target.hostname)) return null;
    if (/%2e|%2f|%5c|%00|\\/i.test(target.pathname)) return null;
    const decoded = decodeURIComponent(target.pathname);
    if (decoded.includes('..') || /[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
    if (!decoded.startsWith(PROXIED_IMAGE_PATHS.get(target.hostname)) || !/\.(?:png|jpe?g|webp)$/i.test(decoded)) return null;
    target.hash = '';
    return target;
  } catch {
    return null;
  }
}

/** 串流讀取圖片回應並在超出 maxBytes 時立即中止，只回傳 Uint8Array（不依賴 Node Buffer）。 */
export async function readBoundedBytes(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > maxBytes) throw Object.assign(new Error('IMAGE_TOO_LARGE'), { code: 'IMAGE_TOO_LARGE' });
    return body;
  }
  const reader = response.body.getReader();
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
        throw Object.assign(new Error('IMAGE_TOO_LARGE'), { code: 'IMAGE_TOO_LARGE' });
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function providerStatusFromEnv(env = {}) {
  return {
    ygoprodeck: { enabled: true, capability: '免費遊戲王卡片資料與各版本 set price 參考價（24 小時快取；圖片需自行保存）' },
    kapaipai: { enabled: false, capability: '等待公開頁面結構與存取方式確認' },
    snkrdunk: { enabled: false, capability: '只提供外連（link-only），不抓資料；尚未申請授權（not-requested）' },
    yuyutei: { enabled: Boolean(env?.SCRAPE_SECRET), capability: '遊々亭買取行情；建議每日排程一次' },
    reportsDb: { enabled: Boolean(env?.SUPABASE_URL && env?.SUPABASE_SERVICE_KEY), capability: 'Supabase：回報、多語名稱、日版行情、匯率' }
  };
}

export const storageStatus = report => {
  const bytes = Number(report?.databaseBytes);
  return !Number.isFinite(bytes) ? 'unknown' : bytes >= DB_NEAR_LIMIT_BYTES ? 'near-limit' : 'ok';
};

export function fxJump(previous, next) {
  for (const currency of ['JPY', 'USD', 'EUR']) {
    const before = Number(previous?.[currency]);
    const after = Number(next?.[currency]);
    if (before > 0 && after > 0 && Math.abs(after / before - 1) > FX_JUMP_LIMIT) return currency;
  }
  return null;
}

export function amountToTwd(amount, currency, fx) {
  const value = Number(amount);
  const rate = Number(fx?.rates?.[currency]);
  return Number.isFinite(value) && Number.isFinite(rate) ? Math.round(value * rate) : null;
}

export function normalizeBrowseRegion(value) {
  const region = String(value || '').trim().toUpperCase();
  return !region || region === 'ALL' ? null : region;
}

export function normalizeBrowseRarity(value) {
  const rarity = String(value || '').trim();
  return !rarity || rarity.toLowerCase() === 'all' ? null : rarity;
}

export function normalizeBrowseSort(value, game = null) {
  const sort = String(value || 'number-asc').trim().toLowerCase();
  return new Set(['number-asc', 'number-desc', 'release-asc', 'release-desc', 'rarity-asc', 'rarity-desc', 'name-asc', 'name-desc']).has(sort)
    || (game === 'pokemon' && BROWSE_PRICE_SORTS.has(sort))
    ? sort
    : 'number-asc';
}

export function rarityRankingToken(value) {
  return normalizeRarityToken(value);
}

export function rarityDefinition(game) {
  return normalizeRarityDefinition(game);
}

export function rarityCanonicalCode(game, value) {
  return normalizeRarityCanonicalCode(game, value);
}

export function rarityCanonicalToken(game, value) {
  return rarityRankingToken(rarityCanonicalCode(game, value));
}

export function rarityDisplayLabel(game, value) {
  return normalizeRarityDisplayLabel(game, value);
}

export function browseRarityRank(game, value) {
  return normalizeRarityRank(game, value);
}

export function browseValues(card, printings, key) {
  const values = [];
  if (key === 'rarity') {
    values.push(
      rarityCanonicalCode(card?.game, card?.rarity),
      ...(printings || []).flatMap(p => [p.rarity, p.rarityCode, p.rarityLabel]).map(value => rarityCanonicalCode(card?.game, value))
    );
  }
  if (key === 'region') values.push(card?.region, ...(printings || []).map(p => p.region));
  if (key === 'language') values.push(card?.language, ...(printings || []).map(p => p.language));
  return uniqueValues(values);
}

export function browseHasUsableImage(row) {
  return Boolean(row?.imageUrl && row.imageRehostRequired !== true && imageRightsAllowDisplay(row.imageRightsStatus, row.imageLicenseExpiresAt, imageSourceOf(row)));
}

export function cardImageFields(card, printings) {
  const printing = (printings || []).find(p => p.imageUrl && !p.imageRehostRequired);
  if (printing) return { imageUrl: printing.imageUrl };
  const image = (card?.images || []).find(browseHasUsableImage);
  return image
    ? { imageUrl: image.imageUrl, imageSource: image.source, imageRightsStatus: image.imageRightsStatus, imageLicenseExpiresAt: image.imageLicenseExpiresAt || null }
    : { imageUrl: null };
}

export const REGION_PRIORITY = { JP: 0, TW: 1, US: 2, KR: 3, ASIA: 4 };

export function comparePrintings(a, b) {
  return (REGION_PRIORITY[a?.region] ?? 9) - (REGION_PRIORITY[b?.region] ?? 9)
    || Number(Boolean(b?.imageUrl && !b?.imageRehostRequired)) - Number(Boolean(a?.imageUrl && !a?.imageRehostRequired))
    || compareIsoDesc(a?.releaseDate, b?.releaseDate);
}

export function buildPrintingIndex(rows = []) {
  const byCard = new Map();
  for (const printing of rows) {
    const list = byCard.get(printing.cardId) || [];
    list.push(printing);
    byCard.set(printing.cardId, list);
  }
  for (const list of byCard.values()) list.sort(comparePrintings);
  return byCard;
}

export function hydrateBrowseCard(card, printingByCard, imageByCard) {
  const printings = printingByCard.get(card.id) || [];
  const images = imageByCard?.get(card.id) || [];
  const image = images.find(browseHasUsableImage) || printings.find(browseHasUsableImage);
  const safePrintings = printings.map(printing => (browseHasUsableImage(printing) ? printing : { ...printing, imageUrl: null }));
  return {
    ...card,
    printings: safePrintings,
    images: images.map(item => (browseHasUsableImage(item) ? item : { ...item, imageUrl: null })),
    region: printings[0]?.region || card.region || null,
    language: printings[0]?.language || card.language || null,
    imageUrl: image?.imageUrl || null,
    imageSource: image?.source || null,
    imageRightsStatus: image?.imageRightsStatus || null
  };
}

const BROWSE_LOCALE = 'en-US';
export const browseNumberCollator = new Intl.Collator(BROWSE_LOCALE, { numeric: true, sensitivity: 'base' });
export const browseIdCollator = new Intl.Collator(BROWSE_LOCALE);
export const browseNameCollator = new Intl.Collator(BROWSE_LOCALE, { sensitivity: 'base' });

const notPrinted = card => card?.metadata?.numberStatus === 'not-printed';

export function buildBrowseFacets(rows, printingByCard) {
  const facets = { rarity: {}, region: {}, language: {} };
  const rarityLabels = {};
  const grouped = new Map();
  for (const card of rows) {
    const identity = String(card?.canonicalId || card?.id || '');
    if (!identity) continue;
    const current = grouped.get(identity) || { cards: [] };
    current.cards.push(card);
    grouped.set(identity, current);
  }
  for (const { cards } of grouped.values()) {
    for (const key of Object.keys(facets)) {
      const values = new Set(cards.flatMap(card => browseValues(card, printingByCard.get(card.id) || [], key)));
      if (!values.size) values.add('unknown');
      for (const value of new Set(values)) {
        facets[key][value] = (facets[key][value] || 0) + 1;
        if (key === 'rarity' && value !== 'unknown') rarityLabels[value] = rarityDisplayLabel(cards[0]?.game, value);
      }
    }
  }
  return { ...facets, rarityLabels };
}

export function filterBrowseCards(rows, { region = null, seriesId = null, printingByCard = new Map() } = {}) {
  const regionToken = region ? String(region).toUpperCase() : null;
  return rows.filter(card => {
    const printings = printingByCard.get(card.id) || [];
    if (seriesId && card.seriesId !== seriesId && !printings.some(printing => printing.seriesId === seriesId)) return false;
    if (regionToken && !browseValues(card, printings, 'region').some(value => String(value).toUpperCase() === regionToken)) return false;
    return true;
  });
}

function filterBrowseByRarity(baseMatching, rarity, printingByCard) {
  if (!rarity) return baseMatching;
  const rarityTokenByGame = new Map();
  return baseMatching.filter(card => {
    const game = card?.game;
    let targetToken = rarityTokenByGame.get(game);
    if (targetToken === undefined) {
      targetToken = rarityCanonicalToken(game, rarity);
      rarityTokenByGame.set(game, targetToken);
    }
    if (!targetToken) return true;
    const printings = printingByCard.get(card.id) || [];
    return browseValues(card, printings, 'rarity').some(value => rarityCanonicalToken(game, value) === targetToken);
  });
}

function sortBrowseCards(filtered, { sort = 'number-asc', printingByCard = new Map(), priceByCard = null } = {}) {
  const isRaritySort = sort === 'rarity-asc' || sort === 'rarity-desc';
  const isReleaseSort = sort === 'release-asc' || sort === 'release-desc';
  const isNameSort = sort === 'name-asc' || sort === 'name-desc';
  const isPriceSort = BROWSE_PRICE_SORTS.has(sort);
  const rarityDir = sort.endsWith('desc') ? 'desc' : 'asc';

  const keyed = filtered.map((card, idx) => {
    const printings = printingByCard.get(card.id) || [];
    const num = String(card?.officialCardNumber || printings.find(p => p.localCardNumber)?.localCardNumber || '');
    const item = { card, idx, num, notPrinted: notPrinted(card), id: String(card.id) };
    if (isPriceSort) item.price = priceByCard?.get(card.id);
    if (isReleaseSort) item.rel = String(printings.map(p => p.releaseDate).filter(Boolean).sort().at(-1) || card?.releaseDate || '');
    if (isRaritySort) {
      const firstRarity = browseValues(card, printings, 'rarity')[0];
      item.rarityRank = browseRarityRank(card?.game, firstRarity);
      item.rarityText = String(firstRarity || '');
    }
    if (isNameSort) item.name = String(card.nameZh || card.nameEn || card.nameJa || card.id);
    return item;
  });

  const cmpNumber = (a, b) =>
    browseNumberCollator.compare(a.num, b.num)
    || (a.notPrinted && b.notPrinted ? a.idx - b.idx : 0)
    || browseIdCollator.compare(a.id, b.id);

  keyed.sort((a, b) => {
    if (sort === 'number-desc') return -cmpNumber(a, b);
    if (isPriceSort) {
      const pa = a.price;
      const pb = b.price;
      if ((pa == null) !== (pb == null)) return pa == null ? 1 : -1;
      if (pa != null && pa !== pb) return sort === 'price-desc' ? pb - pa : pa - pb;
      return cmpNumber(a, b);
    }
    if (isReleaseSort) {
      const value = browseIdCollator.compare(a.rel, b.rel) || cmpNumber(a, b);
      return sort === 'release-desc' ? -value : value;
    }
    if (isRaritySort) {
      const ar = a.rarityRank;
      const br = b.rarityRank;
      let cmp;
      if (ar === Number.MAX_SAFE_INTEGER || br === Number.MAX_SAFE_INTEGER) {
        cmp = ar !== br ? (ar === Number.MAX_SAFE_INTEGER ? 1 : -1) : browseNumberCollator.compare(a.rarityText, b.rarityText);
      } else if (ar !== br) {
        cmp = rarityDir === 'desc' ? ar - br : br - ar;
      } else {
        cmp = browseNumberCollator.compare(a.rarityText, b.rarityText);
      }
      return cmp || cmpNumber(a, b);
    }
    if (isNameSort) {
      const value = browseNameCollator.compare(a.name, b.name) || cmpNumber(a, b);
      return sort === 'name-desc' ? -value : value;
    }
    return cmpNumber(a, b);
  });

  return keyed.map(({ card }) => card);
}

/** 預先過濾與排序系列卡片，供大型系列分頁快取安全重用已排序清單而免重複排序。 */
export function prepareBrowseSeriesSorted(rows, {
  region = null,
  rarity = null,
  seriesId = null,
  sort = 'number-asc',
  printingByCard = new Map(),
  priceByCard = null
} = {}) {
  const baseMatching = filterBrowseCards(rows, { region, seriesId, printingByCard });
  const filtered = filterBrowseByRarity(baseMatching, rarity, printingByCard);
  return sortBrowseCards(filtered, { sort, printingByCard, priceByCard });
}

/**
 * 系列／目錄瀏覽分頁（Schwartzian transform 預計算排序鍵＋僅 hydrate 分頁切片＋支援快取好的 facets 與排序清單），
 * 在大型系列下維持與原本完全一致的排序／計數結果並壓低單次請求 CPU 消耗。
 */
export function buildBrowsePage(rows, {
  region = null,
  rarity = null,
  seriesId = null,
  sort = 'number-asc',
  limit = 60,
  offset = 0,
  printingByCard = new Map(),
  imageByCard = new Map(),
  facetStatus = 'complete',
  priceByCard = null,
  precomputedFacets = null,
  precomputedSorted = null,
  siblingUrls = null
} = {}) {
  const hasSorted = Array.isArray(precomputedSorted);
  const baseMatching = !precomputedFacets || !hasSorted
    ? filterBrowseCards(rows, { region, seriesId, printingByCard })
    : null;
  const sortedCards = hasSorted
    ? precomputedSorted
    : sortBrowseCards(filterBrowseByRarity(baseMatching, rarity, printingByCard), { sort, printingByCard, priceByCard });

  const take = Math.min(Math.max(Number(limit) || 60, 1), BROWSE_PAGE_MAX);
  const skip = Math.max(Number(offset) || 0, 0);
  const page = sortedCards.slice(skip, skip + take).map(card => {
    const hydrated = hydrateBrowseCard(card, printingByCard, imageByCard);
    if (siblingUrls) {
      const urls = siblingUrls.get(card.canonicalId || card.id);
      if (urls?.length) hydrated.fallbackImageUrls = urls.slice(0, 3);
    }
    return hydrated;
  });

  const facets = precomputedFacets
    ? {
        rarity: { ...precomputedFacets.rarity },
        region: { ...precomputedFacets.region },
        language: { ...precomputedFacets.language },
        rarityLabels: { ...precomputedFacets.rarityLabels }
      }
    : buildBrowseFacets(baseMatching, printingByCard);

  return {
    data: page,
    total: sortedCards.length,
    hasMore: skip + page.length < sortedCards.length,
    facets,
    facetStatus,
    limit: take,
    offset: skip
  };
}

export function referencePriceFromRow(row) {
  const amount = Number(row?.amount);
  const date = String(row?.snapshot_date || '').slice(0, 10);
  const usd = row?.currency === 'USD' && String(row?.variant || '').startsWith('tcgapi-');
  if (!row?.card_id || !Number.isFinite(amount) || amount <= 0 || !(row.currency === 'EUR' || usd) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    amount,
    currency: row.currency,
    source: usd ? 'tcgplayer' : 'cardmarket',
    variant: usd ? String(row.variant).slice(7) : row.variant || '',
    observedAt: row.observed_at || `${date}T00:00:00.000Z`,
    snapshotDate: date
  };
}

export const REFERENCE_FLAT_PCT = 0.5;
export function referenceChange(price, prior) {
  const before = Number(prior?.amount);
  const date = String(prior?.snapshot_date || '').slice(0, 10);
  if (!price || !(before > 0) || prior.currency !== price.currency || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return {};
  const pct = (price.amount - before) / before * 100;
  return Number.isFinite(pct) ? { changePct: Math.abs(pct) < REFERENCE_FLAT_PCT ? 0 : Math.round(pct * 10) / 10, changeFrom: date, changeBase: before } : {};
}

export function databaseRelationQuery(table, select, cardIds) {
  const ids = cardIds.map(id => `"${String(id).replaceAll('"', '')}"`).join(',');
  const query = new URLSearchParams({ select, card_id: `in.(${ids})`, order: 'id.asc' });
  return `/${table}?${query}`;
}

export function databaseRelationQueryWithinLimit(table, select, cardIds, { supabaseUrl = '', maxBytes = 8 * 1024 } = {}) {
  const path = databaseRelationQuery(table, select, cardIds);
  const url = `${supabaseUrl || ''}/rest/v1${path}&limit=1000&offset=9999999999`;
  return utf8ByteLength(url) <= maxBytes;
}

export function chunkDatabaseRelationCardIds(table, select, cardIds, legacySelect = null, { batchSize = 100, supabaseUrl = '', maxBytes = 8 * 1024 } = {}) {
  const selects = [select, legacySelect].filter(Boolean);
  const batches = [];
  for (const sizedBatch of chunkCardIds(cardIds, batchSize)) {
    let batch = [];
    for (const cardId of sizedBatch) {
      const candidate = [...batch, cardId];
      const fits = selects.every(candidateSelect => databaseRelationQueryWithinLimit(table, candidateSelect, candidate, { supabaseUrl, maxBytes }));
      if (batch.length && !fits) {
        batches.push(batch);
        batch = [cardId];
      } else {
        batch = candidate;
      }
      if (!selects.every(candidateSelect => databaseRelationQueryWithinLimit(table, candidateSelect, batch, { supabaseUrl, maxBytes }))) {
        throw new Error('RELATION_QUERY_TOO_LARGE');
      }
    }
    if (batch.length) batches.push(batch);
  }
  return batches;
}

export function coverageMetric(covered, denominator, status = 'complete', details = {}) {
  const safeCovered = covered === null || covered === undefined ? null : Number.isFinite(Number(covered)) ? Number(covered) : null;
  const safeDenominator = denominator === null || denominator === undefined ? null : Number.isFinite(Number(denominator)) && Number(denominator) >= 0 ? Number(denominator) : null;
  const percent = safeCovered !== null && safeDenominator !== null && safeDenominator > 0 ? Math.round(safeCovered / safeDenominator * 10000) / 100 : null;
  return { covered: safeCovered, denominator: safeDenominator, percent, status, ...details };
}

export function coverageIso(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function coverageTimestamp(...groups) {
  const fallbackTimestamp = typeof groups.at(-1) === 'string' ? groups.pop() : null;
  const values = groups.flatMap(group => (Array.isArray(group) ? group : [])).flatMap(row => [row?.updatedAt, row?.fetchedAt]).map(coverageIso).filter(Boolean);
  if (!values.length && fallbackTimestamp) {
    const fallback = coverageIso(fallbackTimestamp);
    if (fallback) values.push(fallback);
  }
  values.sort();
  return {
    latest: values.at(-1) || null,
    oldest: values[0] || null,
    status: values.length ? 'observed' : 'unknown',
    field: values.length ? (fallbackTimestamp && !groups.some(group => Array.isArray(group) && group.some(row => row?.updatedAt || row?.fetchedAt)) ? 'catalog.updatedAt' : 'updated_at/fetched_at') : 'not-available'
  };
}

export function coverageFreshness(timestamp, now = Date.now()) {
  const time = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(time)) return { status: 'unknown', observedAt: null, ageHours: null };
  const ageHours = Math.max(0, Math.round((now - time) / 3600000 * 10) / 10);
  return { status: ageHours <= 72 ? 'fresh' : 'stale', observedAt: new Date(time).toISOString(), ageHours };
}

export function compactCatalogBaseline(game) {
  const regions = (game?.regions || []).map(region => ({
    region: region.region,
    baseline: region.baseline,
    seriesCount: (region.series || []).length,
    acceptedSeriesCount: (region.series || []).filter(row => row?.accepted).length,
    quarantinedSeriesCount: (region.series || []).filter(row => row?.baseline?.evidenceStatus === 'quarantined').length,
    limitations: region.limitations || []
  }));
  return { ...(game?.baseline || { kind: 'unknown', value: null, status: 'unknown' }), regions, limitations: game?.limitations || [] };
}

export function catalogBaselineReport(series = []) {
  try {
    return { report: aggregateCatalogBaselines({ series }), error: null };
  } catch (error) {
    console.error('catalog baselines failed', error?.message || error);
    return { report: aggregateCatalogBaselines(), error: UPSTREAM_ERROR };
  }
}

export function attachCatalogBaselines(games, report) {
  const rows = new Map((report?.games || []).map(game => [game.gameId, game]));
  for (const [gameId, game] of Object.entries(games || {})) game.baseline = compactCatalogBaseline(rows.get(gameId));
  return games;
}

const COVERAGE_SAMPLE_LIMIT = 50;
export function createCoverageAccumulator() {
  return {
    cards: 0,
    displayableImages: 0,
    chineseNames: 0,
    rarities: 0,
    cardsWithImageUrls: 0,
    cardsWithSeries: 0,
    totalPrintings: 0,
    totalImages: 0,
    seriesIds: new Set(),
    cardSeries: new Set(),
    printingSeries: new Set(),
    sources: [new Set(), new Set(), new Set()],
    health: { urlRecords: 0, policyEligibleUrlRecords: 0, policyUnknownUrlRecords: 0, policyExcludedUrlRecords: 0, displayableCards: 0, cardCount: 0 },
    audit: {
      cards: 0,
      stableIdentityCards: 0,
      unkeyedCards: 0,
      cardsWithPrintings: 0,
      cardsWithImages: 0,
      printingReferences: 0,
      linkedPrintingReferences: 0,
      imageReferences: 0,
      linkedImageReferences: 0,
      orphanPrintings: 0,
      orphanImages: 0,
      crossGameReferences: 0,
      missingImages: { count: 0, sampleIds: [] },
      missingChineseNames: { count: 0, sampleIds: [] }
    },
    providerKeys: new Map(),
    missingDisplayable: { count: 0, sampleIds: [] },
    timestamp: { latest: null, oldest: null, raw: false }
  };
}

export function accumulateCoverage(acc, cards = [], printings = [], images = []) {
  const rows = Array.isArray(cards) ? cards : [];
  const cardIds = new Set(rows.map(card => card?.id).filter(Boolean));
  const selectedPrintings = (printings || []).filter(printing => cardIds.has(printing?.cardId));
  const selectedImages = (images || []).filter(image => cardIds.has(image?.cardId));
  const printingByCard = buildPrintingIndex(selectedPrintings);
  const imageByCard = new Map();
  for (const image of selectedImages) {
    const list = imageByCard.get(image.cardId) || [];
    list.push(image);
    imageByCard.set(image.cardId, list);
  }
  const cardHasImageUrl = card => Boolean((imageByCard.get(card.id) || []).some(image => image?.imageUrl) || (printingByCard.get(card.id) || []).some(printing => printing?.imageUrl) || card?.imageUrl);
  const cardHasUsableImage = card => Boolean((imageByCard.get(card.id) || []).some(browseHasUsableImage) || (printingByCard.get(card.id) || []).some(browseHasUsableImage) || (card?.imageUrl && imageRightsAllowDisplay(card.imageRightsStatus, card.imageLicenseExpiresAt, imageSourceOf(card))));
  const cardHasChineseName = card => {
    const zh = String(card?.nameZh || '').trim();
    return Boolean(zh) && zh !== String(card?.nameJa || '').trim();
  };
  const cardHasRarity = card => browseValues(card, printingByCard.get(card.id) || [], 'rarity').length;
  const health = summarizeImageHealth({
    cards: rows,
    printings: selectedPrintings,
    images: selectedImages,
    isDisplayable: browseHasUsableImage,
    isPolicyEligible: row => imageRightsAllowDisplay(row?.imageRightsStatus, row?.imageLicenseExpiresAt, imageSourceOf(row))
  });
  const audit = auditCatalogLinks({ cards: rows, printings: selectedPrintings, images: selectedImages, providerKeys: acc.providerKeys });
  const missingDisplayable = rows.filter(card => !cardHasUsableImage(card));
  const timestamp = coverageTimestamp(rows, selectedPrintings, selectedImages);

  acc.cards += rows.length;
  acc.displayableImages += rows.length - missingDisplayable.length;
  acc.chineseNames += rows.filter(cardHasChineseName).length;
  acc.rarities += rows.filter(cardHasRarity).length;
  acc.cardsWithImageUrls += rows.filter(cardHasImageUrl).length;
  acc.cardsWithSeries += rows.filter(card => Boolean(card?.seriesId) || Boolean((printingByCard.get(card.id) || []).some(printing => printing?.seriesId))).length;
  acc.totalPrintings += selectedPrintings.length;
  acc.totalImages += selectedImages.length;

  for (const row of rows) {
    if (row?.seriesId) {
      acc.seriesIds.add(row.seriesId);
      acc.cardSeries.add(String(row.seriesId));
    }
    for (const key of [row?.source, row?.imageSource, row?.providerId, row?.provider]) if (key) acc.sources[0].add(String(key));
  }
  for (const printing of selectedPrintings) {
    if (printing?.seriesId) acc.seriesIds.add(printing.seriesId);
    const set = printing?.seriesId || printing?.localSetCode;
    if (set) acc.printingSeries.add(String(set));
    for (const key of [printing?.source, printing?.imageSource, printing?.providerId, printing?.provider]) if (key) acc.sources[1].add(String(key));
  }
  for (const image of selectedImages) {
    for (const key of [image?.source, image?.imageSource, image?.providerId, image?.provider]) if (key) acc.sources[2].add(String(key));
  }
  for (const key of Object.keys(acc.health)) acc.health[key] += health[key];
  for (const key of Object.keys(acc.audit)) if (typeof acc.audit[key] === 'number') acc.audit[key] += audit[key];
  for (const key of ['missingImages', 'missingChineseNames']) {
    acc.audit[key].count += audit[key].count;
    const room = COVERAGE_SAMPLE_LIMIT - acc.audit[key].sampleIds.length;
    if (room > 0) acc.audit[key].sampleIds.push(...audit[key].sampleIds.slice(0, room));
  }
  acc.missingDisplayable.count += missingDisplayable.length;
  {
    const room = COVERAGE_SAMPLE_LIMIT - acc.missingDisplayable.sampleIds.length;
    if (room > 0) acc.missingDisplayable.sampleIds.push(...missingDisplayable.slice(0, room).map(card => card.id));
  }
  if (timestamp.latest && (!acc.timestamp.latest || timestamp.latest > acc.timestamp.latest)) acc.timestamp.latest = timestamp.latest;
  if (timestamp.oldest && (!acc.timestamp.oldest || timestamp.oldest < acc.timestamp.oldest)) acc.timestamp.oldest = timestamp.oldest;
  if ([rows, selectedPrintings, selectedImages].some(group => group.some(row => row?.updatedAt || row?.fetchedAt))) acc.timestamp.raw = true;
  return acc;
}

export function finishCoverage(acc, gameId, options = {}) {
  const rowsLength = acc.cards;
  const imageHealth = { ...summarizeImageHealth(), ...acc.health };
  const stableIdentityCards = acc.audit.stableIdentityCards;
  const duplicateProviderKeys = [...acc.providerKeys.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key: key.replace('\u001f', ':'), cardIds: ids }));
  const linkAudit = {
    status: 'observed',
    cards: acc.audit.cards,
    stableIdentityCards,
    unkeyedCards: acc.audit.unkeyedCards,
    cardsWithPrintings: acc.audit.cardsWithPrintings,
    cardsWithImages: acc.audit.cardsWithImages,
    printingReferences: acc.audit.printingReferences,
    linkedPrintingReferences: acc.audit.linkedPrintingReferences,
    imageReferences: acc.audit.imageReferences,
    linkedImageReferences: acc.audit.linkedImageReferences,
    orphanPrintings: acc.audit.orphanPrintings,
    orphanImages: acc.audit.orphanImages,
    crossGameReferences: acc.audit.crossGameReferences,
    duplicateProviderKeys,
    missingImages: acc.audit.missingImages,
    missingChineseNames: acc.audit.missingChineseNames,
    complete: acc.audit.cards > 0 && stableIdentityCards === acc.audit.cards && acc.audit.orphanPrintings === 0 && acc.audit.orphanImages === 0 && acc.audit.crossGameReferences === 0
  };
  const fallbackText = typeof options.fallbackUpdatedAt === 'string' && options.fallbackUpdatedAt ? options.fallbackUpdatedAt : null;
  const fallbackIsoValue = fallbackText ? coverageIso(fallbackText) : null;
  const hasRows = Boolean(acc.timestamp.latest);
  const observed = hasRows || Boolean(fallbackIsoValue);
  const timestamp = {
    latest: hasRows ? acc.timestamp.latest : fallbackIsoValue,
    oldest: hasRows ? acc.timestamp.oldest : fallbackIsoValue,
    status: observed ? 'observed' : 'unknown',
    field: observed ? (fallbackText && !acc.timestamp.raw ? 'catalog.updatedAt' : 'updated_at/fetched_at') : 'not-available'
  };
  const freshness = coverageFreshness(timestamp.latest, options.now);
  const cardStatus = options.cardStatus || 'complete';
  const printingStatus = options.printingStatus || 'complete';
  const imageStatus = options.imageStatus || 'complete';
  const cardDenominator = cardStatus === 'unknown' ? null : rowsLength;
  const imageMetricStatus = imageStatus === 'unknown' && printingStatus === 'unknown' ? 'unknown' : imageStatus === 'complete' ? 'complete' : imageStatus;
  const coveredSets = uniqueValues([...acc.cardSeries], [...acc.printingSeries]);
  const displayableImages = acc.displayableImages;
  const cardsWithPrintings = acc.audit.cardsWithPrintings;
  const fields = {
    cards: coverageMetric(rowsLength, null, cardStatus === 'complete' ? 'observed-total' : 'unknown', { denominatorStatus: 'unknown', note: '目前僅能確認資料庫觀測到的卡片列數；各 IP 可驗證的完整分母尚未提供。' }),
    images: coverageMetric(displayableImages, cardDenominator, imageMetricStatus, {
      urlRecords: imageHealth.urlRecords,
      policyEligibleUrlRecords: imageHealth.policyEligibleUrlRecords,
      policyUnknownUrlRecords: imageHealth.policyUnknownUrlRecords,
      policyExcludedUrlRecords: imageHealth.policyExcludedUrlRecords,
      cardsWithImageUrls: acc.cardsWithImageUrls,
      sampledLoadCount: imageHealth.sampledLoadCount,
      sampledLoadStatus: imageHealth.sampledLoadStatus
    }),
    chineseNames: coverageMetric(acc.chineseNames, cardDenominator, cardStatus === 'unknown' ? 'unknown' : cardStatus, { field: 'tcg_cards.name_zh' }),
    rarity: coverageMetric(acc.rarities, cardDenominator, cardStatus === 'unknown' ? 'unknown' : cardStatus, { field: 'tcg_cards.rarity or tcg_printings.rarity' }),
    printings: coverageMetric(cardsWithPrintings, cardDenominator, printingStatus === 'unknown' ? 'unknown' : printingStatus, { records: acc.totalPrintings }),
    versions: coverageMetric(cardsWithPrintings, cardDenominator, printingStatus === 'unknown' ? 'unknown' : printingStatus, { records: acc.totalPrintings, note: '版本以 tcg_printings 的 region/language 列表示。' }),
    identity: coverageMetric(linkAudit.stableIdentityCards, cardDenominator, cardStatus === 'unknown' ? 'unknown' : cardStatus, { unkeyedCards: linkAudit.unkeyedCards }),
    missingImages: coverageMetric(displayableImages, cardDenominator, imageMetricStatus, { missing: acc.missingDisplayable.count, sampleIds: acc.missingDisplayable.sampleIds, definition: 'cards-without-policy-displayable-image' }),
    missingChineseNames: coverageMetric(cardDenominator === null ? null : Math.max(0, rowsLength - linkAudit.missingChineseNames.count), cardDenominator, cardStatus === 'unknown' ? 'unknown' : cardStatus, { missing: linkAudit.missingChineseNames.count, sampleIds: linkAudit.missingChineseNames.sampleIds }),
    sourceTimestamp: { value: timestamp.latest, oldest: timestamp.oldest, status: timestamp.status, field: timestamp.field }
  };
  const sources = uniqueValues([...acc.sources[0]], [...acc.sources[1]], [...acc.sources[2]]);
  const expectedCards = options.expectedCards ?? null;
  return {
    cards: rowsLength,
    displayableImages,
    chineseNames: acc.chineseNames,
    rarities: acc.rarities,
    cardsWithImageUrls: acc.cardsWithImageUrls,
    cardsWithSeries: acc.cardsWithSeries,
    totalPrintings: acc.totalPrintings,
    totalImages: acc.totalImages,
    totalSeries: acc.seriesIds.size,
    coveredSets,
    totalSets: coveredSets.length,
    expectedCards,
    completeness: expectedCards === null ? '未核定' : '已核對',
    sources,
    sourceTimestamp: timestamp.latest,
    sourceTimestampStatus: timestamp.status,
    observationWindow: timestamp,
    freshness,
    coverage: fields,
    fields,
    linkAudit,
    imageHealth,
    imageUrlRecords: imageHealth.urlRecords,
    policyEligibleImageUrlRecords: imageHealth.policyEligibleUrlRecords,
    sampledImageLoadCount: imageHealth.sampledLoadCount,
    sampledImageLoadStatus: imageHealth.sampledLoadStatus,
    metricStatus: {
      cards: cardStatus,
      printings: printingStatus,
      images: imageStatus,
      chineseNames: cardStatus,
      rarities: cardStatus,
      versions: printingStatus,
      sourceTimestamp: timestamp.status,
      expectedTotals: expectedCards === null ? 'unknown' : 'complete'
    },
    sample: options.sample ?? false,
    complete: options.complete ?? (cardStatus === 'complete' && printingStatus === 'complete' && imageStatus === 'complete'),
    scope: {
      sample: options.sample ?? false,
      complete: options.complete ?? (cardStatus === 'complete' && printingStatus === 'complete' && imageStatus === 'complete'),
      kind: options.scopeKind || 'current-observed-rows',
      expectedTotal: expectedCards,
      expectedTotalStatus: expectedCards === null ? 'unknown' : 'provided',
      coveredSets,
      totalSets: coveredSets.length,
      freshness,
      limitations: options.limitations || ['目前未取得各 IP 可驗證的完整卡表分母，因此百分比僅表示目前資料列的欄位覆蓋率，不宣稱全系列完整。']
    }
  };
}

export function adjustCoverageGame(report, options = {}) {
  if (options.printingStatus !== 'unknown' && options.imageStatus !== 'unknown') return report;
  if (options.printingStatus === 'unknown') {
    report.rarities = null;
    for (const key of ['rarity', 'printings', 'versions']) {
      report.coverage[key] = { ...report.coverage[key], covered: null, denominator: null, percent: null, status: 'unknown' };
    }
    report.metricStatus.rarities = 'unknown';
  }
  report.displayableImages = null;
  report.cardsWithImageUrls = null;
  report.imageUrlRecords = null;
  report.policyEligibleImageUrlRecords = null;
  report.sampledImageLoadCount = null;
  report.imageHealth = null;
  report.totalPrintings = options.printingStatus === 'unknown' ? null : report.totalPrintings;
  report.totalImages = options.imageStatus === 'unknown' ? null : report.totalImages;
  report.coverage.images = { ...report.coverage.images, covered: null, denominator: null, percent: null, status: 'unknown', urlRecords: null, policyEligibleUrlRecords: null, policyUnknownUrlRecords: null, policyExcludedUrlRecords: null, cardsWithImageUrls: null, sampledLoadCount: null };
  report.coverage.missingImages = { ...report.coverage.missingImages, covered: null, denominator: null, percent: null, status: 'unknown', missing: null, sampleIds: [] };
  report.linkAudit = { ...report.linkAudit, missingImages: { count: null, sampleIds: [] } };
  report.metricStatus.images = 'unknown';
  report.complete = false;
  report.scope.complete = false;
  report.scope.limitations = [...report.scope.limitations, '圖片或印刷版本關聯查詢失敗；可顯示圖片與缺圖數量暫時無法核定。'];
  return report;
}

export function buildCoverageGame(gameId, cards = [], printings = [], images = [], options = {}) {
  return adjustCoverageGame(finishCoverage(accumulateCoverage(createCoverageAccumulator(), cards, printings, images), gameId, options), options);
}

export function buildFallbackCatalogCoverage(fallback, extra = {}, now = Date.now()) {
  const games = {};
  for (const game of fallback.games || []) {
    const rows = (fallback.cards || []).filter(card => card.game === game.id);
    const printings = rows.flatMap(card => {
      const list = Array.isArray(card.printings) && card.printings.length
        ? card.printings
        : [{ cardId: card.id, region: card.region, language: card.language, localCardNumber: card.officialCardNumber, rarity: card.rarity, imageUrl: card.imageUrl, source: card.imageSource, sourceUrl: card.sourceUrl }];
      return list.map(printing => ({ ...printing, cardId: printing.cardId || card.id }));
    });
    const images = rows.flatMap(card => {
      const list = Array.isArray(card.images) && card.images.length
        ? card.images
        : card.imageUrl
          ? [{ cardId: card.id, imageUrl: card.imageUrl, source: card.imageSource, sourceUrl: card.sourceUrl }]
          : [];
      return list.map(image => ({ ...image, cardId: image.cardId || card.id }));
    });
    games[game.id] = buildCoverageGame(game.id, rows, printings, images, {
      cardStatus: 'catalog-file',
      printingStatus: 'catalog-file',
      imageStatus: 'catalog-file',
      scopeKind: 'fallback-catalog-file',
      sample: true,
      fallbackUpdatedAt: fallback.updatedAt,
      now,
      limitations: ['這是隨版本控管的公開備援資料檔，不是各 IP 完整卡表分母。']
    });
  }
  const baseline = catalogBaselineReport();
  const coveredGames = Object.keys(games).filter(gameId => games[gameId].cards > 0);
  const coveredSets = uniqueValues(Object.values(games).flatMap(game => game.coveredSets || []));
  const freshness = coverageFreshness(fallback.updatedAt, now);
  attachCatalogBaselines(games, baseline.report);
  return {
    totalCards: (fallback.cards || []).length,
    totalMatchingRecords: (fallback.cards || []).length,
    games,
    coveredGames,
    coveredSets,
    totalSets: coveredSets.length,
    source: 'catalog.json',
    updatedAt: fallback.updatedAt || null,
    expectedTotals: { value: null, status: 'unknown', reason: '未提供各 IP 可驗證的完整卡表分母' },
    baselineRegistry: {
      schemaVersion: baseline.report.schemaVersion,
      registryVersion: baseline.report.registryVersion,
      reviewedAt: baseline.report.reviewedAt,
      status: baseline.report.summary.status,
      error: baseline.error
    },
    freshness,
    sample: true,
    complete: false,
    scope: {
      sample: true,
      complete: false,
      kind: 'fallback-catalog-file',
      expectedTotal: null,
      expectedTotalStatus: 'unknown',
      totalMatchingRecords: (fallback.cards || []).length,
      coveredGames,
      coveredSets,
      totalSets: coveredSets.length,
      freshness,
      limitations: ['資料庫未設定時使用公開備援資料檔；僅代表檔案內可觀測範圍。']
    },
    metricStatus: {
      cards: 'catalog-file',
      printings: 'catalog-file',
      images: 'catalog-file',
      chineseNames: 'catalog-file',
      rarities: 'catalog-file',
      versions: 'catalog-file',
      sourceTimestamp: fallback.updatedAt ? 'catalog-file' : 'unknown',
      expectedTotals: 'unknown'
    },
    ...extra
  };
}

export function trendObservationWindow(rows = []) {
  const values = rows.map(row => coverageIso(row?.updatedAt)).filter(Boolean).sort();
  return { latest: values.at(-1) || null, oldest: values[0] || null, status: values.length ? 'observed' : 'unknown', field: values.length ? 'scraped_at' : 'not-available' };
}

export function trendRecordKey(row) {
  const values = [row?.game, row?.setCode, row?.cardCode || row?.cardNumber, row?.cardName].map(value => String(value || '').trim().toLocaleLowerCase());
  return values.some(Boolean) ? values.join('|') : null;
}

export function trendMeta(snapshot, now = Date.now()) {
  const rowsScanned = Number(snapshot?.rowsScanned) || 0;
  const validRows = Number(snapshot?.validRows) || 0;
  const uniqueCards = Number(snapshot?.uniqueCards) || 0;
  const window = snapshot?.observationWindow || trendObservationWindow([]);
  const complete = snapshot?.status === 'complete';
  const coveredGames = snapshot?.coveredGames || [];
  const coveredSets = snapshot?.coveredSets || [];
  const freshness = coverageFreshness(window.latest, now);
  const limitations = [
    '資料只涵蓋遊々亭日版買取價，不是全市場掛牌、成交或玩家熱度資料。',
    '漲幅以同筆觀測中的 previous_price 與 price 計算；缺少其中一項的列不列入排名。'
  ];
  return {
    source: 'yuyutei-buyback',
    label: '單一來源買取漲幅（遊々亭）',
    formula: '(price - previous_price) / previous_price',
    priceType: 'buyback',
    market: 'JP',
    totalMatchingRecords: rowsScanned,
    coveredGames,
    coveredSets,
    observationWindow: window,
    freshness,
    sample: false,
    complete,
    scope: {
      source: 'yuyutei',
      market: 'JP',
      priceType: 'buyback',
      filter: 'source=yuyutei AND previous_price IS NOT NULL AND price > previous_price',
      rowsScanned,
      totalMatchingRecords: rowsScanned,
      rowsWithValidChange: validRows,
      uniqueCards,
      coveredGames,
      coveredSets,
      observationWindow: window,
      freshness,
      sample: false,
      complete,
      coverage: 'source-only',
      limitations
    },
    completeness: {
      status: complete ? 'complete' : 'unavailable',
      sample: false,
      rowsScanned,
      totalMatchingRecords: rowsScanned,
      denominatorStatus: 'source-filtered-observations-only',
      coveredGames,
      coveredSets,
      freshness
    },
    limitations,
    warning: '只反映遊々亭日版買取調價，不代表全市場熱度、成交量、掛牌價或成交價。'
  };
}

export function pokemonProductNameZh(title, type) {
  const replacements = [
    ['強化拡張パック', '強化補充包'],
    ['ハイクラスパック', '高級補充包'],
    ['拡張パック', '補充包'],
    ['スターターセット', '起始組合'],
    ['スタートデッキ', '起始牌組'],
    ['構築デッキ', '構築牌組'],
    ['デッキ', '牌組'],
    ['カードファイル', '卡冊'],
    ['デッキシールド', '卡套'],
    ['デッキケース', '牌盒'],
    ['プレイマット', '遊戲墊']
  ];
  let result = String(title || '');
  for (const [ja, zh] of replacements) result = result.replace(ja, zh);
  return result === title ? `寶可夢${/周辺|サプライ/.test(type) ? '周邊' : '商品'}｜${title}` : result;
}

export function regionLabel(region, language, game) {
  if (region === 'JP') return '日版';
  if (region === 'TW') return game === 'onepiece' ? '亞洲日文版' : '台版';
  if (region === 'KR') return '韓版';
  if (region === 'US') return '美版';
  if (region === 'ASIA' && String(language).startsWith('en')) return '亞洲英文版';
  return region || language || '版本待確認';
}

export function buildCuratedProducts(catalog = fallbackCatalogData) {
  return (catalog.series || []).map(s => ({
    id: `curated-${s.id}`,
    game: s.game,
    name: s.nameEn || s.nameJa || s.nameZh,
    nameZh: s.nameZh,
    nameJa: s.nameJa,
    nameKo: s.nameKo || null,
    officialCode: s.officialCode,
    region: s.region,
    language: s.region === 'JP' ? 'ja-JP' : s.region === 'KR' ? 'ko-KR' : s.region === 'TW' ? 'zh-Hant-TW' : 'en-US',
    versionLabel: null,
    releaseDate: s.releaseDate,
    sealedCount: null,
    cardsCount: null,
    imageUrl: null,
    imageKind: 'series-logo',
    productType: '系列',
    source: 'curated-official-index',
    sourceUrl: s.sourceUrl || null
  }));
}

export function buildProductSetsFromSources({ stored = [], curated = [], twSeriesNames = new Map(), seriesTranslations = SERIES_ZH_ENTRIES } = {}) {
  const seen = new Set();
  const all = [...stored, ...curated]
    .filter(x => {
      if (x.imageKind === 'card') return false;
      if (!['sealed-product', 'series-logo'].includes(x.imageKind) && x.imageUrl) return false;
      const identity = x.imageKind === 'sealed-product' ? x.id : x.officialCode || x.nameZh || x.nameJa || x.name || x.nameKo || x.id;
      const key = `${x.game}:${x.region}:${x.imageKind || ''}:${identity}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(row => ({
      ...normalizeProduct(row),
      imageUrl: imageRightsAllowDisplay(row.metadata?.imageRightsStatus, row.metadata?.imageLicenseExpiresAt, imageSourceOf(row)) ? row.imageUrl : null
    }))
    .sort((a, b) => compareIsoDesc(a?.releaseDate, b?.releaseDate));

  const series = all.filter(x => x.imageKind === 'series-logo');
  const seriesByCode = new Map();
  const seriesRowByCode = new Map();
  for (const row of series.filter(x => x.officialCode)) {
    const key = `${row.game}:${String(row.officialCode).toUpperCase()}`;
    const current = seriesRowByCode.get(key);
    if (!current || row.region === 'TW') {
      seriesRowByCode.set(key, row);
      if (row.seriesId) seriesByCode.set(key, row.seriesId);
    }
  }

  const configured = new Map((seriesTranslations || []).map(row => [`${row.game}:${String(row.code || '').toUpperCase()}`, row]));
  const products = all.filter(x => x.imageKind === 'sealed-product').map(x => {
    const key = x.officialCode ? `${x.game}:${String(x.officialCode).toUpperCase()}` : null;
    const entry = key ? configured.get(key) : null;
    const crossRegion = x.game === 'pokemon' && key
      ? seriesRowByCode.get(key) || (twSeriesNames.get(key) ? { nameZh: twSeriesNames.get(key) } : null)
      : null;
    const metadata = { ...(x.metadata || {}) };
    const original = x.nameJa || x.name || x.nameEn || x.nameKo || '原名待補';
    let nameZh = x.nameZh;
    if (entry) {
      nameZh = entry.nameZh;
      metadata.translationStatus = 'maintained-map';
      metadata.translationSource = entry.source;
    } else if (crossRegion?.nameZh) {
      nameZh = `${pokemonProductNameZh(String(x.productType || '商品'), x.productType).replace(String(x.productType || ''), '')}｜${crossRegion.nameZh}`;
      metadata.translationStatus = 'official-cross-region';
    } else if (['unofficial', 'category-only'].includes(metadata.translationStatus)) {
      nameZh = `官方尚未有中文名稱｜${original}`;
    }
    return { ...x, seriesId: x.seriesId || (key ? seriesByCode.get(key) : null) || null, nameZh, metadata };
  });

  return { products, series };
}

export function productFeedMeta({ products, series }) {
  const games = ['pokemon', 'onepiece', 'yugioh', 'haikyuu', 'weiss-schwarz', 'dragonball-fw'];
  const counts = rows => Object.fromEntries(games.map(game => [game, rows.filter(row => row.game === game).length]));
  const productSources = [...new Set(products.map(row => row.source).filter(Boolean))].sort();
  const seriesSources = [...new Set(series.map(row => row.source).filter(Boolean))].sort();
  return {
    productCount: products.length,
    seriesCount: series.length,
    productCountsByGame: counts(products),
    seriesCountsByGame: counts(series),
    productImageCountsByGame: counts(products.filter(row => row.imageUrl)),
    seriesImageCountsByGame: counts(series.filter(row => row.imageUrl)),
    productSources,
    seriesSources,
    sources: [...new Set([...productSources, ...seriesSources])].sort(),
    warning: '實體商品與系列索引分開計數；系列圖不是卡盒封面。缺少可靠封面時顯示圖片待補，不借用單卡圖。'
  };
}

export function mergeCatalogRows(fallbackRows = [], databaseRows = [], { keepFallbackOnly = true } = {}) {
  const rows = new Map(fallbackRows.map(row => [row.id, structuredClone(row)]));
  for (const row of databaseRows) {
    const fallback = rows.get(row.id) || {};
    const merged = { ...fallback, ...row };
    for (const key of ['nameZh', 'nameJa', 'nameEn', 'nameKo', 'imageSource', 'sourceUrl']) {
      if (!merged[key]) merged[key] = fallback[key] || null;
    }
    if (!Object.hasOwn(row, 'imageUrl')) merged.imageUrl = fallback.imageUrl || null;
    merged.aliases = uniqueValues(fallback.aliases || [], row.aliases || []);
    merged.printings = [...(fallback.printings || []), ...(row.printings || [])];
    rows.set(row.id, merged);
  }
  if (!keepFallbackOnly) {
    const ids = new Set(databaseRows.map(row => row.id));
    return [...rows.values()].filter(row => ids.has(row.id));
  }
  return [...rows.values()];
}

export function canonicalizeCatalog(catalog) {
  const grouped = new Map();
  for (const physical of catalog.cards || []) {
    const canonicalId = physical.canonicalId || physical.id;
    const existing = grouped.get(canonicalId);
    const derivedPrinting = {
      id: physical.id,
      cardId: physical.id,
      region: physical.region || null,
      language: physical.language || null,
      localSetCode: physical.localSetCode || null,
      localCardNumber: physical.officialCardNumber || null,
      imageUrl: physical.imageUrl || null,
      imageSource: physical.imageSource || null,
      source: physical.source || null,
      sourceUrl: physical.sourceUrl || null,
      imageRightsStatus: physical.imageRightsStatus || 'not-provided',
      imageLicenseExpiresAt: physical.imageLicenseExpiresAt || null,
      imageRehostRequired: physical.imageRehostRequired === true,
      releaseDate: physical.releaseDate || null,
      seriesId: physical.seriesId || null,
      rarity: physical.rarity || null,
      nameZh: physical.nameZh || null,
      nameJa: physical.nameJa || null,
      nameEn: physical.nameEn || null,
      nameKo: physical.nameKo || null
    };
    const printings = (physical.printings?.length ? physical.printings : [derivedPrinting]).map(p => ({
      ...derivedPrinting,
      ...p,
      id: p.id || p.cardId || physical.id,
      cardId: p.cardId || physical.id,
      seriesId: p.seriesId || physical.seriesId || null,
      localCardNumber: p.localCardNumber || physical.officialCardNumber || null,
      imageUrl: p.imageUrl || physical.imageUrl || null,
      imageSource: p.imageSource || physical.imageSource || null,
      source: p.source || physical.source || null
    }));
    if (!existing) {
      const usablePrinting = printings.find(browseHasUsableImage);
      grouped.set(canonicalId, {
        ...physical,
        id: canonicalId,
        canonicalId,
        physicalCardIds: [physical.id],
        aliases: uniqueValues(physical.aliases || [], physical.nameZh, physical.nameJa, physical.nameEn, physical.nameKo),
        printings,
        region: printings[0]?.region || physical.region || null,
        language: printings[0]?.language || physical.language || null,
        imageUrl: usablePrinting?.imageUrl || (imageRightsAllowDisplay(physical.imageRightsStatus, physical.imageLicenseExpiresAt, imageSourceOf(physical)) ? physical.imageUrl : null)
      });
      continue;
    }
    existing.physicalCardIds = uniqueValues(existing.physicalCardIds, physical.id);
    existing.aliases = uniqueValues(existing.aliases, physical.aliases || [], physical.nameZh, physical.nameJa, physical.nameEn, physical.nameKo);
    existing.printings.push(...printings);
    for (const key of ['nameZh', 'nameJa', 'nameEn', 'nameKo', 'rarity', 'imageUrl', 'imageSource']) {
      if (!existing[key] && physical[key]) existing[key] = physical[key];
    }
  }
  for (const card of grouped.values()) {
    const seen = new Set();
    card.printings = card.printings.filter(p => {
      const key = [p.id || p.providerId || '', p.cardId, p.region, p.language, p.localSetCode, p.localCardNumber, p.rarity || p.rarityCode || '', p.metadata?.variantKey || p.metadata?.imageId || ''].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(comparePrintings);
    const preferred = card.printings[0];
    const usable = card.printings.find(browseHasUsableImage);
    card.region = preferred?.region || card.region || null;
    card.language = preferred?.language || card.language || null;
    card.referenceRegion = preferred?.region || null;
    card.referencePrintingId = preferred?.id || preferred?.cardId || null;
    card.imageUrl = usable?.imageUrl || (imageRightsAllowDisplay(card.imageRightsStatus, card.imageLicenseExpiresAt, imageSourceOf(card)) ? card.imageUrl : null);
    card.printings = card.printings.map(printing => (browseHasUsableImage(printing) ? printing : { ...printing, imageUrl: null }));
    card.images = (card.images || []).map(item => (browseHasUsableImage(item) ? item : { ...item, imageUrl: null }));
  }
  return { ...catalog, cards: [...grouped.values()] };
}

export const cardNumberTerms = term => {
  const text = String(term).trim();
  const tokens = text.split(/[\s\-‐-―]+/).filter(Boolean);
  const head = tokens.slice(0, -1).join('');
  const last = tokens.at(-1) || '';
  if (tokens.length < 2 || tokens.length > 3 || !tokens.every(t => /^[a-z0-9]+$/i.test(t)) || !/^[a-z]{1,5}\d{0,3}[a-z]?$/i.test(head) || !/^[a-z]{0,3}\d{1,4}$/i.test(last)) return [];
  const spellings = [`${head}-${last}`];
  if (/^\d{1,2}$/.test(last)) spellings.push(`${head}-${last.padStart(3, '0')}`);
  return spellings.filter(v => v.toLowerCase() !== text.toLowerCase());
};

export const sourceMarkupTerms = term => {
  if (term.includes('<')) return [];
  const variants = [];
  for (let i = term.indexOf('的'); i > 0 && i < term.length - 1 && variants.length < 3; i = term.indexOf('的', i + 1)) {
    variants.push(`<${term.slice(0, i + 1)}>${term.slice(i + 1)}`);
  }
  return variants;
};

export const searchQueryTerms = rawQuery => {
  const raws = [].concat(rawQuery);
  const mapped = externalAliasIndex.get(normalizeSearch(raws[0]))?.query;
  return [...new Set(
    [...raws, mapped]
      .filter(Boolean)
      .map(postgrestLike)
      .filter(Boolean)
      .flatMap(term => [term, ...sourceMarkupTerms(term), ...anniversaryTerms(term), ...cardNumberTerms(term)])
  )].slice(0, SEARCH_PATTERNS_MAX);
};

export function suggestBody(body, region) {
  const pick = c => {
    const list = c.printings || [];
    if (list.length < 2) return c;
    const p = list.find(x => x.imageUrl && (region === 'ALL' || x.region === region)) || list.find(x => x.imageUrl) || list[0];
    return { ...c, printings: [p] };
  };
  return { ...body, data: (body.data || []).map(pick) };
}

export const cardMatchRank = (card, needles) => {
  const names = [card.nameZh, card.nameJa, card.nameEn, card.nameKo, card.officialCardNumber].map(normalizeSearch).filter(Boolean);
  if (names.some(name => needles.includes(name))) return 0;
  if (names.some(name => needles.some(needle => name.startsWith(needle)))) return 1;
  if (names.some(name => needles.some(needle => name.includes(needle)))) return 2;
  return 3;
};

export const searchTimedOut = error => /57014|statement timeout|aborted due to timeout|TimeoutError/i.test(`${error?.name || ''} ${error?.message || error || ''}`);

export function tcgdexLookups(card) {
  const seen = new Map();
  for (const x of [card, ...(card.printings || [])]) {
    const l = tcgdexLookupForPrinting(x, card, { enSetMap: TCGDEX_EN_SET_MAP });
    if (l && !seen.has(`${l.language}:${l.id}`)) seen.set(`${l.language}:${l.id}`, l);
  }
  return [...seen.values()].slice(0, 3);
}

export function priceHistoryCardIds(card, requestedId) {
  return [...new Set([requestedId, card?.id, ...(card?.printings || []).map(p => p.cardId)].filter(id => typeof id === 'string' && id))].slice(0, PRICE_HISTORY_IDS_MAX);
}

const VERSION_REGION_ORDER = ['JP', 'TW', 'US', 'KR', 'ASIA'];
const SNAPSHOT_SOURCE_NAMES = { cardmarket: 'Cardmarket', tcgplayer: 'TCGplayer' };

export function buildVersionPrices(card, records = [], snapshotCards = [], { fx = null } = {}) {
  const printings = new Map();
  for (const p of card?.printings || []) if (p?.cardId && !printings.has(p.cardId)) printings.set(p.cardId, p);
  if (!printings.size && card?.id) printings.set(card.id, { cardId: card.id, region: card.region, language: card.language, localCardNumber: card.officialCardNumber });
  const perRegion = new Map();
  for (const p of printings.values()) perRegion.set(p.region || '', (perRegion.get(p.region || '') || 0) + 1);
  const snapshots = new Map((snapshotCards || []).map(entry => [entry.cardId, entry.prices || []]));
  const order = region => {
    const index = VERSION_REGION_ORDER.indexOf(region);
    return index < 0 ? VERSION_REGION_ORDER.length : index;
  };
  return [...printings.values()]
    .sort((a, b) => order(a.region) - order(b.region) || compareAscii(String(a.localCardNumber || ''), String(b.localCardNumber || '')) || compareAscii(String(a.cardId), String(b.cardId)))
    .map(p => {
      const live = perRegion.get(p.region || '') === 1
        ? (records || []).filter(r => r?.region === p.region && Number.isFinite(Number(r.amount))).map(r => ({
            provider: r.provider,
            source: r.provider === 'yuyutei' ? '遊々亭' : (r.market || r.provider),
            priceType: r.priceType,
            variant: r.variant || '',
            currency: r.currency,
            amount: Number(r.amount),
            amountTwd: r.priceTwd ?? amountToTwd(r.amount, r.currency, fx),
            observedAt: r.observedAt || null,
            origin: 'market'
          }))
        : [];
      const has = new Set(live.filter(r => r.priceType === 'market').map(r => `${r.source}|${r.variant}`));
      const snapshot = (snapshots.get(p.cardId) || [])
        .filter(r => !r.stale && SNAPSHOT_SOURCE_NAMES[r.provider] && !has.has(`${SNAPSHOT_SOURCE_NAMES[r.provider]}|${r.variant || ''}`))
        .map(r => ({
          provider: r.provider,
          source: SNAPSHOT_SOURCE_NAMES[r.provider],
          priceType: 'market',
          variant: r.variant || '',
          currency: r.currency,
          amount: r.amount,
          amountTwd: r.amountTwd ?? null,
          observedAt: r.snapshotDate ? `${r.snapshotDate}T00:00:00.000Z` : null,
          origin: 'snapshot'
        }));
      return {
        cardId: p.cardId,
        region: p.region || null,
        language: p.language || null,
        localSetCode: p.localSetCode || null,
        localCardNumber: p.localCardNumber || null,
        variantName: p.metadata?.variantName || null,
        prices: [...live, ...snapshot].sort((a, b) => compareAscii(a.source, b.source) || compareAscii(a.priceType, b.priceType) || compareAscii(a.variant, b.variant))
      };
    });
}

export function buildPriceMovers(rows, fx, now = Date.now()) {
  const up = [];
  const down = [];
  for (const row of rows || []) {
    const from = Number(row.from_amount);
    const to = Number(row.to_amount);
    const change = Number(row.change_percent);
    if (!row?.card_id || !Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(change)) continue;
    (row.direction === 'up' ? up : down).push({
      cardId: row.card_id,
      name: row.name_zh || row.name_ja || row.name_en || row.card_number || row.card_id,
      nameJa: row.name_ja || null,
      cardNumber: row.card_number || null,
      seriesCode: row.series_code || null,
      seriesName: row.series_name || null,
      imageUrl: row.image_url || null,
      variant: row.variant || '',
      currency: row.currency,
      changePercent: change,
      from: { date: String(row.from_date).slice(0, 10), amount: from, amountTwd: amountToTwd(from, row.currency, fx) },
      to: { date: String(row.to_date).slice(0, 10), amount: to, amountTwd: amountToTwd(to, row.currency, fx) }
    });
  }
  return {
    data: { up, down },
    meta: {
      provider: 'cardmarket',
      windowDays: PRICE_MOVERS_DAYS,
      minAmount: PRICE_MOVERS_MIN_EUR,
      currency: 'EUR',
      note: '這是歐洲平台的參考價，不是成交價或台灣行情；新台幣以今日匯率換算，未含運費與關稅，也不是買賣建議。',
      generatedAt: new Date(now).toISOString()
    }
  };
}

export function buildHotCardsPayload(rows, now = Date.now()) {
  return {
    data: (rows || []).filter(row => row?.card_id).map(row => ({
      cardId: row.card_id,
      name: row.name_zh || row.name_ja || row.name_en || row.card_number || row.card_id,
      nameJa: row.name_ja || null,
      cardNumber: row.card_number || null,
      seriesCode: row.series_code || null,
      seriesName: row.series_name || null,
      game: row.game || null,
      imageUrl: row.image_url || null
    })),
    meta: {
      windowDays: HOT_CARDS_DAYS,
      minOpens: HOT_CARDS_MIN_OPENS,
      generatedAt: new Date(now).toISOString()
    }
  };
}

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function buildStats(rows) {
  const groups = {};
  for (const r of rows) (groups[r.currency] ??= []).push(Number(r.price));
  const stats = {};
  for (const [currency, p] of Object.entries(groups)) {
    stats[currency] = {
      count: p.length,
      min: Math.min(...p),
      max: Math.max(...p),
      median: median(p),
      avg: Math.round(p.reduce((a, b) => a + b, 0) / p.length * 100) / 100
    };
  }
  return stats;
}
