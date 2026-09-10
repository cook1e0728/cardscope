import { createHash } from 'node:crypto';

// This module is intentionally a planner, not a writer.  It accepts rows that
// have already been read by the caller and returns dry-run patch envelopes.
// Keeping the read/match/plan boundary here means a scheduled job can apply
// the same plan in bounded batches without ever guessing a card identity.

export const DEFAULT_APPROVED_PROVIDERS = Object.freeze([
  'pokemontcg',
  'tcgdex',
  'tcgdex-zh-tw'
]);

export const DEFAULT_BATCH_SIZE = 100;
export const MAX_BATCH_SIZE = 250;
export const ZH_TW_LOCALE = 'zh-Hant-TW';

const PROVIDER_ALIASES = new Map([
  ['pokemon-tcg', 'pokemontcg'],
  ['pokemon-tcg-data', 'pokemontcg'],
  ['pokemontcg', 'pokemontcg'],
  ['tcgdex', 'tcgdex'],
  ['tcgdex-zh-tw', 'tcgdex-zh-tw'],
  ['tcgdex_zh_tw', 'tcgdex-zh-tw'],
  ['tcgdex-zh-hant-tw', 'tcgdex-zh-tw']
]);

const clean = value => value == null ? null : String(value).trim() || null;
const hasValue = value => {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return true;
};
const firstValue = (...values) => values.find(hasValue) ?? null;
const asArray = value => Array.isArray(value) ? value : value instanceof Set ? [...value] : value && typeof value[Symbol.iterator] === 'function' ? [...value] : [];

function canonicalProvider(value) {
  const normalized = clean(value)?.toLocaleLowerCase().replace(/\s+/g, '-');
  return normalized ? PROVIDER_ALIASES.get(normalized) || normalized : null;
}

// Local keys are deliberately conservative: case and insignificant whitespace
// are normalized, but separators such as '-' and '/' are retained.  No name,
// alias, image URL, or fuzzy similarity participates in identity matching.
export function normalizeExactPart(value) {
  return clean(value)?.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '') || null;
}

export function makeLocalKey(setCode, cardNumber) {
  const set = normalizeExactPart(setCode);
  const number = normalizeExactPart(cardNumber);
  return set && number ? `${set}|${number}` : null;
}

function cardId(row) {
  return clean(row?.id ?? row?.card_id);
}

function printingId(row) {
  return clean(row?.id ?? row?.printing_id) || `${rowProvider(row) || 'unknown'}|${rowProviderId(row) || makeLocalKey(row?.local_set_code, row?.local_card_number) || ''}`;
}

function printingCardId(row) {
  return clean(row?.card_id ?? row?.cardId) || cardId(row);
}

function rowProvider(row) {
  return canonicalProvider(row?.provider ?? row?.source);
}

function rowProviderId(row) {
  return clean(row?.providerId ?? row?.provider_id);
}

