import { createHash } from 'node:crypto';
import { normalizeRarityValue } from './normalize.mjs';

/**
 * Bounded, read-only TCGdex enrichment planning.
 *
 * This module deliberately owns only source fetching and candidate-row
 * generation. It never opens a database connection and never writes a file.
 * The caller supplies a snapshot of the current catalog and may persist the
 * returned rows in `catalog_enrichment_candidates` after an independent
 * review.
 */

export const POKEMON_GAME_ID = 'pokemon';
export const TCGDEX_PROVIDER = 'tcgdex-zh-tw';
export const TCGDEX_LOCALE = 'zh-Hant-TW';
export const TCGDEX_API_BASE = 'https://api.tcgdex.net/v2/zh-tw/cards';
export const TCGDEX_SOURCE_BASE = 'https://www.tcgdex.net/database/cards';
export const DEFAULT_BATCH_SIZE = 100;
export const MAX_BATCH_SIZE = 100;
export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 8;

// `rarity` is intentionally the only default request. Names are opt-in and
// images are opt-in twice: the caller must request image_url and set the
// explicit includeImages flag.
export const DEFAULT_REQUESTED_FIELDS = Object.freeze(['rarity']);
export const CANDIDATE_FIELDS = Object.freeze([
  'name_zh',
  'rarity_code',
  'rarity_label',
  'image_url'
]);

const TCGDEX_PROVIDER_ALIASES = new Set([
  'tcgdex',
  'tcgdex-zh-tw',
  'tcgdex_zh_tw',
  'tcgdex-zh-hant-tw'
]);

const FIELD_ALIASES = new Map([
  ['name_zh', 'name_zh'],
  ['name-zh', 'name_zh'],
  ['traditional-chinese-name', 'name_zh'],
  ['traditional_chinese_name', 'name_zh'],
  ['chinese-name', 'name_zh'],
  ['chinese_name', 'name_zh'],
  ['rarity', 'rarity'],
  ['rarity_code', 'rarity_code'],
  ['rarity-code', 'rarity_code'],
  ['rarity_label', 'rarity_label'],
  ['rarity-label', 'rarity_label'],
  ['image', 'image_url'],
  ['image_url', 'image_url'],
  ['image-url', 'image_url']
]);

const clean = value => value == null ? null : String(value).trim() || null;
const hasValue = value => {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  return true;
};
const firstValue = (...values) => values.find(hasValue) ?? null;
const asArray = value => Array.isArray(value) ? value : value == null ? [] : [value];

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Stable JSON is used for payload hashes and output ordering. */
export function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sha256Payload(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeProvider(value) {
  const normalized = clean(value)?.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '-');
  return normalized || null;
}

function isTcgdexProvider(row) {
  const provider = normalizeProvider(row?.provider ?? row?.source ?? row?.runtimeProvider);
  return Boolean(provider && TCGDEX_PROVIDER_ALIASES.has(provider));
}

function rowValue(row, ...keys) {
  if (!row || typeof row !== 'object') return null;
  return firstValue(...keys.map(key => row[key]));
}

function providerIdFor(row) {
  return clean(rowValue(row, 'providerId', 'provider_id', 'providerCardId', 'provider_card_id'));
}

function rowId(row) {
  return clean(rowValue(row, 'id', 'cardId', 'card_id', 'printingId', 'printing_id'));
}

function cardIdFor(row) {
  return clean(rowValue(row, 'id', 'cardId', 'card_id'));
}

function printingIdFor(row) {
  return clean(rowValue(row, 'id', 'printingId', 'printing_id'));
}

function canonicalIdFor(row) {
  return clean(rowValue(row, 'canonicalId', 'canonical_id'));
}

function setCodeFor(row) {
  const set = objectOrEmpty(row?.set);
  const metadata = objectOrEmpty(row?.metadata);
  return clean(firstValue(
    rowValue(row, 'localSetCode', 'local_set_code', 'setCode', 'set_code', 'officialSetCode', 'official_set_code'),
    rowValue(metadata, 'setCode', 'set_code', 'setId', 'set_id'),
    rowValue(set, 'id', 'code')
  ));
}

