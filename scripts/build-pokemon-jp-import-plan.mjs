import { readFile } from 'node:fs/promises';
import { buildPokemonJpImportPlan } from '../providers/pokemon-jp-import-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-import-plan.mjs <manifest.json>',
  '',
  'Reads a dry-run manifest from scripts/plan-pokemon-jp-import.mjs and prints the row plan',
  'for private.import_pokemon_jp_metadata. It makes no network or database calls.'
].join('\n');

try {
  const [manifestPath] = process.argv.slice(2);
  if (!manifestPath || manifestPath === '--help' || manifestPath === '-h') {
    process.stdout.write(`${usage}\n`);
    if (!manifestPath) process.exitCode = 1;
  } else {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    process.stdout.write(`${JSON.stringify(buildPokemonJpImportPlan(manifest), null, 2)}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exitCode = 1;
}
