import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260920062403_pokemon_tcgdex_trifield_promotion.sql', import.meta.url);

test('tri-field promotion stays private, bounded, exact, atomic and rights-aware', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /candidate count must be between 1 and 100/);
  assert.match(sql, /alter table public\.tcg_card_names[\s\S]+add column if not exists source text/);
  assert.match(sql, /add column if not exists metadata jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update/);
  assert.match(sql, /c\.source <> 'tcgdex-zh-tw'/);
  assert.match(sql, /c\.game_id <> 'pokemon'/);
  assert.match(sql, /c\.matching_method <> 'provider-id'/);
  assert.match(sql, /assets\[\.\]tcgdex\[\.\]net/);
  assert.match(sql, /image_rights_status = 'not-provided'/);
  assert.match(sql, /imageProbedAt/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /tcg_card_names/);
  assert.match(sql, /verifiedExistingNames/);
  assert.match(sql, /tcg_canonical_cards/);
  assert.match(sql, /catalog_enrichment_promotion_batches/);
  assert.match(sql, /revoke all on function[^;]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function[^;]+to service_role/i);
});

test('tri-field promotion only fills blanks and rejects conflicting names or stale targets', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /official Traditional Chinese name conflict/);
  assert.match(sql, /candidate target linkage is invalid, stale, or non-empty/);
  assert.match(sql, /nullif\(btrim\(card\.name_zh\), ''\) is null/);
  assert.match(sql, /nullif\(btrim\(printing\.image_url\), ''\) is null/);
  assert.match(sql, /exact replay no longer matches its target/);
  assert.match(sql, /promotion batch id already exists with a different checksum/);
});

test('candidate evidence carries the source name for zero-write name reconciliation', async () => {
  const source = await readFile(new URL('../providers/enrichment-candidates.mjs', import.meta.url), 'utf8');
  assert.match(source, /sourceNameZh:\s*record\.nameZh/);
  assert.match(source, /field === 'name_zh' \? \{ nameType: 'official' \}/);
});
