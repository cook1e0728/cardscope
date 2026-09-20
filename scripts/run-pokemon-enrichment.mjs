import { readFile, writeFile } from 'node:fs/promises';
import { planPokemonEnrichmentWorkflow } from '../providers/pokemon-enrichment-workflow.mjs';

function usage() {
  return [
    'Usage: node scripts/run-pokemon-enrichment.mjs <snapshot.json> [options]',
    '',
    'This command performs bounded source GETs and prints an audited dry-run plan.',
    'It never writes Supabase or the formal catalog tables.',
    '',
    'Options:',
    '  --batch-size <n>                     Maximum provider groups per planner (hard cap: 100)',
    '  --fields <name_zh,rarity,image_url>   Candidate fields (default: rarity)',
    '  --gap-kinds <a,b>                     Gap fields (default: traditional-chinese-name,rarity)',
    '  --concurrency <n>                     TCGdex GET concurrency',
    '  --include-images                      Explicitly request image candidates',
    '  --observed-at <ISO timestamp>         Fallback observation timestamp',
    '  --api-base <URL>                      TCGdex detail API base URL',
    '  --gap-cursor <token>                  Resume the gap planner cursor',
    '  --candidate-cursor <token>            Resume the TCGdex candidate cursor',
    '  --cursor <JSON>                       Resume both cursors from a prior output',
    '  --output <path>                       Write the JSON dry-run plan (otherwise stdout)',
    '  --dry-run                             Explicitly keep the write-free mode (default)',
    '  --help                                Show this message'
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
    if (arg === '--include-images' || arg === '--dry-run') {
      if (arg === '--include-images') options.includeImages = true;
      continue;
    }
    if (arg === '--apply' || arg === '--write') throw new Error('APPLY_DISABLED_DRY_RUN_ONLY');
    const [inlineKey, inlineValue] = arg.split('=', 2);
    const key = inlineKey.replace(/^--/, '');
    const value = inlineValue ?? argv[++index];
    if (value == null || String(value).startsWith('--')) throw new Error(`MISSING_OPTION_VALUE:${arg}`);
    if (key === 'batch-size') options.batchSize = Number(value);
    else if (key === 'fields') options.fields = value;
    else if (key === 'gap-kinds') options.gapKinds = value.split(',').map(item => item.trim()).filter(Boolean);
    else if (key === 'concurrency') options.concurrency = Number(value);
    else if (key === 'observed-at') options.observedAt = value;
    else if (key === 'api-base') options.apiBase = value;
    else if (key === 'gap-cursor') options.cursor = { ...(options.cursor || {}), gap: value };
    else if (key === 'candidate-cursor') options.cursor = { ...(options.cursor || {}), candidate: value };
    else if (key === 'cursor') {
      try {
        const parsed = JSON.parse(value);
        options.cursor = parsed;
      } catch {
        options.cursor = { gap: value };
      }
    } else if (key === 'output') options.outputPath = value;
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
    const { outputPath, ...workflowOptions } = parsed.options;
    const plan = await planPokemonEnrichmentWorkflow({
      snapshot,
      ...workflowOptions,
      dryRun: true
    });
    const output = `${JSON.stringify(plan, null, 2)}\n`;
    if (outputPath) {
      await writeFile(outputPath, output, 'utf8');
      console.error(`Wrote dry-run enrichment plan to ${outputPath}`);
    } else {
      process.stdout.write(output);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
}
