import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTwCardImageSql, officialTwImageUrl, planTwOfficialCardImages, twCardImageBatches, twCardImagePlanDigest } from '../providers/pokemon-tw-card-images-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-tw-card-images-plan.mjs <missing-cards.json> <all-tw-cards.json> <out-dir> --cache FILE[,FILE...]',
  '',
  'ADR 0031: gives Taiwanese Pokemon cards that have no image at all their own official card image link',
  '(asia.pokemon-card.com/tw/card-img/tw<detail ID, 8 digits>.png). missing-cards.json rows:',
  '{ card_id, source, code, num, name_zh, ids } (ids = metadata.officialDetailIds); all-tw-cards.json rows:',
  '{ card_id, code, name_zh }. --cache lists Taiwanese official search caches (seriesLists + details), later',
  'files win. Writes plan.json, report.json and per batch <n>-dry.sql, <n>-test.sql, <n>-write.sql and',
  '<n>-replay.sql. No network or database calls; images are never read.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const [missingPath, allPath, outDir] = args;
  const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (!missingPath || !allPath || !outDir || !flag('--cache')) throw new Error('ARGUMENTS_REQUIRED');
  const cache = { seriesLists: {}, details: {} };
  for (const path of flag('--cache').split(',')) {
    const part = JSON.parse(readFileSync(path, 'utf8'));
    Object.assign(cache.seriesLists, part.seriesLists);
    Object.assign(cache.details, part.details);
  }
  const cards = JSON.parse(readFileSync(missingPath, 'utf8'));
  const allCards = JSON.parse(readFileSync(allPath, 'utf8'));
  const { matched, unmatched } = planTwOfficialCardImages({ cards, allCards, cache });
  if (matched.length + unmatched.length !== cards.length) throw new Error(`COUNT_MISMATCH:${matched.length}+${unmatched.length}<>${cards.length}`);
  mkdirSync(outDir, { recursive: true });

  const tally = (rows, keys) => rows.reduce((acc, row) => { const key = keys(row); acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const sourceOf = new Map(cards.map(card => [card.card_id, card.source]));
  const batches = twCardImageBatches(matched).map((rows, index) => {
    const name = `batch-${String(index + 1).padStart(2, '0')}`;
    const sql = buildTwCardImageSql(rows, name);
    for (const [kind, text] of Object.entries(sql)) writeFileSync(join(outDir, `${name}-${kind}.sql`), text);
    return { name, cards: rows.length, first: rows[0].cardId, last: rows.at(-1).cardId, digest: twCardImagePlanDigest(rows) };
  });
  writeFileSync(join(outDir, 'plan.json'), `${JSON.stringify(matched.map(row => ({ cardId: row.cardId, detailId: row.detailId, imageUrl: officialTwImageUrl(row.detailId), group: row.group, basis: row.basis })), null, 0)}\n`);
  const report = {
    candidates: cards.length,
    matched: matched.length,
    unmatched: unmatched.length,
    matchedByGroup: tally(matched, row => `${row.group}:${row.basis}`),
    matchedBySource: tally(matched, row => sourceOf.get(row.cardId)),
    matchedBySet: tally(matched, row => row.code),
    unmatchedByReason: tally(unmatched, row => row.reason.split(':')[0]),
    unmatchedBySet: tally(unmatched, row => row.code),
    batches,
    planDigest: twCardImagePlanDigest(matched),
    unmatchedCards: unmatched
  };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(JSON.stringify({ candidates: report.candidates, matched: report.matched, unmatched: report.unmatched, matchedByGroup: report.matchedByGroup, unmatchedByReason: report.unmatchedByReason, batches: batches.map(b => `${b.name}:${b.cards}`) }));
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
