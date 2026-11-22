// 複合特徵搜尋單元測試：周年同義詞、無空白中英數切詞、系列索引比對、防誤傷護欄、SQL migration 與前端篩選 chip。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  anniversaryTerms,
  buildSeriesIndex,
  chineseNumber,
  escapeLike,
  isCardNumberQuery,
  matchSeriesIndex,
  ordinalEn,
  parseAnniversaryToken,
  parseSearchQuery,
  postgrestLike,
  toChineseNumber
} from '../providers/search-query.mjs';

const FIXTURE_SERIES = [
  { id: 'pokemon-tcgdex-ja-m6a', game: 'pokemon', officialCode: 'M6a', region: 'JP', releaseDate: '2026-09-16', nameJa: '30th CELEBRATION', aliases: ['M6a'] },
  { id: 'pokemon-tw-official-m6a', game: 'pokemon', officialCode: 'M6a', region: 'TW', releaseDate: '2026-09-16', nameZh: '30th CELEBRATION', aliases: ['M6a'] },
  { id: 'pokemon-jp-official-mf', game: 'pokemon', officialCode: 'MF', region: 'JP', releaseDate: '2026-09-16', nameJa: '30th CELEBRATION プレミアムデッキセット エーフィ・ブラッキー', aliases: ['MF'] },
  { id: 'pokemon-pokemontcg-me55', game: 'pokemon', officialCode: 'me55', region: 'US', releaseDate: '2026-09-16', nameEn: '30th Celebration', aliases: ['me55'] },
  { id: 'pokemon-pokemontcg-me55c', game: 'pokemon', officialCode: 'me55c', region: 'US', releaseDate: '2026-09-16', nameEn: '30th Celebration Collection', aliases: ['me55c'] },
  { id: 'pokemon-jp-official-s8a', game: 'pokemon', officialCode: 'S8a', region: 'JP', releaseDate: '2021-10-22', nameJa: '25th アニバーサリーコレクション', aliases: ['S8a'] },
  { id: 'pokemon-jp-official-s8a-g', game: 'pokemon', officialCode: 'S8a-G', region: 'JP', releaseDate: '2021-12-01', nameJa: '25th ANNIVERSARY GOLDEN BOX', aliases: ['S8a-G'] },
  { id: 'pokemon-pokemontcg-cel25', game: 'pokemon', officialCode: 'cel25', region: 'US', releaseDate: '2021-10-08', nameEn: 'Celebrations', aliases: ['cel25'] },
  { id: 'pokemon-jp-official-cp6', game: 'pokemon', officialCode: 'CP6', region: 'JP', releaseDate: '2016-09-16', nameJa: 'コンセプトパック「ポケットモンスターカードゲーム 拡張パック 20th Anniversary」', aliases: ['CP6'] },
  { id: 'pokemon-tcgdex-ja-sv2a', game: 'pokemon', officialCode: 'SV2a', region: 'JP', releaseDate: '2023-06-16', nameJa: '強化拡張パック「ポケモンカード151」', aliases: ['SV2a'] },
  { id: 'pokemon-tcgdex-tw-sv2a', game: 'pokemon', officialCode: 'SV2a', region: 'TW', releaseDate: '2023-06-30', nameZh: '強化擴充包「寶可夢卡牌151」', aliases: ['SV2a'] },
  { id: 'pokemon-pokemontcg-sv3pt5', game: 'pokemon', officialCode: 'sv3pt5', region: 'US', releaseDate: '2023-09-22', nameEn: '151', aliases: ['sv3pt5', 'MEW'] },
  { id: 'pokemon-sv4a-jp', game: 'pokemon', officialCode: 'SV4a', region: 'JP', releaseDate: '2023-12-01', nameZh: '閃色寶藏 ex', nameJa: 'シャイニートレジャーex', nameEn: 'Shiny Treasure ex', aliases: ['閃色寶藏', 'SV4a'] },
  { id: 'pokemon-sv6a-jp', game: 'pokemon', officialCode: 'SV6a', region: 'JP', releaseDate: '2024-06-07', nameZh: '黑夜漫遊者', nameJa: 'ナイトワンダラー', aliases: ['SV6a'] },
  { id: 'onepiece-op05-jp', game: 'onepiece', officialCode: 'OP-05', region: 'JP', releaseDate: '2023-08-26', nameZh: '新時代的主角', nameJa: '新時代の主役', nameEn: 'Awakening of the New Era', aliases: ['OP05', 'OP-05'] },
  { id: 'yugioh-qccu-jp', game: 'yugioh', officialCode: 'QCCU', region: 'JP', releaseDate: '2024-02-23', nameZh: 'QUARTER CENTURY CHRONICLE side:UNITY', nameEn: 'Quarter Century Chronicle side: Unity', aliases: ['QCCU'] },
  { id: 'union-arena-ua01bt', game: 'union-arena', officialCode: 'UA01BT', region: 'JP', releaseDate: '2023-03-24', nameJa: 'コードギアス 反逆のルルーシュ', aliases: ['UA01BT'] }
];

