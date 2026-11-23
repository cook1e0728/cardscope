import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareWorkerAssets } from '../scripts/prepare-worker-assets.mjs';
import { API_CSP } from '../providers/http-security.mjs';
import { createSupabaseClient } from '../providers/supabase-client.mjs';
import { DEFAULT_MIGRATED_APIS, createWorkerHandler } from '../worker/index.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FETCH_BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080
]);

async function listenEphemeral(httpServer) {
  for (;;) {
    await new Promise((resolveListen, rejectListen) => {
      httpServer.once('error', rejectListen);
      httpServer.listen(0, '127.0.0.1', resolveListen);
    });
    const { port } = httpServer.address();
    if (!FETCH_BAD_PORTS.has(port)) return port;
    await new Promise(resolveClose => httpServer.close(resolveClose));
  }
}

async function freePort() {
  const probe = createServer();
  const port = await listenEphemeral(probe);
  await new Promise(resolveClose => probe.close(resolveClose));
  return port;
}

const closeServer = httpServer => (httpServer?.listening ? new Promise(resolveClose => httpServer.close(resolveClose)) : Promise.resolve());

const VOLATILE_TIMESTAMP_KEYS = new Set([
  'generatedAt',
  'updatedAt',
  'lastSuccessAt',
  'expiresAt',
  'staleUntil',
  'fetchedAt',
  'observedAt'
]);

function normalizeDynamicFields(value, key = '') {
  if (Array.isArray(value)) return value.map(item => normalizeDynamicFields(item, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'ageMs' && typeof v === 'number') {
        assert.ok(v >= 0);
        out[k] = '<AGE_MS>';
      } else if (VOLATILE_TIMESTAMP_KEYS.has(k) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
        assert.ok(Number.isFinite(Date.parse(v)), `invalid ISO timestamp for ${k}: ${v}`);
        out[k] = '<ISO_TS>';
      } else {
        out[k] = normalizeDynamicFields(v, k);
      }
    }
    return out;
  }
  return value;
}

function assertApiSecurityHeaders(res, expectedCacheControl) {
  assert.equal(res.headers.get('content-security-policy'), API_CSP);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(String(res.headers.get('vary') || ''), /\bAccept-Encoding\b/i);
  if (expectedCacheControl !== undefined) {
    assert.equal(res.headers.get('cache-control'), expectedCacheControl);
  }
}

function makeCard(id, game, seriesId, num, rarity, nameZh, nameJa, nameEn, extra = {}) {
  return {
    id,
    canonicalId: id,
    game,
    seriesId,
    officialCardNumber: num,
    rarity,
    nameZh,
    nameJa,
    nameEn,
    nameKo: null,
    aliases: [],
    metadata: {},
    source: 'pokemontcg',
    providerId: id,
    region: extra.region || 'JP',
    language: extra.language || 'ja-JP',
    imageUrl: `https://images.pokemontcg.io/${seriesId}/${num}.png`,
    printings: [
      {
        id: `pr-${id}`,
        cardId: id,
        seriesId,
        region: extra.region || 'JP',
        language: extra.language || 'ja-JP',
        localSetCode: extra.setCode || 'SV2a',
        localCardNumber: num,
        rarity,
        rarityCode: rarity,
        rarityLabel: rarity,
        imageUrl: `https://images.pokemontcg.io/${seriesId}/${num}.png`,
        source: 'pokemontcg',
        sourceUrl: null,
        providerId: id,
        releaseDate: extra.releaseDate || '2026-10-01',
        imageRehostRequired: false,
        imageRightsStatus: 'not-provided',
        imageLicenseExpiresAt: null,
        metadata: {}
      }
    ],
    images: []
  };
}

function buildBigSeriesFixtures() {
  const seriesId = 'pokemon-big-600';
  const cards = [];
  const printings = [];
  const rarities = ['C', 'U', 'R', 'RR', 'AR', 'SR', 'SAR', 'UR'];
  for (let i = 1; i <= 600; i++) {
    const num = String(i).padStart(3, '0');
    const id = `pokemon-big-${num}`;
    const rarity = rarities[i % rarities.length];
    cards.push({
      id,
      canonicalId: id,
      game: 'pokemon',
      seriesId,
      officialCardNumber: num,
      rarity,
      nameZh: `測試卡${num}`,
      nameJa: `テスト${num}`,
      nameEn: `Test Card ${num}`,
      nameKo: null,
      aliases: [],
      metadata: {},
      source: 'pokemontcg',
      providerId: id
    });
    printings.push({
      id: `pr-big-${num}`,
      cardId: id,
      seriesId,
      region: 'JP',
      language: 'ja-JP',
      localSetCode: 'BIG600',
      localCardNumber: num,
      rarity,
      rarityCode: rarity,
      rarityLabel: rarity,
      imageUrl: `https://images.pokemontcg.io/big/${num}.png`,
      source: 'pokemontcg',
      providerId: id,
      releaseDate: '2026-10-01',
      imageRehostRequired: false,
      imageRightsStatus: 'not-provided',
      imageLicenseExpiresAt: null,
      metadata: {}
    });
  }
  return { cards, printings, images: [] };
}

