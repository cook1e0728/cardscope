import { normalizeRarityValue } from './normalize.mjs';
import { sha256PokemonJpPayload } from './pokemon-jp-manifest.mjs';

export const POKEMON_JP_ENRICH_PLAN_VERSION = 1;

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function supportedRarityCode(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const rarity = normalizeRarityValue('pokemon', value);
  return rarity.known ? rarity.code : null;
}

/**
 * Build the plan accepted by private.enrich_pokemon_jp_metadata for one
 * imported JP series (ADR 0003). Inputs are evidence only; nothing is fetched.
 *
 * - jpSeries: { id, providerId, nameZh }
 * - jpCards: imported JP cards { id, provider_id, name_ja, name_zh, canonical_id, rarity }
 * - archiveSet: { zhTw } and archiveCards: [{ providerId, ja, zhTw, rarity }] from the
 *   Source archive (same files hold the Japanese and Traditional Chinese names)
 * - twSeries: { id, official_code, name_zh } or null; twCards: [{ id, provider_id, name_zh,
 *   canonical_id, canonicalShared }] read from the database
 *
 * Links need the same Provider ID, archive ja = JP name, archive zh-tw = TW
 * official name, and an unshared TW canonical. Cards without a link get a
 * Derived name only when every linked card with the same Japanese name agrees
 * on one Taiwanese name. Anything inconsistent is quarantined, not planned.
 */
export function buildPokemonJpEnrichPlan({ jpSeries, jpCards, archiveSet, archiveCards, twSeries, twCards, sourceArchive }) {
  if (!jpSeries?.id || !jpSeries?.providerId) throw new Error('POKEMON_JP_ENRICH_SERIES_REQUIRED');
  if (!/^[0-9a-f]{40}$/.test(String(sourceArchive?.commit))) throw new Error('POKEMON_JP_ENRICH_ARCHIVE_REQUIRED');
  const code = jpSeries.providerId;
  const archiveById = new Map(archiveCards.map(card => [card.providerId, card]));
  const twById = new Map((twCards || []).map(card => [card.provider_id, card]));
  const quarantined = [];
  const entries = new Map();

  for (const card of [...jpCards].sort((a, b) => compareText(a.id, b.id))) {
    const entry = { id: card.id, name_ja: card.name_ja, link: null, name_zh: null, basis: null, rarity_code: null };
    const archive = archiveById.get(card.provider_id);
    const tw = twById.get(card.provider_id);
    if (tw && !card.name_zh && card.canonical_id === card.id) {
      const reasons = [];
      if (!archive) reasons.push('missing-archive-card');
      else {
        if (archive.ja !== card.name_ja) reasons.push('archive-ja-name-mismatch');
        if (archive.zhTw !== tw.name_zh) reasons.push('archive-zh-tw-name-mismatch');
      }
      if (!tw.name_zh) reasons.push('tw-name-missing');
      if (tw.canonical_id !== tw.id) reasons.push('tw-canonical-not-own');
      if (tw.canonicalShared) reasons.push('tw-canonical-shared');
      if (reasons.length) quarantined.push({ id: card.id, link: tw.id, reasons });
      else Object.assign(entry, { link: tw.id, name_zh: tw.name_zh, basis: 'tw-official' });
    }
    if (card.rarity == null) entry.rarity_code = supportedRarityCode(archive?.rarity);
    entries.set(card.id, entry);
  }

  const officialByJa = new Map();
  for (const entry of entries.values()) {
    if (entry.basis !== 'tw-official') continue;
    const names = officialByJa.get(entry.name_ja) || new Set();
    names.add(entry.name_zh);
    officialByJa.set(entry.name_ja, names);
  }
  for (const card of jpCards) {
    const entry = entries.get(card.id);
    if (entry.basis || card.name_zh || !officialByJa.has(card.name_ja)) continue;
    const names = [...officialByJa.get(card.name_ja)];
    if (names.length === 1) Object.assign(entry, { name_zh: names[0], basis: 'derived-same-name' });
    else quarantined.push({ id: card.id, reasons: ['ambiguous-derived-name'], candidates: names.sort() });
  }

  let series = null;
  if (twSeries && !jpSeries.nameZh && twSeries.name_zh) {
    if (String(twSeries.official_code).toUpperCase() !== code.toUpperCase()) {
      quarantined.push({ id: jpSeries.id, reasons: ['tw-series-code-mismatch'] });
    } else if (archiveSet?.zhTw !== twSeries.name_zh) {
      quarantined.push({ id: jpSeries.id, reasons: ['archive-series-zh-tw-name-mismatch'] });
    } else {
      series = { name_zh: twSeries.name_zh, twSeriesId: twSeries.id };
    }
  }

  const cards = [...entries.values()]
    .filter(entry => entry.link || entry.name_zh || entry.rarity_code)
    .sort((a, b) => compareText(a.id, b.id));
  const evidence = {
    sourceArchive: { repository: sourceArchive.repository, commit: sourceArchive.commit },
    jpSeries, jpCards: [...jpCards].sort((a, b) => compareText(a.id, b.id)),
    archiveSet: archiveSet ?? null,
    archiveCards: [...archiveCards].sort((a, b) => compareText(a.providerId, b.providerId)),
    twSeries: twSeries ?? null,
    twCards: [...(twCards || [])].sort((a, b) => compareText(a.id, b.id))
  };
  const plan = {
    planVersion: POKEMON_JP_ENRICH_PLAN_VERSION,
    kind: 'jp-enrich',
    source: 'tcgdex-ja',
    seriesProviderId: code,
    seriesId: jpSeries.id,
    evidenceHash: sha256PokemonJpPayload(evidence),
    sourceArchive: evidence.sourceArchive,
    series,
    cards
  };
  return {
    plan,
    evidence,
    quarantined,
    summary: {
      cards: cards.length,
      links: cards.filter(c => c.basis === 'tw-official').length,
      derived: cards.filter(c => c.basis === 'derived-same-name').length,
      rarities: cards.filter(c => c.rarity_code).length,
      series: series ? 1 : 0,
      quarantined: quarantined.length,
      stillWithoutZh: jpCards.filter(c => !c.name_zh && !entries.get(c.id)?.name_zh).length
    }
  };
}
