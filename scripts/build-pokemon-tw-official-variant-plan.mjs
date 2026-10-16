import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTwOfficialVariantPlans, buildTwOfficialVariantSql } from '../providers/pokemon-tw-official-variant-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-tw-official-variant-plan.mjs <base-cards.json> <out-dir> --cache FILE[,FILE...] [--matches FILE] [--actor NAME]',
  '',
  'ADR 0043: plans for private.split_pokemon_tw_official_variants. base-cards.json is the read-only export of the',
  'Taiwanese cards whose TW printing lists several official detail IDs (docs/evidence/pokemon-tw/variant-split-20261016/',
  'base-cards.sql). --cache lists Taiwanese official search caches with .details (later files win), for example',
  'docs/evidence/pokemon-tw/official-rarity-20261002.json,docs/evidence/pokemon-tw/official-series/official-promo-cache-20261014.json.',
  '',
  '--matches (ADR 0043 addendum): JSON { "<base card id>": "<official detail id>" }, the official page whose image the base card already shows',
  '(docs/evidence/pokemon-tw/variant-split-20261017/image-match.json, field "matches"). A base card with a printing image and no entry is skipped.',
  '',
  'Plans hold at most 100 new cards, never split a base card and cover one series each. Writes plan-<n>.json,',
  'plan-<n>.sql, plan-<n>-replay.sql and report.json. No network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const positional = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--actor' && args[i - 1] !== '--cache' && args[i - 1] !== '--matches');
  const [basePath, outDir] = positional;
  const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (!basePath || !outDir || !flag('--cache')) throw new Error('ARGUMENTS_REQUIRED');
  const actor = flag('--actor') ?? 'claude-code-local:aa26488931';
  const details = {};
  for (const path of flag('--cache').split(',')) Object.assign(details, JSON.parse(readFileSync(path, 'utf8')).details);
  const imageMatches = flag('--matches') ? JSON.parse(readFileSync(flag('--matches'), 'utf8')).matches : {};
  const baseCards = JSON.parse(readFileSync(basePath, 'utf8')).map(row => ({ ...row, has_image: Boolean(row.has_image || row.printing_image) }));
  if (!Array.isArray(baseCards) || !Object.keys(details).length) throw new Error('INPUT_SHAPE_UNSUPPORTED');
  const { plans, skipped, summary } = buildTwOfficialVariantPlans({ details, baseCards, imageMatches });
  mkdirSync(outDir, { recursive: true });
  const files = plans.map((item, i) => {
    const name = `plan-${String(i + 1).padStart(2, '0')}`;
    const sql = buildTwOfficialVariantSql(item.plan, actor, item.baseImages);
    writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(item.plan, null, 1)}\n`);
    writeFileSync(join(outDir, `${name}.sql`), sql.gated);
    writeFileSync(join(outDir, `${name}-replay.sql`), sql.replay);
    return { file: name, series: item.series, bases: item.bases, newCards: item.cards, baseImages: item.baseImages, planDigest: sql.digest };
  });
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify({ summary, plans: files, skipped }, null, 1)}\n`);
  for (const row of summary) console.log(JSON.stringify(row));
  for (const row of files) console.log(JSON.stringify(row));
  console.log(JSON.stringify({ skipped: skipped.length }));
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