function createMockUpstream(state) {
  const bigSeries = buildBigSeriesFixtures();
  const sampleCatalogCard = makeCard('pokemon-cat-sample', 'pokemon', 'pokemon-jp-sv2a', '001', 'C', '妙蛙種子', 'フシギダネ', 'Bulbasaur');
  const detailPokemonCard = {
    ...makeCard('pokemon-p1', 'pokemon', 'pokemon-jp-sv2a', '025', 'SAR', '皮卡丘ex', 'ピカチュウex', 'Pikachu ex'),
    printings: [
      {
        id: 'pr-p1-jp',
        cardId: 'pokemon-p1',
        seriesId: 'pokemon-jp-sv2a',
        region: 'JP',
        language: 'ja-JP',
        localSetCode: 'SV2a',
        localCardNumber: '025',
        rarity: 'SAR',
        rarityCode: 'SAR',
        rarityLabel: 'SAR',
        imageUrl: 'https://assets.tcgdex.net/ja/sv/sv2a/025.webp',
        source: 'tcgdex-ja',
        providerId: 'sv2a-025',
        releaseDate: '2026-10-01',
        imageRehostRequired: false,
        imageRightsStatus: 'not-provided',
        metadata: {}
      },
      {
        id: 'pr-p1-tw',
        cardId: 'pokemon-p1-tw',
        seriesId: 'pokemon-tw-sv2a',
        region: 'TW',
        language: 'zh-TW',
        localSetCode: 'SV2a',
        localCardNumber: '025',
        rarity: 'SAR',
        rarityCode: 'SAR',
        rarityLabel: 'SAR',
        imageUrl: 'https://asia.pokemon-card.com/tw/card-img/tw0001.png',
        source: 'asia-pokemon-card-official-tw',
        providerId: 'tw-025',
        releaseDate: '2026-10-01',
        imageRehostRequired: false,
        imageRightsStatus: 'not-provided',
        metadata: {}
      }
    ]
  };
  const yugiohCard = {
    ...makeCard('yugioh-be-001', 'yugioh', 'yugioh-s1', 'LOB-001', 'Ultra Rare', '青眼白龍', '青眼の白龍', 'Blue-Eyes White Dragon', { region: 'US', language: 'en-US', setCode: 'LOB' }),
    source: 'ygoprodeck',
    printings: [
      {
        id: 'pr-ygo-us',
        cardId: 'yugioh-be-001',
        seriesId: 'yugioh-s1',
        region: 'US',
        language: 'en-US',
        localSetCode: 'LOB',
        localCardNumber: 'LOB-001',
        rarity: 'Ultra Rare',
        rarityCode: 'Ultra Rare',
        rarityLabel: 'Ultra Rare',
        imageUrl: null,
        source: 'ygoprodeck',
        providerId: '89631139',
        releaseDate: '2026-09-01',
        imageRehostRequired: true,
        imageRightsStatus: 'not-provided',
        metadata: {}
      }
    ]
  };
  const uaCard = makeCard('union-arena-bt01-001', 'union-arena', 'union-arena-bt01', 'UA01BT/001', 'SR', '炭治郎', '竈門炭治郎', 'Tanjiro Kamado', { setCode: 'UA01BT' });
  const seriesMain = [
    {
      id: 'pokemon-jp-sv2a',
      game: 'pokemon',
      officialCode: 'SV2a',
      nameZh: '寶可夢卡牌 151',
      nameJa: 'ポケモンカード151',
      nameEn: 'Pokemon Card 151',
      nameKo: null,
      region: 'JP',
      language: 'ja-JP',
      releaseDate: '2026-10-01',
      aliases: [],
      sourceUrl: 'https://www.pokemon-card.com/ex/sv2a/',
      imageUrl: null,
      imageKind: 'series-logo',
      metadata: {}
    }
  ];
  const seriesIp2 = [
    {
      id: 'union-arena-bt01',
      game: 'union-arena',
      officialCode: 'UA01BT',
      nameZh: '鬼滅之刃',
      nameJa: '鬼滅の刃',
      nameEn: null,
      nameKo: null,
      region: 'JP',
      language: 'ja-JP',
      releaseDate: '2026-10-15',
      aliases: [],
      sourceUrl: 'https://www.unionarena-tcg.com/jp/products/bt01.php',
      imageUrl: null,
      imageKind: 'series-logo',
      metadata: {}
    }
  ];

  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);

  return createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      const body = bodyStr ? (() => { try { return JSON.parse(bodyStr); } catch { return bodyStr; } })() : null;
      state.requests.push({ method: req.method, path: url.pathname, search: url.search, body });

      const sendJson = (status, data, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
        res.end(JSON.stringify(data));
      };

      if (state.forceUpstreamLeak && url.pathname.startsWith(`/${state.forceUpstreamLeak}`)) {
        return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_LEAK' });
      }

      if (!url.pathname.startsWith('/main/') && !url.pathname.startsWith('/ip2/') && !url.pathname.startsWith('/ext/')) {
        state.originCalls.push({ method: req.method, path: url.pathname + url.search });
        return sendJson(200, { proxiedByOrigin: true, path: url.pathname + url.search });
      }

      // 外部 API mocks
      if (url.pathname.startsWith('/ext/fx/')) {
        state.extCalls.push('fx');
        if (state.fxMode === 'jump') {
          return sendJson(200, { result: 'success', time_last_update_utc: 'Mon, 23 Nov 2026 00:00:00 +0000', rates: { JPY: 4.5, USD: 0.031, EUR: 0.2 } });
        }
        return sendJson(200, { result: 'success', time_last_update_utc: 'Mon, 23 Nov 2026 00:00:00 +0000', rates: { JPY: 4.8, USD: 0.03125, EUR: 0.028 } });
      }
      if (url.pathname.startsWith('/ext/ygo/')) {
        state.extCalls.push('ygo');
        if (state.failExternalMarket) return sendJson(500, { error: 'SECRET_YGO_INTERNAL_ERROR' });
        return sendJson(200, {
          data: [{
            id: 89631139,
            name: 'Blue-Eyes White Dragon',
            card_sets: [{ set_name: 'Legend of Blue Eyes', set_code: 'LOB-001', set_rarity: 'Ultra Rare', set_rarity_code: '(UR)', set_price: '25.50' }],
            card_prices: [{ cardmarket_price: '10.00', tcgplayer_price: '20.00' }]
          }]
        });
      }
      if (url.pathname.startsWith('/ext/tcgdex/')) {
        state.extCalls.push('tcgdex');
        if (state.failExternalMarket) return sendJson(500, { error: 'SECRET_TCGDEX_INTERNAL_ERROR' });
        return sendJson(200, {
          id: 'sv2a-025',
          name: 'ピカチュウex',
          variants_detailed: [{
            type: 'holo',
            pricing: {
              cardmarket: { unit: 'EUR', trend: 18.5, low: 14.0, avg7: 18.0, avg30: 17.2, idProduct: 777, updated: new Date(Date.now() - 86400000).toISOString() }
            }
          }]
        });
      }
      if (url.pathname.startsWith('/ext/onepiece/')) {
        state.extCalls.push('onepiece');
        if (url.searchParams.get('fail') === '1') return sendJson(500, { error: 'SECRET_OP_ERR' });
        if (url.searchParams.get('redirect') === '1') {
          res.writeHead(302, { Location: 'https://evil.example/redirect.png' });
          return res.end();
        }
        if (url.searchParams.get('svg') === '1') {
          res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
          return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
        }
        if (url.searchParams.get('streamHuge') === '1') {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.write(Buffer.alloc(6 * 1024 * 1024));
          return res.end();
        }
        if (url.searchParams.get('huge') === '1') {
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(6 * 1024 * 1024) });
          return res.end(Buffer.alloc(16));
        }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(pngBytes.length) });
        return res.end(pngBytes);
      }

      const isIp2 = url.pathname.startsWith('/ip2/');
      const prefix = isIp2 ? '/ip2' : '/main';
      if (!url.pathname.startsWith(`${prefix}/rest/v1`)) return sendJson(404, { error: 'not found' });
      const restPath = url.pathname.slice(`${prefix}/rest/v1`.length);

      if (state.failAllDb || (isIp2 && state.failIp2)) {
        return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99' });
      }

      // RPCs
      if (restPath === '/rpc/db_size_report') {
        if (!isIp2 && state.failMainStorage) return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_MAIN_STORAGE' });
        if (isIp2 && state.failIp2Storage) return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_IP2_STORAGE' });
        return sendJson(200, { databaseBytes: isIp2 ? 50 * 1024 * 1024 : 120 * 1024 * 1024 });
      }
      if (restPath === '/rpc/catalog_health_snapshot_v2') {
        if (state.healthMode === 'legacy' || state.healthMode === 'fail-both') return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_V2' });
        return sendJson(200, { totalCards: 5000, games: { pokemon: { cards: 3000 } }, source: 'supabase-rpc-v2' });
      }
      if (restPath === '/rpc/catalog_health_snapshot') {
        if (state.healthMode === 'fail-both') return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_LEGACY' });
        return sendJson(200, { totalCards: 4999, games: { pokemon: { cards: 2999 } }, source: 'supabase-rpc-legacy' });
      }
      if (restPath === '/rpc/price_reference_best') {
        if (state.failRefPrice) return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_REF' });
        const today = new Date().toISOString().slice(0, 10);
        const ids = Array.isArray(body?.p_ids) ? body.p_ids : [];
        return sendJson(200, ids.slice(0, 3).map((id, i) => ({
          card_id: id,
          variant: 'holo',
          currency: 'EUR',
          amount: 10 + i * 2,
          snapshot_date: today,
          observed_at: `${today}T12:00:00Z`
        })));
      }
      if (restPath === '/rpc/price_reference_prior') {
        const priorDate = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
        const ids = Array.isArray(body?.p_ids) ? body.p_ids : [];
        return sendJson(200, ids.slice(0, 1).map(id => ({
          card_id: id,
          provider: 'cardmarket',
          variant: 'holo',
          currency: 'EUR',
          amount: 8,
          snapshot_date: priorDate
        })));
      }
      if (restPath === '/rpc/price_products_shared') {
        return sendJson(200, ['pokemon-p1-twin']);
      }
      if (restPath === '/rpc/price_movers') {
        if (state.failMovers) return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_MOVERS' });
        return sendJson(200, [{
          direction: 'up',
          card_id: 'pokemon-p1',
          variant: 'holo',
          currency: 'EUR',
          from_date: '2026-11-01',
          from_amount: 10,
          to_date: '2026-11-15',
          to_amount: 15,
          change_percent: 50,
          name_zh: '皮卡丘ex',
          name_ja: 'ピカチュウex',
          card_number: '025',
          series_code: 'SV2a',
          series_name: '寶可夢卡牌 151',
          image_url: 'https://assets.tcgdex.net/ja/sv/sv2a/025.webp'
        }]);
      }
      if (restPath === '/rpc/card_hot_top') {
        if (state.failHot) return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_HOT' });
        return sendJson(200, [{
          card_id: 'pokemon-p1',
          name_zh: '皮卡丘ex',
          name_ja: 'ピカチュウex',
          card_number: '025',
          series_code: 'SV2a',
          series_name: '寶可夢卡牌 151',
          game: 'pokemon',
          image_url: 'https://assets.tcgdex.net/ja/sv/sv2a/025.webp'
        }]);
      }
      if (restPath === '/rpc/card_hot_add') {
        state.hotWrites++;
        return sendJson(200, { ok: true });
      }
      if (restPath === '/rpc/browse_cards_page') {
        if (isIp2) return sendJson(200, { cards: [uaCard], total: 1 });
        return sendJson(200, { cards: [sampleCatalogCard, detailPokemonCard].slice(0, body.p_limit || 60), total: 2 });
      }
      if (restPath === '/rpc/browse_series_cards') {
        if (body.p_series === 'pokemon-empty-series') return sendJson(200, { cards: [], printings: [], images: [], siblingImages: [] });
        if (body.p_series === 'pokemon-huge-fallback') return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_HUGE_SERIES' });
        if (body.p_series === 'pokemon-big-600') return sendJson(200, bigSeries);
        return sendJson(200, {
          cards: [detailPokemonCard].map(({ printings, images, ...c }) => c),
          printings: detailPokemonCard.printings,
          images: [],
          siblingImages: []
        });
      }
      if (restPath === '/rpc/browse_rarity_values') {
        return sendJson(200, ['SAR', 'C']);
      }
      if (restPath === '/rpc/browse_cards_filtered' || restPath === '/rpc/browse_cards_priced') {
        return sendJson(200, { cards: [detailPokemonCard], total: 1, unmapped: false });
      }
      if (restPath === '/rpc/browse_cards_facets') {
        return sendJson(200, { rarity: { SAR: 1 }, region: { JP: 1 }, language: { 'ja-JP': 1 }, unmapped: false });
      }
      if (restPath === '/rpc/get_card_detail') {
        const id = body?.p_id;
        if (isIp2 && id === uaCard.id) return sendJson(200, { cards: [uaCard], series: seriesIp2, games: [{ id: 'union-arena', nameZh: 'UNION ARENA' }] });
        if (!isIp2 && id === sampleCatalogCard.id) return sendJson(200, { cards: [sampleCatalogCard], series: seriesMain, games: [{ id: 'pokemon', nameZh: '寶可夢' }] });
        if (!isIp2 && id === detailPokemonCard.id) return sendJson(200, { cards: [detailPokemonCard], series: seriesMain, games: [{ id: 'pokemon', nameZh: '寶可夢' }] });
        if (!isIp2 && id === yugiohCard.id) return sendJson(200, { cards: [yugiohCard], series: [], games: [{ id: 'yugioh', nameZh: '遊戲王' }] });
        return sendJson(200, { cards: [], series: [], games: [] });
      }
      if (restPath === '/rpc/search_cards_ranked') {
        if (state.failSearch || state.failSearchRpc) return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_SEARCH' });
        const joined = (body?.p_needles || []).join(' ');
        if (/不存在的怪獸|typopikachu/.test(joined)) {
          return sendJson(200, { cards: [], matchCount: 0, groupCount: 0, matchedBy: 'none' });
        }
        if (/日向翔陽/.test(joined)) {
          return sendJson(200, { cards: [], matchCount: 0, groupCount: 0, matchedBy: 'none' });
        }
        if (/日向\s+翔陽/.test(joined)) {
          const hCard = makeCard('haikyuu-1', 'haikyuu', 'haikyuu-s1', 'HV-01', 'N', '日向翔陽', '日向 翔陽', 'Hinata');
          return sendJson(200, { cards: [{ ...hCard, hit: 0 }], matchCount: 1, groupCount: 1, matchedBy: 'name' });
        }
        if (isIp2) {
          return sendJson(200, { cards: [{ ...uaCard, hit: 2 }], matchCount: 1, groupCount: 1, matchedBy: 'name' });
        }
        return sendJson(200, { cards: [{ ...detailPokemonCard, hit: 0 }], matchCount: 1, groupCount: 1, matchedBy: 'name' });
      }
      if (restPath === '/rpc/search_cards_with_siblings' && state.failSearchRpc) {
        return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_SEARCH_SIBLINGS' });
      }
      if (restPath === '/rpc/search_fold_names') {
        if (state.failSearchRpc) return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_SEARCH_FOLD' });
        return sendJson(200, [{ name: '日向 翔陽' }]);
      }
      if (restPath === '/rpc/search_name_suggestion') {
        if (state.failSearchRpc) return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_SEARCH_SUGGEST' });
        if (!isIp2 && /typopikachu/i.test(body?.p_q || '')) return sendJson(200, 'Pikachu');
        return sendJson(200, null);
      }

      // Tables
      if (restPath === '/exchange_rates') {
        if (req.method === 'POST') {
          state.fxWrites++;
          return sendJson(201, []);
        }
        const fetchedAt = state.staleFx
          ? new Date(Date.now() - 48 * 3600000).toISOString()
          : new Date(Date.now() - 3600000).toISOString();
        const rateDate = fetchedAt.slice(0, 10);
        return sendJson(200, [
          { currency: 'JPY', rate_to_twd: 0.21, rate_date: rateDate, source: 'test-db', fetched_at: fetchedAt },
          { currency: 'USD', rate_to_twd: 32, rate_date: rateDate, source: 'test-db', fetched_at: fetchedAt },
          { currency: 'EUR', rate_to_twd: 35, rate_date: rateDate, source: 'test-db', fetched_at: fetchedAt }
        ]);
      }
      if (restPath === '/catalog_sync_runs') {
        return sendJson(200, [{ provider: 'pokemontcg', scope: 'all', status: 'completed', rowsSeen: 100, rowsWritten: 10, startedAt: '2026-11-22T00:00:00Z', finishedAt: '2026-11-22T00:05:00Z' }]);
      }
      if (restPath === '/tcg_games') {
        return sendJson(200, isIp2 ? [{ id: 'union-arena', nameZh: 'UNION ARENA', nameJa: 'UNION ARENA', nameEn: 'UNION ARENA', nameKo: null }] : [{ id: 'pokemon', nameZh: '寶可夢', nameJa: 'ポケモン', nameEn: 'Pokémon', nameKo: null }]);
      }
      if (restPath === '/tcg_series') {
        const select = url.searchParams.get('select') || '';
        if (select.includes('release_date') && select.includes('source_url') && select.includes('game_id')) {
          if (!isIp2 && state.failSeriesEvents) return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_SERIES_EVENTS' });
          const eventDate = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
          return sendJson(200, isIp2
            ? [{ game_id: 'union-arena', region: 'JP', release_date: eventDate, name_zh: 'UA測試彈', name_ja: null, name_en: null, source_url: 'https://www.unionarena-tcg.com/jp/' }]
            : [{ game_id: 'pokemon', region: 'JP', release_date: eventDate, name_zh: '151測試', name_ja: null, name_en: null, source_url: 'https://www.pokemon-card.com/ex/sv2a/' }]);
        }
        if (url.searchParams.has('or') && /zzzznotfound/.test(url.searchParams.get('or') || '')) {
          return sendJson(200, []);
        }
        return sendJson(200, isIp2 ? seriesIp2 : seriesMain);
      }
      if (restPath === '/tcg_cards') {
        state.cardTableScans++;
        if (url.searchParams.has('or') && /zzzznotfound/.test(url.searchParams.get('or') || '')) {
          return sendJson(200, []);
        }
        return sendJson(200, [sampleCatalogCard], { 'content-range': '0-0/1' });
      }
      if (restPath === '/tcg_printings') {
        if (url.searchParams.get('series_id') === 'eq.pokemon-huge-fallback') {
          const rows = [];
          for (let i = 1; i <= 550; i++) {
            const num = String(i).padStart(3, '0');
            rows.push({
              id: `pr-hf-${num}`,
              cardId: `pokemon-hf-${num}`,
              seriesId: 'pokemon-huge-fallback',
              region: 'JP',
              language: 'ja-JP',
              localSetCode: 'HF550',
              localCardNumber: num,
              rarity: 'C',
              rarityCode: 'C',
              rarityLabel: 'C',
              imageUrl: null,
              source: 'pokemontcg',
              providerId: `hf-${num}`,
              releaseDate: '2026-10-01',
              imageRehostRequired: false,
              imageRightsStatus: 'not-provided',
              metadata: {}
            });
          }
          return sendJson(200, rows);
        }
        return sendJson(200, sampleCatalogCard.printings);
      }
      if (restPath === '/card_images') {
        return sendJson(200, []);
      }
      if (restPath === '/tcg_products') {
        return sendJson(200, [{
          id: 'prod-sv2a',
          game: 'pokemon',
          seriesId: 'pokemon-jp-sv2a',
          officialCode: 'SV2a',
          productType: '強化拡張パック',
          nameZh: '寶可夢卡牌151',
          nameJa: 'ポケモンカード151',
          name: 'Pokemon Card 151',
          nameKo: null,
          region: 'JP',
          language: 'ja-JP',
          releaseDate: '2026-10-01',
          imageUrl: null,
          imageKind: 'sealed-product',
          source: 'pokemon-card-official-jp',
          sourceUrl: 'https://www.pokemon-card.com/products/index.html',
          metadata: { imageRightsStatus: 'licensed' }
        }]);
      }
      if (restPath === '/price_snapshots') {
        if (state.failSnapshots) return sendJson(500, { message: 'SECRET_INTERNAL_PG_TABLE_99_SNAP' });
        const today = new Date().toISOString().slice(0, 10);
        return sendJson(200, [
          { card_id: 'pokemon-p1', provider: 'cardmarket', variant: 'holo', currency: 'EUR', snapshot_date: today, amount: 12.5 },
          { card_id: 'pokemon-p1-tw', provider: 'tcgplayer', variant: 'tcgapi-holofoil', currency: 'USD', snapshot_date: today, amount: 8.2 }
        ]);
      }
      if (restPath === '/reports') {
        const select = url.searchParams.get('select') || '';
        if (select === 'currency,price') return sendJson(200, [{ currency: 'TWD', price: 300 }, { currency: 'TWD', price: 500 }]);
        return sendJson(200, [{
          id: 'rep-1',
          cardName: '皮卡丘ex',
          cardId: 'pokemon-p1',
          game: 'pokemon',
          platform: '蝦皮購物',
          currency: 'TWD',
          price: 400,
          condition: 'NM',
          note: 'good',
          tradedAt: '2026-11-20',
          createdAt: '2026-11-20T00:00:00Z',
          status: 'verified'
        }]);
      }
      return sendJson(200, []);
    });
  });
}

