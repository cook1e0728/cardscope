import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260926200419_repair_pokemon_tw_printing_rarity.sql', import.meta.url);

test('TW rarity repair freezes the reviewed manifest and relies on the migration runner transaction', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  const firstLockIndex = sql.search(/pg_advisory_xact_lock/i);
  assert.ok(firstLockIndex > 0, 'advisory transaction lock exists');
  assert.ok(sql.toLowerCase().indexOf("set local lock_timeout = '5s';") < firstLockIndex);
  assert.ok(sql.toLowerCase().indexOf("set local statement_timeout = '120s';") < firstLockIndex);
  assert.doesNotMatch(sql, /^\s*begin;\s*$/im);
  assert.doesNotMatch(sql, /^\s*set transaction isolation level serializable;\s*$/im);
  assert.doesNotMatch(sql, /^\s*commit;\s*$/im);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /lock table public\.catalog_enrichment_candidates in share mode/i);
  assert.match(sql, /lock table public\.catalog_enrichment_promotion_batches in share mode/i);
  assert.match(sql, /v_candidate_count <> 796/);
  assert.match(sql, /v_candidate_id_count <> 796/);
  assert.match(sql, /v_distinct_candidate_target_count <> 786/);
  assert.match(sql, /v_authoritative_count <> 786/);
  assert.match(sql, /v_authoritative_candidate_id_count <> 786/);
  assert.match(sql, /v_authoritative_target_count <> 786/);
  assert.match(sql, /v_excluded_count <> 10/);
  assert.match(sql, /f36bae4f4f2e0bc5becfc9c0ccb7305e/);
  assert.match(sql, /where not c\.batch_record_exists[\s\S]*?c\.promotion_batch_id is distinct from 'pokemon-s10a-001-010-20260915'/i);
  assert.match(sql, /from public\.catalog_enrichment_promotion_batches b\s+where b\.promotion_batch_id = 'pokemon-s10a-001-010-20260915'/i);
  assert.doesNotMatch(sql, /is distinct from array\s*\[/i);
  assert.match(sql, /authoritative\.promoted_at <= legacy\.promoted_at/i);
  assert.match(sql, /authoritative\.promotion_batch_id is not distinct from legacy\.promotion_batch_id/i);
});

test('repair requires reviewed promotion evidence, exact joins, and ranked canonical rarity', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /c\.status = 'promoted'/);
  assert.match(sql, /c\.matching_method is distinct from 'provider-id'/i);
  assert.match(sql, /c\.reviewed_at is null/);
  assert.match(sql, /c\.promoted_at is null/);
  assert.match(sql, /c\.evidence ->> 'providerId' is distinct from c\.source_record_id/i);
  assert.match(sql, /c\.evidence ->> 'normalizedRarityCode' is distinct from \(c\.proposed_value #>> '\{\}'\)/i);
  assert.match(sql, /target\.printing_region is distinct from 'TW'/i);
  assert.match(sql, /target\.printing_source_locale is distinct from 'zh-Hant-TW'/i);
  assert.match(sql, /target\.printing_language is distinct from 'zh-Hant-TW'/i);
  assert.match(sql, /target\.candidate_locale is not null and target\.candidate_locale is distinct from target\.printing_source_locale/i);
  assert.match(sql, /target\.printing_set_code is distinct from \(target\.evidence ->> 'setCode'\)/i);
  assert.match(sql, /target\.printing_card_number is distinct from \(target\.evidence ->> 'cardNumber'\)/i);
  assert.match(sql, /target\.card_rarity is distinct from target\.proposed_rarity_code/i);
  assert.match(sql, /target\.canonical_rarity_tier is null/);
  assert.match(sql, /target\.canonical_rarity_label is null/);
});

test('repair updates only blank printing rarity fields and records append-only before/after audit', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /create table if not exists private\.catalog_printing_rarity_repair_audit/i);
  assert.match(sql, /before update or delete on private\.catalog_printing_rarity_repair_audit/i);
  assert.match(sql, /before truncate on private\.catalog_printing_rarity_repair_audit/i);
  assert.match(sql, /candidate_batch_refs jsonb not null/i);
  assert.match(sql, /before_snapshot jsonb not null/i);
  assert.match(sql, /after_snapshot jsonb not null/i);
  assert.match(sql, /candidate_ids bigint\[\] not null/i);
  assert.match(sql, /candidate_batch_refs is distinct from v_candidate_batch_refs/i);
  assert.match(sql, /nullif\(btrim\(target\.printing_rarity\), ''\) is not null/i);
  assert.match(sql, /nullif\(btrim\(target\.printing_rarity_code\), ''\) is not null/i);
  assert.match(sql, /nullif\(btrim\(target\.printing_rarity_label\), ''\) is not null/i);
  assert.match(sql, /set rarity = target\.proposed_rarity_code,[\s\S]*?rarity_code = target\.proposed_rarity_code,[\s\S]*?rarity_label = target\.canonical_rarity_label/i);
  assert.match(sql, /printing rarity repair update count mismatch/);
  assert.match(sql, /existing repair audit or current targets no longer match the exact repair/);
  assert.doesNotMatch(sql, /update\s+public\.catalog_enrichment_candidates/i);
  assert.doesNotMatch(sql, /update\s+public\.tcg_cards/i);
});
