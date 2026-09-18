import { createHash } from 'node:crypto';

/**
 * Build a read-only, series-scoped coverage manifest.
 *
 * A manifest is deliberately an observation report, not a completeness claim.
 * A series can only have a numeric denominator when the caller supplies an
 * explicit, traceable `official-total` or `provider-total` baseline.  Observed
 * rows are never promoted to a denominator by this module.
 */

export const GAP_STATUSES = Object.freeze({
  COMPLETE: 'complete',
  UNCOLLECTED: 'uncollected',
  MISSING_FIELDS: 'missing-fields',
  NOT_PUBLISHED: 'not-published',
  UPDATE_FAILED: 'update-failed'
});

export const DEFAULT_REQUIRED_FIELDS = Object.freeze([
  'name_zh',
  'rarity',
  'image_url'
]);

const KNOWN_DENOMINATOR_KINDS = new Set(['official-total', 'provider-total']);
const STATUS_ALIASES = new Map([
  ['complete', GAP_STATUSES.COMPLETE],
  ['ok', GAP_STATUSES.COMPLETE],
  ['uncolllected', GAP_STATUSES.UNCOLLECTED],
  ['uncollected', GAP_STATUSES.UNCOLLECTED],
  ['missing-fields', GAP_STATUSES.MISSING_FIELDS],
  ['missing_fields', GAP_STATUSES.MISSING_FIELDS],
  ['not-published', GAP_STATUSES.NOT_PUBLISHED],
  ['not_published', GAP_STATUSES.NOT_PUBLISHED],
  ['planned', GAP_STATUSES.NOT_PUBLISHED],
  ['unreleased', GAP_STATUSES.NOT_PUBLISHED],
  ['upcoming', GAP_STATUSES.NOT_PUBLISHED],
  ['update-failed', GAP_STATUSES.UPDATE_FAILED],
  ['update_failed', GAP_STATUSES.UPDATE_FAILED],
  ['failed', GAP_STATUSES.UPDATE_FAILED],
  ['error', GAP_STATUSES.UPDATE_FAILED]
]);

const FIELD_ALIASES = new Map([
  ['name', 'name_zh'],
  ['namezh', 'name_zh'],
  ['name_zh', 'name_zh'],
  ['name-zh', 'name_zh'],
  ['traditional-chinese-name', 'name_zh'],
  ['traditional_chinese_name', 'name_zh'],
  ['rarity', 'rarity'],
  ['rarity_code', 'rarity'],
  ['rarity-code', 'rarity'],
  ['image', 'image_url'],
  ['imageurl', 'image_url'],
  ['image_url', 'image_url'],
  ['image-url', 'image_url']
]);

const clean = value => value == null ? null : String(value).trim() || null;

const hasValue = value => {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

const firstValue = (...values) => values.find(hasValue) ?? null;

function normalizeToken(value) {
  return clean(value)?.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '') || null;
}

function normalizeGameId(row) {
  return clean(row?.gameId ?? row?.game_id ?? row?.game ?? row?.ip);
}

function normalizeRegion(row) {
  return clean(row?.region ?? row?.market ?? row?.territory)?.toLocaleUpperCase() || null;
}

function normalizeSeriesId(row) {
  return clean(row?.seriesId ?? row?.series_id ?? row?.id ?? row?.officialCode ?? row?.official_code);
}

function normalizeOfficialCode(row) {
  return clean(row?.officialCode ?? row?.official_code ?? row?.setCode ?? row?.set_code);
}

function normalizeCardId(row, index) {
  return clean(row?.id ?? row?.cardId ?? row?.card_id ?? row?.providerId ?? row?.provider_id) || `row-${index}`;
}

function normalizePrintingId(row, index) {
  return clean(row?.id ?? row?.printingId ?? row?.printing_id ?? row?.providerId ?? row?.provider_id) || `row-${index}`;
}

function normalizeField(value) {
  const token = clean(value)?.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '-');
  if (!token) throw new Error('INVALID_SERIES_GAP_FIELD');
  return FIELD_ALIASES.get(token) || token;
}