const seriesIndex = buildSeriesIndex(FIXTURE_SERIES);

test('數字、中文數字、序數與周年同義詞正規化互通', () => {
  assert.equal(chineseNumber('30'), 30);
  assert.equal(chineseNumber('三十'), 30);
  assert.equal(chineseNumber('二十五'), 25);
  assert.equal(chineseNumber('十'), 10);
  assert.equal(toChineseNumber(30), '三十');
  assert.equal(toChineseNumber(25), '二十五');
  assert.equal(toChineseNumber(15), '十五');
  assert.equal(ordinalEn(1), '1st');
  assert.equal(ordinalEn(2), '2nd');
  assert.equal(ordinalEn(3), '3rd');
  assert.equal(ordinalEn(11), '11th');
  assert.equal(ordinalEn(25), '25th');
  assert.equal(ordinalEn(30), '30th');

  for (const input of ['30th', '30周年', '30週年', '30周年記念', '30週年紀念', '三十周年', '三十週年', '30th Anniversary', '30th Celebration']) {
    const f = parseAnniversaryToken(input);
    assert.ok(f, `應辨識周年詞：${input}`);
    assert.equal(f.number, 30, input);
    assert.equal(f.label, '30th', input);
    assert.ok(f.terms.includes('30th') && f.terms.includes('30周年') && f.terms.includes('30週年'), input);
  }
  assert.ok(anniversaryTerms('30周年記念').includes('30th'));
  assert.ok(anniversaryTerms('25周年').includes('cel25'));
  assert.ok(anniversaryTerms('25th').includes('quarter century'));
  assert.equal(parseAnniversaryToken('1st'), null, '單獨 1st 不視為周年');
  assert.equal(parseAnniversaryToken('1st Anniversary')?.number, 1);
  assert.equal(parseAnniversaryToken('2026年'), null);
});

test('30 周年／25 周年／20 周年複合查詢（含無空白、前後順序、多特徵混合）皆可精準拆解並命中對應系列', () => {
  const cases = [
    ['30th皮卡丘', '皮卡丘', '30th', [], null],
    ['30周年皮卡丘', '皮卡丘', '30th', [], null],
    ['30週年皮卡丘', '皮卡丘', '30th', [], null],
    ['30周年記念皮卡丘', '皮卡丘', '30th', [], null],
    ['30週年紀念皮卡丘', '皮卡丘', '30th', [], null],
    ['三十周年皮卡丘', '皮卡丘', '30th', [], null],
    ['三十週年皮卡丘', '皮卡丘', '30th', [], null],
    ['皮卡丘30th', '皮卡丘', '30th', [], null],
    ['皮卡丘 30周年', '皮卡丘', '30th', [], null],
    ['皮卡丘 30週年', '皮卡丘', '30th', [], null],
    ['30thPikachu', 'Pikachu', '30th', [], null],
    ['30thpikachu', 'pikachu', '30th', [], null],
    ['Pikachu30th', 'Pikachu', '30th', [], null],
    ['30th Anniversary Pikachu', 'Pikachu', '30th', [], null],
    ['30th CELEBRATION 皮卡丘', '皮卡丘', '30th', [], null],
    ['皮卡丘ex30th', '皮卡丘ex', '30th', [], null],
    ['30th皮卡丘SAR', '皮卡丘', '30th', ['SAR'], null],
    ['30周年皮卡丘 日版 SAR', '皮卡丘', '30th', ['SAR'], 'JP'],
    ['皮卡丘30th台版', '皮卡丘', '30th', [], 'TW'],
    ['30th皮卡丘台版', '皮卡丘', '30th', [], 'TW'],
    ['台版30周年皮卡丘', '皮卡丘', '30th', [], 'TW'],
    ['30th 017', '017', '30th', [], null]
  ];
  for (const [q, name, label, rarities, region] of cases) {
    const parsed = parseSearchQuery(q, { seriesIndex });
    assert.equal(parsed.name, name, `name: ${q}`);
    assert.deepEqual(parsed.rarities, rarities, `rarities: ${q}`);
    assert.equal(parsed.region, region, `region: ${q}`);
    assert.equal(parsed.series?.kind, 'anniversary', `kind: ${q}`);
    assert.equal(parsed.series?.label, label, `label: ${q}`);
    assert.ok(parsed.series.allIds.includes('pokemon-tcgdex-ja-m6a'), `allIds 含 JP M6a: ${q}`);
    assert.ok(parsed.series.allIds.includes('pokemon-tw-official-m6a'), `allIds 含 TW M6a: ${q}`);
    assert.ok(parsed.series.allIds.includes('pokemon-pokemontcg-me55'), `allIds 含 US me55: ${q}`);
    if (region === 'TW') assert.deepEqual(parsed.series.ids, ['pokemon-tw-official-m6a'], `台版只篩 TW 系列: ${q}`);
    if (region === 'JP') assert.ok(parsed.series.ids.includes('pokemon-tcgdex-ja-m6a') && !parsed.series.ids.includes('pokemon-tw-official-m6a'), `日版只篩 JP 系列: ${q}`);
  }

  const p25 = parseSearchQuery('25周年噴火龍', { seriesIndex });
  assert.equal(p25.name, '噴火龍');
  assert.equal(p25.series?.label, '25th');
  assert.ok(p25.series.allIds.includes('pokemon-jp-official-s8a'));
  assert.ok(p25.series.allIds.includes('pokemon-jp-official-s8a-g'));
  assert.ok(p25.series.allIds.includes('pokemon-pokemontcg-cel25'), '美版 Celebrations (cel25) 也納入 25 周年');
  assert.ok(p25.series.allIds.includes('yugioh-qccu-jp'), '遊戲王 Quarter Century 也納入 25 周年');

  const p20 = parseSearchQuery('20th噴火龍', { seriesIndex });
  assert.equal(p20.name, '噴火龍');
  assert.deepEqual(p20.series?.allIds, ['pokemon-jp-official-cp6']);
});

