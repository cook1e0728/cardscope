import { readFile } from 'node:fs/promises';
import { planPokemonJpManifest } from '../providers/pokemon-jp-manifest.mjs';

function usage() {
  return [
    'Usage: node scripts/plan-pokemon-jp-import.mjs <snapshot.json> --series <tcgdex-set-id> [options]',
    '',
    'Options:',
    '  --limit <n>       Maximum saved card details in this manifest (1-100, default: 100)',
    '  --cursor <token>  Resume a manifest cursor returned by a prior run',
    '  --help            Show this message',
    '',
    'Reads one saved JSON snapshot with an observedAt ISO timestamp and prints a dry-run manifest; it makes no network or database calls.'
  ].join('\n');
}

function parseArgs(argv) {
  let snapshotPath = null;
  let help = false;
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (!arg.startsWith('-') && snapshotPath == null) {
      snapshotPath = arg;
      continue;
    }
    const [rawKey, inlineValue] = arg.split('=', 2);
    const key = rawKey.replace(/^--/, '');
    if (!['series', 'limit', 'cursor'].includes(key)) throw new Error(`UNKNOWN_OPTION:${arg}`);
    const value = inlineValue ?? argv[++index];
    if (value == null || String(value).startsWith('--')) throw new Error(`MISSING_OPTION_VALUE:${arg}`);
    if (key === 'series') options.seriesId = value;
    else if (key === 'limit') options.limit = Number(value);
    else options.cursor = value;
  }
  if (help) return { help: true };
  if (!snapshotPath) throw new Error('SNAPSHOT_PATH_REQUIRED');
  if (!options.seriesId) throw new Error('SERIES_ID_REQUIRED');
  return { snapshotPath, options };
}

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
  } else {
    const snapshot = JSON.parse(await readFile(parsed.snapshotPath, 'utf8'));
    const manifest = planPokemonJpManifest(snapshot, parsed.options);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
}
