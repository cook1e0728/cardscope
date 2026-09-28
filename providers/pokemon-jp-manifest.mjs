import { createHash } from 'node:crypto';
import { normalizeRarityValue } from './normalize.mjs';

export const POKEMON_JP_SOURCE_IDENTITY = Object.freeze({
  source: 'tcgdex-ja',
  region: 'JP',
  locale: 'ja-JP'
});

export const MAX_POKEMON_JP_MANIFEST_CARDS = 100;

const NAMESPACE = 'pokemon-tcgdex-jp';
const GAME_ID = 'pokemon';
const TCGDEX_JA_API_BASE = 'https://api.tcgdex.net/v2/ja';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const clean = value => value == null ? null : String(value).trim() || null;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stablePokemonJpStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stablePokemonJpStringify).join(',')}]`;
  return `{${Object.keys(value).sort(compareText).map(key => `${JSON.stringify(key)}:${stablePokemonJpStringify(value[key])}`).join(',')}}`;
}

export function sha256PokemonJpPayload(value) {
  return createHash('sha256').update(stablePokemonJpStringify(value)).digest('hex');
}

function requireProviderId(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new Error(code);
  return value;
}

/**
 * Encode a source identity without slugging or dropping provider characters.
 * Card/printing IDs include the set ID in the encoded tuple so repeated raw
 * card IDs in different sets cannot collide in the JP namespace.
 */
export function pokemonJpTargetId(entity, providerId, seriesProviderId = null) {
  if (!['series', 'card', 'printing'].includes(entity)) throw new Error('INVALID_POKEMON_JP_ENTITY');
  const id = requireProviderId(providerId, 'INVALID_POKEMON_JP_PROVIDER_ID');
  const payload = entity === 'series'
    ? [POKEMON_JP_SOURCE_IDENTITY.source, entity, id]
    : [POKEMON_JP_SOURCE_IDENTITY.source, entity, requireProviderId(seriesProviderId, 'INVALID_POKEMON_JP_SERIES_ID'), id];
  return `${NAMESPACE}-${entity}-${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

export function decodePokemonJpTargetId(value) {
  const text = clean(value);
  if (!text?.startsWith(`${NAMESPACE}-`)) throw new Error('INVALID_POKEMON_JP_TARGET_ID');
  const suffix = text.slice(`${NAMESPACE}-`.length);
  const split = suffix.indexOf('-');
  if (split < 0) throw new Error('INVALID_POKEMON_JP_TARGET_ID');
  const entity = suffix.slice(0, split);
  if (!['series', 'card', 'printing'].includes(entity)) throw new Error('INVALID_POKEMON_JP_TARGET_ID');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(suffix.slice(split + 1), 'base64url').toString('utf8'));
  } catch {
    throw new Error('INVALID_POKEMON_JP_TARGET_ID');
  }
  if (!Array.isArray(payload) || payload[0] !== POKEMON_JP_SOURCE_IDENTITY.source || payload[1] !== entity) {
    throw new Error('INVALID_POKEMON_JP_TARGET_ID');
  }
  if (entity === 'series' && payload.length === 3 && typeof payload[2] === 'string') {
    return { entity, providerId: payload[2] };
  }
  if (entity !== 'series' && payload.length === 4 && typeof payload[2] === 'string' && typeof payload[3] === 'string') {
    return { entity, seriesProviderId: payload[2], providerId: payload[3] };
  }
  throw new Error('INVALID_POKEMON_JP_TARGET_ID');
}

function assertSourceIdentity(value) {
  if (!isObject(value)
    || value.source !== POKEMON_JP_SOURCE_IDENTITY.source
    || value.region !== POKEMON_JP_SOURCE_IDENTITY.region
    || value.locale !== POKEMON_JP_SOURCE_IDENTITY.locale) {
    throw new Error('INVALID_POKEMON_JP_SOURCE_IDENTITY');
  }
}

function optionalRowIdentityIssue(row) {
  if (!isObject(row)) return 'invalid-source-row';
  const source = row.source ?? row.provider;
  if (source != null && source !== POKEMON_JP_SOURCE_IDENTITY.source) return 'wrong-source-identity';
  if (row.region != null && row.region !== POKEMON_JP_SOURCE_IDENTITY.region) return 'wrong-region-identity';
  if (row.locale != null && row.locale !== POKEMON_JP_SOURCE_IDENTITY.locale) return 'wrong-locale-identity';
  return null;
}