test('系列代碼、151 系列號、核心系列名複合查詢（有/無空白）皆由 catalog.series 動態索引驅動', () => {
  const cases = [
    ['M6a皮卡丘', '皮卡丘', 'code', ['pokemon-tcgdex-ja-m6a', 'pokemon-tw-official-m6a']],
    ['M6a 皮卡丘', '皮卡丘', 'code', ['pokemon-tcgdex-ja-m6a', 'pokemon-tw-official-m6a']],
    ['皮卡丘M6a', '皮卡丘', 'code', ['pokemon-tcgdex-ja-m6a', 'pokemon-tw-official-m6a']],
    ['SV2a超夢', '超夢', 'code', ['pokemon-tcgdex-ja-sv2a', 'pokemon-tcgdex-tw-sv2a']],
    ['S8a-G皮卡丘', '皮卡丘', 'code', ['pokemon-jp-official-s8a-g']],
    ['OP05魯夫', '魯夫', 'code', ['onepiece-op05-jp']],
    ['QCCU黑魔導女孩', '黑魔導女孩', 'code', ['yugioh-qccu-jp']],
    ['151皮卡丘', '皮卡丘', 'number', ['pokemon-tcgdex-ja-sv2a', 'pokemon-tcgdex-tw-sv2a', 'pokemon-pokemontcg-sv3pt5']],
    ['151 皮卡丘', '皮卡丘', 'number', ['pokemon-tcgdex-ja-sv2a', 'pokemon-tcgdex-tw-sv2a', 'pokemon-pokemontcg-sv3pt5']],
    ['皮卡丘151', '皮卡丘', 'number', ['pokemon-tcgdex-ja-sv2a', 'pokemon-tcgdex-tw-sv2a', 'pokemon-pokemontcg-sv3pt5']],
    ['151 夢幻ex SAR', '夢幻ex', 'number', ['pokemon-tcgdex-ja-sv2a', 'pokemon-tcgdex-tw-sv2a', 'pokemon-pokemontcg-sv3pt5']],
    ['閃色寶藏 夢幻', '夢幻', 'name', ['pokemon-sv4a-jp']],
    ['閃色寶藏夢幻', '夢幻', 'name', ['pokemon-sv4a-jp']],
    ['新時代的主角 魯夫', '魯夫', 'name', ['onepiece-op05-jp']]
  ];
  for (const [q, name, kind, expectedIds] of cases) {
    const parsed = parseSearchQuery(q, { seriesIndex });
    assert.equal(parsed.name, name, `name: ${q}`);
    assert.equal(parsed.series?.kind, kind, `kind: ${q}`);
    for (const id of expectedIds) assert.ok(parsed.series.allIds.includes(id), `${q} 應含系列 ${id}`);
  }
  assert.deepEqual(parseSearchQuery('151 夢幻ex SAR', { seriesIndex }).rarities, ['SAR']);
  assert.deepEqual(parseSearchQuery('SV2a超夢SAR', { seriesIndex }).rarities, ['SAR']);
});

