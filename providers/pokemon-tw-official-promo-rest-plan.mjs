import { createHash } from 'node:crypto';
import { OFFICIAL_TW_RARITY_FILTERS, officialTwDetailUrl, officialTwRarityCode, sameTwName } from './pokemon-tw-official.mjs';
import { postgresJsonbText } from './pokemon-jp-import-sql.mjs';
import { OFFICIAL_TW_SOURCE } from './pokemon-tw-official-series-plan.mjs';

// ADR 0041 left the promo pages without a card number out (PROMO_SPECIAL_NUMBER / NUMBER_MISSING).
// Their detail pages do print a collector string, but it is never a number: the three-letter
// energy code (GRA, FIR, ...), the series code itself (M-P, SV-P) or "n/a". This planner reads
// that raw string from a text-facts overlay (the series cache stored only the number part) and
// turns the pages into private.supplement_pokemon_tw_official_series plans:
// - an energy code is the card number as printed (same as the archive SV-P rows DAR, FIG, ...);
// - a page with no number at all (collector string = series code or "n/a") is its own card with the
//   official detail page ID as identity, as ADR 0026 does for the Japanese DP era. The supplement
//   function cannot take a null number, so the interim number is "c<detail ID>" and the card
//   carries metadata numberStatus "not-printed"; a later migration may null the number without
//   changing the card ID.
// Pages that share the same name and text stay separate cards (ADR 0035): the page text cannot
// show which version is which, so merging would make them impossible to register separately.

const BATCH_SIZE = 100;
const ENERGY_CODE = /^[A-Z]{3}$/;

export function classifyPromoCollector(collectorText, code) {
  const text = String(collectorText ?? '').trim();
  if (ENERGY_CODE.test(text)) return { kind: 'energy-code', number: text };
  if (text === '' || text.toLowerCase() === 'n/a' || text.toUpperCase() === String(code).toUpperCase()) return { kind: 'not-printed', number: null };
  return { kind: 'unknown', number: null };
}

function rarityLabelsById(cache) {
  if (!Object.keys(OFFICIAL_TW_RARITY_FILTERS).every(value => cache.rarityLists?.[value]?.complete)) throw new Error('TW_RARITY_LISTS_INCOMPLETE');
  const labels = new Map();
  for (const [value, list] of Object.entries(cache.rarityLists)) for (const id of Object.values(list.pages).flat()) labels.set(id, [...(labels.get(id) || []), OFFICIAL_TW_RARITY_FILTERS[value]]);
  return labels;
}

/**
 * existing: the printings already in the target series [{ num, name_zh }].
 * overlay: { pages: { [detailId]: { list, nameZh, collectorText, setMark, cardType, illustrator, effectSha256, fetchedAt } } }.
 * Every list entry whose cached number is not a plain number must have an overlay page.
 * Held back (never planned): a page whose collector string is unknown; an energy code the series
 * already holds under another name; a number-less page whose name the series already holds on a
 * non-numeric number (the archive no0-no3 rows cannot be matched to one page of a same-text group).
 */
