import { readFile } from 'node:fs/promises';
import { planPokemonEnrichment } from '../providers/enrichment-candidates.mjs';

function usage() {
  return [
    'Usage: node scripts/plan-pokemon-enrichment.mjs <snapshot.json> [options]',
    '',
    'Options:',
    '  --fields <name_zh,rarity,image_url>  Requested fields (default: rarity)',
    '  --batch-size <n>                     Maximum source records (hard cap: 100)',
    '  --concurrency <n>                    Concurrent GET requests (default: 4)',
    '  --include-images                     Explicitly opt in to image candidates',
    '  --series <code>                       Exact normalized TCGdex series code',
    '  --card-number-from <n>                Inclusive numeric card-number lower bound',
    '  --card-number-to <n>                  Inclusive numeric card-number upper bound',
    '  --observed-at <ISO timestamp>        Fallback timestamp for records without updatedAt',
    '  --api-base <URL>                     TCGdex detail API base URL',
    '  --help                               Show this message'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {};
  let snapshotPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!snapshotPath && !arg.startsWith('-')) {
      snapshotPath = arg;
      continue;
    }
    const [inlineKey, inlineValue] = arg.split('=', 2);
    const key = inlineKey.replace(/^--/, '');
    if (key === 'include-images') {
      options.includeImages = true;
      continue;
    }
    const value = inlineValue ?? argv[++index];
    if (value == null || String(value).startsWith('--')) throw new Error(`MISSING_OPTION_VALUE:${arg}`);
    if (key === 'fields') options.fields = value;
    else if (key === 'batch-size') options.batchSize = Number(value);
    else if (key === 'concurrency') options.concurrency = Number(value);
    else if (key === 'series') options.series = value;
    else if (key === 'card-number-from') options.cardNumberFrom = value;
    else if (key === 'card-number-to') options.cardNumberTo = value;
    else if (key === 'observed-at') options.observedAt = value;
    else if (key === 'api-base') options.apiBase = value;
    else throw new Error(`UNKNOWN_OPTION:${arg}`);
  }
  if (!snapshotPath) throw new Error('SNAPSHOT_PATH_REQUIRED');
  return { snapshotPath, options };
}

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(usage());
    process.exitCode = 0;
  } else {
    const snapshot = JSON.parse(await readFile(parsed.snapshotPath, 'utf8'));
    const plan = await planPokemonEnrichment(snapshot, parsed.options);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
}
