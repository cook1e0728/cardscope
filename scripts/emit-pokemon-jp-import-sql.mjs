import { readFile } from 'node:fs/promises';
import { buildPokemonJpImportSql } from '../providers/pokemon-jp-import-sql.mjs';

const usage = [
  'Usage: node scripts/emit-pokemon-jp-import-sql.mjs <import-plan.json> --actor <name> --mode <dry-run|import>',
  '',
  'Prints SQL that rebuilds the plan from a short card list inside PostgreSQL and calls',
  'private.import_pokemon_jp_metadata only when the rebuilt plan hashes to the expected planDigest.',
  'It makes no network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const planPath = args.find(arg => !arg.startsWith('--') && args[args.indexOf(arg) - 1]?.startsWith('--') !== true);
  const option = name => { const index = args.indexOf(`--${name}`); return index === -1 ? null : args[index + 1]; };
  const mode = option('mode');
  if (!planPath || !['dry-run', 'import'].includes(mode)) throw new Error('PLAN_AND_MODE_REQUIRED');
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const { digest, sql } = buildPokemonJpImportSql(plan, { actor: option('actor'), dryRun: mode === 'dry-run' });
  process.stderr.write(`planDigest ${digest}\n`);
  process.stdout.write(sql);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exitCode = 1;
}
