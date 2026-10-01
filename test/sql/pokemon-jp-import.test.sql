-- Scenario tests for private.import_pokemon_jp_metadata.
-- Run through scripts/test-pokemon-jp-import-sql.sh, which loads the fixture,
-- the migration, and passes :'plan' (a real import plan) to this file.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

create function pg_temp.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error matching % from: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'expected an error matching%' then raise; end if;
  if sqlerrm !~ p_pattern then
    raise exception 'error "%" did not match % for: %', sqlerrm, p_pattern, p_sql;
  end if;
end;
$$;

create function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAILED: %', p_label; end if;
  raise notice 'ok - %', p_label;
end;
$$;

create temporary table t_plan as select :'plan'::jsonb as plan;
create temporary table t_baseline as
  select (select jsonb_agg(to_jsonb(s) order by s.id) from public.tcg_series s) series,
         (select jsonb_agg(to_jsonb(c) order by c.id) from public.tcg_cards c) cards,
         (select jsonb_agg(to_jsonb(k) order by k.id) from public.tcg_canonical_cards k) canonical,
         (select jsonb_agg(to_jsonb(p) order by p.id) from public.tcg_printings p) printings;
grant select on t_plan, t_baseline to service_role;

-- 1. Only service_role may call the importer.
set role authenticated;
select pg_temp.expect_error(
  $q$select private.import_pokemon_jp_metadata((select plan from t_plan), 'test', true)$q$, 'permission denied');
reset role;
select pg_temp.check(true, 'authenticated cannot call the importer');

set role service_role;

-- 2. Dry run validates and inserts everything, then rolls back.
create temporary table t_dry as select private.import_pokemon_jp_metadata((select plan from t_plan), 'test', true) r;
select pg_temp.check((select r->>'replay' = 'false' and r->>'dryRun' = 'true' from t_dry), 'dry run reports a fresh import');
select pg_temp.check((select r->'inserted' = jsonb_build_object('series', 1,
  'cards', jsonb_array_length((select plan from t_plan)->'cards'),
  'canonical', jsonb_array_length((select plan from t_plan)->'cards'),
  'printings', jsonb_array_length((select plan from t_plan)->'cards')) from t_dry), 'dry run counts every planned row');
select pg_temp.check((select count(*) = 0 from public.tcg_cards where source = 'tcgdex-ja')
  and (select count(*) = 0 from private.catalog_jp_import_audit), 'dry run leaves no rows behind');

-- 3. Invalid plans are rejected before any write.
select pg_temp.expect_error(format($q$select private.import_pokemon_jp_metadata(%L::jsonb, 'test', false)$q$,
  jsonb_set((select plan from t_plan), '{cards,0,id}', '"pokemon-tcgdex-ja-other-001"')), 'card identity is invalid');
select pg_temp.expect_error(format($q$select private.import_pokemon_jp_metadata(%L::jsonb, 'test', false)$q$,
  jsonb_set((select plan from t_plan), '{cards,0,rarity_code}', '"NOT-A-RARITY"')), 'card identity is invalid');
select pg_temp.expect_error(format($q$select private.import_pokemon_jp_metadata(%L::jsonb, 'test', false)$q$,
  jsonb_set((select plan from t_plan), '{manifestHash}', '"short"')), 'provenance');
select pg_temp.expect_error($q$select private.import_pokemon_jp_metadata((select plan from t_plan), ' ', false)$q$, 'actor');

-- 4. A failure part-way through the inserts rolls back the whole series.
select pg_temp.expect_error(format($q$select private.import_pokemon_jp_metadata(%L::jsonb, 'test', false)$q$,
  jsonb_set((select plan from t_plan), '{cards,-1,release_date}', '"2024-02-30"')), 'date');
select pg_temp.check((select count(*) = 0 from public.tcg_series where source = 'tcgdex-ja')
  and (select count(*) = 0 from public.tcg_canonical_cards where id like 'pokemon-tcgdex-ja-%'),
  'mid-insert failure leaves no partial series');

-- 5. Real import.
create temporary table t_import as select private.import_pokemon_jp_metadata((select plan from t_plan), 'test', false) r;
select pg_temp.check((select r->>'replay' = 'false' and r->>'dryRun' = 'false' from t_import), 'import reports a fresh write');
select pg_temp.check((select count(*) = jsonb_array_length((select plan from t_plan)->'cards')
  from public.tcg_cards c join public.tcg_canonical_cards k on k.id = c.canonical_id and k.id = c.id
  where c.source = 'tcgdex-ja' and k.name_ja = c.name_ja), 'each card has its own 1:1 canonical');
select pg_temp.check((select bool_and(c.data_status = 'pending' and c.name_zh is null and c.name_ja is not null)
  from public.tcg_cards c where c.source = 'tcgdex-ja'), 'cards are pending with only a Japanese name');
select pg_temp.check((select bool_and(p.data_status = 'pending' and p.image_url is null and p.image_rights_status = 'not-provided'
  and p.region = 'JP' and p.language = 'ja-JP' and p.source_locale = 'ja-JP' and p.provider_id = c.provider_id)
  from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where p.source = 'tcgdex-ja'),
  'printings are pending, imageless JP rows bound to their card provider ID');
select pg_temp.check((select s.region = 'JP' and s.name_zh is null and s.source = 'tcgdex-ja'
  from public.tcg_series s where s.id = (select plan from t_plan)->'series'->>'id'), 'series is a JP tcgdex-ja row without a Chinese name');
