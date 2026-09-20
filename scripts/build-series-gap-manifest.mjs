import { readFile, writeFile } from 'node:fs/promises';
import { buildSeriesGapManifest } from '../providers/series-gap-manifest.mjs';

function usage() {
  return [
    'Usage: node scripts/build-series-gap-manifest.mjs <snapshot.json> [options]',
    '',
    'The snapshot is read-only JSON with series/cards/printings and optional updates.',
    'A baseline registry defaults to data/catalog-baselines.json when not embedded.',
    '',
    'Options:',
    '  --baselines <path>                    Baseline registry JSON path',
    '  --required-fields <a,b,c>             Fields to inspect (default: name_zh,rarity,image_url)',
    '  --as-of <ISO timestamp>                Observation timestamp',
    '  --output <path>                        Write the JSON manifest (otherwise stdout)',
    '  --help                                 Show this message'
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
    const value = inlineValue ?? argv[++index];
    if (value == null || String(value).startsWith('--')) throw new Error(`MISSING_OPTION_VALUE:${arg}`);
    if (key === 'baselines') options.baselinesPath = value;
    else if (key === 'required-fields') options.requiredFields = value;
    else if (key === 'as-of') options.asOf = value;
    else if (key === 'output') options.outputPath = value;
    else throw new Error(`UNKNOWN_OPTION:${arg}`);
  }
  if (!snapshotPath) throw new Error('SNAPSHOT_PATH_REQUIRED');
  return { snapshotPath, options };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(usage());
    process.exitCode = 0;
  } else {
    const input = await readJson(parsed.snapshotPath);
    const source = input?.catalog && typeof input.catalog === 'object' ? input.catalog : input;
    const registry = input?.baselines || input?.baselineRegistry || (parsed.options.baselinesPath
      ? await readJson(parsed.options.baselinesPath)
      : await readJson(new URL('../data/catalog-baselines.json', import.meta.url)));
    const manifest = buildSeriesGapManifest({
      series: Array.isArray(source?.series) ? source.series : [],
      cards: Array.isArray(source?.cards) ? source.cards : [],
      printings: Array.isArray(source?.printings) ? source.printings : [],
      registry,
      baselines: registry,
      updates: input?.updates || input?.updateResults || input?.updateFailures || [],
      requiredFields: parsed.options.requiredFields,
      asOf: parsed.options.asOf
    });
    const output = `${JSON.stringify(manifest, null, 2)}\n`;
    if (parsed.options.outputPath) {
      await writeFile(parsed.options.outputPath, output, 'utf8');
      console.error(`Wrote dry-run manifest to ${parsed.options.outputPath}`);
    } else {
      process.stdout.write(output);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
}