export function buildPromoRestPlan({ code, seriesId, existing, cache, overlay, observedAt, includeNotPrinted = true }) {
  const list = cache.seriesLists?.[code];
  if (!list?.complete) throw new Error(`TW_OFFICIAL_LIST_INCOMPLETE:${code}`);
  const labelsById = rarityLabelsById(cache);
  const covered = new Map(existing.map(row => [row.num, row]));
  const held = [], cards = [], evidence = [], rarityUnknown = [], seen = new Set();
  const specials = Object.values(list.pages).flat().filter(id => !/^\d+$/.test(String(cache.details[id]?.number ?? '')));
  for (const id of specials) {
    const detail = cache.details[id], page = overlay.pages?.[id];
    if (!detail) throw new Error(`TW_OFFICIAL_DETAIL_MISSING:${code}:${id}`);
    if (!page) throw new Error(`TW_PROMO_OVERLAY_MISSING:${code}:${id}`);
    if (page.list !== code || page.nameZh !== detail.nameZh || !String(page.setMark).startsWith('PROMO.MARK')) throw new Error(`TW_PROMO_OVERLAY_MISMATCH:${code}:${id}`);
    const kind = classifyPromoCollector(page.collectorText, code);
    if (kind.kind === 'unknown') { held.push({ id, nameZh: page.nameZh, collectorText: page.collectorText, reason: 'COLLECTOR_TEXT_UNKNOWN' }); continue; }
    const labels = [...new Set(labelsById.get(id) || [])];
    const mapped = labels.length === 1 ? officialTwRarityCode(labels[0]) : { quarantine: labels.length ? `TW_RARITY_NOT_SINGLE:${labels.join('/')}` : 'TW_RARITY_NOT_LISTED' };
    if (mapped.quarantine) rarityUnknown.push({ id, reason: mapped.quarantine });
    let number = kind.number, metadata;
    if (kind.kind === 'energy-code') {
      const row = covered.get(number);
      if (row) {
        if (!sameTwName(row.name_zh, page.nameZh)) { held.push({ id, nameZh: page.nameZh, collectorText: page.collectorText, reason: `ENERGY_CODE_NAME_CONFLICT:${row.name_zh}` }); continue; }
        held.push({ id, nameZh: page.nameZh, collectorText: page.collectorText, reason: 'ALREADY_IN_SERIES', number }); continue;
      }
      metadata = { officialDetailIds: [String(id)], officialCollectorText: page.collectorText, rarityLabels: labels };
    } else {
      if (!includeNotPrinted) { held.push({ id, nameZh: page.nameZh, collectorText: page.collectorText, reason: 'NOT_PRINTED_EXCLUDED' }); continue; }
      const sameName = existing.filter(row => !/^\d+$/.test(row.num) && sameTwName(row.name_zh, page.nameZh));
      if (sameName.length) { held.push({ id, nameZh: page.nameZh, collectorText: page.collectorText, reason: `ALIGNMENT_AMBIGUOUS:${sameName.map(row => row.num).join('|')}` }); continue; }
      number = `c${id}`;
      metadata = { officialDetailIds: [String(id)], officialCollectorText: page.collectorText, numberStatus: 'not-printed', rarityLabels: labels };
    }
    if (seen.has(number.toLowerCase())) throw new Error(`TW_PROMO_NUMBER_REPEATED:${code}:${number}`);
    seen.add(number.toLowerCase());
    if (mapped.rarity) metadata.rarityBasis = OFFICIAL_TW_SOURCE;
    evidence.push({ id: String(id), number, nameZh: page.nameZh, collectorText: page.collectorText, rarityLabels: labels });
    cards.push({
      id: `pokemon-official-tw-${code.toLowerCase()}-${number.toLowerCase()}`,
      provider_id: String(id),
      official_card_number: number,
      name_zh: page.nameZh,
      rarity_code: mapped.rarity ?? null,
      source_url: officialTwDetailUrl(id),
      search_text: kind.kind === 'energy-code' ? [page.nameZh, number, `${code}-${number}`, `${code}${number}`.toLowerCase()].join(' ') : [page.nameZh, code, `${code}-${page.nameZh}`].join(' '),
      metadata
    });
  }
  const byNum = (a, b) => a.official_card_number.localeCompare(b.official_card_number, 'en', { numeric: true });
  cards.sort(byNum);
  const sortedExisting = [...existing].sort((a, b) => a.num.localeCompare(b.num, 'en', { numeric: true })).map(row => ({ number: row.num, name_zh: row.name_zh }));
  const plans = [];
  for (let index = 0, count = Math.ceil(cards.length / BATCH_SIZE); index < count; index++) {
    const slice = cards.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
    const earlier = cards.slice(0, index * BATCH_SIZE).map(card => ({ number: card.official_card_number, name_zh: card.name_zh }));
    const alignment = [...sortedExisting, ...earlier].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
    const evidenceHash = createHash('sha256').update(postgresJsonbText({ series: code, promoRest: slice.map(card => card.metadata.officialDetailIds), alignment: existing }), 'utf8').digest('hex');
    plans.push({ planVersion: 1, source: OFFICIAL_TW_SOURCE, seriesProviderId: code, evidenceHash, sourceObservedAt: observedAt, ...(count > 1 ? { batch: { index: index + 1, count, seriesCardCount: cards.length } } : {}), series: { id: seriesId, provider_id: code }, alignment, cards: slice });
  }
  return { plans, held, rarityUnknown, evidence: evidence.sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true })), summary: { code, seriesId, existing: existing.length, specialPages: specials.length, add: cards.length, held: held.length, batches: plans.length } };
}

/**
 * Rarity fill for the archive rows that have no number the official site prints (SV-P no0-no3 and the
 * energies), for private.fill_pokemon_official_rarity_tw. rows: [{ printing_id, card_id, num, name_zh, rarity }].
 * - exact: the row's number is the official energy code and exactly one page of that name prints it;
 * - group: the row is a number-less card (no0, no1, ...) and several official pages share its name;
 *   they all carry one rarity, but which page the row is cannot be shown, so officialDetailIds names
 *   the whole group. These rows are planned separately so the owner can decide.
 */
export function buildPromoRarityFillPlans({ code, seriesId, rows, cache, overlay }) {
  const labelsById = rarityLabelsById(cache);
  const pages = Object.entries(overlay.pages || {}).filter(([, page]) => page.list === code).map(([id, page]) => ({ id, ...page }));
  const exact = [], group = [], quarantined = [];
  for (const row of rows.filter(item => !item.rarity && !/^\d+$/.test(item.num))) {
    const sameName = pages.filter(page => sameTwName(row.name_zh, page.nameZh));
    const byCode = ENERGY_CODE.test(row.num) ? sameName.filter(page => page.collectorText === row.num) : [];
    const candidates = byCode.length ? byCode : sameName.filter(page => classifyPromoCollector(page.collectorText, code).kind === 'not-printed');
    if (!candidates.length) { quarantined.push({ num: row.num, name: row.name_zh, reason: 'OFFICIAL_PAGE_NOT_FOUND' }); continue; }
    const labels = new Set(candidates.flatMap(page => labelsById.get(page.id) || []));
    if (candidates.some(page => (labelsById.get(page.id) || []).length !== 1) || labels.size !== 1) { quarantined.push({ num: row.num, name: row.name_zh, reason: `RARITY_AMBIGUOUS:${[...labels].join('|') || 'none'}` }); continue; }
    const mapped = officialTwRarityCode([...labels][0]);
    if (mapped.quarantine) { quarantined.push({ num: row.num, name: row.name_zh, reason: mapped.quarantine }); continue; }
    const entry = { printingId: Number(row.printing_id), cardId: row.card_id, number: row.num, name: row.name_zh, rarity: mapped.rarity, officialDetailIds: candidates.map(page => page.id).sort((a, b) => Number(a) - Number(b)) };
    (byCode.length === 1 ? exact : group).push(entry);
  }
  const plan = entries => (entries.length ? { version: 1, kind: 'tw-official', seriesId, rows: entries.sort((a, b) => a.number.localeCompare(b.number)) } : null);
  return { exact: plan(exact), group: plan(group), quarantined };
}