function rowMetadata(row) {
  return row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function rowSetNumberPairs(row) {
  const metadata = rowMetadata(row);
  const pairs = [
    [row?.local_set_code, row?.local_card_number],
    [row?.localSetCode, row?.localCardNumber],
    [row?.set_code, row?.card_number],
    [row?.setCode, row?.cardNumber],
    [row?.official_set_code, row?.official_card_number],
    [row?.officialSetCode, row?.officialCardNumber],
    [metadata.localSetCode, metadata.localCardNumber],
    [metadata.setCode, metadata.cardNumber],
    [metadata.setId, row?.official_card_number]
  ];
  return pairs.map(([setCode, number]) => makeLocalKey(setCode, number)).filter(Boolean);
}

function rowZhName(row) {
  return firstValue(row?.name_zh, row?.nameZh, row?.chinese_name, row?.chineseName);
}

function rowRarity(row) {
  return firstValue(row?.rarity, row?.rarity_code, row?.rarityCode);
}

function rowImage(row) {
  return firstValue(row?.image_url, row?.imageUrl);
}

function normalizeDataStatus(value) {
  const status = clean(value)?.toLocaleLowerCase();
  return ['verified', 'pending', 'incomplete'].includes(status) ? status : 'pending';
}

function normalizeImageUrl(record) {
  const images = record?.images && typeof record.images === 'object' ? record.images : {};
  const image = record?.image && typeof record.image === 'object' ? record.image : {};
  const direct = firstValue(
    record?.imageUrl,
    record?.image_url,
    record?.imageURL,
    image.low,
    image.small,
    image.url,
    images.small,
    images.large,
    images.low
  );
  if (direct) return direct;
  const base = typeof record?.image === 'string' ? clean(record.image) : null;
  if (!base) return null;
  return /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(base)
    ? base
    : `${base.replace(/\/$/, '')}/low.webp`;
}

function normalizeSourceRecord(input, index, approvedProviders) {
  const source = input && typeof input === 'object' ? input : {};
  const provider = canonicalProvider(source.provider ?? source.source);
  const sourceUrl = clean(source.sourceUrl ?? source.source_url ?? source.url);
  const sourcePolicy = clean(source.sourcePolicy ?? source.source_policy ?? source.policy)?.toLocaleLowerCase();
  if (!provider || !approvedProviders.has(provider) || source.approved === false || ['blocked', 'disallowed', 'not-approved'].includes(sourcePolicy)) {
    return {
      invalid: true,
      index,
      sortKey: `invalid:${index}`,
      reason: 'source-not-approved',
      provider,
      sourceUrl
    };
  }

  const providerId = clean(source.providerId ?? source.provider_id ?? source.cardId ?? source.card_id ?? source.id);
  const setCode = firstValue(
    source.setCode,
    source.set_code,
    source.localSetCode,
    source.local_set_code,
    source.setId,
    source.set_id,
    source.set?.id,
    source.set?.code
  );
  const cardNumber = firstValue(
    source.cardNumber,
    source.card_number,
    source.localCardNumber,
    source.local_card_number,
    source.localId,
    source.officialCardNumber,
    source.official_card_number,
    source.number
  );
  const localKey = makeLocalKey(setCode, cardNumber);
  if (!providerId && !localKey) {
    return {
      invalid: true,
      index,
      sortKey: `invalid:${index}`,
      reason: 'missing-stable-key',
      provider,
      sourceUrl
    };
  }

  const sourceLocale = clean(source.locale)?.toLocaleLowerCase().replace(/_/g, '-');
  const isZhSource = provider === 'tcgdex-zh-tw' || sourceLocale === 'zh-tw' || sourceLocale?.startsWith('zh-hant');
  const nameZh = firstValue(
    source.nameZh,
    source.name_zh,
    source.chineseName,
    source.chinese_name,
    isZhSource ? source.name : null
  );
  const nameEn = firstValue(
    source.nameEn,
    source.name_en,
    source.englishName,
    source.english_name,
    provider === 'pokemontcg' ? source.name : null
  );
  const rarityCode = firstValue(source.rarityCode, source.rarity_code, source.rarity?.code, source.rarity);
  const rarityLabel = firstValue(source.rarityLabel, source.rarity_label, source.rarity?.label, source.rarity?.name, source.rarity);
  const record = {
    provider,
    providerId,
    setCode: clean(setCode),
    cardNumber: clean(cardNumber),
    localKey,
    nameZh,
    nameEn,
    rarityCode,
    rarityLabel,
    imageUrl: normalizeImageUrl(source),
    sourceUrl,
    locale: isZhSource ? ZH_TW_LOCALE : (clean(source.locale) || 'en-US'),
    dataStatus: normalizeDataStatus(source.dataStatus ?? source.data_status)
  };
  const stableKey = providerId ? `id:${normalizeExactPart(providerId)}` : `local:${localKey}`;
  return {
    ...record,
    invalid: false,
    index,
    stableKey,
    sortKey: `${provider}|${stableKey}|${stableStringify(record)}`
  };
}

function addIndex(index, key, value) {
  if (!key || !value) return;
  const values = index.get(key) || new Set();
  values.add(value);
  index.set(key, values);
}

function addRowIndexes(indexes, row, targetCardId = cardId(row)) {
  if (!targetCardId) return;
  const provider = rowProvider(row);
  const providerId = rowProviderId(row);
  if (provider && providerId) addIndex(indexes.provider, `${provider}|${normalizeExactPart(providerId)}`, targetCardId);
  for (const key of rowSetNumberPairs(row)) addIndex(indexes.local, key, targetCardId);
}

function buildIndexes(cards, printings) {
  const cardIndexes = { provider: new Map(), local: new Map() };
  const printingIndexes = { provider: new Map(), local: new Map() };
  for (const card of cards) addRowIndexes(cardIndexes, card);
  for (const printing of printings) {
    const printingKey = printingId(printing);
    const target = printingCardId(printing);
    if (target) {
      addRowIndexes(cardIndexes, printing, target);
      addRowIndexes(printingIndexes, printing, printingKey);
    }
  }
  return { cardIndexes, printingIndexes };
}

function unique(values) {
  return [...new Set(values)];
}

function candidatesFor(indexes, source) {
  const byProvider = source.providerId
    ? [...(indexes.provider.get(`${source.provider}|${normalizeExactPart(source.providerId)}`) || [])]
    : [];
  const byLocal = source.localKey ? [...(indexes.local.get(source.localKey) || [])] : [];
  return { byProvider, byLocal };
}

function resolveExact(indexes, source) {
  const { byProvider, byLocal } = candidatesFor(indexes, source);
  if (byProvider.length > 1) return { matched: false, reason: 'ambiguous-provider-id', candidates: byProvider };
  if (byProvider.length && byLocal.length && !byLocal.includes(byProvider[0])) {
    return { matched: false, reason: 'provider-local-conflict', candidates: unique([...byProvider, ...byLocal]) };
  }
  if (!byProvider.length && byLocal.length > 1) return { matched: false, reason: 'ambiguous-local-set-number', candidates: byLocal };
  const resolved = byProvider[0] || byLocal[0];
  return resolved
    ? { matched: true, id: resolved, matchType: byProvider.length ? 'provider-id' : 'local-set-number' }
    : { matched: false, reason: 'no-exact-match', candidates: [] };
}

function addProposal(map, targetId, field, value, source) {
  if (!hasValue(value)) return;
  const target = map.get(targetId) || new Map();
  const values = target.get(field) || [];
  if (!values.some(item => item.value === value)) values.push({ value, source });
  target.set(field, values);
  map.set(targetId, target);
}

function proposalFields(map, targetId) {
  const result = {};
  const conflicts = [];
  for (const [field, values] of map.get(targetId) || []) {
    if (values.length > 1) {
      conflicts.push({ field, values: values.map(item => item.value), sources: values.map(item => item.source) });
      continue;
    }
    result[field] = values[0].value;
  }
  return { result, conflicts };
}

function cardNameIndex(cardNames) {
  const index = new Map();
  for (const row of cardNames) {
    const id = cardId(row);
    const locale = clean(row?.locale);
    const type = clean(row?.name_type ?? row?.nameType) || 'official';
    if (id && locale) index.set(`${id}|${locale}|${type}`, row);
  }
  return index;
}

function cardNameCovered(index, id, locale = ZH_TW_LOCALE, type = 'official') {
  return hasValue(index.get(`${id}|${locale}|${type}`)?.name);
}

function coverageSnapshot(cards, printings, cardNames) {
  const names = cardNameIndex(cardNames);
  const totalCards = cards.length;
  const totalPrintings = printings.length;
  const chineseCardIds = new Set(cards.filter(row => hasValue(rowZhName(row))).map(cardId).filter(Boolean));
  const uniqueCardIds = new Set(cards.map(cardId).filter(Boolean));
  const chineseNameIds = new Set(cardNames.filter(row => clean(row?.locale) === ZH_TW_LOCALE && hasValue(row?.name)).map(cardId).filter(id => uniqueCardIds.has(id)));
  const rarityCardIds = new Set(cards.filter(row => hasValue(rowRarity(row))).map(cardId).filter(Boolean));
  const rarityPrintingIds = new Set(printings.filter(row => hasValue(row?.rarity ?? row?.rarity_code ?? row?.rarityCode)).map(printingId).filter(Boolean));
  const imagePrintingIds = new Set(printings.filter(row => hasValue(rowImage(row))).map(printingId).filter(Boolean));
  const chineseCovered = new Set([...chineseCardIds, ...chineseNameIds].filter(id => uniqueCardIds.has(id)));
  const cardRarityCovered = [...rarityCardIds].filter(Boolean).length;
  const cardNameRows = [...names.values()].filter(row => clean(row?.locale) === ZH_TW_LOCALE && hasValue(row?.name)).length;
  return {
    cards: {
      total: totalCards,
      chineseNames: { covered: chineseCovered.size, missing: Math.max(0, totalCards - chineseCovered.size) },
      chineseNameFields: { covered: chineseCardIds.size, missing: Math.max(0, totalCards - chineseCardIds.size) },
      rarity: { covered: cardRarityCovered, missing: Math.max(0, totalCards - cardRarityCovered) }
    },
    printings: {
      total: totalPrintings,
      displayableImages: { covered: imagePrintingIds.size, missing: Math.max(0, totalPrintings - imagePrintingIds.size) },
      rarity: { covered: rarityPrintingIds.size, missing: Math.max(0, totalPrintings - rarityPrintingIds.size) }
    },
    cardNames: {
      total: cardNames.length,
      zhOfficialRows: cardNameRows,
      cardsWithZhOfficialName: chineseNameIds.size,
      missingCardsWithZhOfficialName: Math.max(0, totalCards - chineseNameIds.size)
    }
  };
}

function gapCounts(snapshot) {
  return {
    chineseNames: snapshot.cards.chineseNames.missing,
    cardChineseNameFields: snapshot.cards.chineseNameFields.missing,
    rarities: snapshot.cards.rarity.missing,
    printingRarities: snapshot.printings.rarity.missing,
    displayableImages: snapshot.printings.displayableImages.missing,
    officialChineseNameRows: snapshot.cardNames.missingCardsWithZhOfficialName
  };
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sourceChecksum(records) {
  const normalized = records.map((record, index) => {
    const result = normalizeSourceRecord(record, index, new Set(DEFAULT_APPROVED_PROVIDERS));
    return result.invalid
      ? { invalid: true, reason: result.reason, source: result.provider, sourceUrl: result.sourceUrl, raw: record }
      : result;
  }).sort((left, right) => `${left.sortKey || ''}`.localeCompare(`${right.sortKey || ''}`));
  return createHash('sha256').update(stableStringify(normalized)).digest('hex');
}

function encodeCursor(offset, checksum) {
  return Buffer.from(JSON.stringify({ offset, checksum }), 'utf8').toString('base64url');
}

function decodeCursor(value, checksum, total) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (parsed.checksum !== checksum || !Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > total) {
      throw new Error('invalid');
    }
    return parsed.offset;
  } catch {
    throw new Error('INVALID_POKEMON_GAP_CURSOR');
  }
}