async function spawnTestServer({ mockPort, preloadPath, supabase = true, supabase2 = true, scrapeSecret = '', supabaseKey = 'test-main-key', supabase2Key = 'test-ip2-key' }) {
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    CATALOG_WARM_ON_START: 'false',
    CATALOG_SYNC_ON_START: 'false',
    CARD_IMAGE_CACHE_ON_START: 'false',
    SUPABASE_URL: supabase ? `http://127.0.0.1:${mockPort}/main` : '',
    SUPABASE_SERVICE_KEY: supabase ? supabaseKey : '',
    SUPABASE2_URL: supabase2 ? `http://127.0.0.1:${mockPort}/ip2` : '',
    SUPABASE2_SERVICE_KEY: supabase2 ? supabase2Key : '',
    SCRAPE_SECRET: scrapeSecret
  };
  const args = preloadPath ? ['--import', new URL(`file:///${preloadPath.replace(/\\/g, '/')}`).href, 'server.mjs'] : ['server.mjs'];
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolveReady, rejectReady) => {
    let out = '';
    const timer = setTimeout(() => rejectReady(new Error(`server start timeout: ${out}`)), 8000);
    child.once('exit', code => { clearTimeout(timer); rejectReady(new Error(`server exited ${code}: ${out}`)); });
    child.stdout.on('data', d => { out += d; if (out.includes('CardScope is running')) { clearTimeout(timer); resolveReady(); } });
    child.stderr.on('data', d => { out += d; });
  });
  return { baseUrl: `http://127.0.0.1:${port}`, child };
}

function createWorkerEnv(mockPort, { supabase = true, supabase2 = true, scrapeSecret = '', migratedApi, supabaseKey = 'test-main-key', supabase2Key = 'test-ip2-key' } = {}) {
  const env = {
    ORIGIN_URL: `http://127.0.0.1:${mockPort}`,
    PUBLIC_BASE_URL: 'https://cardseektcg.com',
    SUPABASE_URL: supabase ? `http://127.0.0.1:${mockPort}/main` : '',
    SUPABASE_SERVICE_KEY: supabase ? supabaseKey : '',
    SUPABASE2_URL: supabase2 ? `http://127.0.0.1:${mockPort}/ip2` : '',
    SUPABASE2_SERVICE_KEY: supabase2 ? supabase2Key : '',
    SCRAPE_SECRET: scrapeSecret,
    ASSETS: {
      async fetch() {
        return new Response('<!doctype html><title>CardSeek</title>', { status: 200 });
      }
    }
  };
  if (migratedApi !== undefined) env.MIGRATED_API = migratedApi;
  return env;
}

function createWorkerFetch(mockPort) {
  const rewrite = new Map([
    ['open.er-api.com', `/ext/fx`],
    ['db.ygoprodeck.com', `/ext/ygo`],
    ['api.tcgdex.net', `/ext/tcgdex`],
    ['asia-tc.onepiece-cardgame.com', `/ext/onepiece`]
  ]);
  return async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(raw);
    const prefix = rewrite.get(parsed.hostname);
    if (prefix) {
      return globalThis.fetch(`http://127.0.0.1:${mockPort}${prefix}${parsed.pathname}${parsed.search}`, init);
    }
    return globalThis.fetch(input, init);
  };
}

function createMockEdgeCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const hit = store.get(req.url);
      if (!hit) return undefined;
      return hit.clone();
    },
    async put(req, res) {
      store.set(req.url, res.clone());
    }
  };
}

const tempDirs = [];
const spawnedChildren = [];
const openServers = [];