export function normalizeRequiredFields(value) {
  const raw = value == null
    ? [...DEFAULT_REQUIRED_FIELDS]
    : typeof value === 'string'
      ? value.split(',')
      : Array.isArray(value) ? value : [value];
  const fields = [];
  for (const item of raw) {
    const field = normalizeField(item);
    if (!fields.includes(field)) fields.push(field);
  }
  return fields;
}

export function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sha256Payload(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeTimestamp(value) {
  const text = clean(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function baselineValue(row) {
  const baseline = isObject(row?.baseline) ? row.baseline : {};
  const metadata = isObject(row?.metadata) ? row.metadata : {};
  const direct = firstValue(
    baseline.value,
    baseline.total,
    baseline.printedTotal,
    baseline.cardCount,
    row?.expectedTotal,
    row?.expected_total
  );
  const numeric = direct == null || direct === '' ? null : Number(direct);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function baselineKind(row) {
  const baseline = isObject(row?.baseline) ? row.baseline : {};
  return clean(
    baseline.kind
      ?? baseline.denominatorKind
      ?? row?.denominatorKind
      ?? row?.denominator_kind
      ?? (row?.expectedTotal != null || row?.expected_total != null ? 'provider-total' : null)
  )?.toLocaleLowerCase() || 'unknown';
}

function baselineStatus(row) {
  const baseline = isObject(row?.baseline) ? row.baseline : {};
  return clean(baseline.status ?? baseline.evidenceStatus ?? row?.denominatorStatus ?? row?.denominator_status)?.toLocaleLowerCase() || null;
}

function registrySeriesRows(registry) {
  const rows = [];
  const games = Array.isArray(registry?.games) ? registry.games : [];
  for (const game of games) {
    const gameId = normalizeGameId(game);
    for (const series of Array.isArray(game?.series) ? game.series : []) {
      rows.push({ ...series, gameId: gameId || normalizeGameId(series) });
    }
    for (const region of Array.isArray(game?.regions) ? game.regions : []) {
      for (const series of Array.isArray(region?.series) ? region.series : []) {
        rows.push({
          ...series,
          gameId: gameId || normalizeGameId(series),
          region: normalizeRegion(series) || normalizeRegion(region)
        });
      }
    }
  }
  return rows;
}

function seriesKey(row) {
  return [normalizeGameId(row) || '*', normalizeRegion(row) || '*', normalizeSeriesId(row) || '*'].join('|');
}

function findRegistrySeries(series, registry) {
  const key = seriesKey(series);
  return registrySeriesRows(registry).find(row => seriesKey(row) === key)
    || registrySeriesRows(registry).find(row => normalizeSeriesId(row) === normalizeSeriesId(series) && normalizeGameId(row) === normalizeGameId(series))
    || null;
}

function mergeSeriesRows(seriesRows, registry) {
  const byKey = new Map();
  for (const row of registrySeriesRows(registry)) {
    const id = normalizeSeriesId(row);
    if (id) byKey.set(seriesKey(row), { ...row });
  }
  for (const row of Array.isArray(seriesRows) ? seriesRows : []) {
    const id = normalizeSeriesId(row);
    if (!id) continue;
    const key = seriesKey(row);
    byKey.set(key, { ...(byKey.get(key) || {}), ...row });
  }
  return [...byKey.values()].sort((left, right) => seriesKey(left).localeCompare(seriesKey(right)));
}

function baselineFor(series, registry) {
  const registered = findRegistrySeries(series, registry);
  const direct = isObject(series?.baseline) ? series.baseline : {};
  const fromRegistry = isObject(registered?.baseline) ? registered.baseline : {};
  const baseline = { ...fromRegistry, ...direct };
  const value = baselineValue({ ...registered, ...series, baseline });
  const kind = clean(baseline.kind ?? baseline.denominatorKind)?.toLocaleLowerCase() || baselineKind({ ...registered, ...series, baseline });
  const status = clean(baseline.status ?? baseline.evidenceStatus)?.toLocaleLowerCase() || baselineStatus({ ...registered, ...series, baseline });
  const quarantined = status === 'quarantined' || baseline.evidenceStatus === 'quarantined';
  const accepted = value !== null
    && KNOWN_DENOMINATOR_KINDS.has(kind)
    && !quarantined
    && status !== 'unknown';
  const source = baseline.source ?? baseline.evidence ?? null;
  if (!accepted) {
    return {
      kind: 'unknown',
      value: null,
      status: 'unknown',
      denominatorKnown: false,
      confidence: clean(baseline.confidence) || 'unverified',
      source,
      reason: value === null
        ? 'no-traceable-total'
        : quarantined ? 'quarantined-total' : 'denominator-kind-or-evidence-not-approved'
    };
  }
  return {
    kind,
    value,
    status: status || 'reported',
    denominatorKnown: true,
    confidence: clean(baseline.confidence) || 'unverified',
    source,
    providerSeriesId: clean(baseline.providerSeriesId ?? baseline.provider_series_id),
    sourceChecksum: clean(baseline.sourceChecksum ?? baseline.source_checksum),
    reason: null
  };
}

function rowSeriesId(row) {
  return clean(row?.seriesId ?? row?.series_id);
}

function rowSeriesCode(row) {
  return clean(row?.officialCode ?? row?.official_code ?? row?.setCode ?? row?.set_code ?? row?.localSetCode ?? row?.local_set_code);
}

function belongsToSeries(row, series) {
  const direct = rowSeriesId(row);
  const id = normalizeSeriesId(series);
  if (direct && id && normalizeToken(direct) === normalizeToken(id)) return true;
  const code = rowSeriesCode(row);
  const officialCode = normalizeOfficialCode(series);
  return Boolean(code && officialCode && normalizeToken(code) === normalizeToken(officialCode));
}

function uniqueRows(rows, idFor) {
  const result = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const id = idFor(row, index);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(row);
  }
  return result;
}

function rowFieldValue(row, field, printingByCardId) {
  if (field === 'name_zh') return firstValue(row?.nameZh, row?.name_zh, row?.chineseName, row?.chinese_name);
  if (field === 'rarity') return firstValue(row?.rarity, row?.rarityCode, row?.rarity_code, row?.rarityLabel, row?.rarity_label);
  if (field === 'image_url') {
    const cardImage = firstValue(row?.imageUrl, row?.image_url);
    if (cardImage) return cardImage;
    const cardId = clean(row?.id ?? row?.cardId ?? row?.card_id);
    const printingRows = cardId ? printingByCardId.get(cardId) || [] : [];
    return firstValue(...printingRows.flatMap(printing => [printing?.imageUrl, printing?.image_url]));
  }
  return firstValue(row?.[field], row?.[field.replaceAll('_', '')]);
}

function normalizeUpdates(updates) {
  if (Array.isArray(updates)) return updates.filter(isObject);
  if (!isObject(updates)) return [];
  return Object.entries(updates).map(([key, value]) => ({
    ...(isObject(value) ? value : { error: value }),
    seriesId: value?.seriesId ?? value?.series_id ?? key
  }));
}

function updateFor(series, updates) {
  const rows = normalizeUpdates(updates);
  const key = seriesKey(series);
  return rows.find(row => seriesKey(row) === key)
    || rows.find(row => normalizeSeriesId(row) === normalizeSeriesId(series) && normalizeGameId(row) === normalizeGameId(series))
    || null;
}

function updateFailed(update) {
  if (!update) return false;
  const status = clean(update.status ?? update.state)?.toLocaleLowerCase().replaceAll('_', '-') || '';
  return update.ok === false || update.success === false || Boolean(update.error ?? update.errorCode ?? update.failure)
    || ['failed', 'error', 'update-failed', 'timeout'].includes(status);
}

function updateEvidence(update) {
  if (!update) return { status: 'not-attempted', error: null };
  return {
    status: clean(update.status ?? update.state) || (updateFailed(update) ? 'failed' : 'ok'),
    error: clean(update.error ?? update.errorCode ?? update.failure),
    attemptedAt: normalizeTimestamp(update.attemptedAt ?? update.attempted_at ?? update.updatedAt ?? update.updated_at),
    providerId: clean(update.providerId ?? update.provider_id),
    sourceUrl: clean(update.sourceUrl ?? update.source_url ?? update.url)
  };
}

function publicationState(series, asOf) {
  const status = clean(series?.publicationStatus ?? series?.publication_status ?? series?.status)?.toLocaleLowerCase().replaceAll('_', '-') || '';
  const explicitNotPublished = series?.published === false || ['planned', 'unreleased', 'upcoming', 'not-published', 'not-public'].includes(status);
  const releaseDate = normalizeTimestamp(series?.releaseDate ?? series?.release_date ?? series?.publishedAt ?? series?.published_at);
  const futureRelease = Boolean(releaseDate && asOf && Date.parse(releaseDate) > Date.parse(asOf));
  return {
    notPublished: explicitNotPublished || futureRelease,
    reason: explicitNotPublished ? 'series-marked-not-published' : futureRelease ? 'release-after-as-of' : null,
    releaseDate
  };
}

function missingRecordCount(expected, observed) {
  if (!Number.isInteger(expected)) return null;
  return Math.max(0, expected - observed);
}

function rowManifest(series, { cards, printings, requiredFields, baseline, update, asOf }) {
  const cardRows = uniqueRows(cards.filter(row => belongsToSeries(row, series)), normalizeCardId);
  const printingRows = uniqueRows(printings.filter(row => belongsToSeries(row, series)), normalizePrintingId);
  const printingByCardId = new Map();
  for (const row of printingRows) {
    const cardId = clean(row?.cardId ?? row?.card_id);
    if (!cardId) continue;
    const rows = printingByCardId.get(cardId) || [];
    rows.push(row);
    printingByCardId.set(cardId, rows);
  }
  const observedRows = cardRows.length ? cardRows : printingRows;
  const observedCount = observedRows.length;
  const fieldStats = {};
  for (const field of requiredFields) {
    const covered = observedRows.filter(row => hasValue(rowFieldValue(row, field, printingByCardId))).length;
    fieldStats[field] = {
      observed: observedCount,
      covered,
      missing: Math.max(0, observedCount - covered),
      status: observedCount === 0 ? 'not-observed' : covered === observedCount ? 'complete' : 'missing'
    };
  }
  const missingFieldCount = Object.values(fieldStats).reduce((total, row) => total + row.missing, 0);
  const publication = publicationState(series, asOf);
  const updateStatus = updateEvidence(update);
  const failed = updateFailed(update);
  const expected = baseline.value;
  const missingRecords = missingRecordCount(expected, observedCount);
  const hasGap = missingFieldCount > 0 || missingRecords > 0;
  let status = GAP_STATUSES.COMPLETE;
  if (failed) status = GAP_STATUSES.UPDATE_FAILED;
  else if (publication.notPublished) status = GAP_STATUSES.NOT_PUBLISHED;
  else if (observedCount === 0) status = GAP_STATUSES.UNCOLLECTED;
  else if (hasGap) status = GAP_STATUSES.MISSING_FIELDS;
  const secondaryStatuses = [];
  if (failed && publication.notPublished) secondaryStatuses.push(GAP_STATUSES.NOT_PUBLISHED);
  if (failed && observedCount === 0) secondaryStatuses.push(GAP_STATUSES.UNCOLLECTED);
  if (failed && hasGap) secondaryStatuses.push(GAP_STATUSES.MISSING_FIELDS);
  if (!failed && publication.notPublished && observedCount === 0) secondaryStatuses.push(GAP_STATUSES.UNCOLLECTED);
  if (!failed && publication.notPublished && hasGap) secondaryStatuses.push(GAP_STATUSES.MISSING_FIELDS);
  const denominator = {
    kind: baseline.kind,
    value: baseline.denominatorKnown ? baseline.value : null,
    status: baseline.denominatorKnown ? baseline.status : 'unknown',
    known: baseline.denominatorKnown,
    confidence: baseline.confidence,
    missingRecords,
    coverage: baseline.denominatorKnown && baseline.value > 0
      ? Math.min(1, observedCount / baseline.value)
      : null,
    source: baseline.source,
    reason: baseline.reason
  };
  return {
    key: seriesKey(series),
    gameId: normalizeGameId(series),
    region: normalizeRegion(series),
    seriesId: normalizeSeriesId(series),
    officialCode: normalizeOfficialCode(series),
    nameZh: clean(series?.nameZh ?? series?.name_zh),
    nameEn: clean(series?.nameEn ?? series?.name_en),
    status,
    secondaryStatuses,
    releaseDate: publication.releaseDate,
    publication: {
      published: !publication.notPublished,
      status: publication.notPublished ? GAP_STATUSES.NOT_PUBLISHED : 'published',
      reason: publication.reason
    },
    denominator,
    observed: {
      cards: cardRows.length,
      printings: printingRows.length,
      records: observedCount,
      fields: fieldStats
    },
    gaps: {
      missingFields: Object.entries(fieldStats).filter(([, item]) => item.missing > 0).map(([field]) => field),
      missingFieldCount,
      missingRecords,
      denominatorUnknown: !baseline.denominatorKnown
    },
    update: updateStatus,
    evidence: {
      sourceUrl: clean(series?.sourceUrl ?? series?.source_url),
      providerId: clean(series?.providerId ?? series?.provider_id),
      baselineReason: baseline.reason,
      observedAsOf: asOf
    }
  };
}

/**
 * Build a deterministic manifest from catalog rows and optional update
 * results. `updates` may be an array or an object keyed by series ID.
 */
export function buildSeriesGapManifest({
  series = [],
  cards = [],
  printings = [],
  registry = null,
  baselines = null,
  updates = [],
  requiredFields = DEFAULT_REQUIRED_FIELDS,
  asOf = new Date().toISOString()
} = {}) {
  if (!Array.isArray(series) || !Array.isArray(cards) || !Array.isArray(printings)) throw new Error('INVALID_SERIES_GAP_INPUT');
  const observedAt = normalizeTimestamp(asOf) || new Date().toISOString();
  const baselineRegistry = baselines || registry || {};
  const fields = normalizeRequiredFields(requiredFields);
  const mergedSeries = mergeSeriesRows(series, baselineRegistry);
  const rows = mergedSeries.map(row => rowManifest(row, {
    cards,
    printings,
    requiredFields: fields,
    baseline: baselineFor(row, baselineRegistry),
    update: updateFor(row, updates),
    asOf: observedAt
  }));
  const byStatus = Object.fromEntries(Object.values(GAP_STATUSES).map(status => [status, 0]));
  for (const row of rows) byStatus[row.status] += 1;
  const knownDenominatorSeries = rows.filter(row => row.denominator.known).length;
  const unknownDenominatorSeries = rows.length - knownDenominatorSeries;
  const manifest = {
    schemaVersion: 1,
    generatedAt: observedAt,
    dryRun: true,
    requiredFields: fields,
    denominatorPolicy: {
      unknown: { kind: 'unknown', value: null },
      numericAllowedKinds: [...KNOWN_DENOMINATOR_KINDS].sort(),
      note: 'Observed rows are not a denominator; unknown totals remain null.'
    },
    summary: {
      series: rows.length,
      byStatus,
      knownDenominatorSeries,
      unknownDenominatorSeries,
      observedRecords: rows.reduce((sum, row) => sum + row.observed.records, 0),
      missingFieldValues: rows.reduce((sum, row) => sum + row.gaps.missingFieldCount, 0),
      missingRecords: rows.reduce((sum, row) => sum + (row.gaps.missingRecords || 0), 0),
      unknownMissingRecords: rows.filter(row => row.gaps.missingRecords === null).length
    },
    rows
  };
  manifest.checksum = sha256Payload({
    schemaVersion: manifest.schemaVersion,
    requiredFields: manifest.requiredFields,
    rows: manifest.rows
  });
  return manifest;
}

export function manifestChecksum(manifest) {
  return sha256Payload({
    schemaVersion: manifest?.schemaVersion || 1,
    requiredFields: manifest?.requiredFields || [],
    rows: manifest?.rows || []
  });
}