test('防誤傷護欄：單搜系列、卡號、卡名後綴、兩位數與泛用包裝詞都不誤拆，且無系列時回傳形狀維持原樣', () => {
  // 單搜系列維持 name=系列詞，不拆成空的卡名
  for (const standalone of ['30th', '30周年', '30週年', '三十周年', '151', 'M6a', 'SV2a', '閃色寶藏']) {
    const parsed = parseSearchQuery(standalone, { seriesIndex });
    assert.equal(parsed.series, undefined, `單搜系列不拆：${standalone}`);
    assert.equal(parsed.name, standalone);
    assert.deepEqual(Object.keys(parsed).sort(), ['name', 'q', 'rarities', 'region']);
  }
  // 單搜系列＋版本／稀有度：保留系列作為 name，只拆版本或稀有度
  const s30jp = parseSearchQuery('30th 日版', { seriesIndex });
  assert.equal(s30jp.series, undefined);
  assert.equal(s30jp.name, '30th');
  assert.equal(s30jp.region, 'JP');
  const s30sar = parseSearchQuery('30th SAR', { seriesIndex });
  assert.equal(s30sar.series, undefined);
  assert.equal(s30sar.name, '30th');
  assert.deepEqual(s30sar.rarities, ['SAR']);

  // 卡號格式不被拆成系列交集
  for (const cardNo of ['SV6a 090', 'SV6a-090', 'OP-17-118', 'BETB EN060', 'M6a 017']) {
    assert.equal(isCardNumberQuery(cardNo), true, cardNo);
    const parsed = parseSearchQuery(cardNo, { seriesIndex });
    assert.equal(parsed.series, undefined, `卡號不拆：${cardNo}`);
    assert.equal(parsed.name, cardNo);
  }

  // 卡名後綴、2 位數字、單字母與泛用詞不誤拆
  for (const plain of ['噴火龍ex', '阿爾宙斯VSTAR', '皮卡丘VMAX', '皮卡丘V-UNION', '多邊獸2', 'Pikachu 25', 'Ace Sabo', 'R 噴火龍', '補充包 皮卡丘']) {
    const parsed = parseSearchQuery(plain, { seriesIndex });
    assert.equal(parsed.series, undefined, `不誤拆：${plain}`);
    assert.equal(parsed.name, plain);
  }
  // 數字邊界保護：10th 不得命中 110th
  const idx110 = buildSeriesIndex([{ id: 's-110', officialCode: 'S110', nameEn: '110th Special', region: 'JP' }]);
  assert.deepEqual(matchSeriesIndex(parseAnniversaryToken('10th'), idx110).allIds, []);
});

test('LIKE 與 PostgREST 萬用字元安全處理', () => {
  assert.equal(postgrestLike('30th%皮卡丘_(test).'), '30th皮卡丘test');
  assert.equal(escapeLike('100%_\\test'), '100\\%\\_\\\\test');
});

test('SQL migration（主庫與 ip2 同步）：7 參數 search_cards_ranked 與 search_fold_names 跳脫修正', async () => {
  const [mainSql, ip2Sql] = await Promise.all([
    readFile(new URL('../supabase/migrations/20261121000000_search_cards_ranked_series_filter.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/ip2/20261121000000_search_cards_ranked_series_filter.sql', import.meta.url), 'utf8')
  ]);
  assert.equal(mainSql, ip2Sql, '主庫與 ip2 的 migration 內容一致');
  assert.match(mainSql, /create or replace function public\.search_cards_ranked\([\s\S]*p_series_ids text\[\]/);
  assert.match(mainSql, /grant execute on function public\.search_cards_ranked\(text\[\], text\[\], integer, text, integer, text\[\], text\[\]\) to service_role;/);
  assert.match(mainSql, /replace\(public\.tcg_search_fold\(p_fold\), '\\', '\\\\'\)/, 'search_fold_names 反斜線正確雙重跳脫');
});

test('前端 index.html：已套用系列 chip 可取消並保留其餘條件；name-only-series 與 seriesTerms 連動', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /window\.setBandSearch\?\.\(q,meta\.seriesTerms\?\.length\?meta\.seriesTerms:meta\.queryTerms\)/);
  const start = html.indexOf('let activeSearch=null;');
  const end = html.indexOf('function emptySearchMarkup(');
  const searched = [];
  const host = { hidden: true, innerHTML: '' };
  const ctx = vm.createContext({
    $: id => (id === 'appliedFilters' ? host : { value: '' }),
    e: v => String(v ?? ''),
    rn: r => ({ JP: '日版', TW: '台版', US: '美版', KR: '韓版' }[r] || r),
    search: q => searched.push(q),
    document: {},
    window: {},
    CustomEvent: undefined
  });
  vm.runInContext(html.slice(start, end), ctx);
  vm.runInContext(`activeSearch = ${JSON.stringify({ parsed: { q: '30th皮卡丘 SAR', name: '皮卡丘', rarities: ['SAR'], region: null, series: { label: '30th', kind: 'anniversary', terms: ['30th', '30周年'] } } })}; showApplied(activeSearch);`, ctx);
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /data-cancel-kind="series" data-cancel-value="30th"/);
  assert.match(host.innerHTML, /取消條件 30th/);
  assert.match(host.innerHTML, /取消條件 SAR/);
  vm.runInContext('cancelAppliedFilter("series", "30th");', ctx);
  assert.equal(searched.at(-1), '皮卡丘 SAR');
  vm.runInContext('cancelAppliedFilter("rarity", "SAR");', ctx);
  assert.equal(searched.at(-1), '30th 皮卡丘');
  assert.equal(vm.runInContext('suggestReason("name-only-series")', ctx), '只搜卡名，不加系列、稀有度或版本');
  assert.equal(vm.runInContext('suggestReason("name-only")', ctx), '只搜卡名，不加稀有度或版本');
});