after(async () => {
  for (const child of spawnedChildren) {
    try { child.kill(); } catch {}
  }
  for (const srv of openServers) {
    await closeServer(srv).catch(() => {});
  }
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Worker ↔ Node 全部 20 支搬遷端點在設定完整與未設 DB 下皆同輸入同輸出', async () => {
  const state = { requests: [], extCalls: [], originCalls: [], hotWrites: 0, fxWrites: 0, cardTableScans: 0 };
  const mockServer = createMockUpstream(state);
  const mockPort = await listenEphemeral(mockServer);
  openServers.push(mockServer);

  const tmpDir = await mkdtemp(join(tmpdir(), 'cardseek-parity-'));
  tempDirs.push(tmpDir);
  const preloadPath = join(tmpDir, 'fetch-preload.mjs');
  await writeFile(
    preloadPath,
    `const origFetch = globalThis.fetch;
const map = new Map([
  ['open.er-api.com', '/ext/fx'],
  ['db.ygoprodeck.com', '/ext/ygo'],
  ['api.tcgdex.net', '/ext/tcgdex'],
  ['asia-tc.onepiece-cardgame.com', '/ext/onepiece']
]);
globalThis.fetch = async (input, init) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const u = new URL(raw);
  const p = map.get(u.hostname);
  if (p) return origFetch('http://127.0.0.1:${mockPort}' + p + u.pathname + u.search, init);
  return origFetch(input, init);
};
`,
    'utf8'
  );

  const nodeServer = await spawnTestServer({ mockPort, preloadPath, supabase: true, supabase2: true });
  spawnedChildren.push(nodeServer.child);

  const edgeCache = createMockEdgeCache();
  const workerHandler = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache });
  const env = createWorkerEnv(mockPort, { supabase: true, supabase2: true });

  async function callBoth(path, { method = 'GET', headers = {}, body, compareJson = true, stripKeys = [] } = {}) {
    const nodeRes = await fetch(`${nodeServer.baseUrl}${path}`, { method, headers, body });
    const workerReq = new Request(`https://cardseektcg.com${path}`, { method, headers, body });
    const workerRes = await workerHandler.fetch(workerReq, env);
    assert.equal(workerRes.status, nodeRes.status, `${method} ${path} status mismatch`);
    assertApiSecurityHeaders(workerRes, nodeRes.headers.get('cache-control'));
    if (method === 'HEAD') {
      assert.equal(await workerRes.text(), '');
      return { nodeRes, workerRes };
    }
    if (!compareJson) return { nodeRes, workerRes };
    const nodeJson = normalizeDynamicFields(await nodeRes.json());
    const workerJson = normalizeDynamicFields(await workerRes.json());
    for (const keyPath of stripKeys) {
      delete nodeJson[keyPath];
      delete workerJson[keyPath];
    }
    assert.deepEqual(workerJson, nodeJson, `${method} ${path} JSON mismatch`);
    return { nodeRes, workerRes, nodeJson, workerJson };
  }

  // 1. catalog-health HEAD + GET
  await callBoth('/api/catalog/health', { method: 'HEAD' });
  await callBoth('/api/catalog/health');

  // 2. providers (含 SCRAPE_SECRET 切換)
  await callBoth('/api/providers');
  const nodeWithSecret = await spawnTestServer({ mockPort, preloadPath, supabase: true, supabase2: true, scrapeSecret: 'sec-1' });
  spawnedChildren.push(nodeWithSecret.child);
  const workerWithSecret = await workerHandler.fetch(new Request('https://cardseektcg.com/api/providers'), createWorkerEnv(mockPort, { scrapeSecret: 'sec-1' }));
  const nodeWithSecretJson = await (await fetch(`${nodeWithSecret.baseUrl}/api/providers`)).json();
  assert.deepEqual(await workerWithSecret.json(), nodeWithSecretJson);

  // 3-6. sources / sync-status / trends / buyback-prices
  await callBoth('/api/catalog/sources');
  await callBoth('/api/catalog/sync-status');
  await callBoth('/api/trends?limit=12');
  await callBoth('/api/buyback-prices?game=pokemon');
  await callBoth('/api/buyback-prices?game=yugioh');

  // 7. images-onepiece (200 bytes + edgeCache 命中 + 400 + 502 + >5MB)
  const opImgUrl = encodeURIComponent('https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP05-001.png');
  const opResPair = await callBoth(`/api/images/onepiece?url=${opImgUrl}`, { compareJson: false });
  assert.deepEqual(Buffer.from(await opResPair.workerRes.arrayBuffer()), Buffer.from(await opResPair.nodeRes.arrayBuffer()));
  const extBeforeCache = state.extCalls.filter(x => x === 'onepiece').length;
  const cachedOpRes = await workerHandler.fetch(new Request(`https://cardseektcg.com/api/images/onepiece?url=${opImgUrl}`), env);
  assert.equal(cachedOpRes.status, 200);
  assert.equal(state.extCalls.filter(x => x === 'onepiece').length, extBeforeCache, 'One Piece 圖片第 2 次應命中 Edge Cache');
  await callBoth(`/api/images/onepiece?url=${encodeURIComponent('https://evil.example/a.png')}`);
  await callBoth(`/api/images/onepiece?url=${encodeURIComponent('https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP05-001.png?fail=1')}`);
  await callBoth(`/api/images/onepiece?url=${encodeURIComponent('https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP05-001.png?huge=1')}`);

  // 8-9. catalog & products
  await callBoth('/api/catalog');
  await callBoth('/api/products');

  // 10. cards (fast, series+price, large-series 600, filtered, price-desc, ip2 union-arena, 400 validation)
  await callBoth('/api/cards?game=pokemon&limit=2&offset=0&sort=number-asc');
  await callBoth('/api/cards?game=pokemon&series=pokemon-jp-sv2a&sort=rarity-desc&limit=48');
  await callBoth('/api/cards?game=pokemon&region=JP&rarity=SAR&sort=name-asc&limit=10');
  await callBoth('/api/cards?game=pokemon&sort=price-desc&region=JP&limit=2');
  await callBoth('/api/cards?game=union-arena&limit=2');
  await callBoth('/api/cards?game=not-a-game');
  await callBoth('/api/cards?game=pokemon&region=MARS');
  await callBoth(`/api/cards?game=pokemon&series=${'a'.repeat(129)}`);

  // 600 張大型系列排序一致性與熱快取效能基準
  const bigQuery = '/api/cards?game=pokemon&series=pokemon-big-600&sort=rarity-desc&limit=48&offset=96';
  const bigParity = await callBoth(bigQuery);
  assert.equal(bigParity.workerJson.meta.total, 600);
  assert.equal(bigParity.workerJson.data.length, 48);
  const isolatedNoEdgeHandler = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: null });
  await isolatedNoEdgeHandler.fetch(new Request(`https://cardseektcg.com${bigQuery}`), env);
  const t0 = performance.now();
  const warmBigRes = await isolatedNoEdgeHandler.fetch(new Request(`https://cardseektcg.com${bigQuery}`), env);
  const warmBigMs = performance.now() - t0;
  assert.equal(warmBigRes.status, 200);
  assert.ok(warmBigMs < 25, `預期 600 張系列熱快取分頁 < 25ms，實測 ${warmBigMs.toFixed(2)}ms`);

  // 11. search (一般、suggest、複合、rarity-only、symbols-only、ip2 補位、折疊重試與錯字建議)
  await callBoth('/api/search?q=Pikachu&region=JP&limit=10');
  await callBoth('/api/search?q=Pikachu&limit=6&fields=suggest');
  await callBoth('/api/search?q=151%20%E5%A4%A2%E5%B9%BB%20SAR');
  await callBoth('/api/search?q=SAR');
  await callBoth('/api/search?q=._%25');
  await callBoth('/api/search?q=%E6%97%A5%E5%90%91%E7%BF%94%E9%99%BD');
  await callBoth('/api/search?q=typopikachu');

  // 12. cards/:id (主庫 pokemon、第二庫 union-arena、404、400、?open=1 不在 Worker 寫庫)
  await callBoth('/api/cards/pokemon-p1?open=1', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const reqCountBeforeWorkerOpen = state.requests.length;
  const workerOpenRes = await workerHandler.fetch(new Request('https://cardseektcg.com/api/cards/pokemon-p2-unseen?open=1', { headers: { 'User-Agent': 'Mozilla/5.0' } }), env);
  assert.equal(workerOpenRes.status, 404);
  assert.equal(state.hotWrites, 0, 'Worker ?open=1 絕不呼叫 card_hot_add 寫庫');
  assert.equal(
    state.requests.slice(reqCountBeforeWorkerOpen).some(r => r.path.includes('card_hot_add')),
    false
  );
  await callBoth('/api/cards/union-arena-bt01-001');
  await callBoth('/api/cards/does-not-exist-999');
  await callBoth('/api/cards/%00bad');

  // 13. cards/:id/market (pokemon + yugioh)
  await callBoth('/api/cards/pokemon-p1/market');
  await callBoth('/api/cards/yugioh-be-001/market');

  // 14. exchange-rates (DB cache)
  await callBoth('/api/exchange-rates');

  // 15-17. hot-cards / market-events / price-movers
  await callBoth('/api/hot-cards');
  await callBoth('/api/market-events');
  await callBoth('/api/market-events?game=pokemon');
  await callBoth('/api/price-movers');

  // 18. POST /api/prices/reference (200 / 400 bad JSON / 400 bad shape / 413 too large)
  await callBoth('/api/prices/reference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardIds: ['pokemon-p1', 'pokemon-p1-tw'] })
  });
  await callBoth('/api/prices/reference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad-json' });
  await callBoth('/api/prices/reference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ other: 1 }) });
  // Node readJsonBody 在超過上限時會 req.destroy()，fetch 可能直接看到連線關閉；Worker 則穩定回 413 JSON。
  const oversized = 'x'.repeat(21000);
  const w413 = await workerHandler.fetch(new Request('https://cardseektcg.com/api/prices/reference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: oversized }), env);
  assert.equal(w413.status, 413);
  assertApiSecurityHeaders(w413, 'no-store');
  assert.deepEqual(await w413.json(), { error: '請求內容過大' });
  const n413 = await fetch(`${nodeServer.baseUrl}/api/prices/reference`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: oversized }).catch(() => ({ status: 413 }));
  assert.equal(n413.status, 413);

  // 19-20. reports/meta & reports
  await callBoth('/api/reports/meta');
  await callBoth('/api/reports?cardId=pokemon-p1');
  await callBoth('/api/reports?cardName=%E7%9A%AE%E5%8D%A1%E4%B8%98&game=union-arena&limit=5');
  await callBoth('/api/reports');

  // 驗證無資料庫模式（No DB）：Node 與 Worker 同輸出
  const noDbNode = await spawnTestServer({ mockPort, preloadPath, supabase: false, supabase2: false });
  spawnedChildren.push(noDbNode.child);
  const noDbWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: null });
  const noDbEnv = createWorkerEnv(mockPort, { supabase: false, supabase2: false });
  for (const path of ['/api/catalog/health', '/api/catalog', '/api/products', '/api/cards?game=pokemon&limit=5', '/api/search?q=%E7%9A%AE%E5%8D%A1%E4%B8%98', '/api/hot-cards', '/api/market-events', '/api/price-movers', '/api/reports?cardId=p1']) {
    const nRes = await fetch(`${noDbNode.baseUrl}${path}`);
    const wRes = await noDbWorker.fetch(new Request(`https://cardseektcg.com${path}`), noDbEnv);
    assert.equal(wRes.status, nRes.status, `NoDB ${path}`);
    assertApiSecurityHeaders(wRes, nRes.headers.get('cache-control'));
    assert.deepEqual(normalizeDynamicFields(await wRes.json()), normalizeDynamicFields(await nRes.json()), `NoDB ${path} mismatch`);
  }
  const nRef = await fetch(`${noDbNode.baseUrl}/api/prices/reference`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardIds: ['a'] }) });
  const wRef = await noDbWorker.fetch(new Request('https://cardseektcg.com/api/prices/reference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardIds: ['a'] }) }), noDbEnv);
  assert.equal(wRef.status, 503);
  assert.deepEqual(await wRef.json(), await nRef.json());

  // 驗證無第二庫時 union-arena：cards 503、card detail 404
  const noIp2Env = createWorkerEnv(mockPort, { supabase: true, supabase2: false });
  assert.equal((await workerHandler.fetch(new Request('https://cardseektcg.com/api/cards?game=union-arena'), noIp2Env)).status, 503);
  assert.equal((await workerHandler.fetch(new Request('https://cardseektcg.com/api/cards/union-arena-bt01-001'), noIp2Env)).status, 404);
});

