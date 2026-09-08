import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');

test('historical migrations create prerequisites before using them',async()=>{
  const [search,taxonomy,sources]=await Promise.all([
    migration('20260831_catalog_search_trigram.sql'),
    migration('20260905_catalog_taxonomy_alignment.sql'),
    migration('20260908_catalog_source_policy_seed.sql')
  ]);
  assert.ok(search.indexOf('add column if not exists search_text')<search.indexOf('tcg_cards_search_trgm_idx'));
  assert.ok(taxonomy.indexOf('insert into public.tcg_product_categories')<taxonomy.indexOf('matching_categories integer'));
  assert.ok(sources.indexOf('create table if not exists public.catalog_source_policies')<sources.indexOf('insert into public.catalog_source_policies'));
});

test('forward reconciliation is additive and preserves service-only source policy',async()=>{
  const sql=await migration('20260908190238_reconcile_catalog_migration_prerequisites.sql');
  assert.doesNotMatch(sql,/\b(drop|truncate|delete)\b\s+(table|from)/i);
  assert.match(sql,/add column if not exists search_text text/i);
  assert.match(sql,/alter table public\.catalog_source_policies enable row level security/i);
  assert.match(sql,/revoke all on table public\.catalog_source_policies from anon, authenticated/i);
  assert.match(sql,/grant select, insert, update, delete on table public\.catalog_source_policies to service_role/i);
  assert.match(sql,/\('tcgdex-ja','pokemonJp'/);
  assert.match(sql,/search_text must be text/);
});
