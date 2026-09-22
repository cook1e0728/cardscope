import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const sql=await readFile(new URL('../supabase/migrations/20260918082717_catalog_health_snapshot_v2.sql',import.meta.url),'utf8');
const optimizedSql=await readFile(new URL('../supabase/migrations/20260922065244_optimize_catalog_health_snapshot_v3.sql',import.meta.url),'utf8');
const workMemSql=await readFile(new URL('../supabase/migrations/20260922065933_tune_catalog_health_work_mem.sql',import.meta.url),'utf8');

test('health v2 is private, policy-driven, and keeps card and printing units separate',()=>{
  assert.match(sql,/catalog_health_snapshot_v2\(p_display_policies jsonb/);
  assert.match(sql,/security invoker/i);
  assert.match(sql,/revoke all on function public\.catalog_health_snapshot_v2\(jsonb\) from public, anon, authenticated/i);
  assert.match(sql,/grant execute on function public\.catalog_health_snapshot_v2\(jsonb\) to service_role/i);
  assert.match(sql,/'cardsWithDisplayableImages'/);
  assert.match(sql,/'printingsWithDisplayableImages'/);
  assert.match(sql,/'cardsDisplayableOnlyByRiskAcceptance'/);
  assert.match(sql,/'unmappedImageUrlRecords'/);
});

test('optimized catalog health snapshot preserves access controls and scans each asset table once',()=>{
  assert.match(optimizedSql,/create or replace function public\.catalog_health_snapshot_v2\(p_display_policies jsonb/);
  assert.match(optimizedSql,/with printing_base as materialized/);
  assert.match(optimizedSql,/from tcg_printings p/);
  assert.match(optimizedSql,/from card_images\s+group by card_id/);
  assert.doesNotMatch(optimizedSql,/union all/);
  assert.match(optimizedSql,/security invoker/);
  assert.match(optimizedSql,/revoke all on function public\.catalog_health_snapshot_v2\(jsonb\) from public, anon, authenticated/i);
  assert.match(optimizedSql,/grant execute on function public\.catalog_health_snapshot_v2\(jsonb\) to service_role/i);
});

test('catalog health memory tuning is function-scoped and does not raise global timeouts',()=>{
  assert.match(workMemSql,/alter function public\.catalog_health_snapshot_v2\(jsonb\)\s+set work_mem = '64MB'/i);
  assert.doesNotMatch(workMemSql,/alter (role|database)/i);
  assert.doesNotMatch(workMemSql,/statement_timeout/i);
});