test('Worker 匯率即時抓、fxJump 拒絕與絕不寫入資料庫，及錯誤不外洩／不快取規則', async () => {
  const state = { requests: [], extCalls: [], originCalls: [], hotWrites: 0, fxWrites: 0, cardTableScans: 0, staleFx: true };
  const mockServer = createMockUpstream(state);
  const mockPort = await listenEphemeral(mockServer);
  openServers.push(mockServer);

  const workerFetch = createWorkerFetch(mockPort);
  const env = createWorkerEnv(mockPort);

  // 1. Stale DB FX -> Worker 抓 open.er-api.com，絕不送 POST /exchange_rates
  const workerFx = createWorkerHandler({ fetchFn: workerFetch, edgeCache: null });
  const fxRes = await workerFx.fetch(new Request('https://cardseektcg.com/api/exchange-rates'), env);
  assert.equal(fxRes.status, 200);
  const fxJson = await fxRes.json();
  assert.equal(fxJson.data.source, 'ExchangeRate-API');
  assert.equal(state.fxWrites, 0, 'Worker 絕不對資料庫寫入 exchange_rates');

  // 2. fxJump > 5% 拒絕採用並退回 DB 舊匯率
  state.fxMode = 'jump';
  const workerJump = createWorkerHandler({ fetchFn: workerFetch, edgeCache: null });
  const jumpRes = await workerJump.fetch(new Request('https://cardseektcg.com/api/exchange-rates'), env);
  assert.equal(jumpRes.status, 200);
  const jumpJson = await jumpRes.json();
  assert.match(jumpJson.data.source, /Supabase cache/);
  assert.equal(jumpJson.data.rates.EUR, 35);

  // 3. health v2 失敗 -> legacy；雙失敗 -> 不掃全庫也不洩露錯誤，且不進 edgeCache
  state.fxMode = null;
  state.staleFx = false;
  state.healthMode = 'legacy';
  const healthEdgeCache = createMockEdgeCache();
  const hLegacy = createWorkerHandler({ fetchFn: workerFetch, edgeCache: healthEdgeCache });
  const legacyBody = await (await hLegacy.fetch(new Request('https://cardseektcg.com/api/catalog/health'), env)).json();
  assert.equal(legacyBody.data.metricStatus.images, 'legacy-strict');

  state.healthMode = 'fail-both';
  const scansBefore = state.cardTableScans;
  const failCache = createMockEdgeCache();
  const hFail = createWorkerHandler({ fetchFn: workerFetch, edgeCache: failCache });
  const hFailRes = await hFail.fetch(new Request('https://cardseektcg.com/api/catalog/health'), env);
  assert.equal(hFailRes.status, 200);
  const hFailText = await hFailRes.text();
  assert.equal(hFailText.includes('SECRET_INTERNAL_PG_TABLE_99'), false);
  assert.equal(JSON.parse(hFailText).data.healthFallbackReason, 'UPSTREAM_UNAVAILABLE');
  assert.equal(state.cardTableScans, scansBefore, 'Worker 禁止在 health RPC 雙失敗時全庫掃描 tcg_cards');
  assert.equal(failCache.store.size, 0, 'healthFallbackReason 不得寫入 Edge Cache');

  // 4. 上游失敗錯誤不外洩（movers, hot, sync-status, market, prices/reference, reports）
  state.healthMode = null;
  state.failHot = true;
  state.failMovers = true;
  state.failExternalMarket = true;
  state.failRefPrice = true;
  state.failAllDb = true;
  const errHandler = createWorkerHandler({ fetchFn: workerFetch, edgeCache: null });
  for (const [path, init] of [
    ['/api/catalog/sync-status', {}],
    ['/api/products', {}],
    ['/api/cards?game=pokemon', {}],
    ['/api/hot-cards', {}],
    ['/api/price-movers', {}],
    ['/api/reports?cardId=pokemon-p1', {}],
    ['/api/prices/reference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardIds: ['p1'] }) }]
  ]) {
    const r = await errHandler.fetch(new Request(`https://cardseektcg.com${path}`, init), env);
    const txt = await r.text();
    assert.equal(txt.includes('SECRET_INTERNAL'), false, `${path} 不可外洩內部錯誤`);
    assert.ok(r.status >= 500 || path === '/api/products', `${path} expected 5xx (got ${r.status})`);
  }

  // 5. market 部分來源失敗不快取且錯誤為 UPSTREAM_UNAVAILABLE
  state.failAllDb = false;
  const marketCache = createMockEdgeCache();
  const mHandler = createWorkerHandler({ fetchFn: workerFetch, edgeCache: marketCache });
  const mRes = await mHandler.fetch(new Request('https://cardseektcg.com/api/cards/yugioh-be-001/market'), env);
  const mText = await mRes.text();
  assert.equal(mText.includes('SECRET_YGO'), false);
  assert.equal(JSON.parse(mText).data.sources.find(s => s.source === 'ygoprodeck').error, 'UPSTREAM_UNAVAILABLE');
  assert.equal(marketCache.store.size, 0, 'market 來源失敗時不可寫入 Edge Cache');
});

test('MIGRATED_API 回滾開關與未搬遷端點代理驗證', async () => {
  const state = { requests: [], extCalls: [], originCalls: [], hotWrites: 0, fxWrites: 0, cardTableScans: 0 };
  const mockServer = createMockUpstream(state);
  const mockPort = await listenEphemeral(mockServer);
  openServers.push(mockServer);

  const handler = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: null });

  // 1. 單支切回 (-cards)
  const cardRollback = await handler.fetch(new Request('https://cardseektcg.com/api/cards?game=pokemon'), createWorkerEnv(mockPort, { migratedApi: '-cards' }));
  assert.deepEqual(await cardRollback.json(), { proxiedByOrigin: true, path: '/api/cards?game=pokemon' });

  // 2. 白名單模式 (providers,trends) -> providers 走 Worker, search 走原點
  const allowEnv = createWorkerEnv(mockPort, { migratedApi: 'providers,trends' });
  const pRes = await handler.fetch(new Request('https://cardseektcg.com/api/providers'), allowEnv);
  assert.ok((await pRes.json()).data.ygoprodeck);
  const sRes = await handler.fetch(new Request('https://cardseektcg.com/api/search?q=pikachu'), allowEnv);
  assert.equal((await sRes.json()).proxiedByOrigin, true);

  // 3. 全關 (none) -> 所有預設 20 支端點皆走原點
  const offEnv = createWorkerEnv(mockPort, { migratedApi: 'none' });
  for (const [path, method] of [
    ['/api/catalog/health', 'GET'],
    ['/api/providers', 'GET'],
    ['/api/cards/c1', 'GET'],
    ['/api/cards/c1/market', 'GET'],
    ['/api/prices/reference', 'POST']
  ]) {
    const r = await handler.fetch(new Request(`https://cardseektcg.com${path}`, { method, body: method === 'POST' ? '{}' : undefined }), offEnv);
    assert.equal((await r.json()).proxiedByOrigin, true, `${method} ${path} 在 none 時應走原點`);
  }

  // 4. 未搬遷端點預設即走原點
  const defaultEnv = createWorkerEnv(mockPort);
  for (const path of ['/api/pack-prizes', '/api/series-hits', '/api/catalog/coverage', '/api/cards/pokemon-p1/price-history', '/api/graded-prices', '/api/ebay-listings', '/api/auth/config']) {
    const r = await handler.fetch(new Request(`https://cardseektcg.com${path}`), defaultEnv);
    assert.equal((await r.json()).proxiedByOrigin, true, `${path} 應繼續代理原點`);
  }
  assert.equal(DEFAULT_MIGRATED_APIS.length, 20);
});

test('Worker 相容性靜態檢查（零 node:*、Buffer、AsyncLocalStorage、snkrdunk 域名）與 bundle/ASSETS 安全性', async () => {
  const visited = new Set();
  const importedJsonSizes = new Map();

  async function walk(filePath) {
    const abs = resolve(ROOT, filePath);
    if (visited.has(abs)) return;
    visited.add(abs);
    const code = await readFile(abs, 'utf8');
    const codeNoComments = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /from\s+['"]node:[^'"]+['"]/, `${filePath} 不可匯入 node:*`);
    assert.doesNotMatch(codeNoComments, /\bAsyncLocalStorage\b/, `${filePath} 不可使用 AsyncLocalStorage`);
    assert.doesNotMatch(codeNoComments, /\bBuffer\b/, `${filePath} 不可使用 Node Buffer`);
    assert.doesNotMatch(code, /snkrdunk\s*['"`]?\s*\+?\s*['"`]?\s*\.\s*com/i, `${filePath} 不可包含 snkrdunk 網域`);

    for (const m of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const targetAbs = resolve(abs, '..', m[1]);
      if (targetAbs.endsWith('.json')) {
        const content = await readFile(targetAbs);
        importedJsonSizes.set(targetAbs, content.byteLength);
      } else {
        await walk(targetAbs);
      }
    }
  }

  await walk('worker/index.mjs');
  assert.ok(visited.size >= 10, `應掃描整個 Worker 相依樹（掃描 ${visited.size} 個檔案）`);

  let totalJsonBytes = 0;
  for (const bytes of importedJsonSizes.values()) totalJsonBytes += bytes;
  assert.ok(totalJsonBytes > 0 && totalJsonBytes < 512 * 1024, `靜態 JSON 總大小應遠小於 3 MiB 上限（目前 ${totalJsonBytes} bytes）`);

  const assetTmp = await mkdtemp(join(tmpdir(), 'cardseek-assets-check-'));
  tempDirs.push(assetTmp);
  await prepareWorkerAssets({ rootDir: ROOT, outDir: assetTmp });
  for (const sensitiveData of ['catalog.json', 'source-registry.json', 'tcgdex-en-set-map.json', 'series-zh.json', 'catalog-baselines.json', 'pack-prizes.json']) {
    assert.equal(existsSync(join(assetTmp, 'data', sensitiveData)), false, `worker/public 不得公開 data/${sensitiveData}`);
  }
});

async function createPreloadForMock(mockPort) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'cardseek-parity-'));
  tempDirs.push(tmpDir);
  const preloadPath = join(tmpDir, 'fetch-preload.mjs');
  await writeFile(
    preloadPath,
    `const origFetch = globalThis.fetch;
const map = new Map([
  ['open.er-api.com', '/ext/fx'],
  ['db.ygoprodeck.com', '/ext/ygo'],
  ['api.tcgdex.net', '/ext/tcgdex'],
  ['asia-tc.onepiece-cardgame.com', '/ext/onepiece']
]);
globalThis.fetch = async (input, init) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const u = new URL(raw);
  const p = map.get(u.hostname);
  if (p) return origFetch('http://127.0.0.1:${mockPort}' + p + u.pathname + u.search, init);
  return origFetch(input, init);
};
`,
    'utf8'
  );
  return preloadPath;
}