// ================= HTTP 整合測試（Mock Supabase / 本地備援 / 雙庫分流） =================
const BAD_PORTS = new Set([6000, 6665, 6666, 6667, 6668, 6669, 10080]);
async function listen(httpServer) {
  for (;;) {
    await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); });
    const { port } = httpServer.address();
    if (!BAD_PORTS.has(port)) return port;
    await close(httpServer);
  }
}
async function close(httpServer) {
  if (httpServer?.listening) {
    httpServer.closeAllConnections?.();
    await new Promise((resolve, reject) => httpServer.close(err => (err ? reject(err) : resolve())));
  }
}

function mockSupabase(routes = {}) {
  const calls = { rpc: [], tables: [] };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://mock-supabase');
    const name = url.pathname.split('/').at(-1);
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text ? JSON.parse(text) : null;
      const respond = (payload, status = 200) => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname.includes('/rpc/')) calls.rpc.push({ name, body });
      else calls.tables.push({ name, query: Object.fromEntries(url.searchParams) });
      const handler = routes[name];
      if (!handler) return respond([]);
      const result = handler({ body, query: url.searchParams, calls });
      if (result && typeof result === 'object' && '__status' in result) return respond(result.payload, result.__status);
      respond(result);
    });
  });
  return { server, calls };
}

async function withServer({ main = null, second = null, env = {} }, run) {
  const mainPort = main ? await listen(main.server) : null;
  const secondPort = second ? await listen(second.server) : null;
  const probe = createServer();
  const appPort = await listen(probe);
  await close(probe);
  let app;
  const childEnv = {
    ...process.env,
    PORT: String(appPort),
    CATALOG_SYNC_ON_START: 'false',
    CATALOG_WARM_ON_START: 'false',
    CARD_IMAGE_CACHE_ON_START: 'false',
    ...env
  };
  if (mainPort) {
    childEnv.SUPABASE_URL = `http://127.0.0.1:${mainPort}`;
    childEnv.SUPABASE_SERVICE_KEY = 'local-fixture-key';
  } else {
    delete childEnv.SUPABASE_URL;
    delete childEnv.SUPABASE_SERVICE_KEY;
  }
  if (secondPort) {
    childEnv.SUPABASE2_URL = `http://127.0.0.1:${secondPort}`;
    childEnv.SUPABASE2_SERVICE_KEY = 'local-fixture-key-2';
  } else {
    delete childEnv.SUPABASE2_URL;
    delete childEnv.SUPABASE2_SERVICE_KEY;
  }
  try {
    app = spawn(process.execPath, ['server.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`server start timeout: ${out}`)), 8000);
      app.once('exit', (code, sig) => { clearTimeout(timer); reject(new Error(`server exited (${code ?? sig}): ${out}`)); });
      app.stdout.on('data', chunk => { out += String(chunk); if (out.includes('CardScope is running')) { clearTimeout(timer); resolve(); } });
      app.stderr.on('data', chunk => { out += String(chunk); });
    });
    const search = async params => {
      const qs = new URLSearchParams(typeof params === 'string' ? { q: params } : params);
      const res = await fetch(`http://127.0.0.1:${appPort}/api/search?${qs}`);
      return { status: res.status, body: await res.json() };
    };
    return await run({ search, main, second });
  } finally {
    if (app && app.exitCode === null && app.signalCode === null) {
      await new Promise(resolve => { app.once('exit', resolve); app.kill(); });
    }
    if (main) await close(main.server);
    if (second) await close(second.server);
  }
}

const M6A_PIKACHU = {
  id: 'pokemon-tcgdex-ja-m6a-017',
  canonicalId: 'canon-pika-30th',
  game: 'pokemon',
  seriesId: 'pokemon-tcgdex-ja-m6a',
  officialCardNumber: '017',
  rarity: 'C',
  nameZh: '皮卡丘',
  nameJa: 'ピカチュウ',
  nameEn: 'Pikachu',
  nameKo: null,
  aliases: [],
  metadata: {},
  matchRank: 0,
  printings: [
    { id: 'p-m6a-jp', cardId: 'pokemon-tcgdex-ja-m6a-017', seriesId: 'pokemon-tcgdex-ja-m6a', region: 'JP', language: 'ja-JP', localSetCode: 'M6a', localCardNumber: '017', rarity: 'C', rarityCode: 'C', imageUrl: 'https://assets.tcgdex.net/ja/M/M6a/017/high.webp', imageRehostRequired: false },
    { id: 'p-other-jp', cardId: 'pokemon-tcgdex-ja-m6a-017', seriesId: 'pokemon-sv4a-jp', region: 'JP', language: 'ja-JP', localSetCode: 'SV4a', localCardNumber: '025', rarity: 'C', rarityCode: 'C', imageUrl: 'https://assets.tcgdex.net/ja/SV/SV4a/025/high.webp', imageRehostRequired: false }
  ]
};

