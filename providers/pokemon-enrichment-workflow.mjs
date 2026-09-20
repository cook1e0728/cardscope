import {
  createPokemonGapPlan,
  GAP_KINDS,
  MAX_BATCH_SIZE as MAX_GAP_BATCH_SIZE
} from './pokemon-gap-sync.mjs';
import {
  planPokemonEnrichment,
  selectPokemonEnrichmentTargets,
  sha256Payload,
  stableStringify,
  DEFAULT_BATCH_SIZE as DEFAULT_CANDIDATE_BATCH_SIZE,
  MAX_BATCH_SIZE as MAX_CANDIDATE_BATCH_SIZE
} from './enrichment-candidates.mjs';

/**
 * Phase 3 orchestration for read-only Pokémon enrichment.
 *
 * The existing gap planner and TCGdex candidate planner remain the only
 * producers of patches/candidate rows.  This wrapper adds a shared bounded
 * cursor, provider-ID-only filtering, blank-target checks and one audited
 * output envelope.  It intentionally has no database or file writer.
 */

export const MAX_BATCH_SIZE = Math.min(MAX_GAP_BATCH_SIZE, MAX_CANDIDATE_BATCH_SIZE, 100);
export const DEFAULT_BATCH_SIZE = Math.min(DEFAULT_CANDIDATE_BATCH_SIZE, MAX_BATCH_SIZE);
export const DEFAULT_GAP_KINDS = Object.freeze([
  GAP_KINDS.TRADITIONAL_CHINESE_NAME,
  GAP_KINDS.RARITY
]);

const clean = value => value == null ? null : String(value).trim() || null;
const hasValue = value => value != null && (typeof value !== 'string' || Boolean(value.trim()));
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

function providerIdFor(row) {
  return clean(row?.providerId ?? row?.provider_id ?? row?.providerCardId ?? row?.provider_card_id);
}

function targetIdFor(row, kind) {
  if (kind === 'card') return clean(row?.id ?? row?.cardId ?? row?.card_id);
  return clean(row?.id ?? row?.printingId ?? row?.printing_id);
}

function cardIdFor(row) {
  return clean(row?.id ?? row?.cardId ?? row?.card_id);
}

function normalizeExact(value) {
  return clean(value)?.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '') || null;
}

function normalizeBatchSize(value) {
  const number = value == null ? DEFAULT_BATCH_SIZE : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error('INVALID_POKEMON_ENRICHMENT_BATCH_SIZE');
  return Math.min(MAX_BATCH_SIZE, number);
}

function encodeCursor(offset, checksum) {
  return Buffer.from(JSON.stringify({ version: 1, offset, checksum }), 'utf8').toString('base64url');
}

function decodeCursor(value, checksum, total) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (parsed.version !== 1 || parsed.checksum !== checksum || !Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > total) throw new Error('invalid');
    return parsed.offset;
  } catch {
    throw new Error('INVALID_POKEMON_ENRICHMENT_CURSOR');
  }
}

function cursorValue(cursor, key) {
  if (!cursor) return null;
  if (typeof cursor === 'string') return key === 'gap' ? cursor : null;
  if (!isObject(cursor)) return null;
  return cursor[key] ?? cursor[`${key}Cursor`] ?? null;
}

function snapshotRows(snapshot, key) {
  return Array.isArray(snapshot?.[key]) ? snapshot[key] : [];
}

function providerGroupFingerprint(group) {
  return {
    providerId: group.providerId,
    targets: group.targets.map(target => ({
      kind: target.kind,
      id: target.id,
      needs: [...target.needs].sort()
    })).sort((left, right) => `${left.kind}|${left.id}`.localeCompare(`${right.kind}|${right.id}`))
  };
}

function candidateGroupsChecksum(groups) {
  return sha256Payload(groups.map(providerGroupFingerprint));
}

function targetKey(target) {
  return `${target.kind}:${target.id}`;
}