function normalizeBatchSize(value) {
  const numeric = Number(value ?? DEFAULT_BATCH_SIZE);
  if (!Number.isInteger(numeric) || numeric < 1) throw new Error('INVALID_POKEMON_GAP_BATCH_SIZE');
  return Math.min(numeric, MAX_BATCH_SIZE);
}

function printingForSource(printings, source, cardTargetId) {
  const matching = printings.filter(row => printingCardId(row) === cardTargetId);
  const indexes = { provider: new Map(), local: new Map() };
  const ids = new Map();
  for (const row of matching) {
    const id = printingId(row);
    addRowIndexes(indexes, row, id);
    ids.set(id, row);
  }
  const resolved = resolveExact(indexes, source);
  return resolved.matched ? { ...resolved, row: ids.get(resolved.id), id: resolved.id } : resolved;
}

function patchEnvelope(table, target, patch, source, matchType, reason) {
  return {
    table,
    key: target,
    id: target,
    patch,
    matchType,
    reason,
    provenance: {
      provider: source.provider,
      providerId: source.providerId,
      setCode: source.setCode,
      cardNumber: source.cardNumber,
      sourceUrl: source.sourceUrl,
      imageRights: 'not-inferred'
    }
  };
}

function projectRows(rows, patches) {
  const byId = new Map(patches.map(item => [item.id, item.patch]));
  return rows.map(row => {
    const id = cardId(row);
    const patch = byId.get(id);
    return patch ? { ...row, ...patch } : row;
  });
}

