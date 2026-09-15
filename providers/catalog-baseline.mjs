import registry from '../data/catalog-baselines.json' with { type: 'json' };

export const REQUIRED_GAME_IDS = Object.freeze([
  'pokemon',
  'onepiece',
  'yugioh',
  'weiss-schwarz',
  'haikyuu'
]);

const BASELINE_KINDS = new Set(['official-total', 'provider-total', 'unknown']);
const BASELINE_STATUSES = new Set(['complete', 'partial', 'unknown']);
const CONFIDENCES = new Set(['high', 'medium', 'low', 'mixed', 'unverified']);
const EVIDENCE_STATUSES = new Set(['provider-reported', 'source-verified', 'quarantined', 'unknown']);
const DEFAULT_QUARANTINE_SERIES_IDS = new Set(['svp', 'sve', 'cs1.5', 'sv5k']);
const SOURCE_STATUS_FALLBACK = 'unknown';
const SOURCE_CONFIDENCE_FALLBACK = 'unverified';

export class CatalogBaselineError extends TypeError {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'CatalogBaselineError';
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details = {}) {
  throw new CatalogBaselineError(code, message, details);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isObject(value) && Object.hasOwn(value, key);
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeRegion(value) {
  const region = stringValue(value);
  return region ? region.toUpperCase() : null;
}

function normalizeGameId(row) {
  return stringValue(row?.gameId ?? row?.game_id ?? row?.game);
}

function normalizeSeriesId(row) {
  return stringValue(row?.seriesId ?? row?.series_id ?? row?.officialCode ?? row?.official_code ?? row?.id);
}

function dateLike(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = stringValue(value);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function sourceObject(source, path = 'source', { numeric = false } = {}) {
  if (!isObject(source)) fail('INVALID_SOURCE', `${path} must be an object`);
  const id = source.id === null || source.id === undefined ? null : stringValue(source.id);
  const url = source.url === null || source.url === undefined ? null : stringValue(source.url);
  const asOf = source.asOf === null || source.asOf === undefined ? null : dateLike(source.asOf);
  const status = stringValue(source.status) || SOURCE_STATUS_FALLBACK;
  const confidence = stringValue(source.confidence) || SOURCE_CONFIDENCE_FALLBACK;
  const evidenceStatus = stringValue(source.evidenceStatus) || 'unknown';
  const sourceChecksum = source.sourceChecksum === null || source.sourceChecksum === undefined ? null : stringValue(source.sourceChecksum);
  const providerSeriesId = source.providerSeriesId === null || source.providerSeriesId === undefined ? null : stringValue(source.providerSeriesId);
  const providerId = source.providerId === null || source.providerId === undefined ? null : stringValue(source.providerId);
  const language = source.language === null || source.language === undefined ? null : stringValue(source.language)?.toLowerCase() || null;
  if (!EVIDENCE_STATUSES.has(evidenceStatus)) fail('INVALID_EVIDENCE_STATUS', `${path}.evidenceStatus is not supported`);
  if (source.id !== null && source.id !== undefined && !id) fail('INVALID_SOURCE', `${path}.id must be a non-empty string or null`);
  if (source.url !== null && source.url !== undefined && (!url || !/^https?:\/\//i.test(url))) fail('INVALID_SOURCE', `${path}.url must be an http(s) URL or null`);
  if (source.asOf !== null && source.asOf !== undefined && !asOf) fail('INVALID_SOURCE', `${path}.asOf must be an ISO-compatible date or null`);
  if (source.sourceChecksum !== null && source.sourceChecksum !== undefined && !sourceChecksum) fail('INVALID_SOURCE', `${path}.sourceChecksum must be a non-empty string or null`);
  if (source.providerSeriesId !== null && source.providerSeriesId !== undefined && !providerSeriesId) fail('INVALID_SOURCE', `${path}.providerSeriesId must be a non-empty string or null`);
  if (source.providerId !== null && source.providerId !== undefined && !providerId) fail('INVALID_SOURCE', `${path}.providerId must be a non-empty string or null`);
  if (numeric && evidenceStatus === 'source-verified' && (!id || !url || !asOf)) fail('UNTRACEABLE_DENOMINATOR', `${path} source-verified denominators need id, url, and asOf`);
  if (numeric && evidenceStatus === 'quarantined') fail('QUARANTINED_DENOMINATOR', `${path} cannot be used as a numeric denominator while quarantined`);
  if (numeric && evidenceStatus !== 'provider-reported' && evidenceStatus !== 'source-verified') fail('UNVERIFIED_DENOMINATOR', `${path}.evidenceStatus must be provider-reported or source-verified for a numeric denominator`);
  if (numeric && evidenceStatus === 'source-verified' && (!url || !asOf)) fail('UNTRACEABLE_DENOMINATOR', `${path} source-verified denominators need url and asOf`);
  if (numeric && evidenceStatus === 'provider-reported' && !id && !providerSeriesId) fail('UNTRACEABLE_DENOMINATOR', `${path} provider-reported denominators need source id or providerSeriesId`);
  return { id, url, asOf, status, confidence, evidenceStatus, sourceChecksum, providerSeriesId, providerId, language };
}

function baselineObject(baseline, path = 'baseline') {
  if (!isObject(baseline)) fail('INVALID_BASELINE', `${path} must be an object`);
  const kind = stringValue(baseline.denominatorKind ?? baseline.kind);
  if (!BASELINE_KINDS.has(kind)) fail('INVALID_BASELINE_KIND', `${path}.kind must be official-total, provider-total, or unknown`);
  const value = baseline.value === null || baseline.value === undefined ? null : numericValue(baseline.value);
  if (kind === 'unknown' && value !== null) fail('UNKNOWN_HAS_VALUE', `${path} unknown denominators must keep value null`);
  if (kind !== 'unknown' && value === null) fail('NUMERIC_BASELINE_MISSING_VALUE', `${path} numeric denominators need a non-negative integer value`);
  const status = stringValue(baseline.status) || 'unknown';
  if (!BASELINE_STATUSES.has(status)) fail('INVALID_BASELINE_STATUS', `${path}.status must be complete, partial, or unknown`);
  const confidence = stringValue(baseline.confidence) || 'unverified';
  if (!CONFIDENCES.has(confidence)) fail('INVALID_BASELINE_CONFIDENCE', `${path}.confidence is not supported`);
  const declaredEvidenceStatus = stringValue(baseline.evidenceStatus) || (kind === 'official-total' ? 'source-verified' : kind === 'provider-total' ? 'provider-reported' : null);
  const sourceInput = isObject(baseline.source) && declaredEvidenceStatus && (!hasOwn(baseline.source, 'evidenceStatus') || baseline.source.evidenceStatus === 'unknown') ? { ...baseline.source, evidenceStatus: declaredEvidenceStatus } : baseline.source;
  const source = sourceObject(sourceInput, `${path}.source`, { numeric: kind !== 'unknown' });
  if (kind !== 'unknown' && status !== 'complete') fail('NUMERIC_BASELINE_NOT_COMPLETE', `${path} numeric denominators must have status complete`);
  const evidenceStatus = declaredEvidenceStatus || source.evidenceStatus;
  if (!EVIDENCE_STATUSES.has(evidenceStatus)) fail('INVALID_EVIDENCE_STATUS', `${path}.evidenceStatus is not supported`);
  const reportedValue = baseline.reportedValue === null || baseline.reportedValue === undefined ? null : numericValue(baseline.reportedValue);
  if (baseline.reportedValue !== null && baseline.reportedValue !== undefined && reportedValue === null) fail('INVALID_REPORTED_VALUE', `${path}.reportedValue must be a non-negative integer or null`);
  const quarantineReason = baseline.quarantineReason === null || baseline.quarantineReason === undefined ? null : stringValue(baseline.quarantineReason);
  if (baseline.quarantineReason !== null && baseline.quarantineReason !== undefined && !quarantineReason) fail('INVALID_QUARANTINE_REASON', `${path}.quarantineReason must be a non-empty string or null`);
  if (evidenceStatus === 'quarantined' && kind !== 'unknown') fail('QUARANTINED_DENOMINATOR', `${path} quarantined evidence cannot be a numeric denominator`);
  if (kind === 'official-total' && (source.status !== 'verified' || source.confidence !== 'high' || evidenceStatus !== 'source-verified')) {
    fail('OFFICIAL_BASELINE_NOT_VERIFIED', `${path} official totals require a verified, high-confidence source`);
  }
  return { kind, denominatorKind: kind, value, status, confidence, evidenceStatus, reportedValue, quarantineReason, source };
}

function isNumericBaseline(baseline) {
  return baseline?.kind === 'official-total' || baseline?.kind === 'provider-total';
}

function ensureNoNumericOverlap(parent, children, path) {
  if (isNumericBaseline(parent) && children.some(child => isNumericBaseline(child))) {
    fail('OVERLAPPING_NUMERIC_BASELINES', `${path} has a numeric parent and numeric child denominator; choose one scope to avoid double counting`);
  }
}

function validateSeries(series, path, gameId, region = null) {
  if (!isObject(series)) fail('INVALID_SERIES', `${path} must be an object`);
  const seriesId = stringValue(series.seriesId ?? series.id ?? series.officialCode ?? series.official_code);
  if (!seriesId) fail('MISSING_SERIES_ID', `${path} needs seriesId`);
  const seriesRegion = normalizeRegion(series.region ?? region);
  if (seriesRegion !== normalizeRegion(region)) fail('SERIES_REGION_MISMATCH', `${path}.region must match its containing region`);
  const baseline = baselineObject(series.baseline, `${path}.baseline`);
  const providerSeriesId = stringValue(series.providerSeriesId ?? series.provider_series_id);
  const providerId = stringValue(series.providerId ?? series.provider_id ?? series.provider);
  const language = stringValue(series.language)?.toLowerCase() || null;
  const approvedDynamic = series.approvedDynamic === true;
  if (approvedDynamic && (!providerId || !language)) fail('UNSCOPED_APPROVED_SERIES', `${path} approvedDynamic series need providerId and language`);
  return { gameId, region: seriesRegion, seriesId, providerSeriesId, providerId, language, approvedDynamic, baseline };
}

function validateGame(game, index) {
  const path = `games[${index}]`;
  if (!isObject(game)) fail('INVALID_GAME', `${path} must be an object`);
  const gameId = stringValue(game.gameId);
  if (!gameId) fail('MISSING_GAME_ID', `${path}.gameId is required`);
  const baseline = baselineObject(game.baseline, `${path}.baseline`);
  const regions = Array.isArray(game.regions) ? game.regions : [];
  const regionIds = new Set();
  const validatedRegions = [];
  for (const [regionIndex, region] of regions.entries()) {
    const regionPath = `${path}.regions[${regionIndex}]`;
    if (!isObject(region)) fail('INVALID_REGION', `${regionPath} must be an object`);
    const regionId = normalizeRegion(region.region);
    if (!regionId) fail('MISSING_REGION', `${regionPath}.region is required`);
    if (regionIds.has(regionId)) fail('DUPLICATE_REGION_SCOPE', `${gameId}/${regionId} appears more than once`);
    regionIds.add(regionId);
    const regionBaseline = baselineObject(region.baseline, `${regionPath}.baseline`);
    const seriesRows = Array.isArray(region.series) ? region.series : [];
    const seriesIds = new Set();
    const series = [];
    for (const [seriesIndex, row] of seriesRows.entries()) {
      const validated = validateSeries(row, `${regionPath}.series[${seriesIndex}]`, gameId, regionId);
      if (seriesIds.has(validated.seriesId)) fail('DUPLICATE_SERIES_SCOPE', `${gameId}/${regionId}/${validated.seriesId} appears more than once`);
      seriesIds.add(validated.seriesId);
      series.push(validated);
    }
    ensureNoNumericOverlap(regionBaseline, series.map(item => item.baseline), regionPath);
    validatedRegions.push({ region: regionId, baseline: regionBaseline, series });
  }
  const gameSeriesRows = Array.isArray(game.series) ? game.series : [];
  const gameSeriesIds = new Set();
  const gameSeries = [];
  for (const [seriesIndex, row] of gameSeriesRows.entries()) {
    const validated = validateSeries(row, `${path}.series[${seriesIndex}]`, gameId, null);
    if (gameSeriesIds.has(validated.seriesId)) fail('DUPLICATE_SERIES_SCOPE', `${gameId}/${validated.seriesId} appears more than once`);
    gameSeriesIds.add(validated.seriesId);
    gameSeries.push(validated);
  }
  ensureNoNumericOverlap(baseline, [
    ...validatedRegions.map(region => region.baseline),
    ...gameSeries.map(item => item.baseline)
  ], path);
  return { gameId, nameZh: stringValue(game.nameZh) || gameId, baseline, regions: validatedRegions, series: gameSeries };
}

export function validateCatalogBaselineRegistry(input = registry) {
  if (!isObject(input)) fail('INVALID_REGISTRY', 'registry must be an object');
  if (input.schemaVersion !== 1) fail('UNSUPPORTED_SCHEMA_VERSION', 'only schemaVersion 1 is supported');
  if (!stringValue(input.registryVersion)) fail('MISSING_REGISTRY_VERSION', 'registryVersion is required');
  if (!dateLike(input.reviewedAt)) fail('INVALID_REVIEWED_AT', 'reviewedAt must be an ISO-compatible date');
  if (!isObject(input.policy)) fail('INVALID_POLICY', 'policy must be an object');
  if (!Array.isArray(input.policy.allowedDenominatorKinds) || !input.policy.allowedDenominatorKinds.every(kind => BASELINE_KINDS.has(kind))) {
    fail('INVALID_POLICY', 'policy.allowedDenominatorKinds must list supported denominator kinds');
  }
  if (!Array.isArray(input.policy.approvedSeriesMetadataKeys) || !input.policy.approvedSeriesMetadataKeys.every(key => typeof key === 'string' && key.trim())) {
    fail('INVALID_POLICY', 'policy.approvedSeriesMetadataKeys must list non-empty metadata keys');
  }
  if (input.policy.evidenceStatuses !== undefined && (!Array.isArray(input.policy.evidenceStatuses) || !input.policy.evidenceStatuses.every(status => EVIDENCE_STATUSES.has(status)))) {
    fail('INVALID_POLICY', 'policy.evidenceStatuses must list supported evidence statuses');
  }
  if (input.policy.quarantineSeriesIds !== undefined && (!Array.isArray(input.policy.quarantineSeriesIds) || !input.policy.quarantineSeriesIds.every(value => typeof value === 'string' && value.trim()))) {
    fail('INVALID_POLICY', 'policy.quarantineSeriesIds must list non-empty series identifiers');
  }
  if (!Array.isArray(input.games)) fail('INVALID_GAMES', 'games must be an array');
  const gameIds = new Set();
  const games = [];
  for (const [index, game] of input.games.entries()) {
    const validated = validateGame(game, index);
    if (gameIds.has(validated.gameId)) fail('DUPLICATE_GAME_SCOPE', `${validated.gameId} appears more than once`);
    gameIds.add(validated.gameId);
    games.push(validated);
  }
  for (const gameId of REQUIRED_GAME_IDS) if (!gameIds.has(gameId)) fail('MISSING_REQUIRED_GAME', `${gameId} is missing from the registry`);
  return { ...input, games };
}

export const CATALOG_BASELINE_REGISTRY = validateCatalogBaselineRegistry(registry);

function sourceFromRow(row, metadata = {}) {
  const sourceValue = isObject(row?.source) ? row.source : {};
  const id = stringValue(metadata.sourceId ?? row?.sourceId ?? row?.source_id ?? sourceValue.id ?? (typeof row?.source === 'string' ? row.source : null));
  const url = stringValue(metadata.sourceUrl ?? row?.sourceUrl ?? row?.source_url ?? sourceValue.url);
  const asOf = dateLike(metadata.asOf ?? row?.asOf ?? row?.as_of ?? row?.updatedAt ?? row?.updated_at ?? sourceValue.asOf);
  const status = stringValue(metadata.sourceStatus ?? row?.sourceStatus ?? row?.source_status ?? sourceValue.status) || SOURCE_STATUS_FALLBACK;
  const confidence = stringValue(metadata.sourceConfidence ?? row?.sourceConfidence ?? row?.source_confidence ?? row?.confidence ?? sourceValue.confidence) || SOURCE_CONFIDENCE_FALLBACK;
  const sourceChecksum = stringValue(metadata.sourceChecksum ?? row?.sourceChecksum ?? row?.source_checksum ?? sourceValue.sourceChecksum);
  const providerSeriesId = stringValue(metadata.providerSeriesId ?? row?.providerSeriesId ?? row?.provider_series_id ?? row?.providerId ?? row?.provider_id ?? sourceValue.providerSeriesId);
  const providerId = stringValue(metadata.providerId ?? row?.provider ?? row?.providerName ?? sourceValue.providerId ?? id);
  const language = stringValue(metadata.language ?? row?.language ?? sourceValue.language)?.toLowerCase() || null;
  const explicitEvidenceStatus = stringValue(metadata.evidenceStatus ?? row?.evidenceStatus ?? row?.evidence_status ?? sourceValue.evidenceStatus);
  return { id, url, asOf, status, confidence, evidenceStatus: explicitEvidenceStatus || 'unknown', sourceChecksum, providerSeriesId, providerId, language };
}

function sourceIsTraceable(source) {
  if (source.evidenceStatus === 'source-verified') return Boolean(source.id && source.url && source.asOf);
  if (source.evidenceStatus === 'provider-reported') return Boolean((source.id || source.providerSeriesId) && source.status !== 'unknown');
  return false;
}

function normalizeCode(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s._-]/g, '');
}

function isQuarantinedSeries(seriesId, policy = {}) {
  const configured = Array.isArray(policy.quarantineSeriesIds) ? policy.quarantineSeriesIds : [...DEFAULT_QUARANTINE_SERIES_IDS];
  return new Set(configured.map(normalizeCode)).has(normalizeCode(seriesId));
}

function uniqueSources(records) {
  const seen = new Set();
  return records.map(record => record?.source || record?.baseline?.source).filter(Boolean).filter(source => {
    const key = [source.id, source.url, source.asOf, source.status, source.confidence].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function baselineFromSeriesRecords(records, label) {
  if (!records.length) return null;
  const known = records.filter(record => isNumericBaseline(record.baseline));
  const sources = uniqueSources(records);
  const knownValue = known.reduce((sum, record) => sum + record.baseline.value, 0);
  const reportedValue = records.reduce((sum, record) => sum + (numericValue(record.baseline?.reportedValue) ?? (isNumericBaseline(record.baseline) ? record.baseline.value : 0)), 0);
  const quarantined = records.filter(record => record.baseline?.evidenceStatus === 'quarantined');
  const evidenceStatus = quarantined.length ? 'quarantined' : known.length ? (known.every(record => record.baseline.evidenceStatus === 'source-verified') ? 'source-verified' : 'provider-reported') : 'unknown';
  const providerSeriesIds = [...new Set(records.map(record => record.baseline?.providerSeriesId || record.source?.providerSeriesId).filter(Boolean))];
  const sourceChecksums = [...new Set(records.map(record => record.baseline?.sourceChecksum || record.source?.sourceChecksum).filter(Boolean))];
  if (known.length === records.length) {
    const allOfficial = known.every(record => record.baseline.kind === 'official-total');
    return {
      kind: allOfficial ? 'official-total' : 'provider-total',
      denominatorKind: allOfficial ? 'official-total' : 'provider-total',
      value: knownValue,
      status: 'complete',
      confidence: new Set(known.map(record => record.baseline.confidence)).size === 1 ? known[0].baseline.confidence : 'mixed',
      evidenceStatus,
      reportedValue: knownValue,
      quarantineReason: null,
      providerSeriesId: providerSeriesIds.length === 1 ? providerSeriesIds[0] : null,
      providerSeriesIds,
      sourceChecksum: sourceChecksums.length === 1 ? sourceChecksums[0] : null,
      sourceChecksums,
      source: sources.length === 1 ? sources[0] : null,
      sources,
      evidenceCount: known.length,
      scope: label
    };
  }
  return {
    kind: 'unknown',
    denominatorKind: 'unknown',
    value: null,
    status: known.length ? 'partial' : 'unknown',
    confidence: known.length ? 'mixed' : 'unverified',
    evidenceStatus,
    reportedValue: reportedValue || null,
    quarantineReason: quarantined.length ? '一個以上 provider 系列被隔離，未將其回報數字視為完整分母。' : null,
    providerSeriesId: providerSeriesIds.length === 1 ? providerSeriesIds[0] : null,
    providerSeriesIds,
    sourceChecksum: sourceChecksums.length === 1 ? sourceChecksums[0] : null,
    sourceChecksums,
    source: sources.length === 1 ? sources[0] : null,
    sources,
    knownTotal: knownValue || null,
    knownSeriesCount: known.length,
    seriesCount: records.length,
    scope: label
  };
}

function staticSeriesRecord(gameId, region, series) {
  return { gameId, region, seriesId: series.seriesId, providerSeriesId: series.providerSeriesId, providerId: series.providerId, language: series.language, approvedDynamic: series.approvedDynamic, baseline: series.baseline, source: series.baseline.source, accepted: isNumericBaseline(series.baseline), reason: null };
}

function recordProviderSeriesId(record) {
  return record?.providerSeriesId || record?.baseline?.providerSeriesId || record?.baseline?.source?.providerSeriesId || null;
}

function recordProviderId(record) {
  return record?.providerId || record?.baseline?.source?.providerId || record?.baseline?.source?.id || null;
}

function recordLanguage(record) {
  return record?.language || record?.baseline?.source?.language || null;
}

function recordScopeKey(record) {
  const providerId = recordProviderId(record), language = recordLanguage(record);
  return providerId && language ? `${providerId}|${language}` : null;
}

function registrySeriesMatches(declaration, record) {
  if (!declaration?.approvedDynamic) return false;
  const sameSeriesId = declaration.seriesId === record.seriesId;
  const sameProviderSeriesId = declaration.providerSeriesId && recordProviderSeriesId(record) && declaration.providerSeriesId === recordProviderSeriesId(record);
  if (!sameSeriesId && !sameProviderSeriesId) return false;
  if (declaration.providerId && declaration.providerId !== recordProviderId(record)) return false;
  if (declaration.language && declaration.language !== recordLanguage(record)) return false;
  return true;
}

function unapprovedDynamicRecord(record, reason) {
  return {
    ...record,
    accepted: false,
    reason,
    baseline: {
      ...record.baseline,
      kind: 'unknown',
      denominatorKind: 'unknown',
      value: null,
      status: 'unknown',
      confidence: 'unverified',
      quarantineReason: record.baseline.evidenceStatus === 'quarantined' ? record.baseline.quarantineReason : reason
    }
  };
}

function blockedBaseline(records, label, reason) {
  const candidate = baselineFromSeriesRecords(records, label) || {
    kind: 'unknown', denominatorKind: 'unknown', value: null, status: 'unknown', confidence: 'unverified', evidenceStatus: 'unknown', reportedValue: null, quarantineReason: null, providerSeriesId: null, sourceChecksum: null, source: null, sources: [], scope: label
  };
  const knownTotal = candidate.knownTotal ?? (isNumericBaseline(candidate) ? candidate.value : candidate.reportedValue) ?? null;
  return {
    ...candidate,
    kind: 'unknown',
    denominatorKind: 'unknown',
    value: null,
    status: knownTotal === null ? 'unknown' : 'partial',
    knownTotal,
    quarantineReason: candidate.quarantineReason || reason,
    scope: label
  };
}

function dynamicSeriesRecord(row, policy) {
  const gameId = normalizeGameId(row);
  const region = normalizeRegion(row?.region);
  const seriesId = normalizeSeriesId(row);
  if (!gameId || !seriesId) return null;
  const metadata = isObject(row?.metadata) ? row.metadata : {};
  const keys = Array.isArray(policy?.approvedSeriesMetadataKeys) ? policy.approvedSeriesMetadataKeys : ['printedTotal', 'total', 'cardCount'];
  const key = keys.find(candidate => hasOwn(metadata, candidate));
  const rawValue = key ? metadata[key] : null;
  const parsedValue = key && rawValue !== null && rawValue !== undefined ? numericValue(rawValue) : null;
  const source = sourceFromRow(row, metadata);
  const quarantined = isQuarantinedSeries(source.providerSeriesId || seriesId, policy);
  const evidenceStatus = quarantined ? 'quarantined' : source.evidenceStatus !== 'unknown' ? source.evidenceStatus : key && parsedValue !== null && (source.id || source.providerSeriesId) ? 'provider-reported' : 'unknown';
  source.evidenceStatus = evidenceStatus;
  if (source.status === 'unknown' && evidenceStatus === 'provider-reported') source.status = 'provider-reported';
  const denominatorKind = stringValue(metadata.denominatorKind ?? row?.denominatorKind) || 'provider-total';
  const sourceReady = sourceIsTraceable(source);
  const officialReady = denominatorKind === 'official-total' && source.status === 'verified' && source.confidence === 'high';
  const validKind = BASELINE_KINDS.has(denominatorKind) && denominatorKind !== 'unknown';
  const accepted = parsedValue !== null && validKind && evidenceStatus !== 'quarantined' && sourceReady && (denominatorKind !== 'official-total' || officialReady);
  const reason = quarantined ? 'series is quarantined until its provider total and scope are verified' : !key ? 'series metadata has no approved total field' : parsedValue === null && rawValue !== null && rawValue !== undefined ? 'approved total field is not a non-negative integer' : !validKind ? 'denominator kind is not approved' : !sourceReady ? 'numeric denominator is missing traceable source evidence' : denominatorKind === 'official-total' && !officialReady ? 'official total needs verified high-confidence evidence' : null;
  return {
    gameId,
    region,
    seriesId,
    providerSeriesId: source.providerSeriesId,
    providerId: source.providerId,
    language: source.language,
    baseline: accepted ? {
      kind: denominatorKind,
      denominatorKind,
      value: parsedValue,
      status: 'complete',
      confidence: source.confidence,
      evidenceStatus,
      reportedValue: parsedValue,
      quarantineReason: null,
      providerSeriesId: source.providerSeriesId,
      sourceChecksum: source.sourceChecksum,
      source,
      sources: [source],
      evidenceCount: 1,
      scope: `series:${gameId}:${region || '*'}:${seriesId}`
    } : {
      kind: 'unknown',
      denominatorKind: 'unknown',
      value: null,
      status: evidenceStatus === 'quarantined' ? 'unknown' : 'unknown',
      confidence: 'unverified',
      evidenceStatus,
      reportedValue: parsedValue,
      quarantineReason: evidenceStatus === 'quarantined' ? reason : null,
      providerSeriesId: source.providerSeriesId,
      sourceChecksum: source.sourceChecksum,
      source,
      sources: source.id || source.url || source.providerSeriesId || source.sourceChecksum ? [source] : [],
      scope: `series:${gameId}:${region || '*'}:${seriesId}`
    },
    accepted,
    reason
  };
}

function gameTemplate(game) {
  return {
    gameId: game.gameId,
    nameZh: game.nameZh,
    baseline: game.baseline,
    regions: game.regions.map(region => ({ region: region.region, baseline: region.baseline, series: region.series.map(series => staticSeriesRecord(game.gameId, region.region, series)), limitations: [] })),
    series: game.series.map(series => staticSeriesRecord(game.gameId, null, series)),
    limitations: []
  };
}

export function extractSeriesBaseline(row, { registry: sourceRegistry = CATALOG_BASELINE_REGISTRY } = {}) {
  const validated = validateCatalogBaselineRegistry(sourceRegistry);
  const gameId = normalizeGameId(row);
  const game = validated.games.find(item => item.gameId === gameId);
  if (!game) fail('UNKNOWN_GAME', `${gameId || '<missing>'} is not registered`);
  const record = dynamicSeriesRecord(row, validated.policy);
  if (!record) return null;
  const declarations = record.region ? game.regions.find(item => item.region === record.region)?.series || [] : game.series;
  const declaration = declarations.find(item => registrySeriesMatches(item, record));
  if (!declaration) return unapprovedDynamicRecord(record, 'series metadata 未在 registry 逐系列明示核准，只保留 candidate/unknown。');
  return {...record,registrySeries:declaration,approvedDynamic:true};
}

export function aggregateCatalogBaselines({ series = [], registry: sourceRegistry = CATALOG_BASELINE_REGISTRY } = {}) {
  const validated = validateCatalogBaselineRegistry(sourceRegistry);
  if (!Array.isArray(series)) fail('INVALID_SERIES_ROWS', 'series must be an array');
  const dynamic = [];
  const seenScopes = new Set();
  const seenProviderScopes = new Set();
  for (const row of series) {
    let record = dynamicSeriesRecord(row, validated.policy);
    if (!record) continue;
    const game = validated.games.find(item => item.gameId === record.gameId);
    if (!game) fail('UNKNOWN_GAME', `${record.gameId || '<missing>'} is not registered`);
    const declarations = record.region ? game.regions.find(item => item.region === record.region)?.series || [] : game.series;
    const declaration = declarations.find(item => registrySeriesMatches(item, record));
    if (!declaration) record = unapprovedDynamicRecord(record, 'series metadata 未在 registry 逐系列明示核准，只保留 candidate/unknown。');
    else {
      record.registrySeries = declaration;
      if (isNumericBaseline(declaration.baseline)) fail('DUPLICATE_SERIES_SCOPE', `${record.gameId}|${record.region || '*'}|${record.seriesId} is already represented by a numeric registry baseline`);
    }
    const key = `${record.gameId}|${record.region || '*'}|${record.seriesId}`;
    if (seenScopes.has(key)) fail('DUPLICATE_SERIES_SCOPE', `${key} appears more than once in provider metadata`);
    const providerSeriesId = recordProviderSeriesId(record);
    if (providerSeriesId) {
      const providerKey = `${record.gameId}|${record.region || '*'}|${providerSeriesId}`;
      if (seenProviderScopes.has(providerKey)) fail('DUPLICATE_PROVIDER_SERIES_SCOPE', `${providerKey} appears more than once in provider metadata`);
      seenProviderScopes.add(providerKey);
    }
    seenScopes.add(key);
    dynamic.push(record);
  }
  const games = validated.games.map(game => {
    const output = gameTemplate(game);
    const dynamicByRegion = new Map();
    const dynamicGameSeries = [];
    for (const record of dynamic.filter(item => item.gameId === game.gameId)) {
      if (record.region) {
        const list = dynamicByRegion.get(record.region) || [];
        list.push(record);
        dynamicByRegion.set(record.region, list);
      } else dynamicGameSeries.push(record);
    }
    const allRegionIds = new Set([...output.regions.map(region => region.region), ...dynamicByRegion.keys()]);
    for (const regionId of allRegionIds) {
      let region = output.regions.find(item => item.region === regionId);
      if (!region) {
        region = { region: regionId, baseline: { kind: 'unknown', value: null, status: 'unknown', confidence: 'unverified', source: null, sources: [] }, series: [], limitations: ['此地區由 provider metadata 發現，尚未登錄在 baseline registry。'] };
        output.regions.push(region);
      }
      const dynamicRows = dynamicByRegion.get(regionId) || [];
      for (const dynamicRow of dynamicRows) {
        const existingIndex = dynamicRow.registrySeries ? region.series.findIndex(item => item.seriesId === dynamicRow.registrySeries.seriesId && item.providerId === dynamicRow.registrySeries.providerId && item.language === dynamicRow.registrySeries.language) : -1;
        if (existingIndex >= 0 && region.series[existingIndex].approvedDynamic === true) {
          dynamicRow.approvedDynamic = true;
          region.series[existingIndex] = dynamicRow;
        } else region.series.push(dynamicRow);
      }
      const staticNumeric = isNumericBaseline(region.baseline);
      if (staticNumeric) {
        if (dynamicRows.length) region.limitations.push('已採用明確的地區分母；系列 provider total 被排除以避免重複計算。');
        continue;
      }
      const seriesRecords = region.series;
      const numericSeries = seriesRecords.filter(record => isNumericBaseline(record.baseline));
      const scopeKeys = new Set(numericSeries.map(recordScopeKey).filter(Boolean));
      const unscopedNumeric = numericSeries.some(record => !recordScopeKey(record));
      const canAggregate = numericSeries.length > 0 && numericSeries.length === seriesRecords.length && (numericSeries.length === 1 || (!unscopedNumeric && scopeKeys.size === 1));
      const aggregated = canAggregate ? baselineFromSeriesRecords(seriesRecords, `region:${game.gameId}:${regionId}`) : numericSeries.length > 0 ? blockedBaseline(seriesRecords, `region:${game.gameId}:${regionId}`, scopeKeys.size > 1 ? '同一地區含多個 provider/language scope，未跨來源聚合。' : '系列未形成單一可核准的 provider/language scope，未產生數字分母。') : baselineFromSeriesRecords(seriesRecords, `region:${game.gameId}:${regionId}`);
      if (aggregated) {
        region.baseline = aggregated;
        if (aggregated.status !== 'complete') region.limitations.push(scopeKeys.size > 1 ? '同一地區含多個 provider/language scope，未跨來源聚合。' : '系列資料只有部分具備可追溯分母，未把已知小計當成完整地區分母。');
      }
    }
    const numericGameBaseline = isNumericBaseline(output.baseline);
    if (numericGameBaseline) {
      if (output.regions.some(region => isNumericBaseline(region.baseline)) || dynamicGameSeries.length) output.limitations.push('已採用 registry 明示的 IP 分母；地區與系列分母不再相加。');
    } else {
      const numericRegions = output.regions.filter(region => isNumericBaseline(region.baseline));
      const gameSeries = [...output.series, ...dynamicGameSeries];
      const numericGameSeries = gameSeries.filter(record => isNumericBaseline(record.baseline));
      if (numericRegions.length || numericGameSeries.length) {
        const evidence = [
          ...numericRegions.map(region => ({ baseline: region.baseline, source: region.baseline.source })),
          ...gameSeries
        ];
        output.baseline = blockedBaseline(evidence, `game:${game.gameId}`, 'IP 層 expected total 只能採用 registry 明示的單一 game official-total；不可由地區或 dynamic series 相加。');
        output.limitations.push('IP 層不由地區或系列動態加總；請在 registry 明示單一 game official-total 後才提供完整分母。');
      }
    }
    if (output.baseline.kind === 'unknown' && output.baseline.status === 'unknown') output.limitations.push('尚無可核對的官方或 provider 完整分母，expected total 維持 null。');
    return output;
  });
  const knownGames = games.filter(game => isNumericBaseline(game.baseline));
  return {
    schemaVersion: validated.schemaVersion,
    registryVersion: validated.registryVersion,
    reviewedAt: validated.reviewedAt,
    games,
    summary: {
      gameCount: games.length,
      knownGameCount: knownGames.length,
      status: knownGames.length === games.length ? 'complete' : knownGames.length ? 'partial' : 'unknown',
      limitations: validated.policy.limitations
    }
  };
}

export const buildCatalogBaseline = aggregateCatalogBaselines;

export default CATALOG_BASELINE_REGISTRY;
