import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOfficialTwSeriesPlans } from '../providers/pokemon-tw-official-series-plan.mjs';
import { buildOfficialJpSeriesSql } from '../providers/pokemon-jp-official-series-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-tw-official-series-plan.mjs <tw-cache.json> <expansion-names.json> <out-dir> --series CODE,CODE [--actor NAME]',
  '',
  'ADR 0015: turns the Taiwanese official card search cache into import plans of at most 100 cards for',
  'private.import_pokemon_tw_official_series. expansion-names.json: { expansions: { CODE: official label } };',
  'the series name is the label without a booster-pack prefix or quote marks. Writes per batch <CODE>-<n>.json,',
  '<CODE>-<n>.sql (gated) and <CODE>-<n>-replay.sql, plus <CODE>-report.json. No network or database calls.'
].join('\n');

// Drop the booster-pack prefix (擴充包「超級勇氣」 -> 超級勇氣) but keep deck types and anything after the
// quotes, so sibling products stay distinct (擴充包「傳說交鋒」SET A, G超起始牌組「傳說交鋒」).
export function seriesNameFromLabel(label) {
  return String(label || '').replace(/^(?:擴充包|強化擴充包|高級擴充包)\s*/, '').replace(/\s*[「」]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

try {
  const args = process.argv.slice(2);
  const [cachePath, namesPath, outDir] = args;
  const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (!cachePath || !namesPath || !outDir || !flag('--series')) throw new Error('ARGUMENTS_REQUIRED');
  const actor = flag('--actor') ?? 'claude-code-local:aa26488931';
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const { expansions } = JSON.parse(readFileSync(namesPath, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  for (const code of flag('--series').split(',')) {
    const ids = Object.values(cache.seriesLists?.[code]?.pages || {}).flat();
    const observedAt = ids.map(id => cache.details[id]?.fetchedAt).filter(Boolean).sort().at(-1);
    const result = buildOfficialTwSeriesPlans({ code, seriesNameZh: seriesNameFromLabel(expansions[code]), cache, observedAt });
    const digests = [];
    for (const plan of result.plans) {
      const name = `${code}-${plan.batch.index}`;
      const { digest, gated, replay } = buildOfficialJpSeriesSql(plan, actor, 'private.import_pokemon_tw_official_series');
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
      writeFileSync(join(outDir, `${name}.sql`), gated);
      writeFileSync(join(outDir, `${name}-replay.sql`), replay);
      digests.push({ batch: plan.batch.index, cards: plan.cards.length, planDigest: digest });
    }
    writeFileSync(join(outDir, `${code}-report.json`), `${JSON.stringify({ summary: result.summary, seriesName: result.plans[0]?.series.name_zh, digests, quarantined: result.quarantined, rarityUnknown: result.rarityUnknown, evidence: result.evidence }, null, 1)}\n`);
    console.log(JSON.stringify({ ...result.summary, seriesName: result.plans[0]?.series.name_zh, digests }));
  }
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
