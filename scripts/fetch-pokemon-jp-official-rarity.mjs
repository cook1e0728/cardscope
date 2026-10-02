import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { OFFICIAL_JP_ORIGIN, officialJpDetailUrl, officialJpListUrl, parseOfficialJpDetail, parseOfficialJpList } from '../providers/pokemon-jp-official.mjs';

const usage = [
  'Usage: node scripts/fetch-pokemon-jp-official-rarity.mjs <needed.json> <cache.json> [--series CODE,CODE]',
  '',
  'Reads the public pokemon-card.com card search for JP printings whose rarity is empty (ADR 0007).',
  'needed.json: [{ code, num, name_ja, ... }] read from the database. For each series it lists the',
  'official card IDs, then opens detail pages, starting at the list position of the card number and',
  'walking by the number difference until the page shows that number. Every response summary is',
  'kept in cache.json, so a rerun resumes without refetching. One request at a time, at least',
  '1.5 s apart; any non-200 response stops the run. Only text facts are stored, never images.'
].join('\n');

const GAP_MS = 1500;
let lastRequest = 0;
async function politeGet(url) {
  const wait = lastRequest + GAP_MS - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequest = Date.now();
  const response = await fetch(url, { headers: { 'User-Agent': 'CardScope/1.0 (metadata check; low rate)', Accept: 'text/html,application/json' }, signal: AbortSignal.timeout(60000) });
  if (response.status !== 200) throw new Error(`OFFICIAL_HTTP_${response.status} ${url}`);
  return response.text();
}

try {
  const args = process.argv.slice(2);
  const [neededPath, cachePath] = args;
  if (!neededPath || !cachePath || neededPath.startsWith('--')) throw new Error('ARGUMENTS_REQUIRED');
  const seriesOption = args[args.indexOf('--series') + 1];
  const only = args.includes('--series') ? new Set(seriesOption.split(',')) : null;
  const needed = JSON.parse(readFileSync(neededPath, 'utf8')).filter(row => !only || only.has(row.code));
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { source: 'pokemon-card.com card search', lists: {}, details: {} };
  const save = () => writeFileSync(cachePath, `${JSON.stringify(cache, null, 1)}\n`);

  for (const code of [...new Set(needed.map(row => row.code))]) {
    if (!cache.lists[code]) {
      const first = parseOfficialJpList(await politeGet(officialJpListUrl(code, 1)));
      const cardIds = [...first.cardIds];
      for (let page = 2; page <= first.maxPage; page++) cardIds.push(...parseOfficialJpList(await politeGet(officialJpListUrl(code, page))).cardIds);
      if (cardIds.length !== first.hitCount) throw new Error(`OFFICIAL_LIST_COUNT ${code} ${cardIds.length}/${first.hitCount}`);
      cache.lists[code] = { hitCount: first.hitCount, cardIds, fetchedAt: new Date().toISOString() };
      save();
    }
    const { cardIds } = cache.lists[code];
    const detailAt = async index => {
      const cardId = cardIds[index];
      if (!cache.details[cardId]) { cache.details[cardId] = { ...parseOfficialJpDetail(await politeGet(officialJpDetailUrl(cardId))), cardId, list: code, fetchedAt: new Date().toISOString() }; save(); }
      return cache.details[cardId];
    };
    for (const row of needed.filter(item => item.code === code)) {
      let index = Math.min(Math.max(Number(row.num) - 1, 0), cardIds.length - 1), found = null;
      for (let step = 0; step < 6 && index >= 0 && index < cardIds.length; step++) {
        const detail = await detailAt(index);
        if (detail.setMark === code && detail.number === row.num) { found = detail; break; }
        const delta = Number(row.num) - Number(detail.number);
        if (!Number.isFinite(delta) || delta === 0) break;
        index += delta;
      }
      // Some cards are missing from the series list (SV6a-092): search the name and open only results filed under this series' image folder; the detail page still decides.
      if (!found && row.name_ja) {
        const search = JSON.parse(await politeGet(`${OFFICIAL_JP_ORIGIN}/card-search/resultAPI.php?${new URLSearchParams({ keyword: row.name_ja, regulation_sidebar_form: 'all', pg: '', sm_and_keyword: 'true' })}`));
        for (const card of (search.cardList || []).filter(item => String(item.cardThumbFile || '').split('/').at(-2) === code)) {
          const cardId = String(card.cardID);
          if (!cache.details[cardId]) { cache.details[cardId] = { ...parseOfficialJpDetail(await politeGet(officialJpDetailUrl(cardId))), cardId, list: `${code}:keyword`, fetchedAt: new Date().toISOString() }; save(); }
          const detail = cache.details[cardId];
          if (detail.setMark === code && detail.number === row.num) { found = detail; break; }
        }
      }
      // Otherwise look outward from the guess, a bounded number of new pages.
      const guess = Math.min(Math.max(Number(row.num) - 1, 0), cardIds.length - 1);
      for (let distance = 0, fetched = 0; !found && fetched < 12 && distance < cardIds.length; distance++) {
        for (const candidate of new Set([guess - distance, guess + distance])) {
          if (found || candidate < 0 || candidate >= cardIds.length) continue;
          if (!cache.details[cardIds[candidate]]) fetched++;
          const detail = await detailAt(candidate);
          if (detail.setMark === code && detail.number === row.num) found = detail;
        }
      }
      console.log(`${code}-${row.num} ${found ? `${found.cardId} ${found.rarityIcon || 'no-mark'}` : 'NOT_FOUND'}`);
    }
  }
  console.log(`done: ${Object.keys(cache.details).length} detail pages cached`);
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