const M6A_PIKACHU_TW = {
  id: 'pokemon-tw-official-m6a-017',
  canonicalId: 'canon-pika-30th',
  game: 'pokemon',
  seriesId: 'pokemon-tw-official-m6a',
  officialCardNumber: '017',
  rarity: 'C',
  nameZh: '皮卡丘',
  nameJa: null,
  nameEn: null,
  nameKo: null,
  aliases: [],
  metadata: {},
  matchRank: 0,
  printings: [
    { id: 'p-m6a-tw', cardId: 'pokemon-tw-official-m6a-017', seriesId: 'pokemon-tw-official-m6a', region: 'TW', language: 'zh-TW', localSetCode: 'M6a', localCardNumber: '017', rarity: 'C', rarityCode: 'C', imageUrl: 'https://asia.pokemon-card.com/tw/card-img/tw0001.png', imageRehostRequired: false }
  ]
};

test('HTTP 整合：30th皮卡丘／30周年皮卡丘／皮卡丘30th 呼叫 7 參數 RPC、過濾目標系列印刷，且 fields=suggest 一致', async () => {
  const main = mockSupabase({
    tcg_series: () => FIXTURE_SERIES.filter(s => s.game !== 'union-arena'),
    search_cards_ranked: ({ body }) => {
      assert.ok(Array.isArray(body.p_series_ids) && body.p_series_ids.length >= 3, '應送出 7 參數 p_series_ids');
      return { matchedBy: 'series+name', matchedSeries: body.p_series_ids.length, matchCount: 2, groupCount: 1, cards: [M6A_PIKACHU, M6A_PIKACHU_TW] };
    }
  });
  await withServer({ main }, async ({ search }) => {
    for (const q of ['30th皮卡丘', '30周年皮卡丘', '皮卡丘30th', '皮卡丘 30周年']) {
      const res = await search({ q });
      assert.equal(res.status, 200, q);
      assert.equal(res.body.meta.total, 1, q);
      assert.equal(res.body.meta.match, 'database-series+name', q);
      assert.equal(res.body.meta.parsed.name, '皮卡丘', q);
      assert.equal(res.body.meta.parsed.series.label, '30th', q);
      assert.ok(res.body.meta.seriesTerms.includes('30th') && res.body.meta.seriesTerms.includes('30周年'), q);
      assert.deepEqual(res.body.data[0].printings.map(p => p.seriesId).sort(), ['pokemon-tcgdex-ja-m6a', 'pokemon-tw-official-m6a'], `只留 30 周年印刷（濾掉 SV4a）：${q}`);
      assert.ok(res.body.data[0].printings.every(p => p.localSetCode === 'M6a'));
    }
    const rpcBody = main.calls.rpc[0].body;
    assert.deepEqual(Object.keys(rpcBody).sort(), ['p_limit', 'p_needles', 'p_offset', 'p_patterns', 'p_rarities', 'p_region', 'p_series_ids']);
    assert.ok(rpcBody.p_patterns.includes('%皮卡丘%') && rpcBody.p_patterns.includes('%Pikachu%'));

    // fields=suggest 一致性：只回單一目標系列 printing，且保留 parsed.series
    const suggest = await search({ q: '30th皮卡丘', limit: '6', fields: 'suggest' });
    assert.equal(suggest.status, 200);
    assert.equal(suggest.body.data.length, 1);
    assert.equal(suggest.body.data[0].printings.length, 1);
    assert.equal(suggest.body.data[0].printings[0].localSetCode, 'M6a');
    assert.equal(suggest.body.meta.parsed.series.label, '30th');

    // #57 資安檢核保留：非法 region 仍回 400
    const badRegion = await search({ q: '30th皮卡丘', region: 'INVALID' });
    assert.equal(badRegion.status, 400);
  });
});

test('HTTP 整合：7 參數 RPC 尚未遷移（PGRST202）時優雅降級為 PostgREST 交集，且 5 分鐘內不再重試', async () => {
  const main = mockSupabase({
    tcg_series: () => FIXTURE_SERIES.filter(s => s.game !== 'union-arena'),
    search_cards_ranked: ({ body }) => {
      if ('p_series_ids' in body) return { __status: 404, payload: { code: 'PGRST202', message: 'Could not find the function' } };
      return { matchedBy: 'name', matchedSeries: 0, matchCount: 0, groupCount: 0, cards: [] };
    },
    tcg_printings: () => [{ id: 'p-m6a-jp', cardId: M6A_PIKACHU.id, seriesId: 'pokemon-tcgdex-ja-m6a', region: 'JP', language: 'ja-JP', localSetCode: 'M6a', rarity: 'C', rarityCode: 'C', localCardNumber: '017' }],
    tcg_cards: () => [M6A_PIKACHU]
  });
  await withServer({ main }, async ({ search }) => {
    const first = await search({ q: '30th皮卡丘' });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 1);
    assert.equal(first.body.data[0].id, M6A_PIKACHU.canonicalId);
    assert.deepEqual(first.body.data[0].printings.map(p => p.seriesId), ['pokemon-tcgdex-ja-m6a']);
    const rpcCountAfterFirst = main.calls.rpc.filter(c => c.name === 'search_cards_ranked' && 'p_series_ids' in c.body).length;
    assert.equal(rpcCountAfterFirst, 1);

    // 不同查詢（避開搜尋快取）不應再次打 7 參數 RPC
    const second = await search({ q: '30周年皮卡丘' });
    assert.equal(second.status, 200);
    assert.equal(second.body.data.length, 1);
    assert.equal(main.calls.rpc.filter(c => c.name === 'search_cards_ranked' && 'p_series_ids' in c.body).length, 1, '斷路器生效，不再重試 7 參數 RPC');
  });
});