function rowsByStableIdentity(rows, identity) {
  return [...rows].sort((left, right) => {
    const leftId = clean(left?.id ?? left?.providerId ?? left?.provider_id) || '';
    const rightId = clean(right?.id ?? right?.providerId ?? right?.provider_id) || '';
    return compareText(leftId, rightId) || compareText(stablePokemonJpStringify(left), stablePokemonJpStringify(right));
  });
}

function sourceSnapshotHash(sourceIdentity, observedAt, seriesId, sets, cards) {
  return sha256PokemonJpPayload({
    sourceIdentity,
    observedAt,
    seriesId,
    sets: rowsByStableIdentity(sets, 'id'),
    cards: rowsByStableIdentity(cards, 'id')
  });
}

function seedSnapshotHash(existingJpRows) {
  return sha256PokemonJpPayload(Object.fromEntries(
    ['series', 'cards', 'printings'].map(key => [key, rowsByStableIdentity(existingJpRows[key], 'id')])
  ));
}

function normalizeSeriesCode(value) {
  return clean(value)?.normalize('NFKC').toLocaleUpperCase().replace(/\s+/g, '') || null;
}

function normalizeCardNumber(value) {
  const text = clean(value)?.normalize('NFKC');
  if (!text) return null;
  const numerator = /^(\d+)(?:\s*\/.*)?$/.exec(text);
  if (numerator) {
    try {
      return `number:${BigInt(numerator[1]).toString()}`;
    } catch {
      return null;
    }
  }
  return `text:${text.toLocaleUpperCase().replace(/\s+/g, '')}`;
}

function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

function validObservedAt(value) {
  if (typeof value !== 'string') return false;
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?(?<zone>Z|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/.exec(value);
  if (!match) return false;
  const { year: yearText, month: monthText, day: dayText, hour: hourText, minute: minuteText, second: secondText, offsetHour: offsetHourText, offsetMinute: offsetMinuteText } = match.groups;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHourText != null && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function metadataEndpoint(resource, providerId) {
  if (resource !== 'sets' && resource !== 'cards') throw new Error('INVALID_POKEMON_JP_ENDPOINT_RESOURCE');
  const id = requireProviderId(providerId, 'INVALID_POKEMON_JP_PROVIDER_ID');
  const encodedId = encodeURIComponent(id);
  const endpoint = `${TCGDEX_JA_API_BASE}/${resource}/${encodedId}`;
  const parsed = new URL(endpoint);
  if (parsed.origin !== 'https://api.tcgdex.net'
    || parsed.pathname !== `/v2/ja/${resource}/${encodedId}`) {
    throw new Error('INVALID_POKEMON_JP_PROVIDER_ENDPOINT');
  }
  return endpoint;
}

function sourceEvidence(resource, providerId, observedAt) {
  return {
    url: providerId == null ? null : metadataEndpoint(resource, providerId),
    urlType: providerId == null ? 'unavailable-provider-id' : 'derived-provider-endpoint',
    observedAt
  };
}

function supportedRarity(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const rarity = normalizeRarityValue(GAME_ID, value);
  return rarity.known ? { code: rarity.code, label: rarity.label } : null;
}

function cursorPayload(value) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
  } catch {
    throw new Error('INVALID_POKEMON_JP_MANIFEST_CURSOR');
  }
}

function encodeCursor(payload) {
  return Buffer.from(stablePokemonJpStringify(payload), 'utf8').toString('base64url');
}

function regionOf(row) {
  return clean(row?.region ?? row?.market)?.toLocaleUpperCase() || null;
}

function isJapanesePrinting(row) {
  const language = clean(row?.language ?? row?.locale)?.normalize('NFKC').toLocaleLowerCase();
  return regionOf(row) === 'JP' && (language === 'ja' || language === 'ja-jp');
}

function jpSeriesRows(existingJpRows, targetId) {
  return existingJpRows.series.filter(row => {
    const gameId = clean(row?.gameId ?? row?.game_id ?? row?.game);
    if (gameId !== GAME_ID || regionOf(row) !== 'JP') return false;
    const officialCode = row?.officialCode ?? row?.official_code ?? row?.setCode ?? row?.set_code;
    return normalizeSeriesCode(officialCode) === normalizeSeriesCode(targetId)
      || row?.id === pokemonJpTargetId('series', targetId);
  });
}

