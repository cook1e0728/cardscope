import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, runSnapshotJob } from '../scripts/background-job.mjs';

// scripts/background-job.mjs：Render 停用後，原本的計時器工作改由 GitHub Actions 一次跑一輪。
const env = { SUPABASE_URL: 'https://main.example', SUPABASE_SERVICE_KEY: 'k1', SUPABASE2_URL: 'https://ip2.example', SUPABASE2_SERVICE_KEY: 'k2' };

test('createDb: main by default, ip2 only when asked, main-only tables always main', async () => {
  const seen = [];
  const db = createDb(env, async (url, init) => { seen.push([url, init.headers.apikey]); return new Response('[{"ok":1}]'); });
  assert.deepEqual(await db('/tcg_cards?limit=1'), [{ ok: 1 }]);
  await db('/tcg_cards?limit=1', { db: 'ip2' });
  await db('/catalog_sync_runs?limit=1', { db: 'ip2' });
  assert.deepEqual(seen, [
    ['https://main.example/rest/v1/tcg_cards?limit=1', 'k1'],
    ['https://ip2.example/rest/v1/tcg_cards?limit=1', 'k2'],
    ['https://main.example/rest/v1/catalog_sync_runs?limit=1', 'k1']
  ]);
  const failing = createDb(env, async () => new Response('nope', { status: 500 }));
  await assert.rejects(failing('/x'), /SUPABASE_500:nope/);
});

test('runSnapshotJob: a finished day waits; otherwise it resumes the cursor with a deadline', async () => {
  const now = () => Date.parse('2026-11-25T12:00:00Z');
  const completed = async () => [{ id: 1, status: 'completed', started_at: '2026-11-25T06:00:00Z', metadata: {} }];
  assert.equal((await runSnapshotJob({ db: completed, now, run: () => assert.fail('must not run') })).status, 'wait');
  const cut = async () => [{ id: 7, status: 'failed', error: 'TIME_BUDGET', cursor: 'ja:123', started_at: '2026-11-25T06:00:00Z', metadata: {} }];
  let options;
  await runSnapshotJob({ db: cut, now, budgetMinutes: 10, run: async opts => { options = opts; return { status: 'completed' }; } });
  assert.equal(options.cursor, 'ja:123');
  assert.equal(options.resumedFrom, 7);
  assert.equal(options.deadline, now() + 10 * 60000);
});

test('runPriceSnapshot: the deadline is checked between chunks and ends the run as TIME_BUDGET (resumable, not ABORTED)', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../providers/price-snapshot.mjs', import.meta.url), 'utf8');
  assert.match(source, /cursor: resumeCursor = null, resumedFrom = null, deadline = null,/);
  assert.ok(source.includes("if (deadline && now() >= deadline) { stopReason = 'TIME_BUDGET'; break; }"));
  assert.ok(source.indexOf("stopReason = 'TIME_BUDGET'") < source.indexOf('const chunk = page.items.slice(i, i + chunkSize);'), 'checked before a chunk starts, so the cursor stays on a finished chunk');
  assert.equal((await import('../providers/price-snapshot.mjs')).planNextSnapshotRun.length, 1);
});

test('tcgapi images only on Mondays (UTC); other days the whole budget goes to prices', async () => {
  const { tcgapiImagesDue } = await import('../scripts/background-job.mjs');
  assert.equal(tcgapiImagesDue(new Date('2026-11-23T03:00:00Z')), true);
  assert.equal(tcgapiImagesDue(new Date('2026-11-25T03:00:00Z')), false);
});