async function stopSpawnedServer(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  await new Promise(resolveExit => {
    const timer = setTimeout(resolveExit, 2000);
    child.once('exit', () => { clearTimeout(timer); resolveExit(); });
    try { child.kill(); } catch { clearTimeout(timer); resolveExit(); }
  });
}

async function assertNodeWorkerParity(nodeBaseUrl, workerHandler, env, path, { method = 'GET', headers = {}, body, compareJson = true } = {}) {
  const nodeRes = await fetch(`${nodeBaseUrl}${path}`, { method, headers, body });
  const workerRes = await workerHandler.fetch(new Request(`https://cardseektcg.com${path}`, { method, headers, body }), env);
  assert.equal(workerRes.status, nodeRes.status, `${method} ${path} status mismatch`);
  assertApiSecurityHeaders(workerRes, nodeRes.headers.get('cache-control'));
  if (!compareJson) return { nodeRes, workerRes };
  const nodeJson = normalizeDynamicFields(await nodeRes.json());
  const workerJson = normalizeDynamicFields(await workerRes.json());
  assert.deepEqual(workerJson, nodeJson, `${method} ${path} JSON mismatch`);
  return { nodeRes, workerRes, nodeJson, workerJson };
}

test('一致性補測：空結果、參數邊界、第二庫完整 Parity 與 getCard 冷熱 Isolate 一致性', async () => {
  const state = { requests: [], extCalls: [], originCalls: [], hotWrites: 0, fxWrites: 0, cardTableScans: 0 };
  const mockServer = createMockUpstream(state);
  const mockPort = await listenEphemeral(mockServer);
  openServers.push(mockServer);
  const preloadPath = await createPreloadForMock(mockPort);

  const nodeServer = await spawnTestServer({ mockPort, preloadPath, supabase: true, supabase2: true });
  spawnedChildren.push(nodeServer.child);
  const workerHandler = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: createMockEdgeCache() });
  const env = createWorkerEnv(mockPort, { supabase: true, supabase2: true });

  try {
    // 1. 空系列、offset 夾緊 200000、整數 limit 與非法字元 series 空 facets
    const emptySeries = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/cards?game=pokemon&series=pokemon-empty-series');
    assert.equal(emptySeries.workerRes.status, 200);
    assert.deepEqual(emptySeries.workerJson.data, []);
    assert.equal(emptySeries.workerJson.meta.total, 0);
    assert.deepEqual(emptySeries.workerJson.meta.facets, { rarity: {}, region: {}, language: {}, rarityLabels: {} });

    const clampedCards = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/cards?game=pokemon&offset=999999');
    assert.equal(clampedCards.workerJson.meta.offset, 200000);
    const clampedSearch = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/search?q=Pikachu&offset=999999');
    assert.equal(clampedSearch.workerJson.meta.offset, 200000);

    const floatLimit = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/cards?game=pokemon&limit=1.5');
    assert.equal(floatLimit.workerJson.meta.limit, 1);
    assert.equal(floatLimit.workerJson.data.length, 1);
    const negLimit = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/cards?game=pokemon&limit=-5');
    assert.equal(negLimit.workerJson.meta.limit, 1);
    await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/trends?limit=3.8');
    const searchFloatLimit = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/search?q=Pikachu&limit=3.8');
    assert.equal(searchFloatLimit.workerJson.meta.limit, 3);

    // 暖起 pokemon-jp-sv2a 快取後，再測帶非法字元的 series=pokemon-jp-sv2a! 仍必須回空 facets
    await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/cards?game=pokemon&series=pokemon-jp-sv2a');
    const badSeriesRes = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/cards?game=pokemon&series=pokemon-jp-sv2a!');
    assert.deepEqual(badSeriesRes.workerJson.data, []);
    assert.equal(badSeriesRes.workerJson.meta.total, 0);
    assert.deepEqual(badSeriesRes.workerJson.meta.facets, { rarity: {}, region: {}, language: {}, rarityLabels: {} });

    // 2. 第二庫（union-arena）正常路徑與已設 ip2 的 reports / market / market-events
    const uaCards = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/cards?game=union-arena');
    assert.equal(uaCards.workerJson.data[0]?.id, 'union-arena-bt01-001');
    await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/cards/union-arena-bt01-001/market');
    const uaEvents = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/market-events?game=union-arena');
    assert.ok(uaEvents.workerJson.data.some(ev => ev.game === 'union-arena'));
    const uaReports200 = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/reports?cardName=%E7%9A%AE%E5%8D%A1%E4%B8%98&game=union-arena');
    assert.equal(uaReports200.workerRes.status, 200);
  } finally {
    await stopSpawnedServer(nodeServer.child);
  }

  // 未設 ip2 時 union-arena Parity：cards 503、reports 400
  const noIp2Node = await spawnTestServer({ mockPort, preloadPath, supabase: true, supabase2: false });
  spawnedChildren.push(noIp2Node.child);
  const noIp2Worker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: null });
  const noIp2Env = createWorkerEnv(mockPort, { supabase: true, supabase2: false });
  try {
    const cards503 = await assertNodeWorkerParity(noIp2Node.baseUrl, noIp2Worker, noIp2Env, '/api/cards?game=union-arena');
    assert.equal(cards503.workerRes.status, 503);
    const reports400 = await assertNodeWorkerParity(noIp2Node.baseUrl, noIp2Worker, noIp2Env, '/api/reports?cardName=%E7%9A%AE%E5%8D%A1%E4%B8%98&game=union-arena');
    assert.equal(reports400.workerRes.status, 400);
  } finally {
    await stopSpawnedServer(noIp2Node.child);
  }

  // ip2 500 故障時：union-arena cards 回 502、market-events 保留主庫事件、catalog/health secondStorage=unknown 且不進 Edge Cache
  state.failIp2 = true;
  const failIp2Node = await spawnTestServer({ mockPort, preloadPath, supabase: true, supabase2: true });
  spawnedChildren.push(failIp2Node.child);
  const failIp2Cache = createMockEdgeCache();
  const failIp2Worker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: failIp2Cache });
  try {
    const cards502 = await assertNodeWorkerParity(failIp2Node.baseUrl, failIp2Worker, env, '/api/cards?game=union-arena');
    assert.equal(cards502.workerRes.status, 502);
    const evFallback = await assertNodeWorkerParity(failIp2Node.baseUrl, failIp2Worker, env, '/api/market-events');
    assert.equal(evFallback.workerRes.status, 200);
    assert.ok(evFallback.workerJson.data.some(ev => ev.game === 'pokemon'), 'ip2 故障時仍應保留主庫事件');
    assert.equal(evFallback.workerJson.data.some(ev => ev.title === 'UA測試彈'), false);

    state.failIp2 = false;
    state.failIp2Storage = true;
    const healthEdgeCache = createMockEdgeCache();
    const healthIp2FailWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: healthEdgeCache });
    const healthIp2FailNode = await spawnTestServer({ mockPort, preloadPath, supabase: true, supabase2: true });
    spawnedChildren.push(healthIp2FailNode.child);
    try {
      const healthPair = await assertNodeWorkerParity(healthIp2FailNode.baseUrl, healthIp2FailWorker, env, '/api/catalog/health');
      assert.equal(healthPair.workerJson.data.secondStorage.status, 'unknown');
      assert.equal(healthEdgeCache.store.size, 0, 'ip2 db_size_report 失敗時不可寫入 Edge Cache');
    } finally {
      await stopSpawnedServer(healthIp2FailNode.child);
      state.failIp2Storage = false;
    }
  } finally {
    await stopSpawnedServer(failIp2Node.child);
    state.failIp2 = false;
  }

  // 4. getCard 冷熱 Isolate 一致性（pokemon-cat-sample）
  const coldWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: null });
  const warmWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: null });
  const coldCardRes = await coldWorker.fetch(new Request('https://cardseektcg.com/api/cards/pokemon-cat-sample'), env);
  assert.equal(coldCardRes.status, 200);
  const coldCardJson = normalizeDynamicFields(await coldCardRes.json());

  const warmCatRes = await warmWorker.fetch(new Request('https://cardseektcg.com/api/catalog'), env);
  assert.equal(warmCatRes.status, 200);
  const warmCardRes = await warmWorker.fetch(new Request('https://cardseektcg.com/api/cards/pokemon-cat-sample'), env);
  assert.equal(warmCardRes.status, 200);
  const warmCardJson = normalizeDynamicFields(await warmCardRes.json());

  assert.equal(warmCardJson.meta.source, 'supabase-full-catalog');
  assert.deepEqual(warmCardJson, coldCardJson, '暖 catalog 快取後 getCard 應與冷啟動完全一致');
});

