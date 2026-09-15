import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migrationUrl=new URL('../supabase/migrations/20260915_pokemon_rarity_candidate_promotion.sql',import.meta.url);

test('rarity promotion is private, bounded, exact-match, and image-free',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  assert.match(sql,/candidate count must be between 1 and 100/);
  assert.match(sql,/c\.source <> 'tcgdex-zh-tw'/);
  assert.match(sql,/c\.game_id <> 'pokemon'/);
  assert.match(sql,/c\.matching_method <> 'provider-id'/);
  assert.match(sql,/security invoker/i);
  assert.match(sql,/set search_path = ''/i);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/for update/);
  assert.match(sql,/revoke all on function[^;]+from public, anon, authenticated/i);
  assert.match(sql,/grant execute on function[^;]+to service_role/i);
  assert.doesNotMatch(sql,/update public\.tcg_printings[\s\S]*?image_url\s*=/i);
});

test('promotion only fills blank rarity targets and supports an idempotent replay',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  assert.match(sql,/nullif\(btrim\(card\.rarity\), ''\) is null/);
  assert.match(sql,/nullif\(btrim\(printing\.rarity_code\), ''\) is null/);
  assert.match(sql,/promoted replay no longer matches its target/);
  assert.match(sql,/'replay', true/);
  assert.match(sql,/candidate promotion count mismatch/);
});
