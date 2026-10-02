import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { OFFICIAL_TW_RARITY_FILTERS, officialTwDetailUrl, officialTwListUrl, parseOfficialTwDetail, parseOfficialTwList } from '../providers/pokemon-tw-official.mjs';

const usage = [
  'Usage: node scripts/fetch-pokemon-tw-official-rarity.mjs <needed.json> <cache.json> [--series CODE,CODE] [--max-requests N]',
  '',
  'Reads the public Taiwanese card search (asia.pokemon-card.com/tw) for ADR 0010, in three resumable phases:',
  '  1. every rarity filter list across all series (which detail IDs carry which rarity),',
  '  2. the card list of each series named in needed.json ([{ code, ... }], read from the database),',
  '  3. the detail page of every card in those lists (set mark, card number, Chinese name).',
  'Everything is kept in cache.json after each request, so a rerun resumes. One request at a time, at',
  'least 1.5 s apart; any non-200 response stops the run. --max-requests ends the run cleanly after N',
  'network requests. Only text facts are stored, never images.'
].join('\n');

const GAP_MS = 1500;
let lastRequest = 0, requests = 0, maxRequests = Infinity;
class Budget extends Error {}
async function politeGet(url) {
  if (requests >= maxRequests) throw new Budget();
  const wait = lastRequest + GAP_MS - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequest = Date.now(); requests++;
  const response = await fetch(url, { headers: { 'User-Agent': 'CardScope/1.0 (metadata check; low rate)', Accept: 'text/html' }, signal: AbortSignal.timeout(60000) });
  if (response.status !== 200) throw new Error(`OFFICIAL_TW_HTTP_${response.status} ${url}`);
  return response.text();
}

const args = process.argv.slice(2);
const [neededPath, cachePath] = args;
const option = name => { const index = args.indexOf(`--${name}`); return index === -1 ? null : args[index + 1]; };
let cache;
// On Windows the rename fails with EPERM/EBUSY while another process is reading the cache
// (an incremental plan build copying it); wait briefly and retry instead of aborting the run.
const save = () => {
  writeFileSync(`${cachePath}.tmp`, `${JSON.stringify(cache)}\n`);
  for (let attempt = 1; ; attempt++) {
    try { renameSync(`${cachePath}.tmp`, cachePath); return; } catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 20) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
};

async function collectList(store, key, urlFor) {
  const entry = store[key] ||= { pages: {}, totalPages: null };
  for (let page = 1; entry.totalPages === null || page <= entry.totalPages; page++) {
    if (entry.pages[page]) continue;
    const parsed = parseOfficialTwList(await politeGet(urlFor(page)));
    entry.totalPages = parsed.totalPages;
    entry.pages[page] = parsed.detailIds;
    save();
    if (!parsed.detailIds.length) break;
  }
  entry.complete = true;
  save();
  return Object.keys(entry.pages).sort((a, b) => a - b).flatMap(page => entry.pages[page]);
}

try {
  if (!neededPath || !cachePath || neededPath.startsWith('--')) throw new Error('ARGUMENTS_REQUIRED');
  if (option('max-requests')) maxRequests = Number(option('max-requests'));
  const only = option('series') ? option('series').split(',') : null;
  const codes = [...new Set(JSON.parse(readFileSync(neededPath, 'utf8')).map(row => row.code))].filter(code => !only || only.includes(code));
  cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { source: 'asia.pokemon-card.com/tw card search', rarityLists: {}, seriesLists: {}, details: {} };

  for (const value of Object.keys(OFFICIAL_TW_RARITY_FILTERS)) {
    if (cache.rarityLists[value]?.complete) continue;
    const ids = await collectList(cache.rarityLists, value, page => officialTwListUrl({ rarityValue: value, page }));
    console.log(`rarity ${OFFICIAL_TW_RARITY_FILTERS[value]}: ${ids.length}`);
  }
  for (const code of codes) {
    const ids = cache.seriesLists[code]?.complete ? null : await collectList(cache.seriesLists, code, page => officialTwListUrl({ seriesCode: code, page }));
    if (ids) console.log(`series ${code}: ${ids.length}`);
  }
  for (const code of codes) {
    const entry = cache.seriesLists[code];
    const ids = Object.keys(entry.pages).sort((a, b) => a - b).flatMap(page => entry.pages[page]);
    let fetched = 0;
    for (const id of ids) {
      if (cache.details[id]) continue;
      cache.details[id] = { ...parseOfficialTwDetail(await politeGet(officialTwDetailUrl(id))), list: code, fetchedAt: new Date().toISOString() };
      fetched++;
      save();
    }
    if (fetched) console.log(`details ${code}: +${fetched} (series has ${ids.length})`);
  }
  console.log(`done: ${requests} requests, ${Object.keys(cache.details).length} detail pages cached`);
} catch (error) {
  if (error instanceof Budget) console.log(`paused: request budget reached (${requests}); rerun to continue`);
  else { console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message); process.exitCode = 1; }
}
