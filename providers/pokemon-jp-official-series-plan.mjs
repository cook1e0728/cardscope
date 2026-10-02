import { createHash } from 'node:crypto';
import { officialJpDetailUrl, officialJpRarity } from './pokemon-jp-official.mjs';
import { pokemonJpPlanDigest, postgresJsonbText } from './pokemon-jp-import-sql.mjs';

// ADR 0012: series the Source archive has no Japanese card names for are imported
// straight from the official card search, as private.import_pokemon_jp_official_series plans.

export const OFFICIAL_JP_SOURCE = 'pokemon-card-official-jp';
const BATCH_SIZE = 100;

const byNumber = (a, b) => a.official_card_number.localeCompare(b.official_card_number, 'en', { numeric: true });

/**
 * Build the ordered batch plans for one series from the whole-series cache.
 * `seriesMeta`: { name_ja, release_date, basis } for the series row. Every detail page
 * filed under the series list must show this set mark and a card number; a number that
 * appears on more than one page is quarantined as a whole. A missing or unknown rarity
 * icon leaves the rarity empty (ADR 0007) and is reported, never guessed.
 */
export function buildOfficialJpSeriesPlans({ code, seriesMeta, cache }) {
  const list = cache.lists?.[code];
  if (!list) throw new Error(`OFFICIAL_LIST_MISSING:${code}`);
  if (!seriesMeta?.name_ja) throw new Error(`SERIES_META_MISSING:${code}`);
  const quarantined = [], rarityUnknown = [], pages = [];
  for (const cardId of list.cardIds) {
    const detail = cache.details[cardId];
    if (!detail) throw new Error(`OFFICIAL_DETAIL_MISSING:${code}:${cardId}`);
    if (detail.setMark !== code) quarantined.push({ cardId, number: detail.number, nameJa: detail.nameJa, reason: `SET_MISMATCH:${detail.setMark}` });
    else if (!detail.number || !/^[A-Za-z0-9]+$/.test(detail.number)) quarantined.push({ cardId, number: detail.number, nameJa: detail.nameJa, reason: 'NUMBER_MISSING' });
    else if (!detail.nameJa) quarantined.push({ cardId, number: detail.number, nameJa: null, reason: 'NAME_MISSING' });
    else pages.push(detail);
  }
  const counts = pages.reduce((tally, page) => tally.set(page.number, (tally.get(page.number) || 0) + 1), new Map());
  const cards = [], evidence = [];
  for (const page of pages) {
    if (counts.get(page.number) > 1) { quarantined.push({ cardId: page.cardId, number: page.number, nameJa: page.nameJa, reason: 'DUPLICATE_NUMBER' }); continue; }
    const rarity = officialJpRarity(page.rarityIcon);
    if (rarity.quarantine) rarityUnknown.push({ number: page.number, cardId: page.cardId, reason: rarity.quarantine });
    evidence.push({ cardId: page.cardId, setMark: page.setMark, number: page.number, nameJa: page.nameJa, rarityIcon: page.rarityIcon ?? null });
    cards.push({
      id: `pokemon-official-ja-${code.toLowerCase()}-${page.number.toLowerCase()}`,
      provider_id: page.cardId,
      official_card_number: page.number,
      name_ja: page.nameJa,
      rarity_code: rarity.rarity ?? null,
      source_url: officialJpDetailUrl(page.cardId),
      search_text: [page.nameJa, page.number, `${code}-${page.number}`, `${code}${page.number}`.toLowerCase()].join(' '),
      metadata: { officialCardId: page.cardId, rarityIcon: page.rarityIcon ?? null, ...(rarity.rarity ? { rarityBasis: OFFICIAL_JP_SOURCE } : {}) }
    });
  }
  cards.sort(byNumber);
  evidence.sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
  const evidenceHash = createHash('sha256').update(postgresJsonbText({ series: code, cards: evidence }), 'utf8').digest('hex');
  const sourceObservedAt = [list.fetchedAt, ...pages.map(page => page.fetchedAt)].filter(Boolean).sort().at(-1);
  const series = {
    id: `pokemon-official-ja-${code.toLowerCase()}`,
    provider_id: code,
    name_ja: seriesMeta.name_ja,
    release_date: seriesMeta.release_date ?? null,
    source_url: `https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=${encodeURIComponent(code)}`,
    metadata: { officialListCount: list.hitCount, evidenceHash, ...(seriesMeta.basis ? { seriesNameBasis: seriesMeta.basis } : {}) }
  };
  const count = Math.ceil(cards.length / BATCH_SIZE);
  const plans = [];
  for (let index = 1; index <= count; index++) {
    plans.push({
      planVersion: 1,
      source: OFFICIAL_JP_SOURCE,
      seriesProviderId: code,
      evidenceHash,
      sourceObservedAt,
      batch: { index, count, seriesCardCount: cards.length },
      series,
      cards: cards.slice((index - 1) * BATCH_SIZE, index * BATCH_SIZE)
    });
  }
  return { plans, evidence, quarantined, rarityUnknown, summary: { code, listed: list.cardIds.length, cards: cards.length, batches: count, quarantined: quarantined.length, rarityUnknown: rarityUnknown.length, evidenceHash } };
}

const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;

/**
 * Gated SQL for one batch: a dry run must report a fresh, collision-free insert of exactly
 * this plan (same digest as computed here) before the real write runs in the same request.
 */
export function buildOfficialJpSeriesSql(plan, actor) {
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('ACTOR_REQUIRED');
  const json = JSON.stringify(plan);
  if (json.includes('$plan$')) throw new Error('PLAN_QUOTE_COLLISION');
  const digest = pokemonJpPlanDigest(plan);
  const n = plan.cards.length;
  const inserted = `{"cards": ${n}, "series": ${plan.batch.index === 1 ? 1 : 0}, "canonical": ${n}, "printings": ${n}}`;
  const fn = 'private.import_pokemon_jp_official_series';
  const call = dry => `${fn}($plan$${json}$plan$::jsonb, ${sqlText(actor)}, ${dry})`;
  const gated = [
    `-- ${plan.seriesProviderId} batch ${plan.batch.index}/${plan.batch.count}: ${n} cards (ADR 0012). planDigest ${digest}`,
    'create temporary table jp_official_import_result (v jsonb) on commit drop;',
    'do $do$',
    'declare d jsonb; r jsonb;',
    'begin',
    `  d := ${call(true)};`,
    `  if (d->>'replay')::boolean or d->>'planDigest' <> ${sqlText(digest)}`,
    `    or d->'before' <> '{"series":0,"cards":0,"canonical":0,"printings":0}'::jsonb`,
    `    or d->'inserted' <> '${inserted}'::jsonb then raise exception 'unexpected dry run %', d; end if;`,
    `  r := ${call(false)};`,
    `  if (r->>'replay')::boolean or r->>'planDigest' <> ${sqlText(digest)} then raise exception 'unexpected import %', r; end if;`,
    '  insert into jp_official_import_result values (r);',
    'end',
    '$do$;',
    'select v from jp_official_import_result;',
    ''
  ].join('\n');
  const replay = `-- ${plan.seriesProviderId} batch ${plan.batch.index} replay: must change nothing.\nselect ${call(false)} v;\n`;
  return { digest, gated, replay };
}
