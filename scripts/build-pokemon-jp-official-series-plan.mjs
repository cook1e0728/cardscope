import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOfficialJpSeriesPlans, buildOfficialJpSeriesSql } from '../providers/pokemon-jp-official-series-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-official-series-plan.mjs <cache.json> <series-meta.json> <out-dir> [--series CODE,CODE] [--actor NAME]',
  '',
  'ADR 0012: turns a whole-series official card search cache (fetch-pokemon-jp-official-rarity.mjs',
  '--whole-series) into import plans of at most 100 cards for private.import_pokemon_jp_official_series.',
  'series-meta.json: { CODE: { name_ja, release_date, basis } }. Writes per batch <CODE>-<n>.json,',
  '<CODE>-<n>.sql (gated: dry run must match before the write) and <CODE>-<n>-replay.sql, plus',
  '<CODE>-report.json with quarantined pages and unknown rarities. No network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const [cachePath, metaPath, outDir] = args;
  if (!cachePath || !metaPath || !outDir || [cachePath, metaPath, outDir].some(arg => arg.startsWith('--'))) throw new Error('ARGUMENTS_REQUIRED');
  const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const actor = flag('--actor') ?? 'claude-code-local:aa26488931';
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const codes = flag('--series')?.split(',') ?? Object.keys(meta);
  mkdirSync(outDir, { recursive: true });
  for (const code of codes) {
    const { plans, evidence, quarantined, rarityUnknown, summary } = buildOfficialJpSeriesPlans({ code, seriesMeta: meta[code], cache });
    const digests = [];
    for (const plan of plans) {
      const name = `${code}-${plan.batch.index}`;
      const { digest, gated, replay } = buildOfficialJpSeriesSql(plan, actor);
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
      writeFileSync(join(outDir, `${name}.sql`), gated);
      writeFileSync(join(outDir, `${name}-replay.sql`), replay);
      digests.push({ batch: plan.batch.index, cards: plan.cards.length, planDigest: digest });
    }
    writeFileSync(join(outDir, `${code}-report.json`), `${JSON.stringify({ summary, digests, quarantined, rarityUnknown, evidence }, null, 1)}\n`);
    console.log(JSON.stringify({ ...summary, digests }));
  }
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
