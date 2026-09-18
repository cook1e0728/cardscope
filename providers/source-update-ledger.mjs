const clean = value => value == null ? null : String(value).trim() || null;

function iso(value) {
  if (!value) return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export function normalizeSourceUpdateState(source = {}) {
  const enabled = source.enabled !== false;
  const lastSuccessAt = iso(source.lastSuccessAt ?? source.last_success_at);
  const lastAttemptAt = iso(source.lastAttemptAt ?? source.last_attempt_at);
  const nextUpdateAt = enabled ? iso(source.nextUpdateAt ?? source.next_update_at) : null;
  const lastFailure = clean(source.lastFailure ?? source.last_failure ?? source.error);
  const retryCount = nonNegativeInteger(source.retryCount ?? source.retry_count);
  const status = !enabled
    ? 'disabled'
    : lastFailure ? 'failed'
      : lastSuccessAt ? 'healthy'
        : 'not-run';
  return {
    source: clean(source.source ?? source.id ?? source.name),
    enabled,
    status,
    lastSuccessAt,
    lastAttemptAt,
    nextUpdateAt,
    lastFailure,
    retry: {
      count: retryCount,
      status: !enabled ? 'disabled' : lastFailure ? 'pending' : 'idle'
    },
    limitation: clean(source.limitation ?? source.reason) || (!enabled ? 'source-disabled' : null)
  };
}

export function buildSourceUpdateLedger(sources = [], { generatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(sources)) throw new Error('INVALID_SOURCE_UPDATE_LEDGER');
  const rows = sources.map(normalizeSourceUpdateState).sort((left, right) => `${left.source || ''}`.localeCompare(`${right.source || ''}`));
  return {
    schemaVersion: 1,
    generatedAt: iso(generatedAt) || new Date().toISOString(),
    rows,
    summary: {
      total: rows.length,
      enabled: rows.filter(row => row.enabled).length,
      disabled: rows.filter(row => !row.enabled).length,
      failed: rows.filter(row => row.status === 'failed').length,
      pendingRetry: rows.filter(row => row.retry.status === 'pending').length
    },
    limitations: [
      'A source is not described as automatically updated unless enabled is true and a next update is scheduled.',
      'A failed attempt never replaces the last successful timestamp.'
    ]
  };
}