function cardNumberFor(row) {
  const metadata = objectOrEmpty(row?.metadata);
  return clean(firstValue(
    rowValue(row, 'localCardNumber', 'local_card_number', 'cardNumber', 'card_number', 'officialCardNumber', 'official_card_number', 'localId', 'number'),
    rowValue(metadata, 'cardNumber', 'card_number', 'localId', 'local_id')
  ));
}

export function normalizeExactPart(value) {
  return clean(value)?.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '') || null;
}

export function makeLocalKey(setCode, cardNumber) {
  const set = normalizeExactPart(setCode);
  const number = normalizeExactPart(cardNumber);
  return set && number ? `${set}|${number}` : null;
}

function localeFor(row) {
  return clean(rowValue(row, 'locale', 'language', 'sourceLocale', 'source_locale'))?.toLocaleLowerCase().replaceAll('_', '-') || null;
}

function isTargetLocale(value) {
  return ['zh-hant-tw', 'zh-hant', 'zh-tw'].includes(String(value || '').toLocaleLowerCase().replaceAll('_', '-'));
}

function nameTypeFor(row) {
  return clean(rowValue(row, 'nameType', 'name_type')) || 'official';
}

function nameFor(row) {
  return clean(rowValue(row, 'name', 'nameZh', 'name_zh', 'chineseName', 'chinese_name'));
}

function rarityCodeFor(row) {
  return clean(rowValue(row, 'rarityCode', 'rarity_code'));
}

function rarityLabelFor(row) {
  return clean(rowValue(row, 'rarityLabel', 'rarity_label'));
}

function rarityRawFor(row) {
  return rowValue(row, 'rarity');
}

function imageFor(row) {
  return clean(rowValue(row, 'imageUrl', 'image_url'));
}

function missing(value) {
  return !hasValue(value);
}

function normalizeFieldValue(value) {
  const normalized = clean(value)?.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '-');
  return normalized ? FIELD_ALIASES.get(normalized) || null : null;
}

/**
 * Normalize logical requested fields. `rarity` expands to one canonical-code
 * promotion candidate. The source label remains in evidence so aliases such
 * as `Common` never create a second public rarity group beside canonical `C`.
 */
export function normalizeRequestedFields(fields, { includeImages = false } = {}) {
  const raw = fields == null ? [...DEFAULT_REQUESTED_FIELDS] : typeof fields === 'string' ? fields.split(',') : asArray(fields);
  const logical = [];
  for (const field of raw) {
    const normalized = normalizeFieldValue(field);
    if (!normalized) throw new Error(`INVALID_ENRICHMENT_FIELD:${field}`);
    if (!logical.includes(normalized)) logical.push(normalized);
  }
  const explicitlyRequestedImage = logical.includes('image_url');
  if (explicitlyRequestedImage && includeImages !== true) throw new Error('IMAGE_OPT_IN_REQUIRED');
  if (includeImages === true && !explicitlyRequestedImage) logical.push('image_url');
  const candidateFields = [];
  for (const field of logical) {
    const expanded = field === 'rarity' ? ['rarity_code'] : [field];
    for (const candidateField of expanded) if (!candidateFields.includes(candidateField)) candidateFields.push(candidateField);
  }
  return { logical, candidateFields };
}

function sourceRecordUrl(providerId) {
  return `${TCGDEX_SOURCE_BASE}/${encodeURIComponent(providerId)}`;
}