test('MAIN_ONLY_PATH 強制主庫保護、降級不寫 Edge Cache 與 ctx.waitUntil 背景刷新', async () => {
  // 1. 直接測 createSupabaseClient：傳入 { db: 'ip2' } 仍強制走主庫
  const clientTargets = [];
  const client = createSupabaseClient({
    env: {
      SUPABASE_URL: 'https://main-db.example.test',
      SUPABASE_SERVICE_KEY: 'main-secret',
      SUPABASE2_URL: 'https://ip2-db.example.test',
      SUPABASE2_SERVICE_KEY: 'ip2-secret'
    },
    fetchFn: async input => {
      clientTargets.push(String(input));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });
  for (const path of ['/rpc/price_reference_best', '/reports?card_id=eq.union-arena-bt01-001', '/exchange_rates?select=currency', '/jp_buyback_prices?select=price']) {
    await client.fetchJson(path, { db: 'ip2' });
  }
  assert.equal(clientTargets.length, 4);
  for (const url of clientTargets) {
    assert.ok(url.startsWith('https://main-db.example.test/rest/v1/'), `MAIN_ONLY_PATH 必須打主庫，實際 ${url}`);
  }
  await client.fetchJson('/tcg_cards?select=id&limit=1', { db: 'ip2' });
  assert.ok(clientTargets[4].startsWith('https://ip2-db.example.test/rest/v1/'), '非 MAIN_ONLY_PATH 帶 db=ip2 應打第二庫');

  // 2. 降級或未知參數不寫 Edge Cache
  const state = { requests: [], extCalls: [], originCalls: [], hotWrites: 0, fxWrites: 0, cardTableScans: 0 };
  const mockServer = createMockUpstream(state);
  const mockPort = await listenEphemeral(mockServer);
  openServers.push(mockServer);
  const env = createWorkerEnv(mockPort, { supabase: true, supabase2: true });

  // /api/market-events 主庫 tcg_series 失敗 (degraded) & 未知 game
  state.failSeriesEvents = true;
  const evDegradedCache = createMockEdgeCache();
  const evDegradedWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: evDegradedCache });
  const evDegradedRes = await evDegradedWorker.fetch(new Request('https://cardseektcg.com/api/market-events'), env);
  assert.equal(evDegradedRes.status, 200);
  assert.equal(evDegradedCache.store.size, 0, 'market-events 降級時不可寫入 Edge Cache');

  state.failSeriesEvents = false;
  const evUnknownCache = createMockEdgeCache();
  const evUnknownWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: evUnknownCache });
  const evUnknownRes = await evUnknownWorker.fetch(new Request('https://cardseektcg.com/api/market-events?game=unknown-game-xyz'), env);
  assert.equal(evUnknownRes.status, 200);
  assert.equal(evUnknownCache.store.size, 0, 'market-events 未知 game 參數不可寫入 Edge Cache');

  // /api/cards/:id/market 遇 fxMode: 'jump' 降級匯率時不寫 Edge Cache
  state.staleFx = true;
  state.fxMode = 'jump';
  const fxJumpMarketCache = createMockEdgeCache();
  const fxJumpMarketWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: fxJumpMarketCache });
  const fxJumpMarketRes = await fxJumpMarketWorker.fetch(new Request('https://cardseektcg.com/api/cards/pokemon-p1/market'), env);
  assert.equal(fxJumpMarketRes.status, 200);
  assert.equal(fxJumpMarketCache.store.size, 0, 'market 遇降級匯率 (cacheable=false) 不可寫入 Edge Cache');
  state.staleFx = false;
  state.fxMode = null;

  // /api/catalog/health 遇主庫 db_size_report 失敗時不寫 Edge Cache
  state.failMainStorage = true;
  const mainStorageCache = createMockEdgeCache();
  const mainStorageWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: mainStorageCache });
  const mainStorageRes = await mainStorageWorker.fetch(new Request('https://cardseektcg.com/api/catalog/health'), env);
  assert.equal(mainStorageRes.status, 200);
  assert.equal((await mainStorageRes.json()).data.storage.status, 'unknown');
  assert.equal(mainStorageCache.store.size, 0, 'health 主庫 db_size_report 失敗時不可寫入 Edge Cache');
  state.failMainStorage = false;

  // 3. ctx.waitUntil 背景刷新測試（/api/catalog、/api/price-movers、/api/hot-cards）
  let currentNow = Date.UTC(2026, 10, 23, 0, 0, 0);
  const bgTasks = [];
  const ctx = { waitUntil(p) { bgTasks.push(p); } };
  const swrEdgeCache = createMockEdgeCache();
  const swrWorker = createWorkerHandler({
    fetchFn: createWorkerFetch(mockPort),
    now: () => currentNow,
    edgeCache: null
  });

  // 暖起 catalog、price-movers、hot-cards
  assert.equal((await swrWorker.fetch(new Request('https://cardseektcg.com/api/catalog'), env, ctx)).status, 200);
  assert.equal((await swrWorker.fetch(new Request('https://cardseektcg.com/api/price-movers'), env, ctx)).status, 200);
  assert.equal((await swrWorker.fetch(new Request('https://cardseektcg.com/api/hot-cards'), env, ctx)).status, 200);
  assert.equal(bgTasks.length, 0);

  // 推進超過 CATALOG_CACHE_TTL_MS (600_000 ms) 觸發 /api/catalog 背景刷新
  currentNow += 650000;
  const reqBeforeCatalogBg = state.requests.length;
  const catSwrRes = await swrWorker.fetch(new Request('https://cardseektcg.com/api/catalog'), env, ctx);
  assert.equal(catSwrRes.status, 200);
  assert.equal(bgTasks.length, 1, '/api/catalog 過期應將背景刷新 Promise 交給 ctx.waitUntil');
  await Promise.all(bgTasks.splice(0));
  assert.ok(state.requests.slice(reqBeforeCatalogBg).some(r => r.path.includes('/tcg_cards')), '等待 ctx.waitUntil 後應完成目錄背景重載');

  // 再推進超過 price-movers / hot-cards TTL (3_600_000 ms) 仍在 maxStale 內
  currentNow += 3100000;
  const reqBeforeMoversBg = state.requests.length;
  const moversRes = await swrWorker.fetch(new Request('https://cardseektcg.com/api/price-movers'), env, ctx);
  const hotRes = await swrWorker.fetch(new Request('https://cardseektcg.com/api/hot-cards'), env, ctx);
  assert.equal(moversRes.status, 200);
  assert.equal(hotRes.status, 200);
  assert.equal(bgTasks.length, 2, 'price-movers 與 hot-cards 過期 SWR 應將背景刷新 Promise 交給 ctx.waitUntil');
  await Promise.all(bgTasks.splice(0));
  const bgPaths = state.requests.slice(reqBeforeMoversBg).map(r => r.path);
  assert.ok(bgPaths.some(p => p.includes('/rpc/price_movers')));
  assert.ok(bgPaths.some(p => p.includes('/rpc/card_hot_top')));
  assert.equal(swrEdgeCache.store.size, 0);
});

test('安全審核補測：金鑰／內部錯誤絕不外洩、One Piece SSRF 完整防護與輸入驗證邊界', async () => {
  const state = { requests: [], extCalls: [], originCalls: [], hotWrites: 0, fxWrites: 0, cardTableScans: 0 };
  const mockServer = createMockUpstream(state);
  const mockPort = await listenEphemeral(mockServer);
  openServers.push(mockServer);
  const preloadPath = await createPreloadForMock(mockPort);

  const secrets = {
    supabaseKey: 'super-secret-main-jwt',
    supabase2Key: 'super-secret-ip2-jwt',
    scrapeSecret: 'super-secret-admin'
  };
  const nodeServer = await spawnTestServer({ mockPort, preloadPath, supabase: true, supabase2: true, ...secrets });
  spawnedChildren.push(nodeServer.child);
  const edgeCache = createMockEdgeCache();
  const seenFetchInits = [];
  const spyWorkerFetch = createWorkerFetch(mockPort);
  const workerHandler = createWorkerHandler({
    fetchFn: async (input, init) => {
      seenFetchInits.push({ url: String(typeof input === 'string' ? input : input?.url || input), redirect: init?.redirect });
      return spyWorkerFetch(input, init);
    },
    edgeCache
  });
  const env = createWorkerEnv(mockPort, { supabase: true, supabase2: true, ...secrets });

  const forbiddenTokens = [
    'super-secret-main-jwt',
    'super-secret-ip2-jwt',
    'super-secret-admin',
    'SECRET_INTERNAL_PG_TABLE_99',
    'SECRET_OP_ERR',
    'SECRET_YGO',
    'PostgREST',
    'price_snapshots',
    'jp_buyback_prices',
    'catalog_sync_runs',
    'db_size_report'
  ];
  const assertNoLeak = (text, label, path) => {
    for (const token of forbiddenTokens) {
      assert.equal(text.includes(token), false, `${label} 絕不可外洩 ${token}`);
    }
    if (!path.startsWith('/api/catalog/health')) {
      assert.equal(text.includes('tcg_cards'), false, `${label} 絕不可外洩 tcg_cards`);
      assert.equal(text.includes('tcg_printings'), false, `${label} 絕不可外洩 tcg_printings`);
    }
  };

  try {
    // 1. 金鑰與內部錯誤絕不外洩（正常 200 與 500 故障路徑）
    const pathsToScan = [
      ['/api/providers', {}],
      ['/api/catalog/health', {}],
      ['/api/catalog', {}],
      ['/api/products', {}],
      ['/api/cards?game=pokemon', {}],
      ['/api/cards?game=union-arena', {}],
      ['/api/search?q=Pikachu', {}],
      ['/api/cards/pokemon-p1', {}],
      ['/api/cards/pokemon-p1/market', {}],
      ['/api/hot-cards', {}],
      ['/api/price-movers', {}],
      ['/api/market-events', {}],
      ['/api/trends', {}],
      ['/api/buyback-prices?game=pokemon', {}],
      ['/api/reports?cardId=pokemon-p1', {}],
      ['/api/catalog/sync-status', {}],
      ['/api/prices/reference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardIds: ['pokemon-p1'] }) }]
    ];
    for (const [p, init] of pathsToScan) {
      const r = await workerHandler.fetch(new Request(`https://cardseektcg.com${p}`, init), env);
      assertNoLeak(await r.text(), `正常路徑 ${p}`, p);
    }

    state.failAllDb = true;
    state.failExternalMarket = true;
    state.failHot = true;
    state.failMovers = true;
    state.failRefPrice = true;
    state.healthMode = 'fail-both';
    const failWorker = createWorkerHandler({ fetchFn: spyWorkerFetch, edgeCache: null });
    for (const [p, init] of pathsToScan) {
      const r = await failWorker.fetch(new Request(`https://cardseektcg.com${p}`, init), env);
      const txt = await r.text();
      assertNoLeak(txt, `500 故障路徑 ${p}`, p);
      if (p === '/api/catalog/health') {
        assert.equal(JSON.parse(txt).data.healthFallbackReason, 'UPSTREAM_UNAVAILABLE');
      }
    }
    state.failAllDb = false;
    state.failExternalMarket = false;
    state.failHot = false;
    state.failMovers = false;
    state.failRefPrice = false;
    state.healthMode = null;

    // 2. /api/images/onepiece 完整 SSRF 防護
    const badImageUrls = [
      'http://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP05-001.png',
      'https://127.0.0.1/images/cardlist/card/OP05-001.png',
      'https://169.254.169.254/latest/meta-data/OP05-001.png',
      'https://[::1]/images/cardlist/card/OP05-001.png',
      'https://user:pass@asia-tc.onepiece-cardgame.com/images/cardlist/card/OP05-001.png',
      'https://asia-tc.onepiece-cardgame.com:8443/images/cardlist/card/OP05-001.png',
      'https://asia-tc.onepiece-cardgame.com.evil.com/images/cardlist/card/OP05-001.png',
      'https://asia-tc.onepiece-cardgame.com/images/cardlist/card/../secret.png',
      'https://asia-tc.onepiece-cardgame.com/images/cardlist/card/%2e%2e/secret.png',
      'https://asia-tc.onepiece-cardgame.com/images/cardlist/card/%2fsecret.png',
      'https://asia-tc.onepiece-cardgame.com/images/cardlist/card/%5csecret.png',
      'https://asia-tc.onepiece-cardgame.com/images/cardlist/card/a%00.png',
      `https://asia-tc.onepiece-cardgame.com/images/cardlist/card/${'a'.repeat(500)}.png`
    ];
    const extCountBeforeSsrf = state.extCalls.length;
    for (const badUrl of badImageUrls) {
      const pair = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, `/api/images/onepiece?url=${encodeURIComponent(badUrl)}`);
      assert.equal(pair.workerRes.status, 400, `應拒絕 ${badUrl}`);
    }
    assert.equal(state.extCalls.length, extCountBeforeSsrf, 'SSRF 攔截不可發起任何上游請求');

    // redirect: 'error'、302 轉址失敗 502、SVG MIME 拒絕 502、>5MB 串流中止 502
    const redirectUrl = encodeURIComponent('https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP05-001.png?redirect=1');
    const redirectPair = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, `/api/images/onepiece?url=${redirectUrl}`);
    assert.equal(redirectPair.workerRes.status, 502);
    assert.ok(seenFetchInits.some(call => call.url.includes('redirect=1') && call.redirect === 'error'), 'fetchFn 必須收到 redirect: error');

    const svgPair = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, `/api/images/onepiece?url=${encodeURIComponent('https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP05-001.png?svg=1')}`);
    assert.equal(svgPair.workerRes.status, 502);

    const streamHugePair = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, `/api/images/onepiece?url=${encodeURIComponent('https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP05-001.png?streamHuge=1')}`);
    assert.equal(streamHugePair.workerRes.status, 502);

    // #frag 與多餘 query 參數命中同一筆 Edge Cache
    const imgCache = createMockEdgeCache();
    const imgCacheWorker = createWorkerHandler({ fetchFn: spyWorkerFetch, edgeCache: imgCache });
    const extBeforeImgCache = state.extCalls.filter(x => x === 'onepiece').length;
    const opTarget = 'https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP05-001.png';
    const rImg1 = await imgCacheWorker.fetch(new Request(`https://cardseektcg.com/api/images/onepiece?url=${encodeURIComponent(opTarget)}&rand=1`), env);
    assert.equal(rImg1.status, 200);
    const rImg2 = await imgCacheWorker.fetch(new Request(`https://cardseektcg.com/api/images/onepiece?url=${encodeURIComponent(`${opTarget}#frag`)}&extra=2`), env);
    assert.equal(rImg2.status, 200);
    assert.equal(state.extCalls.filter(x => x === 'onepiece').length, extBeforeImgCache + 1, '含 #frag 與多餘 query 參數應命中同一筆 Edge Cache');

    // 3. 輸入驗證邊界
    const reqBeforeProto = state.requests.length;
    for (const protoGame of ['constructor', '__proto__']) {
      const pair = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, `/api/buyback-prices?game=${protoGame}`);
      assert.equal(pair.workerRes.status, 200);
      assert.deepEqual(pair.workerJson.data, []);
    }
    assert.equal(state.requests.slice(reqBeforeProto).some(r => r.path.includes('jp_buyback_prices')), false, '原型鍵不可打 DB');

    for (const badReportPath of [
      `/api/reports?cardId=${'a'.repeat(129)}`,
      `/api/reports?cardName=${encodeURIComponent('皮'.repeat(101))}`,
      '/api/reports?cardId=bad%00id',
      '/api/reports?cardName=bad%07name'
    ]) {
      const pair = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, badReportPath);
      assert.equal(pair.workerRes.status, 400, badReportPath);
    }

    // POST /api/prices/reference：Content-Length 25000 立即 413、>100 筆 ID 400、含引號／反斜線／控制字元 400
    let streamPulled = 0;
    const hugeStream = new ReadableStream({
      pull(controller) {
        streamPulled++;
        controller.enqueue(new TextEncoder().encode('{"cardIds":["a"]}'));
        controller.close();
      }
    });
    const clRes = await workerHandler.fetch(
      new Request('https://cardseektcg.com/api/prices/reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '25000' },
        body: hugeStream,
        duplex: 'half'
      }),
      env
    );
    assert.equal(clRes.status, 413);
    assert.equal(streamPulled, 0, 'Content-Length > 20000 應在讀取串流前立即回 413');

    for (const badIds of [
      Array.from({ length: 101 }, (_, i) => `card-${i}`),
      ['bad"quote'],
      ['bad\\slash'],
      ['bad\u0001ctrl']
    ]) {
      const pair = await assertNodeWorkerParity(nodeServer.baseUrl, workerHandler, env, '/api/prices/reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds: badIds })
      });
      assert.equal(pair.workerRes.status, 400);
    }
  } finally {
    await stopSpawnedServer(nodeServer.child);
  }
});