function jpCardProviderRows(existingJpRows, cardId, seriesId) {
  const targetId = pokemonJpTargetId('card', cardId, seriesId);
  return existingJpRows.cards.filter(row => {
    const source = clean(row?.source);
    const providerId = clean(row?.providerId ?? row?.provider_id);
    const exactNamespacedId = row?.id === targetId
      && (source == null || source === POKEMON_JP_SOURCE_IDENTITY.source);
    return source === POKEMON_JP_SOURCE_IDENTITY.source && providerId === cardId
      || exactNamespacedId;
  });
}

function jpPrintingRows(existingJpRows, cardId, seriesId, localId) {
  const providerTargetId = pokemonJpTargetId('printing', cardId, seriesId);
  const numberKey = normalizeCardNumber(localId);
  return existingJpRows.printings.filter(row => {
    if (!isJapanesePrinting(row)) return false;
    if (row?.id === providerTargetId) return true;
    const source = clean(row?.source);
    const providerId = clean(row?.providerId ?? row?.provider_id);
    if (source === POKEMON_JP_SOURCE_IDENTITY.source && providerId === cardId) return true;
    const setCode = row?.localSetCode ?? row?.local_set_code ?? row?.officialCode ?? row?.official_code;
    const cardNumber = row?.localCardNumber ?? row?.local_card_number ?? row?.cardNumber ?? row?.card_number;
    return normalizeSeriesCode(setCode) === normalizeSeriesCode(seriesId)
      && numberKey != null
      && normalizeCardNumber(cardNumber) === numberKey;
  });
}

function validateInput(input, options) {
  if (!isObject(input)) throw new Error('INVALID_POKEMON_JP_MANIFEST_INPUT');
  assertSourceIdentity(input.sourceIdentity);
  if (!Array.isArray(input.sets) || !Array.isArray(input.cards)) throw new Error('INVALID_POKEMON_JP_SOURCE_SNAPSHOT');
  if (!isObject(input.existingJpRows)
    || !Array.isArray(input.existingJpRows.series)
    || !Array.isArray(input.existingJpRows.cards)
    || !Array.isArray(input.existingJpRows.printings)) {
    throw new Error('INVALID_POKEMON_JP_SEED_SNAPSHOT');
  }
  const seriesId = requireProviderId(options.seriesId, 'POKEMON_JP_SERIES_ID_REQUIRED');
  if (!validObservedAt(input.observedAt)) throw new Error('INVALID_POKEMON_JP_OBSERVED_AT');
  const observedAt = input.observedAt;
  const limit = options.limit == null ? MAX_POKEMON_JP_MANIFEST_CARDS : Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_POKEMON_JP_MANIFEST_CARDS) {
    throw new Error('INVALID_POKEMON_JP_MANIFEST_LIMIT');
  }
  const matchingSets = input.sets.filter(row => isObject(row) && row.id === seriesId);
  if (matchingSets.length === 0) throw new Error('POKEMON_JP_SERIES_NOT_IN_SOURCE_SNAPSHOT');
  return { seriesId, limit, matchingSets, observedAt };
}

/**
 * Build a deterministic, read-only manifest from one saved TCGdex-ja set and
 * its card details. This module never fetches data or writes to a database.
 */
