import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceUpdateLedger, normalizeSourceUpdateState } from '../providers/source-update-ledger.mjs';

test('keeps the last successful observation when a later update fails', () => {
  const row = normalizeSourceUpdateState({
    source: 'tcgdex-zh-tw',
    lastSuccessAt: '2026-09-17T00:00:00Z',
    lastAttemptAt: '2026-09-18T00:00:00Z',
    lastFailure: 'timeout',
    retryCount: 2,
    nextUpdateAt: '2026-09-19T00:00:00Z'
  });
  assert.equal(row.status, 'failed');
  assert.equal(row.lastSuccessAt, '2026-09-17T00:00:00.000Z');
  assert.equal(row.lastFailure, 'timeout');
  assert.deepEqual(row.retry, { count: 2, status: 'pending' });
});

test('disabled sources are explicit and never claim a next automatic update', () => {
  const ledger = buildSourceUpdateLedger([
    { source: 'manual-official-check', enabled: false, nextUpdateAt: '2026-09-20T00:00:00Z', reason: 'manual-only' },
    { source: 'approved-api', enabled: true, lastSuccessAt: '2026-09-18T00:00:00Z', nextUpdateAt: '2026-09-19T00:00:00Z' }
  ], { generatedAt: '2026-09-18T01:00:00Z' });
  assert.equal(ledger.summary.disabled, 1);
  assert.equal(ledger.rows[1].status, 'disabled');
  assert.equal(ledger.rows[1].nextUpdateAt, null);
  assert.equal(ledger.rows[1].limitation, 'manual-only');
});