function restrictSnapshotToProviderIds(snapshot, providerIds) {
  const allowed = new Set([...providerIds].map(normalizeExact).filter(Boolean));
  const printings = snapshotRows(snapshot, 'printings').filter(row => allowed.has(normalizeExact(providerIdFor(row))));
  const referencedCardIds = new Set(printings.map(row => clean(row?.cardId ?? row?.card_id)).filter(Boolean));
  const cards = snapshotRows(snapshot, 'cards').filter(row => allowed.has(normalizeExact(providerIdFor(row))) || referencedCardIds.has(cardIdFor(row)));
  const cardIds = new Set(cards.map(cardIdFor).filter(Boolean));
  const cardNames = snapshotRows(snapshot, 'cardNames').filter(row => cardIds.has(clean(row?.cardId ?? row?.card_id)));
  return { cards, printings, cardNames };
}

function sourceRecordsFrom(snapshot, sourceRecords) {
  if (sourceRecords !== undefined) return Array.isArray(sourceRecords) ? sourceRecords : [];
  return Array.isArray(snapshot?.sourceRecords)
    ? snapshot.sourceRecords
    : Array.isArray(snapshot?.sources) ? snapshot.sources : [];
}

function providerIdOnlySources(sourceRecords) {
  const accepted = [];
  const rejected = [];
  for (const [index, row] of sourceRecords.entries()) {
    if (!providerIdFor(row)) {
      rejected.push({ stage: 'source-filter', index, status: 'held-for-review', reason: 'missing-provider-id' });
      continue;
    }
    accepted.push(row);
  }
  return { accepted, rejected };
}

function providerIdFromStableKey(value) {
  const text = clean(value);
  if (!text) return null;
  const marker = text.lastIndexOf('|id:');
  return marker >= 0 ? text.slice(marker + 4) : null;
}

function patchProviderId(item) {
  return clean(
    item?.provenance?.providerId
      ?? item?.patch?.metadata?.providerId
      ?? item?.patch?.metadata?.provider_id
  );
}

function strictGapPlan(plan) {
  const providerIdMatches = new Set(plan.matches
    .filter(match => match.matchType === 'provider-id')
    .map(match => normalizeExact(providerIdFromStableKey(match.source)))
    .filter(Boolean));
  const localMatches = plan.matches.filter(match => match.matchType !== 'provider-id');
  const localProviderIds = new Set(localMatches.map(match => normalizeExact(providerIdFromStableKey(match.source))).filter(Boolean));
  const rejected = localMatches.map(match => ({
    source: match.source,
    reason: 'provider-id-required',
    matchType: match.matchType,
    providerId: providerIdFromStableKey(match.source)
  }));
  const keep = item => {
    const providerId = normalizeExact(patchProviderId(item));
    return Boolean(providerId && providerIdMatches.has(providerId) && !localProviderIds.has(providerId));
  };
  const patches = {
    tcg_cards: plan.patches.tcg_cards.filter(keep),
    tcg_printings: plan.patches.tcg_printings.filter(keep),
    tcg_card_names: plan.patches.tcg_card_names.filter(keep)
  };
  const patchCounts = {
    tcg_cards: patches.tcg_cards.length,
    tcg_printings: patches.tcg_printings.length,
    tcg_card_names: patches.tcg_card_names.length,
    total: patches.tcg_cards.length + patches.tcg_printings.length + patches.tcg_card_names.length
  };
  return {
    ...plan,
    matches: plan.matches.filter(match => match.matchType === 'provider-id'),
    rejected: [...plan.rejected, ...rejected],
    patches,
    patchCounts,
    summary: {
      ...plan.summary,
      matched: plan.matches.filter(match => match.matchType === 'provider-id').length,
      providerIdRejected: rejected.length,
      strictProviderIdOnly: true
    },
    matchingPolicy: 'provider-id-only'
  };
}