select pg_temp.check((select count(*) = 1 from private.catalog_jp_import_audit where kind = 'import'), 'import audit row written');

-- 6. Pre-existing rows are untouched.
select pg_temp.check((select jsonb_agg(to_jsonb(s) order by s.id) from public.tcg_series s where coalesce(s.source, '') <> 'tcgdex-ja')
  = (select series from t_baseline), 'existing series unchanged');
select pg_temp.check((select jsonb_agg(to_jsonb(c) order by c.id) from public.tcg_cards c where coalesce(c.source, '') <> 'tcgdex-ja')
  = (select cards from t_baseline), 'existing cards unchanged');
select pg_temp.check((select jsonb_agg(to_jsonb(k) order by k.id) from public.tcg_canonical_cards k where k.id not like 'pokemon-tcgdex-ja-%')
  = (select canonical from t_baseline), 'existing canonical cards unchanged');
select pg_temp.check((select jsonb_agg(to_jsonb(p) order by p.id) from public.tcg_printings p where coalesce(p.source, '') <> 'tcgdex-ja')
  = (select printings from t_baseline), 'existing printings unchanged');

-- 7. Replay of the same plan is a zero-change no-op with its own audit row.
create temporary table t_counts as select (select count(*) from public.tcg_cards) cards, (select count(*) from public.tcg_printings) printings;
create temporary table t_replay as select private.import_pokemon_jp_metadata((select plan from t_plan), 'test', false) r;
select pg_temp.check((select r->>'replay' = 'true' and r->'inserted' = '{"series":0,"cards":0,"printings":0}'::jsonb from t_replay), 'replay reports zero inserts');
select pg_temp.check((select cards = (select count(*) from public.tcg_cards) and printings = (select count(*) from public.tcg_printings) from t_counts), 'replay changes no catalog rows');
select pg_temp.check((select count(*) = 1 from private.catalog_jp_import_audit where kind = 'replay'), 'replay audit row written');

-- 8. A different plan for an imported series is rejected.
select pg_temp.expect_error(format($q$select private.import_pokemon_jp_metadata(%L::jsonb, 'test', false)$q$,
  jsonb_set((select plan from t_plan), '{cards,0,name_ja}', '"変更"')), 'different plan');

-- 9. Collisions with the SV4a seed and with existing canonical IDs abort.
select pg_temp.expect_error(format($q$select private.import_pokemon_jp_metadata(%L::jsonb, 'test', false)$q$,
  jsonb_build_object('planVersion', 1, 'source', 'tcgdex-ja', 'seriesProviderId', 'SV4a',
    'manifestHash', repeat('a', 64), 'sourceHash', repeat('b', 64), 'seedHash', repeat('c', 64), 'sourceObservedAt', '2026-10-01T00:00:00Z',
    'series', jsonb_build_object('id', 'pokemon-tcgdex-ja-sv4a', 'provider_id', 'SV4a', 'name_ja', 'テスト',
      'source_url', 'https://api.tcgdex.net/v2/ja/sets/SV4a'),
    'cards', jsonb_build_array(jsonb_build_object('id', 'pokemon-tcgdex-ja-sv4a-001', 'provider_id', 'SV4a-001',
      'official_card_number', '001', 'name_ja', 'テスト', 'source_url', 'https://api.tcgdex.net/v2/ja/cards/SV4a-001')))), 'collides');
reset role;
insert into public.tcg_canonical_cards (id, game_id) values ('pokemon-tcgdex-ja-zz1-001', 'pokemon');
set role service_role;
select pg_temp.expect_error(format($q$select private.import_pokemon_jp_metadata(%L::jsonb, 'test', false)$q$,
  jsonb_build_object('planVersion', 1, 'source', 'tcgdex-ja', 'seriesProviderId', 'ZZ1',
    'manifestHash', repeat('a', 64), 'sourceHash', repeat('b', 64), 'seedHash', repeat('c', 64), 'sourceObservedAt', '2026-10-01T00:00:00Z',
    'series', jsonb_build_object('id', 'pokemon-tcgdex-ja-zz1', 'provider_id', 'ZZ1', 'name_ja', 'テスト',
      'source_url', 'https://api.tcgdex.net/v2/ja/sets/ZZ1'),
    'cards', jsonb_build_array(jsonb_build_object('id', 'pokemon-tcgdex-ja-zz1-001', 'provider_id', 'ZZ1-001',
      'official_card_number', '001', 'name_ja', 'テスト', 'source_url', 'https://api.tcgdex.net/v2/ja/cards/ZZ1-001')))), 'collides');
select pg_temp.check((select count(*) = 0 from public.tcg_series where provider_id in ('SV4a', 'ZZ1') and source = 'tcgdex-ja'), 'collisions wrote nothing');

-- 10. The audit is append-only, even for service_role.
select pg_temp.expect_error($q$update private.catalog_jp_import_audit set actor = 'x'$q$, 'permission denied|append-only');
select pg_temp.expect_error($q$delete from private.catalog_jp_import_audit$q$, 'permission denied|append-only');
reset role;
select pg_temp.expect_error($q$update private.catalog_jp_import_audit set actor = 'x'$q$, 'append-only');
select pg_temp.expect_error($q$delete from private.catalog_jp_import_audit$q$, 'append-only');
select pg_temp.expect_error($q$truncate private.catalog_jp_import_audit$q$, 'append-only');
select pg_temp.check(true, 'audit rejects update, delete and truncate');

\echo ALL JP IMPORT SQL SCENARIOS PASSED