function normalizeTimestamp(value) {
  const cleanValue = clean(value);
  if (!cleanValue) return null;
  const time = Date.parse(cleanValue);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function payloadUpdatedAt(payload) {
  const metadata = objectOrEmpty(payload?.metadata);
  return normalizeTimestamp(firstValue(
    payload?.updatedAt,
    payload?.updated_at,
    payload?.lastUpdatedAt,
    payload?.last_updated_at,
    payload?.modifiedAt,
    payload?.modified_at,
    metadata.updatedAt,
    metadata.updated_at
  ));
}

function normalizeImageUrl(payload) {
  const image = objectOrEmpty(payload?.image);
  const images = objectOrEmpty(payload?.images);
  const direct = clean(firstValue(
    payload?.imageUrl,
    payload?.image_url,
    image.low,
    image.small,
    image.url,
    images.low,
    images.small,
    images.large
  ));
  if (direct) return direct;
  const base = typeof payload?.image === 'string' ? clean(payload.image) : null;
  if (!base) return null;
  return /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(base)
    ? base
    : `${base.replace(/\/$/, '')}/low.webp`;
}

function normalizeRarity(payload) {
  const raw = payload?.rarity;
  const rarity = objectOrEmpty(raw);
  const code = clean(firstValue(
    payload?.rarityCode,
    payload?.rarity_code,
    rarity.code,
    rarity.id,
    typeof raw === 'string' ? raw : null
  ));
  const label = clean(firstValue(
    payload?.rarityLabel,
    payload?.rarity_label,
    rarity.label,
    rarity.name,
    rarity.code,
    typeof raw === 'string' ? raw : null
  ));
  return { code, label };
}

function normalizeTcgdexPayload(body, requestedProviderId) {
  const raw = body && typeof body === 'object' && body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? body.data
    : objectOrEmpty(body);
  const providerId = clean(firstValue(raw.id, raw.providerId, raw.provider_id, requestedProviderId));
  const set = objectOrEmpty(raw.set);
  const metadata = objectOrEmpty(raw.metadata);
  const setCode = clean(firstValue(raw.setId, raw.set_id, raw.setCode, raw.set_code, set.id, set.code, metadata.setId, metadata.setCode));
  const cardNumber = clean(firstValue(raw.localId, raw.local_id, raw.cardNumber, raw.card_number, raw.number, metadata.localId, metadata.cardNumber));
  const rarity = normalizeRarity(raw);
  return {
    providerId,
    setCode,
    cardNumber,
    localKey: makeLocalKey(setCode, cardNumber),
    nameZh: clean(firstValue(raw.nameZh, raw.name_zh, raw.chineseName, raw.chinese_name, raw.name)),
    rarityCode: rarity.code,
    rarityLabel: rarity.label,
    imageUrl: normalizeImageUrl(raw),
    sourceUrl: clean(firstValue(raw.sourceUrl, raw.source_url, raw.url)) || sourceRecordUrl(providerId || requestedProviderId),
    updatedAt: payloadUpdatedAt(raw),
    payload: raw
  };
}

function targetKey(target) {
  return `${target.kind}:${target.id}`;
}

function sourceIdKey(value) {
  return normalizeExactPart(value) || '';
}

function addTarget(map, target) {
  const key = sourceIdKey(target.providerId);
  if (!key) return;
  const group = map.get(key) || { providerId: target.providerId, targets: [] };
  const existing = group.targets.find(item => targetKey(item) === targetKey(target));
  if (existing) {
    for (const field of target.needs) if (!existing.needs.includes(field)) existing.needs.push(field);
  } else group.targets.push(target);
  map.set(key, group);
}

function buildCardNameCoverage(cardNames) {
  const covered = new Set();
  for (const row of cardNames) {
    const cardId = cardIdFor(row);
    if (!cardId || !isTargetLocale(localeFor(row)) || nameTypeFor(row) !== 'official' || !nameFor(row)) continue;
    covered.add(cardId);
  }
  return covered;
}

/**
 * Select only existing TCGdex targets with requested fields missing. This is
 * pure and performs no network work.
 */
export function selectPokemonEnrichmentTargets(snapshot = {}, options = {}) {
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
  const printings = Array.isArray(snapshot.printings) ? snapshot.printings : [];
  const cardNames = Array.isArray(snapshot.cardNames) ? snapshot.cardNames : [];
  const { logical, candidateFields } = normalizeRequestedFields(options.fields ?? options.requestedFields, options);
  const nameCoverage = buildCardNameCoverage(cardNames);
  const canonicalByCardId = new Map(cards.map(row => [cardIdFor(row), canonicalIdFor(row)]).filter(([id]) => id));
  const gameByCardId = new Map(cards.map(row => [cardIdFor(row), clean(rowValue(row, 'gameId', 'game_id'))]).filter(([id]) => id));
  const byProviderId = new Map();
  const skipped = [];
  const addRowTarget = (row, kind, id, needs) => {
    if (!isTcgdexProvider(row)) {
      skipped.push({ kind, id, reason: 'source-not-tcgdex' });
      return;
    }
    const providerId = providerIdFor(row);
    if (!providerId) {
      skipped.push({ kind, id, reason: 'missing-provider-id' });
      return;
    }
    if (!needs.length) {
      skipped.push({ kind, id, reason: 'requested-fields-complete' });
      return;
    }
    addTarget(byProviderId, {
      kind,
      id,
      cardId: kind === 'printing' ? clean(rowValue(row, 'cardId', 'card_id')) : id,
      canonicalId: kind === 'card' ? canonicalIdFor(row) : (canonicalByCardId.get(clean(rowValue(row, 'cardId', 'card_id'))) || null),
      providerId,
      setCode: setCodeFor(row),
      cardNumber: cardNumberFor(row),
      localKey: makeLocalKey(setCodeFor(row), cardNumberFor(row)),
      needs,
      current: row
    });
  };

  for (const row of cards) {
    const id = cardIdFor(row);
    if (!id) {
      skipped.push({ kind: 'card', id: null, reason: 'missing-target-id' });
      continue;
    }
    if (clean(rowValue(row, 'gameId', 'game_id')) !== POKEMON_GAME_ID) {
      skipped.push({ kind: 'card', id, reason: 'game-not-pokemon' });
      continue;
    }
    const needs = [];
    if (candidateFields.includes('name_zh') && (missing(rowValue(row, 'nameZh', 'name_zh')) || !nameCoverage.has(id))) needs.push('name_zh');
    if ((candidateFields.includes('rarity_code') || candidateFields.includes('rarity_label')) && missing(rowValue(row, 'rarity', 'rarityCode', 'rarity_code', 'rarityLabel', 'rarity_label'))) {
      for (const field of ['rarity_code', 'rarity_label']) if (candidateFields.includes(field)) needs.push(field);
    }
    addRowTarget(row, 'card', id, [...new Set(needs)]);
  }

  for (const row of printings) {
    const id = printingIdFor(row);
    if (!id) {
      skipped.push({ kind: 'printing', id: null, reason: 'missing-target-id' });
      continue;
    }
    const cardId = clean(rowValue(row, 'cardId', 'card_id'));
    if (gameByCardId.get(cardId) !== POKEMON_GAME_ID) {
      skipped.push({ kind: 'printing', id, reason: 'game-not-pokemon' });
      continue;
    }
    const needs = [];
    if (candidateFields.includes('rarity_code') && missing(rowValue(row, 'rarityCode', 'rarity_code'))) needs.push('rarity_code');
    if (candidateFields.includes('rarity_label') && missing(rowValue(row, 'rarityLabel', 'rarity_label'))) needs.push('rarity_label');
    if (candidateFields.includes('image_url') && missing(imageFor(row))) needs.push('image_url');
    addRowTarget(row, 'printing', id, [...new Set(needs)]);
  }

  const groups = [...byProviderId.values()].sort((left, right) => sourceIdKey(left.providerId).localeCompare(sourceIdKey(right.providerId)));
  const batchSize = normalizeBatchSize(options.batchSize);
  const selected = groups.slice(0, batchSize);
  const deferred = groups.slice(batchSize).map(group => ({ providerId: group.providerId, reason: 'batch-limit', targetCount: group.targets.length }));
  return {
    cards,
    printings,
    cardNames,
    logicalFields: logical,
    candidateFields,
    groups,
    selected,
    deferred,
    skipped,
    batchSize
  };
}

function normalizeBatchSize(value) {
  const number = value == null ? DEFAULT_BATCH_SIZE : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error('INVALID_ENRICHMENT_BATCH_SIZE');
  return Math.min(MAX_BATCH_SIZE, number);
}

function normalizeConcurrency(value) {
  const number = value == null ? DEFAULT_CONCURRENCY : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error('INVALID_ENRICHMENT_CONCURRENCY');
  return Math.min(MAX_CONCURRENCY, number);
}

function signalFor(timeoutMs) {
  const timeout = Number(timeoutMs);
  return Number.isFinite(timeout) && timeout > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeout)
    : undefined;
}

