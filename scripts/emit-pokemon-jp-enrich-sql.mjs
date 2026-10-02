import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkPokemonJpEnrichPlan } from '../providers/pokemon-jp-enrich-plan.mjs';
import { buildPokemonJpEnrichSql } from '../providers/pokemon-jp-import-sql.mjs';

const usage = [
  'Usage: node scripts/emit-pokemon-jp-enrich-sql.mjs <enrich-plan.json> <out-dir> --actor <name>',
  '',
  'Writes gated SQL for private.enrich_pokemon_jp_metadata (ADR 0003): one file per plan chunk of at most',
  '100 cards (links and series title first, then derived names), each running a dry run in the same',
  'statement and writing only when its summary matches, plus a matching -replay.sql per chunk.',
  'enrich-plan.json is the output of scripts/build-pokemon-jp-enrich-plan.mjs (its fingerprints must equal',
  'the database first). No network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const [planPath, outDir] = args;
  const actorIndex = args.indexOf('--actor');
  const actor = actorIndex === -1 ? null : args[actorIndex + 1];
  if (!planPath || !outDir || !actor) throw new Error('ARGUMENTS_REQUIRED');
  const built = JSON.parse(readFileSync(planPath, 'utf8'));
  const plan = built.plan ?? built;
  const chunks = plan.cards.length > 100 ? chunkPokemonJpEnrichPlan(plan) : [plan];
  mkdirSync(outDir, { recursive: true });
  const files = chunks.map((chunk, index) => {
    const name = `enrich-${plan.seriesProviderId}-${String(index + 1).padStart(2, '0')}`;
    const gated = buildPokemonJpEnrichSql(chunk, { actor, dryRun: false, gated: true });
    const replay = buildPokemonJpEnrichSql(chunk, { actor, dryRun: false });
    writeFileSync(join(outDir, `${name}.sql`), gated.sql);
    writeFileSync(join(outDir, `${name}-replay.sql`), replay.sql);
    return { name, cards: chunk.cards.length, digest: gated.digest };
  });
  console.log(JSON.stringify({ series: plan.seriesProviderId, chunks: files }));
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
