import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOfficialTwSupplementSql } from '../providers/pokemon-tw-official-supplement-plan.mjs';
import { buildPromoRarityFillPlans, buildPromoRestPlan } from '../providers/pokemon-tw-official-promo-rest-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-tw-official-promo-rest-plan.mjs <tw-cache.json> <special-pages.json> <printings.json> <out-dir>',
  '        --series CODE=SERIES_ID,CODE=SERIES_ID [--no-not-printed] [--actor NAME]',
  '',
  'ADR 0041 follow-up: plans for the promo pages the official list shows without a card number.',
  'special-pages.json: text facts of those detail pages (raw collector string). printings.json:',
  '[{ code, num, name_zh, printing_id, card_id, rarity }] for every printing of the target series.',
  'Per series writes <CODE>-promo-rest.json/.sql/-replay.sql (private.supplement_pokemon_tw_official_series,',
  'energy codes and, unless --no-not-printed, number-less cards as c<detail ID>) and <CODE>-rarity-exact/-group',
  '(private.fill_pokemon_official_rarity_tw) for archive rows without an official number, plus a report.',
  'No network or database calls.'
].join('\n');

function fillSql(name, plan, actor) {
  const json = JSON.stringify(plan);
  if (json.includes('$plan$')) throw new Error('PLAN_QUOTE_COLLISION');
  const call = dry => `private.fill_pokemon_official_rarity_tw($plan$${json}$plan$::jsonb, '${actor}', ${dry})`;
  return {
    gated: [
      `-- ${name}: tw-official ${plan.rows.length} rows (ADR 0010). Rolls back unless exactly that many are filled.`,
      'create temporary table official_tw_result (v jsonb) on commit drop;', 'do $do$', 'declare r jsonb;', 'begin',
      `  r := ${call(false)};`,
      `  if (r->>'replay')::boolean or (r->>'filled')::int <> ${plan.rows.length} then raise exception 'unexpected tw-official result %', r; end if;`,
      '  insert into official_tw_result values (r);', 'end', '$do$;', 'select v from official_tw_result;', ''
    ].join('\n'),
    replay: `-- ${name} replay: must change nothing.\nselect ${call(false)} v;\n`,
    dry: `select ${call(true)} v;\n`
  };
}

try {
  const args = process.argv.slice(2);
  const [cachePath, overlayPath, printingsPath, outDir] = args;
  const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (!cachePath || !overlayPath || !printingsPath || !outDir || !flag('--series')) throw new Error('ARGUMENTS_REQUIRED');
  const actor = flag('--actor') ?? 'claude-code-local:aa26488931';
  if (actor.includes("'")) throw new Error('ACTOR_QUOTE');
  const cache = JSON.parse(readFileSync(cachePath, 'utf8')), overlay = JSON.parse(readFileSync(overlayPath, 'utf8')), printings = JSON.parse(readFileSync(printingsPath, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  for (const pair of flag('--series').split(',')) {
    const [code, seriesId] = pair.split('=');
    const rows = printings.filter(row => row.code === code);
    const ids = Object.values(cache.seriesLists?.[code]?.pages || {}).flat();
    const observedAt = [...ids.map(id => cache.details[id]?.fetchedAt), ...Object.values(overlay.pages).filter(page => page.list === code).map(page => page.fetchedAt)].filter(Boolean).sort().at(-1);
    const result = buildPromoRestPlan({ code, seriesId, existing: rows.map(({ num, name_zh }) => ({ num, name_zh })), cache, overlay, observedAt, includeNotPrinted: !args.includes('--no-not-printed') });
    const digests = [];
    for (const [index, plan] of result.plans.entries()) {
      const sql = buildOfficialTwSupplementSql(plan, actor);
      const name = `${code}-promo-rest${result.plans.length > 1 ? `-${index + 1}` : ''}`;
      digests.push({ plan: name, cards: plan.cards.length, planDigest: sql.digest });
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
      writeFileSync(join(outDir, `${name}.sql`), sql.gated);
      writeFileSync(join(outDir, `${name}-replay.sql`), sql.replay);
      writeFileSync(join(outDir, `${name}-dry.sql`), `select private.supplement_pokemon_tw_official_series($plan$${JSON.stringify(plan)}$plan$::jsonb, '${actor}', true) v;\n`);
    }
    const fill = buildPromoRarityFillPlans({ code, seriesId, rows, cache, overlay });
    const fillFiles = [];
    for (const [label, plan] of [['exact', fill.exact], ['group', fill.group]]) {
      if (!plan) continue;
      const name = `${code}-rarity-${label}`, sql = fillSql(name, plan, actor);
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
      writeFileSync(join(outDir, `${name}.sql`), sql.gated);
      writeFileSync(join(outDir, `${name}-replay.sql`), sql.replay);
      writeFileSync(join(outDir, `${name}-dry.sql`), sql.dry);
      fillFiles.push({ name, rows: plan.rows.length });
    }
    writeFileSync(join(outDir, `${code}-promo-rest-report.json`), `${JSON.stringify({ summary: result.summary, digests, held: result.held, rarityUnknown: result.rarityUnknown, added: result.evidence, rarityFill: { files: fillFiles, quarantined: fill.quarantined } }, null, 1)}\n`);
    console.log(JSON.stringify({ ...result.summary, digests, rarityFill: fillFiles }));
  }
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