export async function fetchTcgdexCard(providerId, {
  fetchImpl,
  fetch: fetchAlias,
  apiBase = TCGDEX_API_BASE,
  timeoutMs = 30000
} = {}) {
  fetchImpl = fetchImpl || fetchAlias || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');
  const normalizedProviderId = clean(providerId);
  if (!normalizedProviderId) throw new Error('MISSING_TCGDEX_PROVIDER_ID');
  const url = `${String(apiBase).replace(/\/$/, '')}/${encodeURIComponent(normalizedProviderId)}`;
  const options = {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': 'CardScope/1.0' }
  };
  const signal = signalFor(timeoutMs);
  if (signal) options.signal = signal;
  const response = await fetchImpl(url, options);
  if (!response || response.ok === false) {
    const status = response?.status == null ? 'unknown' : response.status;
    throw new Error(`TCGDEX_${status}`);
  }
  const body = await response.json();
  return { requestedProviderId: normalizedProviderId, ...normalizeTcgdexPayload(body, normalizedProviderId) };
}

export async function probeTcgdexImage(imageUrl, {
  imageProbeImpl,
  timeoutMs = 30000
} = {}) {
  const fetchImpl = imageProbeImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('IMAGE_PROBE_FETCH_UNAVAILABLE');
  const url = clean(imageUrl);
  if (!url || !/^https:\/\/assets[.]tcgdex[.]net\//i.test(url)) throw new Error('INVALID_TCGDEX_IMAGE_URL');
  const options = {
    method: 'GET',
    headers: {
      accept: 'image/*',
      range: 'bytes=0-0',
      'user-agent': 'CardScope/1.0'
    }
  };
  const signal = signalFor(timeoutMs);
  if (signal) options.signal = signal;
  const response = await fetchImpl(url, options);
  const status = Number(response?.status);
  const contentType = clean(response?.headers?.get?.('content-type'))?.toLocaleLowerCase() || null;
  if (![200, 206].includes(status) || !contentType?.startsWith('image/')) {
    throw new Error(`TCGDEX_IMAGE_PROBE_${Number.isFinite(status) ? status : 'unknown'}`);
  }
  return {
    imageProbeStatus: String(status),
    imageContentType: contentType,
    imageProbedAt: new Date().toISOString()
  };
}

async function fetchInBatches(groups, options = {}) {
  const concurrency = normalizeConcurrency(options.concurrency);
  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= groups.length) return;
      const group = groups[index];
      try {
        const record = await fetchTcgdexCard(group.providerId, options);
        results[index] = { group, record, error: null };
      } catch (error) {
        results[index] = { group, record: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));
  return results.filter(Boolean);
}