function currentTargetValue(snapshot, row) {
  const table = row?.target_table;
  const targetId = table === 'tcg_cards'
    ? clean(row?.target_card_id ?? row?.target_key)
    : clean(row?.target_printing_id ?? row?.target_key);
  const rows = table === 'tcg_cards' ? snapshotRows(snapshot, 'cards') : snapshotRows(snapshot, 'printings');
  const target = rows.find(item => targetIdFor(item, table === 'tcg_cards' ? 'card' : 'printing') === targetId);
  if (!target) return null;
  const field = row?.field_name;
  if (field === 'name_zh') return target.name_zh ?? target.nameZh ?? null;
  if (field === 'rarity_code') return target.rarity_code ?? target.rarityCode ?? (table === 'tcg_cards' ? target.rarity : null) ?? null;
  if (field === 'rarity_label') return target.rarity_label ?? target.rarityLabel ?? null;
  if (field === 'image_url') return target.image_url ?? target.imageUrl ?? null;
  return target[field] ?? null;
}

function strictCandidatePlan(plan, snapshot) {
  const rejected = [];
  const candidates = plan.candidates.filter(row => {
    if (row.matching_method !== 'provider-id') {
      rejected.push({
        providerId: row.source_record_id,
        target: targetKey({ kind: row.target_printing_id ? 'printing' : 'card', id: row.target_key }),
        field: row.field_name,
        status: 'held-for-review',
        reason: 'provider-id-required'
      });
      return false;
    }
    const current = currentTargetValue(snapshot, row);
    if (hasValue(current)) {
      rejected.push({
        providerId: row.source_record_id,
        target: targetKey({ kind: row.target_printing_id ? 'printing' : 'card', id: row.target_key }),
        field: row.field_name,
        status: 'held-for-review',
        reason: 'target-not-blank'
      });
      return false;
    }
    if (!hasValue(row.proposed_value)) {
      rejected.push({
        providerId: row.source_record_id,
        target: targetKey({ kind: row.target_printing_id ? 'printing' : 'card', id: row.target_key }),
        field: row.field_name,
        status: 'held-for-review',
        reason: 'source-field-missing'
      });
      return false;
    }
    return true;
  });
  const fields = { ...(plan.summary?.fields || {}) };
  for (const row of rejected) {
    if (fields[row.field]) fields[row.field].rejected = (fields[row.field].rejected || 0) + 1;
  }
  return {
    ...plan,
    candidates,
    rows: candidates,
    audit: [...plan.audit, ...rejected],
    summary: {
      ...plan.summary,
      candidateRows: candidates.length,
      providerIdRejected: rejected.filter(row => row.reason === 'provider-id-required').length,
      nonBlankRejected: rejected.filter(row => row.reason === 'target-not-blank').length,
      strictProviderIdOnly: true,
      fields
    },
    matchingPolicy: 'provider-id-only'
  };
}

function emptyCandidatePlan() {
  return {
    dryRun: true,
    provider: 'tcgdex-zh-tw',
    gameId: 'pokemon',
    locale: 'zh-Hant-TW',
    candidates: [],
    rows: [],
    summary: {
      requestedRecords: 0,
      selectedRecords: 0,
      deferredRecords: 0,
      fetchedRecords: 0,
      fetchFailed: 0,
      candidateRows: 0,
      fields: {},
      strictProviderIdOnly: true
    },
    conflicts: [],
    deferred: [],
    skipped: [],
    audit: [],
    provenance: {
      source: 'tcgdex-zh-tw',
      collection: 'metadata-candidate-fetch',
      generatedAt: new Date().toISOString()
    },
    matchingPolicy: 'provider-id-only'
  };
}

/**
 * Plan one resumable Phase 3 batch. The returned envelope is always a dry
 * run. Passing `dryRun: false` is rejected so a caller cannot mistake this
 * preparation helper for a production writer.
 */
