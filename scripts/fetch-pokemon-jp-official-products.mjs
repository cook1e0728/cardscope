import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { officialJpDetailUrl } from '../providers/pokemon-jp-official.mjs';
import { parseOfficialJpProducts } from '../providers/pokemon-jp-official-decks.mjs';

const usage = [
  'Usage: node scripts/fetch-pokemon-jp-official-products.mjs <series-cache.json> <out.json> --series SA,SCS',
  '',
  'ADR 0032：讀日本官方卡片詳細頁的「収録商品」，記錄每個官方卡片 ID 收錄在哪些商品。',
  '只抓 <series-cache.json> 中這些系列清單列出的詳細頁；單一連線、間隔 ≥1.5 秒、非 200 即停。',
  '<out.json> 已有的卡片會跳過，可中斷後接續。只存文字事實（商品名與商品頁路徑）。'
].join('\n');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'CardScope/1.0 (metadata check; low rate)', Accept: 'text/html' }, signal: AbortSignal.timeout(60000) });
  if (response.status !== 200) throw new Error(`OFFICIAL_HTTP_${response.status} ${url}`);
  return response.text();
}

function save(path, data) {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(data, null, 1)}\n`);
  renameSync(`${path}.tmp`, path);
}

try {
  const args = process.argv.slice(2);
  const [cachePath, outPath] = args;
  const seriesArg = args[args.indexOf('--series') + 1];
  if (!cachePath || !outPath || !args.includes('--series') || !seriesArg) throw new Error('ARGUMENTS_REQUIRED');
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const out = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { source: 'pokemon-card.com card detail 収録商品', cards: {} };
  const ids = seriesArg.split(',').flatMap(code => {
    const list = cache.lists?.[code];
    if (!list) throw new Error(`OFFICIAL_LIST_MISSING:${code}`);
    return list.cardIds.map(cardId => ({ code, cardId }));
  }).filter(({ cardId }) => !out.cards[cardId]);
  console.log(`to fetch: ${ids.length}`);
  for (const [index, { code, cardId }] of ids.entries()) {
    const products = parseOfficialJpProducts(await fetchText(officialJpDetailUrl(cardId)));
    out.cards[cardId] = { list: code, products, fetchedAt: new Date().toISOString() };
    if (index % 10 === 9 || index === ids.length - 1) save(outPath, out);
    await sleep(1500);
  }
  save(outPath, out);
  console.log(`done: ${Object.keys(out.cards).length} cards`);
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exit(1);
}
