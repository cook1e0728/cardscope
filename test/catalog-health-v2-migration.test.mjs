import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const sql=await readFile(new URL('../supabase/migrations/20260918082717_catalog_health_snapshot_v2.sql',import.meta.url),'utf8');

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
