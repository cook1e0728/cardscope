import { createHash } from 'node:crypto';
import { officialJpDetailUrl, officialJpRarity } from './pokemon-jp-official.mjs';
import { pokemonJpPlanDigest, postgresJsonbText } from './pokemon-jp-import-sql.mjs';
import { OFFICIAL_JP_SOURCE } from './pokemon-jp-official-series-plan.mjs';

// ADR 0026 (proposed, research only): Japanese DP-era cards print no card number. A series is read
// from the official whole-set list ("（DPx の全てのカード）", fetched as pg=<product ID>); each detail
// page is one card identified by its official card ID, kept in list order. Basic energy pages
// (set mark ENE) and pages filed under another mark are left out.

const FN = 'private.import_pokemon_jp_official_unnumbered_series';
const BATCH_SIZE = 100;
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;

export function buildOfficialJpUnnumberedPlans({ code, listKey, seriesMeta, cache, rarityCodes = null }) {
  const list = cache.lists?.[listKey];
  if (!list) throw new Error(`OFFICIAL_LIST_MISSING:${listKey}`);
  if (!seriesMeta?.name_ja) throw new Error(`SERIES_META_MISSING:${code}`);
  const quarantined = [], rarityUnknown = [], cards = [], evidence = [];
  list.cardIds.forEach((cardId, index) => {
    const detail = cache.details[cardId];
    if (!detail) throw new Error(`OFFICIAL_DETAIL_MISSING:${listKey}:${cardId}`);
    if (detail.setMark !== code) { quarantined.push({ cardId, nameJa: detail.nameJa, reason: `SET_MISMATCH:${detail.setMark}` }); return; }
    if (detail.number) { quarantined.push({ cardId, nameJa: detail.nameJa, reason: `NUMBER_PRESENT:${detail.number}` }); return; }
    if (!detail.nameJa) { quarantined.push({ cardId, nameJa: null, reason: 'NAME_MISSING' }); return; }
    const mapped = officialJpRarity(detail.rarityIcon);
    const rarity = mapped.rarity && rarityCodes && !rarityCodes.has(mapped.rarity) ? null : mapped.rarity ?? null;
    if (!rarity) rarityUnknown.push({ cardId, icon: detail.rarityIcon ?? null });
    const position = index + 1;
    evidence.push({ cardId: String(cardId), position, nameJa: detail.nameJa, rarityIcon: detail.rarityIcon ?? null });
    cards.push({
      id: `pokemon-official-ja-${code.toLowerCase()}-c${cardId}`,
      provider_id: String(cardId),
      name_ja: detail.nameJa,
      rarity_code: rarity,
      source_url: officialJpDetailUrl(cardId),
      search_text: [detail.nameJa, code].join(' '),
      metadata: { officialCardId: String(cardId), numberStatus: 'not-printed', officialListPosition: position, rarityIcon: detail.rarityIcon ?? null, ...(rarity ? { rarityBasis: OFFICIAL_JP_SOURCE } : {}) }
    });
  });
  if (new Set(cards.map(card => card.provider_id)).size !== cards.length) throw new Error(`OFFICIAL_ID_REPEATED:${code}`);
  const evidenceHash = createHash('sha256').update(postgresJsonbText({ series: code, list: listKey, cards: evidence }), 'utf8').digest('hex');
  const sourceObservedAt = [list.fetchedAt, ...list.cardIds.map(id => cache.details[id]?.fetchedAt)].filter(Boolean).sort().at(-1);
  const series = {
    id: `pokemon-official-ja-${code.toLowerCase()}`, provider_id: code, name_ja: seriesMeta.name_ja, release_date: seriesMeta.release_date ?? null,
    source_url: `https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=${encodeURIComponent(listKey)}`,
    metadata: { officialListCount: list.hitCount, officialListProduct: listKey, numberStatus: 'not-printed', evidenceHash, ...(seriesMeta.basis ? { seriesNameBasis: seriesMeta.basis } : {}) }
  };
  const count = Math.ceil(cards.length / BATCH_SIZE), plans = [];
  for (let index = 1; index <= count; index++) {
    plans.push({ planVersion: 1, source: OFFICIAL_JP_SOURCE, seriesProviderId: code, evidenceHash, sourceObservedAt, batch: { index, count, seriesCardCount: cards.length }, series, cards: cards.slice((index - 1) * BATCH_SIZE, index * BATCH_SIZE) });
  }
  return { plans, quarantined, rarityUnknown, summary: { code, listKey, listed: list.cardIds.length, cards: cards.length, batches: count, quarantined: quarantined.length, rarityUnknown: rarityUnknown.length, evidenceHash } };
}

export function buildOfficialJpUnnumberedSql(plan, actor) {
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('ACTOR_REQUIRED');
  const json = JSON.stringify(plan);
  if (json.includes('$plan$')) throw new Error('PLAN_QUOTE_COLLISION');
  const digest = pokemonJpPlanDigest(plan);
  const n = plan.cards.length, series = plan.batch.index === 1 ? 1 : 0;
  const call = dry => `${FN}($plan$${json}$plan$::jsonb, ${sqlText(actor)}, ${dry})`;
  const gated = [
    `-- ${plan.seriesProviderId} unnumbered batch ${plan.batch.index}/${plan.batch.count}: ${n} cards. planDigest ${digest}`,
    'do $do$', 'declare d jsonb; r jsonb;', 'begin',
    `  d := ${call(true)};`,
    `  if (d->>'replay')::boolean or d->>'planDigest' <> ${sqlText(digest)}`,
    `    or d->'before' <> '{"series":0,"cards":0,"canonical":0,"printings":0}'::jsonb`,
    `    or d->'inserted' <> '{"series": ${series}, "cards": ${n}, "canonical": ${n}, "printings": ${n}}'::jsonb then raise exception 'unexpected dry run %', d; end if;`,
    `  r := ${call(false)};`,
    `  if (r->>'replay')::boolean or r->>'planDigest' <> ${sqlText(digest)} then raise exception 'unexpected import %', r; end if;`,
    'end', '$do$;', ''
  ].join('\n');
  const replay = ['do $do$', 'declare r jsonb;', 'begin', `  r := ${call(false)}; if not (r->>'replay')::boolean then raise exception 'replay changed rows %', r; end if;`, 'end', '$do$;', ''].join('\n');
  return { digest, gated, replay };
}