function sourceLocalKey(record) {
  return makeLocalKey(record.setCode, record.cardNumber);
}

function resolveTarget(group, record, allTargets = group.targets) {
  const recordProviderId = sourceIdKey(record.providerId || record.requestedProviderId);
  const direct = group.targets.filter(target => sourceIdKey(target.providerId) === recordProviderId);
  const byKind = kind => {
    const rows = direct.filter(target => target.kind === kind);
    const uniqueIds = [...new Set(rows.map(target => target.id))];
    if (uniqueIds.length > 1) return { ambiguous: true, candidates: uniqueIds };
    if (rows.length) return { target: rows[0], matchingMethod: 'provider-id' };
    return null;
  };
  const directCard = byKind('card');
  const directPrinting = byKind('printing');
  const localKey = sourceLocalKey(record);
  const fallback = targetKind => {
    if (!localKey) return null;
    const rows = allTargets.filter(target => target.kind === targetKind && target.localKey === localKey);
    const uniqueIds = [...new Set(rows.map(target => target.id))];
    if (uniqueIds.length > 1) return { ambiguous: true, candidates: uniqueIds };
    if (rows.length) return { target: rows[0], matchingMethod: 'provider-crosswalk' };
    return null;
  };
  return {
    card: directCard?.ambiguous ? directCard : directCard || fallback('card'),
    printing: directPrinting?.ambiguous ? directPrinting : directPrinting || fallback('printing')
  };
}

function targetCurrentValue(target, field) {
  const row = target.current || {};
  if (field === 'name_zh') return rowValue(row, 'nameZh', 'name_zh') || null;
  if (field === 'rarity_code') return rarityCodeFor(row) || null;
  if (field === 'rarity_label') return rarityLabelFor(row) || null;
  if (field === 'image_url') return imageFor(row) || null;
  return null;
}