export async function planPokemonEnrichmentWorkflow({
  snapshot = {},
  sourceRecords,
  cursor = null,
  batchSize = DEFAULT_BATCH_SIZE,
  gapKinds = DEFAULT_GAP_KINDS,
  approvedProviders,
  fields,
  includeImages = false,
  concurrency,
  apiBase,
  timeoutMs,
  observedAt,
  fetchImpl,
  imageProbeImpl,
  fetch: fetchAlias,
  dryRun = true
} = {}) {
  if (dryRun !== true) throw new Error('POKEMON_ENRICHMENT_DRY_RUN_ONLY');
  if (!isObject(snapshot)) throw new Error('INVALID_POKEMON_ENRICHMENT_SNAPSHOT');
  const limit = normalizeBatchSize(batchSize);
  const rawSources = sourceRecordsFrom(snapshot, sourceRecords);
  const sourceSelection = providerIdOnlySources(rawSources);
  const gapPlan = strictGapPlan(createPokemonGapPlan({
    cards: snapshotRows(snapshot, 'cards'),
    printings: snapshotRows(snapshot, 'printings'),
    cardNames: snapshotRows(snapshot, 'cardNames'),
    sourceRecords: sourceSelection.accepted,
    approvedProviders,
    batchSize: Math.min(limit, MAX_GAP_BATCH_SIZE),
    cursor: cursorValue(cursor, 'gap'),
    gapKinds,
    onlyMissing: true
  }));

  const candidateSelection = selectPokemonEnrichmentTargets(snapshot, {
    fields,
    includeImages,
    batchSize: limit
  });
  const candidateChecksum = candidateGroupsChecksum(candidateSelection.groups);
  const candidateOffset = decodeCursor(cursorValue(cursor, 'candidate'), candidateChecksum, candidateSelection.groups.length);
  const selectedGroups = candidateSelection.groups.slice(candidateOffset, candidateOffset + limit);
  const selectedProviderIds = selectedGroups.map(group => group.providerId);
  const candidateSnapshot = restrictSnapshotToProviderIds(snapshot, selectedProviderIds);
  let candidatePlan = selectedGroups.length
    ? await planPokemonEnrichment(candidateSnapshot, {
      fields,
      includeImages,
      batchSize: selectedGroups.length,
      concurrency,
      apiBase,
      timeoutMs,
      observedAt,
      fetchImpl,
      imageProbeImpl,
      fetch: fetchAlias
    })
    : emptyCandidatePlan();
  candidatePlan = strictCandidatePlan(candidatePlan, snapshot);
  const candidateHasMore = candidateOffset + selectedGroups.length < candidateSelection.groups.length;
  const nextCandidateCursor = candidateHasMore
    ? encodeCursor(candidateOffset + selectedGroups.length, candidateChecksum)
    : null;
  const audit = [
    ...sourceSelection.rejected,
    ...gapPlan.summary.fields,
    ...candidatePlan.audit
  ];
  const nextGapCursor = gapPlan.cursor.next;
  const hasMore = Boolean(nextGapCursor || nextCandidateCursor);
  return {
    schemaVersion: 1,
    dryRun: true,
    matchingPolicy: 'provider-id-only',
    fillPolicy: 'blank-fields-only',
    batch: {
      limit,
      gapSelected: gapPlan.sourceRecords.selected,
      candidateSelected: selectedGroups.length,
      candidateProviderIds: selectedProviderIds
    },
    cursor: {
      input: cursor,
      next: {
        gap: nextGapCursor,
        candidate: nextCandidateCursor
      },
      hasMore,
      candidate: {
        input: cursorValue(cursor, 'candidate'),
        offset: candidateOffset,
        next: nextCandidateCursor,
        hasMore: candidateHasMore,
        checksum: candidateChecksum
      }
    },
    summary: {
      sourceRecords: rawSources.length,
      sourceRecordsRejected: sourceSelection.rejected.length,
      gapPatches: gapPlan.patchCounts.total,
      candidateRows: candidatePlan.candidates.length,
      auditedRows: audit.length,
      candidateFetchFailed: candidatePlan.summary.fetchFailed || 0,
      hasMore
    },
    gapPlan,
    candidatePlan,
    audit,
    provenance: {
      generatedAt: observedAt || new Date().toISOString(),
      source: 'pokemon-gap-sync + tcgdex-zh-tw',
      writesPerformed: false,
      productionDatabase: 'not-contacted'
    }
  };
}

export const createPokemonEnrichmentWorkflow = planPokemonEnrichmentWorkflow;