test('HTTP 整合：防誤拆安全網、跨區 otherRegion 與 name-only-series 建議', async () => {
  const LITERAL_CARD = {
    id: 'pokemon-special-30th-pika',
    canonicalId: 'pokemon-special-30th-pika',
    game: 'pokemon',
    seriesId: 'pokemon-sv4a-jp',
    officialCardNumber: '999',
    rarity: 'PR',
    nameZh: '30th紀念皮卡丘',
    nameJa: null,
    nameEn: null,
    nameKo: null,
    aliases: [],
    metadata: {},
    matchRank: 0,
    printings: [{ id: 'p-lit', cardId: 'pokemon-special-30th-pika', seriesId: 'pokemon-sv4a-jp', region: 'JP', language: 'ja-JP', localSetCode: 'SV4a', localCardNumber: '999', rarity: 'PR', rarityCode: 'PR', imageUrl: null, imageRehostRequired: false }]
  };
  const CP6_PIKA = {
    id: 'pokemon-cp6-033',
    canonicalId: 'pokemon-cp6-033',
    game: 'pokemon',
    seriesId: 'pokemon-jp-official-cp6',
    officialCardNumber: '033',
    rarity: 'C',
    nameZh: '皮卡丘',
    nameJa: 'ピカチュウ',
    nameEn: 'Pikachu',
    nameKo: null,
    aliases: [],
    metadata: {},
    matchRank: 0,
    printings: [{ id: 'p-cp6', cardId: 'pokemon-cp6-033', seriesId: 'pokemon-jp-official-cp6', region: 'JP', language: 'ja-JP', localSetCode: 'CP6', localCardNumber: '033', rarity: 'C', rarityCode: 'C', imageUrl: null, imageRehostRequired: false }]
  };
  const main = mockSupabase({
    tcg_series: () => FIXTURE_SERIES.filter(s => s.game !== 'union-arena'),
    search_cards_ranked: ({ body }) => {
      // 防誤拆：系列交集回 0 筆，完整字串命中 LITERAL_CARD
      if (!('p_series_ids' in body) && body.p_patterns.includes('%30th紀念皮卡丘%')) {
        return { matchedBy: 'name', matchedSeries: 0, matchCount: 1, groupCount: 1, cards: [LITERAL_CARD] };
      }
      // 跨區提示：CP6 20th 只在 JP 有卡
      if ('p_series_ids' in body && body.p_series_ids.includes('pokemon-jp-official-cp6') && body.p_region === null) {
        return { matchedBy: 'series+name', matchedSeries: 1, matchCount: 1, groupCount: 1, cards: [CP6_PIKA] };
      }
      // name-only-series：台版純搜「皮卡丘」有卡
      if (!('p_series_ids' in body) && body.p_patterns.includes('%皮卡丘%') && body.p_region === 'TW') {
        return { matchedBy: 'name', matchedSeries: 0, matchCount: 1, groupCount: 1, cards: [M6A_PIKACHU_TW] };
      }
      return { matchedBy: null, matchedSeries: 0, matchCount: 0, groupCount: 0, cards: [] };
    }
  });
  await withServer({ main }, async ({ search }) => {
    // 1) 防誤拆退回：退回完整字串命中並移除 parsed.series
    const literal = await search({ q: '30th紀念皮卡丘' });
    assert.equal(literal.status, 200);
    assert.equal(literal.body.data.length, 1);
    assert.equal(literal.body.data[0].id, LITERAL_CARD.id);
    assert.equal(literal.body.meta.parsed.series, undefined, '退回完整字串命中後清除錯誤的系列條件');

    // 2) 台版搜 20th皮卡丘（只有日版 CP6）：otherRegion 指向 JP，且建議 name-only-series
    const tw20 = await search({ q: '20th皮卡丘', region: 'TW' });
    assert.equal(tw20.status, 200);
    assert.equal(tw20.body.meta.total, 0);
    assert.deepEqual(tw20.body.meta.otherRegion, { region: 'JP' });
    assert.deepEqual(tw20.body.meta.suggestion, { q: '皮卡丘', reason: 'name-only-series' });
  });
});