function candidateRow(target, field, value, record, matchingMethod, observedAt) {
  const isImage = field === 'image_url';
  const targetTable = target.kind === 'card' ? 'tcg_cards' : 'tcg_printings';
  const targetColumn = target.kind === 'card'
    ? (field === 'rarity_code' ? 'rarity' : field)
    : field;
  const targetKeyValue = String(target.id);
  const evidence = {
    sourceNameZh: record.nameZh,
    ...(field === 'name_zh' ? { nameType: 'official' } : {}),
    rawRarity: record.rawRarity,
    normalizedRarityCode: record.rarityCode,
    normalizedRarityLabel: record.rarityLabel,
    providerId: record.providerId || record.requestedProviderId,
    setCode: record.setCode,
    cardNumber: record.cardNumber,
    sourceUpdatedAt: record.updatedAt,
    ...(record.imageProbe || {}),
    match: matchingMethod
  };
  const payloadHash = sha256Payload({
    sourcePayload: record.payload,
    targetTable,
    targetColumn,
    targetKey: targetKeyValue,
    proposedValue: value
  });
  const row = {
    source: TCGDEX_PROVIDER,
    source_record_id: record.providerId || record.requestedProviderId,
    source_url: record.sourceUrl,
    game_id: POKEMON_GAME_ID,
    target_card_id: target.kind === 'card' ? target.id : (target.cardId || null),
    target_canonical_id: target.canonicalId || null,
    target_printing_id: target.kind === 'printing' ? target.id : null,
    target_table: targetTable,
    target_column: targetColumn,
    target_key: targetKeyValue,
    field_name: field,
    locale: field === 'name_zh' ? TCGDEX_LOCALE : null,
    proposed_value: isImage ? {
      url: value,
      imageRightsStatus: 'not-provided',
      imageRights: 'not-inferred'
    } : value,
    current_value: targetCurrentValue(target, field),
    matching_method: matchingMethod,
    payload_hash: payloadHash,
    evidence,
    observed_at: observedAt,
    status: 'candidate'
  };
  if (isImage) row.review_reason = 'image-rights-review-required';
  return row;
}

function candidateKey(row) {
  return [row.target_card_id || '', row.target_printing_id || '', row.field_name].join('|');
}

function valueKey(value) {
  return stableStringify(value);
}

function defaultObservedAt(options) {
  return normalizeTimestamp(options.observedAt ?? options.observed_at ?? options.generatedAt ?? options.generated_at) || new Date().toISOString();
}

/**
 * Fetch at most 100 detailed TCGdex records and produce database-shaped
 * candidate rows. The function is side-effect free apart from GET requests.
 */