test('CPU 與 Subrequest 風險補測：大型系列冷熱分頁、備援熔斷、純符號早退、搜尋預算上限與 Canonical Cache Key', async () => {
  const state = { requests: [], extCalls: [], originCalls: [], hotWrites: 0, fxWrites: 0, cardTableScans: 0 };
  const mockServer = createMockUpstream(state);
  const mockPort = await listenEphemeral(mockServer);
  openServers.push(mockServer);
  const preloadPath = await createPreloadForMock(mockPort);

  const nodeServer = await spawnTestServer({ mockPort, preloadPath, supabase: true, supabase2: true });
  spawnedChildren.push(nodeServer.child);
  const env = createWorkerEnv(mockPort, { supabase: true, supabase2: true });

  try {
    // 1. 600 張卡大型系列帶 region=JP 冷／熱分頁與 Node 100% 一致，且第二頁 (offset=48) 熱分頁 < 15 ms
    const bigPage1 = '/api/cards?game=pokemon&series=pokemon-big-600&region=JP&sort=rarity-desc&limit=48&offset=0';
    const bigPage2 = '/api/cards?game=pokemon&series=pokemon-big-600&region=JP&sort=rarity-desc&limit=48&offset=48';
    const bigWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: null });
    const p1 = await assertNodeWorkerParity(nodeServer.baseUrl, bigWorker, env, bigPage1);
    assert.equal(p1.workerJson.meta.total, 600);
    assert.equal(p1.workerJson.data.length, 48);
    const p2Cold = await assertNodeWorkerParity(nodeServer.baseUrl, bigWorker, env, bigPage2);
    assert.equal(p2Cold.workerJson.data.length, 48);

    const t0 = performance.now();
    const p2WarmRes = await bigWorker.fetch(new Request(`https://cardseektcg.com${bigPage2}`), env);
    const warmMs = performance.now() - t0;
    assert.equal(p2WarmRes.status, 200);
    assert.deepEqual(normalizeDynamicFields(await p2WarmRes.json()), p2Cold.workerJson);
    assert.ok(warmMs < 15, `600 張系列 region=JP 第 2 頁熱分頁應 < 15ms，實測 ${warmMs.toFixed(2)}ms`);

    // 2. browse_series_cards RPC 失敗且系列 > 500 張卡時回 502 且 subrequests 遠低於 50
    const refuseWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: null });
    const reqBeforeRefuse = state.requests.length;
    const refuseRes = await refuseWorker.fetch(new Request('https://cardseektcg.com/api/cards?game=pokemon&series=pokemon-huge-fallback'), env);
    const refuseSubrequests = state.requests.slice(reqBeforeRefuse).length;
    assert.equal(refuseRes.status, 502);
    assert.deepEqual(await refuseRes.json(), { error: '這個系列太大，無法在備援模式下載入' });
    assert.ok(refuseSubrequests <= 5 && refuseSubrequests < 50, `備援熔斷 subrequests 應遠低於 50（實測 ${refuseSubrequests}）`);

    // 3. /api/search?q=._%25 純符號查詢早退，0 次資料庫請求
    const symWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: null });
    const reqBeforeSym = state.requests.length;
    const symRes = await symWorker.fetch(new Request('https://cardseektcg.com/api/search?q=._%25'), env);
    assert.equal(symRes.status, 200);
    assert.equal((await symRes.json()).meta.source, 'symbols-only');
    assert.equal(state.requests.length - reqBeforeSym, 0, '純符號查詢應 0 次資料庫請求');

    // 4. /api/search 零結果且所有 RPC 失敗走備援時，單次請求對資料庫 subrequests 嚴格 < 50（受預算上限 30 保護）
    state.failSearchRpc = true;
    const budgetWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: null });
    // 先測完全冷啟動（含 loadCatalogShared），再測暖目錄後的單次搜尋請求
    const reqBeforeColdZero = state.requests.length;
    const coldZeroRes = await budgetWorker.fetch(new Request('https://cardseektcg.com/api/search?q=zzzznotfound%20x&region=JP'), env);
    const coldZeroSubrequests = state.requests.slice(reqBeforeColdZero).length;
    assert.equal(coldZeroRes.status, 200);
    assert.equal((await coldZeroRes.json()).data.length, 0);
    assert.ok(coldZeroSubrequests < 50, `冷啟動零結果降級總 subrequests 應 < 50（實測 ${coldZeroSubrequests}）`);

    const reqBeforeWarmZero = state.requests.length;
    const warmZeroRes = await budgetWorker.fetch(new Request('https://cardseektcg.com/api/search?q=zzzznotfound%20y&region=JP'), env);
    const warmZeroSubrequests = state.requests.slice(reqBeforeWarmZero).length;
    assert.equal(warmZeroRes.status, 200);
    assert.ok(warmZeroSubrequests <= 30 && warmZeroSubrequests < 50, `暖目錄零結果降級搜尋 subrequests 應受預算 30 保護（實測 ${warmZeroSubrequests}）`);
    state.failSearchRpc = false;

    // 5. Edge Cache canonical key 測試：無關 query 參數與鍵順序命中同一筆快取
    const canonEdgeCache = createMockEdgeCache();
    const canonWorker = createWorkerHandler({ fetchFn: createWorkerFetch(mockPort), edgeCache: canonEdgeCache });

    const reqBeforeCat1 = state.requests.length;
    assert.equal((await canonWorker.fetch(new Request('https://cardseektcg.com/api/catalog?rand=1'), env)).status, 200);
    const reqAfterCat1 = state.requests.length;
    assert.ok(reqAfterCat1 > reqBeforeCat1);
    assert.equal((await canonWorker.fetch(new Request('https://cardseektcg.com/api/catalog?rand=2'), env)).status, 200);
    assert.equal(state.requests.length, reqAfterCat1, '/api/catalog?rand=2 應命中同一筆 Edge Cache，不重複打 DB');

    const reqBeforeCards1 = state.requests.length;
    assert.equal((await canonWorker.fetch(new Request('https://cardseektcg.com/api/cards?game=pokemon&limit=2&foo=1'), env)).status, 200);
    const reqAfterCards1 = state.requests.length;
    assert.ok(reqAfterCards1 > reqBeforeCards1);
    assert.equal((await canonWorker.fetch(new Request('https://cardseektcg.com/api/cards?limit=2&game=pokemon&bar=2'), env)).status, 200);
    assert.equal(state.requests.length, reqAfterCards1, '/api/cards 應依正規化 canonical key 命中同一筆 Edge Cache');
  } finally {
    await stopSpawnedServer(nodeServer.child);
  }
});
