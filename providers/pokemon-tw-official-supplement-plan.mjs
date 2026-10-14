import { createHash } from 'node:crypto';
import { pokemonJpPlanDigest, postgresJsonbText } from './pokemon-jp-import-sql.mjs';
import { OFFICIAL_TW_SOURCE, buildOfficialTwSeriesPlans } from './pokemon-tw-official-series-plan.mjs';
import { sameTwName } from './pokemon-tw-official.mjs';

// ADR 0023: numbers a Source archive Taiwanese series lacks are added to that series from the
// Taiwanese official card search, as one private.supplement_pokemon_tw_official_series plan.

const FN = 'private.supplement_pokemon_tw_official_series';
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;
const BATCH_SIZE = 100;
const PROMO_CODE = /-P$/;

/**
 * existing: the printings already in the archive series, [{ num, name_zh }]. Every one must match the
 * official card of the same number (ADR 0010 name rule), or the whole series is rejected; the official
 * numbers that are absent become the plan's cards (same shape and rules as ADR 0015).
 *
 * Promo series (code ending in -P, such as SV-P) get two more allowances, each reported in the result:
 * - a numeric archive number written without padding ("56") matches the official padded number ("056")
 *   of the same name, and that official number is then not added again (it would be a duplicate card);
 * - an archive row whose number the official site never prints (no0, DAR) matches when the official
 *   list has a number-less entry of the same name (the official site gives those no card number).
 * More than 100 absent numbers become several plans of at most 100 cards; each later plan's alignment
 * also lists the earlier plans' cards, which are in the series by the time it runs.
 */
export function buildOfficialTwSupplementPlan({ code, seriesId, existing, cache, observedAt }) {
  const { plans: officialPlans, quarantined, rarityUnknown } = buildOfficialTwSeriesPlans({ code, seriesNameZh: code, cache, observedAt });
  const official = new Map(officialPlans.flatMap(plan => plan.cards).map(card => [card.official_card_number, card]));
  const promo = PROMO_CODE.test(code);
  const unnumbered = quarantined.filter(entry => entry.reason === 'NUMBER_MISSING' && entry.nameZh);
  const misaligned = [], zeroPadAliases = [], unnumberedAligned = [];
  const covered = new Set(existing.map(row => row.num));
  for (const row of existing) {
    const card = official.get(row.num);
    if (card && sameTwName(row.name_zh, card.name_zh)) continue;
    if (!card && promo && /^\d+$/.test(row.num)) {
      const padded = [...official.values()].find(candidate => /^\d+$/.test(candidate.official_card_number) && Number(candidate.official_card_number) === Number(row.num) && !existing.some(other => other.num === candidate.official_card_number));
      if (padded && sameTwName(row.name_zh, padded.name_zh)) { zeroPadAliases.push({ archive: row.num, official: padded.official_card_number, name: row.name_zh }); covered.add(padded.official_card_number); continue; }
    }
    if (!card && promo && !/^\d+$/.test(row.num) && unnumbered.some(entry => sameTwName(row.name_zh, entry.nameZh))) { unnumberedAligned.push({ number: row.num, name: row.name_zh }); continue; }
    misaligned.push({ number: row.num, archive: row.name_zh, official: card?.name_zh ?? null });
  }
  const cards = [...official.values()].filter(card => !covered.has(card.official_card_number));
  const batches = Math.ceil(cards.length / BATCH_SIZE);
  const summary = { code, seriesId, existing: existing.length, official: official.size, add: cards.length, batches, misaligned: misaligned.length, quarantined: quarantined.length, zeroPadAliases: zeroPadAliases.length, unnumberedAligned: unnumberedAligned.length };
  const extras = { zeroPadAliases, unnumberedAligned };
  // The database function takes one plan of 1-100 cards per series; only promo series are planned past that.
  if (misaligned.length || !cards.length || (batches > 1 && !promo)) return { plan: null, plans: [], misaligned, quarantined, rarityUnknown, ...extras, summary };
  const sortedExisting = [...existing].sort((a, b) => a.num.localeCompare(b.num, 'en', { numeric: true })).map(row => ({ number: row.num, name_zh: row.name_zh }));
  const plans = [];
  for (let index = 0; index < batches; index++) {
    const slice = cards.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
    const earlier = cards.slice(0, index * BATCH_SIZE).map(card => ({ number: card.official_card_number, name_zh: card.name_zh }));
    const alignment = [...sortedExisting, ...earlier].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
    const evidenceHash = createHash('sha256').update(postgresJsonbText({ series: code, supplement: slice.map(card => card.metadata.officialDetailIds), alignment: existing }), 'utf8').digest('hex');
    plans.push({ planVersion: 1, source: OFFICIAL_TW_SOURCE, seriesProviderId: code, evidenceHash, sourceObservedAt: observedAt, ...(batches > 1 ? { batch: { index: index + 1, count: batches, seriesCardCount: cards.length } } : {}), series: { id: seriesId, provider_id: code }, alignment, cards: slice });
  }
  return { plan: plans[0], plans, misaligned, quarantined, rarityUnknown: rarityUnknown.filter(row => !covered.has(row.number)), ...extras, summary };
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
