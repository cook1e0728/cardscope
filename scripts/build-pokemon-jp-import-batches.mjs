import { readFile } from 'node:fs/promises';
import { planPokemonJpManifest } from '../providers/pokemon-jp-manifest.mjs';
import { buildPokemonJpImportBatchPlans } from '../providers/pokemon-jp-import-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-import-batches.mjs <snapshot.json> --series <set id>',
  '',
  'Pages a snapshot of a series larger than 100 cards (100 cards per page) and prints the',
  'ordered batch plans for private.import_pokemon_jp_metadata_batch (ADR 0005) as a JSON array.',
  'It makes no network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const snapshotPath = args[0];
  const seriesIndex = args.indexOf('--series');
  const seriesId = seriesIndex === -1 ? null : args[seriesIndex + 1];
  if (!snapshotPath || snapshotPath.startsWith('--') || !seriesId) throw new Error('ARGUMENTS_REQUIRED');
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const manifests = [];
  let cursor = null;
  do {
    const manifest = planPokemonJpManifest(snapshot, { seriesId, limit: 100, cursor });
    manifests.push(manifest);
    cursor = manifest.scope.nextCursor;
  } while (cursor);
  process.stdout.write(`${JSON.stringify(buildPokemonJpImportBatchPlans(manifests), null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exitCode = 1;
}
