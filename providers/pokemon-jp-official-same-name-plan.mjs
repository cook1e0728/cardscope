import { createHash } from 'node:crypto';
import { officialJpDetailUrl, officialJpRarity } from './pokemon-jp-official.mjs';
import { pokemonJpPlanDigest, postgresJsonbText } from './pokemon-jp-import-sql.mjs';
import { OFFICIAL_JP_SOURCE } from './pokemon-jp-official-series-plan.mjs';

// ADR 0025: a number the official list shows on several detail pages is one card when every page
// carries the same Japanese name (the same card in several decks), as ADR 0015 does for Taiwan.
// A series where any repeated number carries different names (MG: two decks numbered separately)
// is left out whole. Plans add only those numbers to the existing official series.

const FN = 'private.supplement_pokemon_jp_official_series';
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;

export function buildOfficialJpSameNamePlan({ code, cache, seriesId, existingNumbers, rarityCodes = null }) {
  const list = cache.lists?.[code];
  if (!list) throw new Error(`OFFICIAL_LIST_MISSING:${code}`);
  const byNumber = new Map();
  for (const cardId of list.cardIds) {
    const detail = cache.details[cardId];
    if (!detail) throw new Error(`OFFICIAL_DETAIL_MISSING:${code}:${cardId}`);
    if (detail.setMark !== code || !detail.number || !/^[A-Za-z0-9]+$/.test(detail.number) || !detail.nameJa) continue;
    byNumber.set(detail.number, [...(byNumber.get(detail.number) || []), detail]);
  }
  const repeated = [...byNumber].filter(([, pages]) => pages.length > 1);
  const conflicts = repeated.filter(([, pages]) => new Set(pages.map(page => page.nameJa)).size > 1).map(([number]) => number);
  const summary = { code, seriesId, repeatedNumbers: repeated.length, nameConflicts: conflicts.length, add: 0 };
  if (conflicts.length) return { plan: null, conflicts, rarityUnknown: [], summary };
  const present = new Set(existingNumbers);
  const cards = [], rarityUnknown = [], evidence = [];
  for (const [number, pages] of repeated) {
    if (present.has(number)) throw new Error(`NUMBER_ALREADY_PRESENT:${code}:${number}`);
    const ids = pages.map(page => String(page.cardId)).sort((a, b) => Number(a) - Number(b));
    const mapped = pages.map(page => officialJpRarity(page.rarityIcon));
    const codes = new Set(mapped.map(m => m.rarity ?? null));
    let rarity = codes.size === 1 && mapped[0].rarity ? mapped[0].rarity : null;
    if (rarity && rarityCodes && !rarityCodes.has(rarity)) rarity = null;
    if (!rarity) rarityUnknown.push({ number, ids, icons: pages.map(page => page.rarityIcon ?? null) });
    const nameJa = pages[0].nameJa;
    evidence.push({ number, ids, nameJa, icons: pages.map(page => page.rarityIcon ?? null) });
    cards.push({
      id: `pokemon-official-ja-${code.toLowerCase()}-${number.toLowerCase()}`,
      provider_id: ids[0],
      official_card_number: number,
      name_ja: nameJa,
      rarity_code: rarity,
      source_url: officialJpDetailUrl(ids[0]),
      search_text: [nameJa, number, `${code}-${number}`, `${code}${number}`.toLowerCase()].join(' '),
      metadata: { officialCardId: ids[0], officialCardIds: ids, rarityIcon: pages[0].rarityIcon ?? null, sameNameVersions: ids.length, ...(rarity ? { rarityBasis: OFFICIAL_JP_SOURCE } : {}) }
    });
  }
  const numeric = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  cards.sort((a, b) => numeric(a.official_card_number, b.official_card_number));
  evidence.sort((a, b) => numeric(a.number, b.number));
  summary.add = cards.length;
  if (!cards.length) return { plan: null, conflicts, rarityUnknown, summary };
  const evidenceHash = createHash('sha256').update(postgresJsonbText({ series: code, sameName: evidence }), 'utf8').digest('hex');
  const sourceObservedAt = [list.fetchedAt, ...repeated.flatMap(([, pages]) => pages.map(page => page.fetchedAt))].filter(Boolean).sort().at(-1);
  const plan = { planVersion: 1, source: OFFICIAL_JP_SOURCE, seriesProviderId: code, evidenceHash, sourceObservedAt, series: { id: seriesId, provider_id: code }, cards };
  return { plan, conflicts, rarityUnknown, evidence, summary };
}

export function buildOfficialJpSameNameSql(plan, actor) {
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('ACTOR_REQUIRED');
  const json = JSON.stringify(plan);
  if (json.includes('$plan$')) throw new Error('PLAN_QUOTE_COLLISION');
  const digest = pokemonJpPlanDigest(plan);
  const n = plan.cards.length;
  const call = dry => `${FN}($plan$${json}$plan$::jsonb, ${sqlText(actor)}, ${dry})`;
  const gated = [
    `-- ${plan.seriesProviderId} same-name supplement: ${n} cards into ${plan.series.id}. planDigest ${digest}`,
    'do $do$',
    'declare d jsonb; r jsonb;',
    'begin',
    `  d := ${call(true)};`,
    `  if (d->>'replay')::boolean or d->>'planDigest' <> ${sqlText(digest)}`,
    `    or d->'before' <> '{"cards":0,"canonical":0,"printings":0}'::jsonb`,
    `    or d->'inserted' <> '{"cards": ${n}, "canonical": ${n}, "printings": ${n}}'::jsonb then raise exception 'unexpected dry run %', d; end if;`,
    `  r := ${call(false)};`,
    `  if (r->>'replay')::boolean or r->>'planDigest' <> ${sqlText(digest)} then raise exception 'unexpected supplement %', r; end if;`,
    'end',
    '$do$;',
    ''
  ].join('\n');
  const replay = ['do $do$', 'declare r jsonb;', 'begin', `  r := ${call(false)}; if not (r->>'replay')::boolean then raise exception 'replay changed rows %', r; end if;`, 'end', '$do$;', ''].join('\n');
  return { digest, gated, replay };
}
