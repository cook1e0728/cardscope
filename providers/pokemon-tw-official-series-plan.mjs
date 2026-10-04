import { createHash } from 'node:crypto';
import { OFFICIAL_TW_RARITY_FILTERS, TW_SET_MARK_ALIASES, officialTwDetailUrl, officialTwRarityCode, twSetMarkMatches } from './pokemon-tw-official.mjs';
import { postgresJsonbText } from './pokemon-jp-import-sql.mjs';

// ADR 0015: Taiwanese series the Source archive lacks are imported from the Taiwanese official
// card search cache (seriesLists, details, rarityLists), as private.import_pokemon_tw_official_series plans.

export const OFFICIAL_TW_SOURCE = 'asia-pokemon-card-official-tw';
const BATCH_SIZE = 100;

/**
 * One card per official number. Every version listed under the number must show the series mark
 * (or the series code as total) and the same Chinese name; otherwise the number is quarantined.
 * The rarity is used only when every version sits in exactly one rarity filter and they agree
 * (ADR 0010); the Provider ID is the smallest detail ID of the number.
 */
export function buildOfficialTwSeriesPlans({ code, seriesNameZh, cache, observedAt }) {
  const list = cache.seriesLists?.[code];
  if (!list?.complete) throw new Error(`TW_OFFICIAL_LIST_INCOMPLETE:${code}`);
  if (!seriesNameZh) throw new Error(`TW_SERIES_NAME_MISSING:${code}`);
  if (!Object.keys(OFFICIAL_TW_RARITY_FILTERS).every(value => cache.rarityLists?.[value]?.complete)) throw new Error('TW_RARITY_LISTS_INCOMPLETE');
  const labelsById = new Map();
  for (const [value, rarityList] of Object.entries(cache.rarityLists)) for (const id of Object.values(rarityList.pages).flat()) labelsById.set(id, [...(labelsById.get(id) || []), OFFICIAL_TW_RARITY_FILTERS[value]]);
  // ADR 0022: an aliased mark must be the only mark in the series and appear in no other series list.
  if (TW_SET_MARK_ALIASES[code]) {
    const ownMarks = new Set(Object.values(list.pages).flat().map(id => cache.details[id]?.setMark));
    const elsewhere = Object.entries(cache.seriesLists).some(([other, otherList]) => other !== code && Object.values(otherList.pages || {}).flat().some(id => ownMarks.has(cache.details[id]?.setMark)));
    if (ownMarks.size !== 1 || elsewhere) throw new Error(`TW_SET_MARK_ALIAS_NOT_EXCLUSIVE:${code}`);
  }
  const quarantined = [], rarityUnknown = [], byNumber = new Map();
  for (const id of Object.values(list.pages).flat()) {
    const detail = cache.details[id];
    if (!detail) throw new Error(`TW_OFFICIAL_DETAIL_MISSING:${code}:${id}`);
    if (!detail.number || !/^[A-Za-z0-9]+$/.test(detail.number)) { quarantined.push({ id, number: detail.number, nameZh: detail.nameZh, reason: 'NUMBER_MISSING' }); continue; }
    if (!(twSetMarkMatches(detail.setMark, code) || detail.total === code)) { quarantined.push({ id, number: detail.number, nameZh: detail.nameZh, reason: `SET_MISMATCH:${detail.setMark}` }); continue; }
    if (!detail.nameZh) { quarantined.push({ id, number: detail.number, nameZh: null, reason: 'NAME_MISSING' }); continue; }
    byNumber.set(detail.number, [...(byNumber.get(detail.number) || []), { id: String(id), detail }]);
  }
  const cards = [], evidence = [];
  for (const [number, versions] of byNumber) {
    const names = new Set(versions.map(v => v.detail.nameZh));
    if (names.size > 1) { for (const v of versions) quarantined.push({ id: v.id, number, nameZh: v.detail.nameZh, reason: 'VERSION_NAME_CONFLICT' }); continue; }
    const ids = versions.map(v => v.id).sort((a, b) => Number(a) - Number(b));
    const labels = new Set(), oneEach = versions.every(v => (labelsById.get(v.id) || []).length === 1);
    for (const v of versions) for (const label of labelsById.get(v.id) || []) labels.add(label);
    const mapped = oneEach && labels.size === 1 ? officialTwRarityCode([...labels][0]) : { quarantine: labels.size ? `TW_RARITY_NOT_SINGLE:${[...labels].join('/')}` : 'TW_RARITY_NOT_LISTED' };
    if (mapped.quarantine) rarityUnknown.push({ number, ids, reason: mapped.quarantine });
    const nameZh = versions[0].detail.nameZh;
    evidence.push({ number, ids, nameZh, rarityLabels: [...labels].sort() });
    cards.push({
      id: `pokemon-official-tw-${code.toLowerCase()}-${number.toLowerCase()}`,
      provider_id: ids[0],
      official_card_number: number,
      name_zh: nameZh,
      rarity_code: mapped.rarity ?? null,
      source_url: officialTwDetailUrl(ids[0]),
      search_text: [nameZh, number, `${code}-${number}`, `${code}${number}`.toLowerCase()].join(' '),
      metadata: { officialDetailIds: ids, rarityLabels: [...labels].sort(), ...(mapped.rarity ? { rarityBasis: OFFICIAL_TW_SOURCE } : {}) }
    });
  }
  const byNum = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  cards.sort((a, b) => byNum(a.official_card_number, b.official_card_number));
  evidence.sort((a, b) => byNum(a.number, b.number));
  const evidenceHash = createHash('sha256').update(postgresJsonbText({ series: code, cards: evidence }), 'utf8').digest('hex');
  const series = {
    id: `pokemon-official-tw-${code.toLowerCase()}`,
    provider_id: code,
    name_zh: seriesNameZh,
    release_date: null,
    source_url: `https://asia.pokemon-card.com/tw/card-search/list/?expansionCodes=${encodeURIComponent(code)}`,
    metadata: { officialListCount: Object.values(list.pages).flat().length, evidenceHash, seriesNameBasis: 'asia.pokemon-card.com/tw card search expansion list' }
  };
  const count = Math.ceil(cards.length / BATCH_SIZE), plans = [];
  for (let index = 1; index <= count; index++) {
    plans.push({ planVersion: 1, source: OFFICIAL_TW_SOURCE, seriesProviderId: code, evidenceHash, sourceObservedAt: observedAt, batch: { index, count, seriesCardCount: cards.length }, series, cards: cards.slice((index - 1) * BATCH_SIZE, index * BATCH_SIZE) });
  }
  return { plans, evidence, quarantined, rarityUnknown, summary: { code, numbers: byNumber.size, cards: cards.length, batches: count, quarantined: quarantined.length, rarityUnknown: rarityUnknown.length, evidenceHash } };
}
