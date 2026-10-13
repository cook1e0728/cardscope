import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildJpArchiveVariantPlans, buildJpArchiveVariantSql } from '../providers/pokemon-jp-archive-variant-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-archive-variant-plan.mjs <rarity-cache.json> <images-cache.json> <base-cards.json> <out-dir> [--actor NAME]',
  '',
  'ADR 0039: plans for private.split_pokemon_jp_archive_variants (S9a, S10a, S11a, S12a). rarity-cache.json is the',
  'official card search cache with .details (docs/evidence/pokemon-jp/official-rarity-20261002.json); images-cache.json',
  'has .thumbs (docs/evidence/pokemon-jp/official-card-images-20261009.json). base-cards.json is the read-only export of',
  'the tcgdex-ja cards:',
  '',
  '  node scripts/run-sql.mjs --read-only -e "select c.id, p.local_set_code as code, p.local_card_number as num, c.name_ja,',
  '    exists (select 1 from public.card_images i where i.card_id = c.id) as has_image, c.metadata->\'officialCardIds\' as official_ids',
  '    from public.tcg_cards c join public.tcg_printings p on p.card_id = c.id and p.region = \'JP\'',
  '    where c.game_id = \'pokemon\' and c.source = \'tcgdex-ja\' and p.local_set_code in (\'S9a\',\'S10a\',\'S11a\',\'S12a\')',
  '    order by p.local_set_code, p.local_card_number, c.id" > base-cards.json',
  '',
  'Plans hold at most 100 new cards, never split a base card and cover one series each. Writes plan-<n>.json,',
  'plan-<n>.sql, plan-<n>-replay.sql and report.json. No network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const positional = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--actor');
  const [rarityPath, imagesPath, basePath, outDir] = positional;
  const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (!rarityPath || !imagesPath || !basePath || !outDir) throw new Error('ARGUMENTS_REQUIRED');
  const actor = flag('--actor') ?? 'claude-code-local:aa26488931';
  const { details } = JSON.parse(readFileSync(rarityPath, 'utf8'));
  const { thumbs } = JSON.parse(readFileSync(imagesPath, 'utf8'));
  const baseCards = JSON.parse(readFileSync(basePath, 'utf8'));
  if (!details || !thumbs || !Array.isArray(baseCards)) throw new Error('INPUT_SHAPE_UNSUPPORTED');
  const { plans, skipped, summary } = buildJpArchiveVariantPlans({ details, thumbs, baseCards });
  mkdirSync(outDir, { recursive: true });
  const files = plans.map((item, i) => {
    const name = `plan-${i + 1}`;
    const sql = buildJpArchiveVariantSql(item.plan, actor, item.baseImages);
    writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(item.plan, null, 1)}\n`);
    writeFileSync(join(outDir, `${name}.sql`), sql.gated);
    writeFileSync(join(outDir, `${name}-replay.sql`), sql.replay);
    return { file: name, series: item.series, bases: item.bases, newCards: item.cards, baseImages: item.baseImages, planDigest: sql.digest };
  });
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify({ summary, plans: files, skipped }, null, 1)}\n`);
  for (const row of summary) console.log(JSON.stringify(row));
  for (const row of files) console.log(JSON.stringify(row));
  console.log(JSON.stringify({ skipped: skipped.length }));
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