export function planPokemonJpManifest(input, options = {}) {
  const { seriesId, limit, matchingSets, observedAt } = validateInput(input, options);
  const sourceIdentity = { ...POKEMON_JP_SOURCE_IDENTITY };
  const sourceHash = sourceSnapshotHash(sourceIdentity, observedAt, seriesId, input.sets, input.cards);
  const seedHash = seedSnapshotHash(input.existingJpRows);
  const sourceCards = rowsByStableIdentity(input.cards, 'id');
  const cursor = options.cursor == null ? null : String(options.cursor);
  const decodedCursor = cursorPayload(cursor);
  let offset = 0;
  if (decodedCursor) {
    if (decodedCursor.version !== 1
      || decodedCursor.sourceHash !== sourceHash
      || decodedCursor.seedHash !== seedHash
      || decodedCursor.seriesId !== seriesId
      || decodedCursor.limit !== limit
      || !Number.isInteger(decodedCursor.offset)
      || decodedCursor.offset < 0
      || decodedCursor.offset > sourceCards.length) {
      throw new Error('INVALID_POKEMON_JP_MANIFEST_CURSOR');
    }
    offset = decodedCursor.offset;
  }
  const selectedCards = sourceCards.slice(offset, offset + limit);
  const hasMore = offset + selectedCards.length < sourceCards.length;
  const nextCursor = hasMore
    ? encodeCursor({ version: 1, sourceHash, seedHash, seriesId, limit, offset: offset + selectedCards.length })
    : null;

  const seriesTargetId = pokemonJpTargetId('series', seriesId);
  const seriesSeeds = jpSeriesRows(input.existingJpRows, seriesId);
  const sourceSeriesDuplicates = matchingSets.length > 1;
  const seriesReason = sourceSeriesDuplicates
    ? 'duplicate-source-series-id'
    : seriesSeeds.length > 1
      ? 'duplicate-jp-series-seed'
      : seriesSeeds.length === 1 ? 'existing-jp-series-natural-key' : null;
  const selectedSet = matchingSets.length === 1 ? matchingSets[0] : null;
  const sourceSeriesIdentityIssue = selectedSet ? optionalRowIdentityIssue(selectedSet) : null;
  const allCardIds = new Map();
  const allLocalIds = new Map();
  for (const card of sourceCards) {
    if (optionalRowIdentityIssue(card) || card?.set?.id !== seriesId) continue;
    const id = typeof card?.id === 'string' && card.id.trim() === card.id && card.id.length > 0 ? card.id : null;
    const localId = typeof card?.localId === 'string' && card.localId.trim() === card.localId && card.localId.length > 0 ? card.localId : null;
    if (id) allCardIds.set(id, (allCardIds.get(id) || 0) + 1);
    const localKey = normalizeCardNumber(localId);
    if (localKey) allLocalIds.set(localKey, (allLocalIds.get(localKey) || 0) + 1);
  }

  const records = [];
  const quarantined = [];
  const seedNumberCollisions = [];
  if (sourceSeriesIdentityIssue) {
    quarantined.push({ entity: 'series', sourceProviderId: seriesId, targetId: seriesTargetId, reasons: [sourceSeriesIdentityIssue], sourceEvidence: sourceEvidence('sets', seriesId, observedAt) });
  } else if (seriesReason) {
    quarantined.push({ entity: 'series', sourceProviderId: seriesId, targetId: seriesTargetId, reasons: [seriesReason], sourceEvidence: sourceEvidence('sets', seriesId, observedAt) });
  } else if (offset === 0) {
    records.push({
      entity: 'series',
      targetId: seriesTargetId,
      source: POKEMON_JP_SOURCE_IDENTITY.source,
      sourceProviderId: seriesId,
      gameId: GAME_ID,
      region: POKEMON_JP_SOURCE_IDENTITY.region,
      locale: POKEMON_JP_SOURCE_IDENTITY.locale,
      sourceEvidence: sourceEvidence('sets', seriesId, observedAt),
      metadata: {
        name_ja: clean(selectedSet?.name),
        releaseDate: normalizeDate(selectedSet?.releaseDate)
      }
    });
  }

  for (const card of selectedCards) {
    const rawId = typeof card?.id === 'string' && card.id.trim() === card.id && card.id.length > 0 ? card.id : null;
    const rawLocalId = typeof card?.localId === 'string' && card.localId.trim() === card.localId && card.localId.length > 0 ? card.localId : null;
    const reasons = [];
    const rowIdentityIssue = optionalRowIdentityIssue(card);
    if (rowIdentityIssue) reasons.push(rowIdentityIssue);
    if (!rawId) reasons.push('missing-card-provider-id');
    if (!rawLocalId) reasons.push('missing-local-id');
    if (rawId && rawLocalId && rawId !== `${seriesId}-${rawLocalId}`) reasons.push('card-provider-id-local-id-mismatch');
    if (card?.set?.id !== seriesId) reasons.push('card-set-identity-mismatch');
    if (sourceSeriesIdentityIssue) reasons.push(sourceSeriesIdentityIssue);
    if (seriesReason) reasons.push(seriesReason);
    if (rawId && allCardIds.get(rawId) > 1) reasons.push('duplicate-source-card-id');
    const numberKey = normalizeCardNumber(rawLocalId);
    if (numberKey && allLocalIds.get(numberKey) > 1) reasons.push('duplicate-source-local-id');

    let cardSeeds = [];
    let printingSeeds = [];
    if (rawId && rawLocalId) {
      cardSeeds = jpCardProviderRows(input.existingJpRows, rawId, seriesId);
      printingSeeds = jpPrintingRows(input.existingJpRows, rawId, seriesId, rawLocalId);
      if (cardSeeds.length > 1) reasons.push('duplicate-jp-card-seed');
      else if (cardSeeds.length === 1) reasons.push('existing-jp-card-provider-id');
      if (printingSeeds.length > 1) reasons.push('duplicate-jp-printing-seed');
      else if (printingSeeds.length === 1) reasons.push('existing-jp-printing-natural-key');
      if (printingSeeds.length > 0) seedNumberCollisions.push({ sourceProviderId: rawId, localId: rawLocalId, count: printingSeeds.length });
    }

    if (reasons.length > 0) {
      quarantined.push({
        entity: 'card',
        sourceProviderId: rawId,
        sourceSetProviderId: clean(card?.set?.id),
        localId: rawLocalId,
        targetId: rawId ? pokemonJpTargetId('card', rawId, seriesId) : null,
        reasons: [...new Set(reasons)].sort(compareText),
        sourceEvidence: sourceEvidence('cards', rawId, observedAt)
      });
      continue;
    }

    const cardTargetId = pokemonJpTargetId('card', rawId, seriesId);
    const printingTargetId = pokemonJpTargetId('printing', rawId, seriesId);
    const rarity = supportedRarity(card?.rarity);
    const releaseDate = normalizeDate(selectedSet?.releaseDate);
    records.push({
      entity: 'card',
      targetId: cardTargetId,
      source: POKEMON_JP_SOURCE_IDENTITY.source,
      sourceProviderId: rawId,
      seriesTargetId,
      gameId: GAME_ID,
      region: POKEMON_JP_SOURCE_IDENTITY.region,
      locale: POKEMON_JP_SOURCE_IDENTITY.locale,
      sourceEvidence: sourceEvidence('cards', rawId, observedAt),
      metadata: { name_ja: clean(card?.name) }
    });
    records.push({
      entity: 'printing',
      targetId: printingTargetId,
      source: POKEMON_JP_SOURCE_IDENTITY.source,
      sourceProviderId: rawId,
      cardTargetId,
      seriesTargetId,
      gameId: GAME_ID,
      region: POKEMON_JP_SOURCE_IDENTITY.region,
      locale: POKEMON_JP_SOURCE_IDENTITY.locale,
      identity: { setProviderId: seriesId, localId: rawLocalId },
      sourceEvidence: sourceEvidence('cards', rawId, observedAt),
      metadata: { cardNumber: rawLocalId, releaseDate, rarity }
    });
  }

  const entityOrder = { series: 0, card: 1, printing: 2 };
  records.sort((left, right) => entityOrder[left.entity] - entityOrder[right.entity]
    || compareText(left.sourceProviderId || '', right.sourceProviderId || '')
    || compareText(left.targetId, right.targetId));
  quarantined.sort((left, right) => compareText(left.entity, right.entity)
    || compareText(left.sourceProviderId || '', right.sourceProviderId || '')
    || compareText(left.targetId || '', right.targetId || ''));

  const manifest = {
    schemaVersion: 1,
    manifestType: 'pokemon-jp-metadata-only',
    dryRun: true,
    writesPerformed: false,
    databaseContacted: false,
    sourceIdentity,
    provenance: {
      hashAlgorithm: 'sha256',
      sourceHash,
      seedHash,
      sourceObservedAt: observedAt
    },
    scope: {
      gameId: GAME_ID,
      seriesProviderId: seriesId,
      seriesTargetId,
      seriesStatus: sourceSeriesIdentityIssue || seriesReason ? 'quarantined' : 'eligible',
      limit,
      cursor,
      nextCursor,
      hasMore
    },
    policy: {
      globalExpectedTotals: { status: 'unknown', sets: null, cards: null },
      imageDisplay: { enabled: false, reason: 'image-rights-review-not-included-in-metadata-manifest' },
      prices: { enabled: false }
    },
    summary: {
      sourceCards: sourceCards.length,
      selectedCards: selectedCards.length,
      proposedRecords: records.length,
      quarantinedCards: quarantined.filter(row => row.entity === 'card').length,
      quarantinedSeries: quarantined.filter(row => row.entity === 'series').length,
      jpPrintingSeedCollisions: seedNumberCollisions.length,
      hasMore
    },
    records,
    quarantined,
    seedNumberCollisions
  };
  manifest.manifestHash = sha256PokemonJpPayload(manifest);
  return manifest;
}
