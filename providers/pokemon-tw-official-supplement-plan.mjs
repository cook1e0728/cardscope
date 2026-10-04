import { createHash } from 'node:crypto';
import { pokemonJpPlanDigest, postgresJsonbText } from './pokemon-jp-import-sql.mjs';
import { OFFICIAL_TW_SOURCE, buildOfficialTwSeriesPlans } from './pokemon-tw-official-series-plan.mjs';
import { sameTwName } from './pokemon-tw-official.mjs';

// ADR 0023: numbers a Source archive Taiwanese series lacks are added to that series from the
// Taiwanese official card search, as one private.supplement_pokemon_tw_official_series plan.

const FN = 'private.supplement_pokemon_tw_official_series';
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;

/**
 * existing: the printings already in the archive series, [{ num, name_zh }]. Every one must match the
 * official card of the same number (ADR 0010 name rule), or the whole series is rejected; the official
 * numbers that are absent become the plan's cards (same shape and rules as ADR 0015).
 */
export function buildOfficialTwSupplementPlan({ code, seriesId, existing, cache, observedAt }) {
  const { plans, quarantined, rarityUnknown } = buildOfficialTwSeriesPlans({ code, seriesNameZh: code, cache, observedAt });
  const official = new Map(plans.flatMap(plan => plan.cards).map(card => [card.official_card_number, card]));
  const misaligned = [];
  for (const row of existing) {
    const card = official.get(row.num);
    if (!card || !sameTwName(row.name_zh, card.name_zh)) misaligned.push({ number: row.num, archive: row.name_zh, official: card?.name_zh ?? null });
  }
  const present = new Set(existing.map(row => row.num));
  const cards = [...official.values()].filter(card => !present.has(card.official_card_number));
  const summary = { code, seriesId, existing: existing.length, official: official.size, add: cards.length, misaligned: misaligned.length, quarantined: quarantined.length };
  if (misaligned.length || !cards.length || cards.length > 100) return { plan: null, misaligned, quarantined, rarityUnknown, summary };
  const evidenceHash = createHash('sha256').update(postgresJsonbText({ series: code, supplement: cards.map(card => card.metadata.officialDetailIds), alignment: existing }), 'utf8').digest('hex');
  const alignment = [...existing].sort((a, b) => a.num.localeCompare(b.num, 'en', { numeric: true })).map(row => ({ number: row.num, name_zh: row.name_zh }));
  const plan = { planVersion: 1, source: OFFICIAL_TW_SOURCE, seriesProviderId: code, evidenceHash, sourceObservedAt: observedAt, series: { id: seriesId, provider_id: code }, alignment, cards };
  return { plan, misaligned, quarantined, rarityUnknown: rarityUnknown.filter(row => !present.has(row.number)), summary };
}

export function buildOfficialTwSupplementSql(plan, actor) {
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('ACTOR_REQUIRED');
  const json = JSON.stringify(plan);
  if (json.includes('$plan$')) throw new Error('PLAN_QUOTE_COLLISION');
  const digest = pokemonJpPlanDigest(plan);
  const n = plan.cards.length;
  const call = dry => `${FN}($plan$${json}$plan$::jsonb, ${sqlText(actor)}, ${dry})`;
  const gated = [
    `-- ${plan.seriesProviderId} supplement: ${n} cards into ${plan.series.id} (${FN}). planDigest ${digest}`,
    'create temporary table tw_supplement_result (v jsonb) on commit drop;',
    'do $do$',
    'declare d jsonb; r jsonb;',
    'begin',
    `  d := ${call(true)};`,
    `  if (d->>'replay')::boolean or d->>'planDigest' <> ${sqlText(digest)}`,
    `    or d->'before' <> '{"cards":0,"canonical":0,"printings":0}'::jsonb`,
    `    or d->'inserted' <> '{"cards": ${n}, "canonical": ${n}, "printings": ${n}}'::jsonb then raise exception 'unexpected dry run %', d; end if;`,
    `  r := ${call(false)};`,
    `  if (r->>'replay')::boolean or r->>'planDigest' <> ${sqlText(digest)} then raise exception 'unexpected supplement %', r; end if;`,
    '  insert into tw_supplement_result values (r);',
    'end',
    '$do$;',
    'select v from tw_supplement_result;',
    ''
  ].join('\n');
  const replay = `-- ${plan.seriesProviderId} supplement replay: must change nothing.\nselect ${call(false)} v;\n`;
  return { digest, gated, replay };
}
