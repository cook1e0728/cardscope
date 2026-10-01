import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPokemonJpArchiveSnapshot, TCGDEX_ARCHIVE_JA_ROOT } from '../providers/pokemon-jp-tcgdex-archive.mjs';

function usage() {
  return [
    'Usage: node scripts/snapshot-pokemon-jp-from-tcgdex-archive.mjs <cards-database checkout> --series <set id> --existing <rows.json> [--observed-at <ISO>]',
    '',
    'Reads one Japanese set from a clean local checkout of github.com/tcgdex/cards-database',
    '(data files are parsed, never executed) and prints a snapshot for scripts/plan-pokemon-jp-import.mjs.',
    '<rows.json> is {series, cards, printings} of the existing JP Pokémon rows, read from the database beforehand.',
    'It makes no network or database calls. See docs/adr/0002-tcgdex-archive-source.md.'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {};
  let repoDir = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!arg.startsWith('-') && repoDir == null) { repoDir = arg; continue; }
    const [rawKey, inlineValue] = arg.split('=', 2);
    const key = rawKey.replace(/^--/, '');
    if (!['series', 'existing', 'observed-at'].includes(key)) throw new Error(`UNKNOWN_OPTION:${arg}`);
    const value = inlineValue ?? argv[++index];
    if (value == null || String(value).startsWith('--')) throw new Error(`MISSING_OPTION_VALUE:${arg}`);
    options[key] = value;
  }
  if (!repoDir) throw new Error('ARCHIVE_CHECKOUT_REQUIRED');
  if (!options.series) throw new Error('SERIES_ID_REQUIRED');
  if (!options.existing) throw new Error('EXISTING_ROWS_REQUIRED');
  return { repoDir, options };
}

const git = (repoDir, ...args) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).trim();

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
  } else {
    const { repoDir, options } = parsed;
    const setId = options.series;
    const root = join(repoDir, TCGDEX_ARCHIVE_JA_ROOT);
    const groups = readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, `${setId}.ts`)))
      .map(entry => entry.name);
    if (groups.length !== 1) throw new Error(`ARCHIVE_SET_NOT_UNIQUE:${setId}:${groups.length}`);
    const [seriesGroup] = groups;
    const setDir = join(root, seriesGroup, setId);
    const relativeSet = `${TCGDEX_ARCHIVE_JA_ROOT}/${seriesGroup}/${setId}`;
    if (git(repoDir, 'status', '--porcelain', '--', `${relativeSet}.ts`, relativeSet) !== '') throw new Error('ARCHIVE_CHECKOUT_NOT_CLEAN');
    const commit = git(repoDir, 'rev-parse', 'HEAD');
    const cardSources = readdirSync(setDir)
      .filter(file => file.endsWith('.ts'))
      .sort()
      .map(file => ({ file, source: readFileSync(join(setDir, file), 'utf8') }));
    const snapshot = buildPokemonJpArchiveSnapshot({
      commit,
      seriesGroup,
      setId,
      setSource: readFileSync(join(root, seriesGroup, `${setId}.ts`), 'utf8'),
      cardSources,
      observedAt: options['observed-at'] ?? new Date().toISOString(),
      existingJpRows: JSON.parse(readFileSync(options.existing, 'utf8'))
    });
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
}