export async function planPokemonEnrichment(snapshot = {}, options = {}) {
  const selection = selectPokemonEnrichmentTargets(snapshot, options);
  const observedFallback = defaultObservedAt(options);
  const fetched = await fetchInBatches(selection.selected, options);
  const candidates = new Map();
  const conflicts = [];
  const audit = [];
  const matchedRecordKeys = new Set();
  const fields = Object.fromEntries(selection.candidateFields.map(field => [field, { candidates: 0, skipped: 0, conflicts: 0 }]));

  for (const item of fetched) {
    const group = item.group;
    if (item.error) {
      audit.push({ providerId: group.providerId, status: 'fetch-failed', reason: item.error });
      continue;
    }
    const record = item.record;
    const observedAt = record.updatedAt || observedFallback;
    const resolved = resolveTarget(group, record, selection.groups.flatMap(item => item.targets));
    let recordMatched = false;
    for (const kind of ['card', 'printing']) {
      const resolution = resolved[kind];
      if (!resolution) continue;
      if (resolution.ambiguous) {
        audit.push({ providerId: group.providerId, status: 'ambiguous', kind, reason: 'multiple-exact-targets', candidates: resolution.candidates });
        continue;
      }
      recordMatched = true;
      const target = resolution.target;
      const normalizedRarity = normalizeRarityValue(POKEMON_GAME_ID, record.rarityCode || record.rarityLabel);
      const values = {
        name_zh: record.nameZh,
        rarity_code: normalizedRarity.known ? normalizedRarity.code : null,
        rarity_label: normalizedRarity.known ? normalizedRarity.label : null,
        image_url: record.imageUrl
      };
      for (const field of target.needs) {
        const value = values[field];
        if (!hasValue(value)) {
          fields[field].skipped += 1;
          audit.push({ providerId: group.providerId, target: targetKey(target), field, status: 'source-field-missing' });
          continue;
        }
        let imageProbe = null;
        if (field === 'image_url') {
          try {
            imageProbe = await probeTcgdexImage(value, options);
          } catch (error) {
            fields[field].skipped += 1;
            audit.push({
              providerId: group.providerId,
              target: targetKey(target),
              field,
              status: 'image-probe-failed',
              reason: error instanceof Error ? error.message : String(error)
            });
            continue;
          }
        }
        const row = candidateRow(target, field, value, {
          ...record,
          imageProbe,
          rawRarity: record.rarityLabel || record.rarityCode,
          rarityCode: normalizedRarity.code,
          rarityLabel: normalizedRarity.label
        }, resolution.matchingMethod, observedAt);
        const key = candidateKey(row);
        const existing = candidates.get(key);
        if (existing && valueKey(existing.proposed_value) !== valueKey(row.proposed_value)) {
          candidates.delete(key);
          conflicts.push({ key, providerId: group.providerId, existing: existing.proposed_value, incoming: row.proposed_value });
          fields[field].conflicts += 1;
          audit.push({ providerId: group.providerId, target: targetKey(target), field, status: 'conflict' });
          continue;
        }
        if (!existing) {
          candidates.set(key, row);
          fields[field].candidates += 1;
          audit.push({ providerId: group.providerId, target: targetKey(target), field, status: 'candidate' });
        }
      }
    }
    if (recordMatched) matchedRecordKeys.add(sourceIdKey(group.providerId));
    else audit.push({ providerId: group.providerId, status: 'unmatched', reason: 'no-exact-target' });
  }

  const allRows = [...candidates.values()].sort((left, right) => {
    const leftKey = `${left.source_record_id}|${left.target_card_id || ''}|${left.target_printing_id || ''}|${left.field_name}`;
    const rightKey = `${right.source_record_id}|${right.target_card_id || ''}|${right.target_printing_id || ''}|${right.field_name}`;
    return leftKey.localeCompare(rightKey);
  });
  const rows = allRows.slice(0, MAX_BATCH_SIZE);
  const deferredCandidateRows = allRows.slice(MAX_BATCH_SIZE).map(row => ({
    providerId: row.source_record_id,
    targetTable: row.target_table,
    targetKey: row.target_key,
    field: row.field_name,
    reason: 'candidate-row-limit'
  }));
  const fetchFailed = fetched.filter(item => item.error).length;
  const summary = {
    provider: TCGDEX_PROVIDER,
    gameId: POKEMON_GAME_ID,
    locale: TCGDEX_LOCALE,
    requestedFields: selection.logicalFields,
    candidateFields: selection.candidateFields,
    includeImages: selection.candidateFields.includes('image_url'),
    batchSize: selection.batchSize,
    requestedRecords: selection.groups.length,
    selectedRecords: selection.selected.length,
    deferredRecords: selection.deferred.length,
    fetchedRecords: fetched.length - fetchFailed,
    fetchFailed,
    matchedRecords: matchedRecordKeys.size,
    candidateRows: rows.length,
    deferredCandidateRows: deferredCandidateRows.length,
    conflicts: conflicts.length,
    skippedSnapshotRows: selection.skipped.length,
    fields,
    observedAtFallback: observedFallback
  };
  return {
    dryRun: true,
    provider: TCGDEX_PROVIDER,
    gameId: POKEMON_GAME_ID,
    locale: TCGDEX_LOCALE,
    candidates: rows,
    rows,
    summary,
    conflicts,
    deferred: [...selection.deferred, ...deferredCandidateRows],
    skipped: selection.skipped,
    audit,
    provenance: {
      source: TCGDEX_PROVIDER,
      sourceBase: TCGDEX_API_BASE,
      collection: 'metadata-candidate-fetch',
      imageRightsStatus: summary.includeImages ? 'not-provided' : 'not-requested',
      imageRights: summary.includeImages ? 'not-inferred' : null,
      generatedAt: observedFallback
    }
  };
}

export const createPokemonEnrichmentPlan = planPokemonEnrichment;
export const loadTcgdexMetadataCandidates = planPokemonEnrichment;