test('HTTP 整合：雙庫（main + ip2）系列分流，30th 不打 ip2、UA 系列不打 main', async () => {
  const UA_CARD = {
    id: 'union-arena-ua01bt-001',
    canonicalId: 'union-arena-ua01bt-001',
    game: 'union-arena',
    seriesId: 'union-arena-ua01bt',
    officialCardNumber: '001',
    rarity: 'SR',
    nameZh: null,
    nameJa: 'ルルーシュ',
    nameEn: null,
    nameKo: null,
    aliases: [],
    metadata: {},
    matchRank: 0,
    printings: [{ id: 'p-ua-1', cardId: 'union-arena-ua01bt-001', seriesId: 'union-arena-ua01bt', region: 'JP', language: 'ja-JP', localSetCode: 'UA01BT', localCardNumber: '001', rarity: 'SR', rarityCode: 'SR', imageUrl: null, imageRehostRequired: false }]
  };
  const main = mockSupabase({
    tcg_series: () => FIXTURE_SERIES.filter(s => s.game !== 'union-arena'),
    search_cards_ranked: ({ body }) => ({ matchedBy: 'series+name', matchedSeries: body.p_series_ids?.length || 0, matchCount: 1, groupCount: 1, cards: [M6A_PIKACHU] })
  });
  const second = mockSupabase({
    tcg_games: () => [{ id: 'union-arena', nameEn: 'UNION ARENA' }],
    tcg_series: () => FIXTURE_SERIES.filter(s => s.game === 'union-arena'),
    search_cards_ranked: ({ body }) => ({ matchedBy: 'series+name', matchedSeries: body.p_series_ids?.length || 0, matchCount: 1, groupCount: 1, cards: [UA_CARD] })
  });
  await withServer({ main, second }, async ({ search }) => {
    const pkm = await search({ q: '30th皮卡丘' });
    assert.equal(pkm.status, 200);
    assert.equal(pkm.body.data.length, 1);
    assert.equal(main.calls.rpc.length, 1);
    assert.equal(second.calls.rpc.length, 0, '30th 全屬主庫系列，完全跳過 ip2');

    const ua = await search({ q: 'UA01BTルルーシュ' });
    assert.equal(ua.status, 200);
    assert.equal(ua.body.data.length, 1);
    assert.equal(ua.body.data[0].id, UA_CARD.id);
    assert.equal(main.calls.rpc.length, 1, 'UA01BT 全屬 ip2 系列，完全跳過 main');
    assert.equal(second.calls.rpc.length, 1);
  });
});

test('HTTP 整合：無資料庫時本地 catalog.json 備援支援跨欄位系列＋卡名交集', async () => {
  await withServer({}, async ({ search }) => {
    const op = await search({ q: 'OP05魯夫' });
    assert.equal(op.status, 200);
    assert.equal(op.body.meta.total, 1);
    assert.equal(op.body.data[0].id, 'onepiece-monkey-d-luffy-op05-119');
    assert.equal(op.body.meta.parsed.series.label, 'OP-05');

    const ygo = await search({ q: '25周年黑魔導女孩' });
    assert.equal(ygo.status, 200);
    assert.equal(ygo.body.meta.total, 1);
    assert.equal(ygo.body.data[0].id, 'yugioh-dark-magician-girl-qccu-jp002');
    assert.equal(ygo.body.meta.parsed.series.label, '25th');

    const miss = await search({ q: 'OP05黑魔導女孩' });
    assert.equal(miss.status, 200);
    assert.equal(miss.body.meta.total, 0, '不同系列交集應為 0 筆');
  });
});

test('matchSeriesIndex 命中超過 50 筆系列時，先依 region 篩選再截斷 MAX_SERIES_IDS', () => {
  const many = [];
  for (let i = 0; i < 55; i++) {
    many.push({
      id: `jp-30th-${String(i).padStart(2, '0')}`,
      game: 'pokemon',
      officialCode: `J${i}`,
      region: 'JP',
      releaseDate: `2026-10-${String(30 - (i % 28)).padStart(2, '0')}`,
      nameJa: `30th Anniversary JP ${i}`,
      aliases: []
    });
  }
  for (let i = 0; i < 60; i++) {
    many.push({
      id: `tw-30th-${String(i).padStart(2, '0')}`,
      game: 'pokemon',
      officialCode: `T${i}`,
      region: 'TW',
      releaseDate: `2020-01-${String(28 - (i % 28)).padStart(2, '0')}`,
      nameZh: `30th Anniversary TW ${i}`,
      aliases: []
    });
  }
  const idx = buildSeriesIndex(many);
  const res = matchSeriesIndex(parseAnniversaryToken('30th'), idx, { region: 'TW' });
  assert.equal(res.allIds.length, 50);
  assert.ok(res.allIds.every(id => id.startsWith('jp-30th-')), 'allIds 前 50 筆全是較新的 JP 系列');
  assert.equal(res.ids.length, 50);
  assert.ok(res.ids.every(id => id.startsWith('tw-30th-')), '依 region=TW 篩選後才截斷 MAX_SERIES_IDS，不漏掉 TW 系列');
  assert.equal(res.matched.length, 50);
  assert.ok(res.matched.every(entry => entry.region === 'TW'));
});