function projectNameRows(rows, patches) {
  const projected = [...rows];
  for (const item of patches) {
    const existing = projected.find(row => cardId(row) === item.patch.card_id && clean(row.locale) === item.patch.locale && (clean(row.name_type ?? row.nameType) || 'official') === item.patch.name_type);
    if (existing) Object.assign(existing, item.patch);
    else projected.push(item.patch);
  }
  return projected;
}

function rejectFromSource(source, reason, extra = {}) {
  return {
    reason,
    provider: source.provider || null,
    providerId: source.providerId || null,
    setCode: source.setCode || null,
    cardNumber: source.cardNumber || null,
    ...extra
  };
}

/**
 * Build a deterministic, dry-run enrichment plan for existing Pokémon rows.
 *
 * Inputs are read-only snapshots.  `sourceRecords` may contain approved
 * PokemonTCG or TCGdex records in either API-shaped or normalized field names.
 * The return value is an audit-friendly plan; callers must explicitly apply
 * each `patch` envelope after review and any required policy checks.
 */
export function createPokemonGapPlan({
  cards = [],
  printings = [],
  cardNames = [],
  sourceRecords = [],
  approvedProviders = DEFAULT_APPROVED_PROVIDERS,
  batchSize = DEFAULT_BATCH_SIZE,
  cursor = null
} = {}) {
  if (!Array.isArray(cards) || !Array.isArray(printings) || !Array.isArray(cardNames) || !Array.isArray(sourceRecords)) {
    throw new Error('INVALID_POKEMON_GAP_INPUT');
  }
  const approved = new Set(asArray(approvedProviders).map(canonicalProvider).filter(Boolean));
  const normalizedRecords = sourceRecords.map((record, index) => normalizeSourceRecord(record, index, approved));
  const uniqueRecords = new Map();
  for (const record of normalizedRecords) {
    const key = stableStringify(record);
    if (!uniqueRecords.has(key)) uniqueRecords.set(key, record);
  }
  const records = [...uniqueRecords.values()].sort((left, right) => `${left.sortKey || ''}`.localeCompare(`${right.sortKey || ''}`));
  const checksum = createHash('sha256').update(stableStringify(records)).digest('hex');
  const offset = decodeCursor(cursor, checksum, records.length);
  const limit = normalizeBatchSize(batchSize);
  const selected = records.slice(offset, offset + limit);
  const { cardIndexes } = buildIndexes(cards, printings);
  const cardNameRows = cardNameIndex(cardNames);
  const cardProposals = new Map();
  const printingProposals = new Map();
  const nameProposals = new Map();
  const rejected = [];
  const matches = [];

  for (const source of selected) {
    if (source.invalid) {
      rejected.push(rejectFromSource(source, source.reason));
      continue;
    }
    const cardResolution = resolveExact(cardIndexes, source);
    if (!cardResolution.matched) {
      rejected.push(rejectFromSource(source, cardResolution.reason, { candidates: cardResolution.candidates }));
      continue;
    }
    const targetCard = cards.find(row => cardId(row) === cardResolution.id);
    if (!targetCard) {
      rejected.push(rejectFromSource(source, 'matched-card-not-present', { cardId: cardResolution.id }));
      continue;
    }
    matches.push({ source: source.stableKey, cardId: cardResolution.id, matchType: cardResolution.matchType });

    if (!hasValue(targetCard.name_zh) && source.nameZh) addProposal(cardProposals, cardResolution.id, 'name_zh', source.nameZh, source);
    if (!hasValue(targetCard.rarity) && source.rarityCode) addProposal(cardProposals, cardResolution.id, 'rarity', source.rarityCode, source);
    if (!hasValue(targetCard.name_en) && source.nameEn) addProposal(cardProposals, cardResolution.id, 'name_en', source.nameEn, source);

    const printingResolution = printingForSource(printings, source, cardResolution.id);
    if (printingResolution.matched && printingResolution.row) {
      const printing = printingResolution.row;
      if (!hasValue(printing.image_url) && source.imageUrl) addProposal(printingProposals, printingResolution.id, 'image_url', source.imageUrl, source);
      if (!hasValue(printing.rarity) && source.rarityCode) addProposal(printingProposals, printingResolution.id, 'rarity', source.rarityCode, source);
      if (!hasValue(printing.rarity_code) && source.rarityCode) addProposal(printingProposals, printingResolution.id, 'rarity_code', source.rarityCode, source);
      if (!hasValue(printing.rarity_label) && source.rarityLabel) addProposal(printingProposals, printingResolution.id, 'rarity_label', source.rarityLabel, source);
    } else if (source.imageUrl || source.rarityCode) {
      rejected.push(rejectFromSource(source, printingResolution.reason || 'printing-not-found', { cardId: cardResolution.id, candidates: printingResolution.candidates }));
    }

    if (source.nameZh && !cardNameCovered(cardNameRows, cardResolution.id)) {
      const key = `${cardResolution.id}|${ZH_TW_LOCALE}|official`;
      const namePatch = {
        card_id: cardResolution.id,
        locale: ZH_TW_LOCALE,
        name: source.nameZh,
        name_type: 'official',
        source: source.provider,
        source_url: source.sourceUrl,
        data_status: source.dataStatus,
        metadata: {
          enrichment: 'pokemon-gap-sync',
          providerId: source.providerId,
          setCode: source.setCode,
          cardNumber: source.cardNumber,
          imageRights: 'not-inferred'
        }
      };
      const existing = nameProposals.get(key);
      if (existing && existing.name !== namePatch.name) {
        rejected.push(rejectFromSource(source, 'conflicting-source-values', { cardId: cardResolution.id, field: 'tcg_card_names.name', values: [existing.name, namePatch.name] }));
      } else {
        nameProposals.set(key, namePatch);
      }
    }
  }

  const cardsPatches = [];
  for (const [id] of cardProposals) {
    const { result, conflicts } = proposalFields(cardProposals, id);
    for (const conflict of conflicts) rejected.push(rejectFromSource(conflict.sources[0], 'conflicting-source-values', { cardId: id, field: `tcg_cards.${conflict.field}`, values: conflict.values }));
    const firstSource = [...cardProposals.get(id).values()][0]?.[0]?.source || {};
    if (Object.keys(result).length) cardsPatches.push(patchEnvelope('tcg_cards', id, result, firstSource, matches.find(item => item.cardId === id)?.matchType || 'exact', 'fill-missing-only'));
  }

  const printingsPatches = [];
  for (const [id] of printingProposals) {
    const { result, conflicts } = proposalFields(printingProposals, id);
    for (const conflict of conflicts) rejected.push(rejectFromSource(conflict.sources[0], 'conflicting-source-values', { printingId: id, field: `tcg_printings.${conflict.field}`, values: conflict.values }));
    const firstSource = [...printingProposals.get(id).values()][0]?.[0]?.source || {};
    if (Object.keys(result).length) printingsPatches.push(patchEnvelope('tcg_printings', id, result, firstSource, 'exact', 'fill-missing-only'));
  }

  const namesPatches = [...nameProposals.values()].map(patch => ({
    table: 'tcg_card_names',
    key: `${patch.card_id}|${patch.locale}|${patch.name_type}`,
    id: `${patch.card_id}|${patch.locale}|${patch.name_type}`,
    patch,
    matchType: matches.find(item => item.cardId === patch.card_id)?.matchType || 'exact',
    reason: 'insert-missing-only',
    provenance: {
      provider: patch.source,
      sourceUrl: patch.source_url,
      imageRights: 'not-inferred'
    }
  }));

  const projectedCards = projectRows(cards, cardsPatches);
  const projectedPrintings = projectRows(printings, printingsPatches);
  const projectedNames = projectNameRows(cardNames, namesPatches);
  const before = coverageSnapshot(cards, printings, cardNames);
  const after = coverageSnapshot(projectedCards, projectedPrintings, projectedNames);
  const nextOffset = offset + selected.length;
  const hasMore = nextOffset < records.length;
  const nextCursor = hasMore ? encodeCursor(nextOffset, checksum) : null;
  const patchCounts = {
    tcg_cards: cardsPatches.length,
    tcg_printings: printingsPatches.length,
    tcg_card_names: namesPatches.length,
    total: cardsPatches.length + printingsPatches.length + namesPatches.length
  };

  return {
    dryRun: true,
    provider: 'pokemon-gap-sync',
    sourceProviders: [...approved].sort(),
    sourceRecords: { inputTotal: sourceRecords.length, total: records.length, selected: selected.length, checksum },
    cursor: {
      input: cursor,
      offset,
      next: nextCursor,
      nextOffset,
      limit,
      hasMore,
      checksum
    },
    matches,
    rejected,
    patches: {
      tcg_cards: cardsPatches,
      tcg_printings: printingsPatches,
      tcg_card_names: namesPatches
    },
    patchCounts,
    coverage: {
      scope: 'current-batch-projection',
      before,
      after,
      delta: {
        gaps: Object.fromEntries(Object.entries(gapCounts(before)).map(([key, value]) => [key, value - gapCounts(after)[key]])),
        covered: {
          cardsChineseNames: after.cards.chineseNames.covered - before.cards.chineseNames.covered,
          cardChineseNameFields: after.cards.chineseNameFields.covered - before.cards.chineseNameFields.covered,
          cardRarities: after.cards.rarity.covered - before.cards.rarity.covered,
          printingRarities: after.printings.rarity.covered - before.printings.rarity.covered,
          displayableImages: after.printings.displayableImages.covered - before.printings.displayableImages.covered,
          officialChineseNameRows: after.cardNames.zhOfficialRows - before.cardNames.zhOfficialRows
        }
      },
      gapCounts: { before: gapCounts(before), after: gapCounts(after) }
    }
  };
}

export const planPokemonGapSync = createPokemonGapPlan;
