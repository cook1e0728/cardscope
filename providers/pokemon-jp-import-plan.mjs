import { POKEMON_JP_SOURCE_IDENTITY, sha256PokemonJpPayload } from './pokemon-jp-manifest.mjs';

export const POKEMON_JP_IMPORT_PLAN_VERSION = 1;

/**
 * Turn one dry-run manifest into the exact row plan accepted by
 * private.import_pokemon_jp_metadata. The pilot imports a whole series in one
 * transaction, so any quarantine, cursor or remaining page is a hard stop.
 * Constant columns (game, source, region, language, status, image fields) are
 * fixed by the database function and deliberately absent from the plan.
 */
export function buildPokemonJpImportPlan(manifest) {
  if (manifest?.manifestType !== 'pokemon-jp-metadata-only' || manifest.schemaVersion !== 1) {
    throw new Error('INVALID_POKEMON_JP_MANIFEST');
  }
  const { manifestHash, ...unhashed } = manifest;
  if (sha256PokemonJpPayload(unhashed) !== manifestHash) throw new Error('POKEMON_JP_MANIFEST_HASH_MISMATCH');
  if (manifest.scope.seriesStatus !== 'eligible') throw new Error('POKEMON_JP_SERIES_NOT_ELIGIBLE');
  if (manifest.scope.cursor != null || manifest.scope.hasMore) throw new Error('POKEMON_JP_PLAN_REQUIRES_WHOLE_SERIES');
  if (manifest.quarantined.length > 0) throw new Error('POKEMON_JP_PLAN_HAS_QUARANTINE');

  const series = manifest.records.filter(row => row.entity === 'series');
  const cards = manifest.records.filter(row => row.entity === 'card');
  const printings = manifest.records.filter(row => row.entity === 'printing');
  if (series.length !== 1 || cards.length === 0 || cards.length !== printings.length) {
    throw new Error('POKEMON_JP_PLAN_SHAPE_MISMATCH');
  }
  if (cards.length !== manifest.summary.sourceCards) throw new Error('POKEMON_JP_PLAN_SHAPE_MISMATCH');

  const [seriesRecord] = series;
  const seriesProviderId = seriesRecord.sourceProviderId;
  const printingByCard = new Map(printings.map(row => [row.cardTargetId, row]));
  const provenance = { manifestHash, sourceHash: manifest.provenance.sourceHash, seedHash: manifest.provenance.seedHash };

  return {
    planVersion: POKEMON_JP_IMPORT_PLAN_VERSION,
    source: POKEMON_JP_SOURCE_IDENTITY.source,
    seriesProviderId,
    manifestHash,
    sourceHash: manifest.provenance.sourceHash,
    seedHash: manifest.provenance.seedHash,
    sourceObservedAt: manifest.provenance.sourceObservedAt,
    series: {
      id: seriesRecord.targetId,
      provider_id: seriesProviderId,
      name_ja: seriesRecord.metadata.name_ja,
      release_date: seriesRecord.metadata.releaseDate,
      source_url: seriesRecord.sourceEvidence.url,
      metadata: { sourceEvidence: seriesRecord.sourceEvidence, ...provenance }
    },
    cards: cards.map(card => {
      const printing = printingByCard.get(card.targetId);
      if (!printing || printing.sourceProviderId !== card.sourceProviderId) throw new Error('POKEMON_JP_PLAN_SHAPE_MISMATCH');
      const localId = printing.identity.localId;
      return {
        id: card.targetId,
        provider_id: card.sourceProviderId,
        official_card_number: localId,
        name_ja: card.metadata.name_ja,
        rarity_code: printing.metadata.rarity?.code ?? null,
        search_text: [card.metadata.name_ja, localId, card.sourceProviderId, card.sourceProviderId.replace(/-/g, '').toLowerCase()].join(' '),
        source_url: card.sourceEvidence.url,
        release_date: printing.metadata.releaseDate,
        metadata: { tcgdexId: card.sourceProviderId, sourceEvidence: card.sourceEvidence, ...provenance }
      };
    })
  };
}
