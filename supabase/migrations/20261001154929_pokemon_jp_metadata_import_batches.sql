-- CardScope: import Japanese Pokémon series larger than 100 cards in ordered
-- batches (ADR 0005). Each batch is one all-or-nothing transaction of at most
-- 100 cards; batch 1 also inserts the series row, later batches require the
-- previous batch of the same snapshot. Same identity rules, insert-only
-- policy, dry run and digest replay as private.import_pokemon_jp_metadata.

create table if not exists private.catalog_jp_import_batch_audit (
  audit_id bigint generated always as identity primary key,
  kind text not null check (kind in ('import', 'replay')),
  game_id text not null check (game_id = 'pokemon'),
  source text not null check (source = 'tcgdex-ja'),
  series_provider_id text not null,
  series_id text not null,
  batch_index integer not null check (batch_index between 1 and 20),
  batch_count integer not null check (batch_count between 2 and 20),
  series_card_count integer not null check (series_card_count between 101 and 2000),
  plan_digest text not null check (plan_digest ~ '^[0-9a-f]{64}$'),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  seed_hash text not null check (seed_hash ~ '^[0-9a-f]{64}$'),
  source_observed_at timestamptz not null,
  actor text not null,
  card_count integer not null check (card_count between 1 and 100),
  plan jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists catalog_jp_import_batch_audit_one_import_per_batch
  on private.catalog_jp_import_batch_audit (game_id, source, series_provider_id, batch_index)
  where kind = 'import';

alter table private.catalog_jp_import_batch_audit enable row level security;
revoke all on table private.catalog_jp_import_batch_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_import_batch_audit to service_role;

comment on table private.catalog_jp_import_batch_audit is
  'Append-only plan, before/after snapshot and replay log for batched Japanese Pokémon metadata imports.';

drop trigger if exists catalog_jp_import_batch_audit_no_change on private.catalog_jp_import_batch_audit;
create trigger catalog_jp_import_batch_audit_no_change
before update or delete on private.catalog_jp_import_batch_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_import_batch_audit_no_truncate on private.catalog_jp_import_batch_audit;
create trigger catalog_jp_import_batch_audit_no_truncate
before truncate on private.catalog_jp_import_batch_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- True when a JP series was fully imported, in one call or in all its batches.
create or replace function private.pokemon_jp_series_imported(p_series_provider_id text, p_series_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from private.catalog_jp_import_audit a
    where a.kind = 'import' and a.series_provider_id = p_series_provider_id and a.series_id = p_series_id
  ) or exists (
    select 1 from private.catalog_jp_import_batch_audit b
    where b.kind = 'import' and b.series_provider_id = p_series_provider_id and b.series_id = p_series_id
      and b.batch_index = b.batch_count
  );
$$;

revoke all on function private.pokemon_jp_series_imported(text, text) from public, anon, authenticated;
grant execute on function private.pokemon_jp_series_imported(text, text) to service_role;

create or replace function private.import_pokemon_jp_metadata_batch(
  p_plan jsonb,
  p_actor text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '5s'
set statement_timeout = '60s'
as $$
declare
  v_digest text;
  v_code text;
  v_series jsonb;
  v_series_id text;
  v_card_count integer;
  v_index integer;
  v_count integer;
  v_total integer;
  v_existing private.catalog_jp_import_batch_audit%rowtype;
  v_previous private.catalog_jp_import_batch_audit%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_bad text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP batch import requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'source' is distinct from 'tcgdex-ja'
    or jsonb_typeof(p_plan->'series') is distinct from 'object'
    or jsonb_typeof(p_plan->'cards') is distinct from 'array'
    or jsonb_typeof(p_plan->'batch') is distinct from 'object' then
    raise exception 'JP batch import plan has an unsupported shape';
  end if;
  if coalesce(p_plan->>'manifestHash', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_plan->>'sourceHash', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_plan->>'seedHash', '') !~ '^[0-9a-f]{64}$'
    or p_plan->>'sourceObservedAt' is null then
    raise exception 'JP batch import plan is missing provenance hashes';
  end if;

  v_digest := encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
  v_code := p_plan->>'seriesProviderId';
  v_series := p_plan->'series';
  v_series_id := v_series->>'id';
  v_card_count := jsonb_array_length(p_plan->'cards');
  v_index := (p_plan->'batch'->>'index')::integer;
  v_count := (p_plan->'batch'->>'count')::integer;
  v_total := (p_plan->'batch'->>'seriesCardCount')::integer;

  if v_count not between 2 and 20 or v_index not between 1 and v_count or v_total not between 101 and 2000 then
    raise exception 'JP batch import batch % of % is out of range', v_index, v_count;
  end if;
  if coalesce(v_code, '') !~ '^[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$'
    or v_series->>'provider_id' is distinct from v_code
    or v_series_id is distinct from 'pokemon-tcgdex-ja-' || lower(v_code)
    or coalesce(btrim(v_series->>'name_ja'), '') = ''
    or v_series->>'source_url' is distinct from 'https://api.tcgdex.net/v2/ja/sets/' || v_code then
    raise exception 'JP batch import series identity is invalid for %', v_code;
  end if;
  if v_card_count not between 1 and 100 then
    raise exception 'JP batch import accepts 1-100 cards per batch, got %', v_card_count;
  end if;

  select c->>'provider_id' into v_bad
  from jsonb_array_elements(p_plan->'cards') as c
  where coalesce(c->>'official_card_number', '') !~ '^[A-Za-z0-9]+$'
    or c->>'provider_id' is distinct from v_code || '-' || (c->>'official_card_number')
    or c->>'id' is distinct from v_series_id || '-' || lower(c->>'official_card_number')
    or coalesce(btrim(c->>'name_ja'), '') = ''
    or c->>'source_url' is distinct from 'https://api.tcgdex.net/v2/ja/cards/' || (c->>'provider_id')
    or (c->>'rarity_code' is not null and not exists (
      select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code'))
  limit 1;
  if found then
    raise exception 'JP batch import card identity is invalid for %', v_bad;
  end if;
  if (select count(distinct lower(c->>'official_card_number')) from jsonb_array_elements(p_plan->'cards') c) <> v_card_count then
    raise exception 'JP batch import plan repeats a card number';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-import:' || lower(v_code), 0)
  );

  if exists (
    select 1 from private.catalog_jp_import_audit a
    where a.game_id = 'pokemon' and a.source = 'tcgdex-ja' and a.series_provider_id = v_code and a.kind = 'import'
  ) then
    raise exception 'JP series % was already imported in a single call', v_code;
  end if;

  select * into v_existing
  from private.catalog_jp_import_batch_audit a
  where a.game_id = 'pokemon' and a.source = 'tcgdex-ja' and a.series_provider_id = v_code
    and a.batch_index = v_index and a.kind = 'import';
  if found then
    if v_existing.plan_digest <> v_digest then
      raise exception 'JP series % batch % was already imported from a different plan', v_code, v_index;
    end if;
    if (select count(*) from jsonb_array_elements(p_plan->'cards') c
        join public.tcg_cards k on k.id = c->>'id' and k.source = 'tcgdex-ja'
        join public.tcg_printings p on p.card_id = k.id and p.source = 'tcgdex-ja') <> v_card_count then
      raise exception 'JP series % batch % no longer matches its import audit', v_code, v_index;
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'seriesId', v_series_id, 'batch', v_index,
      'planDigest', v_digest, 'inserted', jsonb_build_object('series', 0, 'cards', 0, 'printings', 0));
    if not p_dry_run then
      insert into private.catalog_jp_import_batch_audit (kind, game_id, source, series_provider_id, series_id, batch_index,
        batch_count, series_card_count, plan_digest, manifest_hash, source_hash, seed_hash, source_observed_at, actor,
        card_count, plan, before_snapshot, after_snapshot)
      values ('replay', 'pokemon', 'tcgdex-ja', v_code, v_series_id, v_index, v_count, v_total, v_digest,
        p_plan->>'manifestHash', p_plan->>'sourceHash', p_plan->>'seedHash', (p_plan->>'sourceObservedAt')::timestamptz,
        p_actor, v_card_count, p_plan, '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  end if;

  if v_index > 1 then
    select * into v_previous
    from private.catalog_jp_import_batch_audit a
    where a.game_id = 'pokemon' and a.source = 'tcgdex-ja' and a.series_provider_id = v_code
      and a.batch_index = v_index - 1 and a.kind = 'import';
    if not found
      or v_previous.batch_count <> v_count or v_previous.series_card_count <> v_total
      or v_previous.source_hash <> p_plan->>'sourceHash' or v_previous.seed_hash <> p_plan->>'seedHash'
      or v_previous.source_observed_at <> (p_plan->>'sourceObservedAt')::timestamptz then
      raise exception 'JP series % batch % needs batch % of the same snapshot first', v_code, v_index, v_index - 1;
    end if;
    if not exists (select 1 from public.tcg_series s where s.id = v_series_id and s.source = 'tcgdex-ja' and s.provider_id = v_code) then
      raise exception 'JP series % is missing for batch %', v_code, v_index;
    end if;
  elsif exists (
    select 1 from private.catalog_jp_import_batch_audit a
    where a.game_id = 'pokemon' and a.source = 'tcgdex-ja' and a.series_provider_id = v_code and a.kind = 'import'
  ) then
    raise exception 'JP series % already has batches from another plan', v_code;
  end if;

  -- Any pre-existing row on an identity this batch claims aborts it; batch 1
  -- also requires the series identity to be free.
  with ids as (
    select c->>'id' as id, c->>'provider_id' as provider_id
    from jsonb_array_elements(p_plan->'cards') c
  )
  select jsonb_build_object(
    'series', case when v_index = 1 then (select count(*) from public.tcg_series s
      where s.id = v_series_id
        or (s.source = 'tcgdex-ja' and s.provider_id = v_code)
        or (s.game_id = 'pokemon' and s.region = 'JP' and upper(s.official_code) = upper(v_code))) else 0 end,
    'cards', (select count(*) from public.tcg_cards c
      where c.id in (select id from ids)
        or (c.source = 'tcgdex-ja' and c.provider_id in (select provider_id from ids))),
    'canonical', (select count(*) from public.tcg_canonical_cards k where k.id in (select id from ids)),
    'printings', (select count(*) from public.tcg_printings p
      where p.card_id in (select id from ids)
        or (p.source = 'tcgdex-ja' and p.provider_id in (select provider_id from ids))
        or (p.region = 'JP' and upper(p.local_set_code) = upper(v_code)
          and p.local_card_number in (select c->>'official_card_number' from jsonb_array_elements(p_plan->'cards') c)))
  ) into v_before;
  if v_before <> '{"series":0,"cards":0,"canonical":0,"printings":0}'::jsonb then
    raise exception 'JP batch import collides with existing rows for % batch %: %', v_code, v_index, v_before;
  end if;

  begin
    if v_index = 1 then
      insert into public.tcg_series (id, game_id, official_code, name_ja, region, language, release_date,
        source_url, source, provider_id, source_locale, metadata)
      values (v_series_id, 'pokemon', v_code, v_series->>'name_ja', 'JP', 'ja-JP',
        (v_series->>'release_date')::date, v_series->>'source_url', 'tcgdex-ja', v_code, 'ja-JP',
        coalesce(v_series->'metadata', '{}'::jsonb));
    end if;

    insert into public.tcg_cards (id, canonical_id, game_id, series_id, official_card_number, rarity, rarity_tier,
      name_ja, aliases, source, provider_id, search_text, metadata, data_status)
    select c->>'id', c->>'id', 'pokemon', v_series_id, c->>'official_card_number',
      r.rarity_code, r.rarity_tier, c->>'name_ja', array[c->>'provider_id'], 'tcgdex-ja', c->>'provider_id',
      c->>'search_text', coalesce(c->'metadata', '{}'::jsonb), 'pending'
    from jsonb_array_elements(p_plan->'cards') c
    left join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code';

    insert into public.tcg_printings (card_id, region, language, local_set_code, local_card_number, image_url,
      source_url, release_date, series_id, rarity, rarity_code, rarity_label, source, provider_id,
      image_rehost_required, metadata, image_rights_status, source_locale, data_status)
    select c->>'id', 'JP', 'ja-JP', v_code, c->>'official_card_number', null,
      c->>'source_url', (c->>'release_date')::date, v_series_id, r.rarity_code, r.rarity_code, r.rarity_label,
      'tcgdex-ja', c->>'provider_id', false, coalesce(c->'metadata', '{}'::jsonb), 'not-provided', 'ja-JP', 'pending'
    from jsonb_array_elements(p_plan->'cards') c
    left join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code';

    v_after := jsonb_build_object(
      'series', case when v_index = 1 then (select to_jsonb(s) - 'created_at' - 'updated_at' from public.tcg_series s where s.id = v_series_id) end,
      'cards', (select jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' order by c.id)
        from public.tcg_cards c where c.id in (select x->>'id' from jsonb_array_elements(p_plan->'cards') x)),
      'printings', (select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.provider_id)
        from public.tcg_printings p where p.card_id in (select x->>'id' from jsonb_array_elements(p_plan->'cards') x))
    );
    if jsonb_array_length(v_after->'cards') <> v_card_count or jsonb_array_length(v_after->'printings') <> v_card_count
      or (select count(*) from public.tcg_canonical_cards k where k.id in (select x->>'id' from jsonb_array_elements(p_plan->'cards') x)) <> v_card_count then
      raise exception 'JP batch import wrote an unexpected row count for % batch %', v_code, v_index;
    end if;
    if v_index = v_count and (
      (select count(*) from public.tcg_cards c where c.series_id = v_series_id and c.source = 'tcgdex-ja') <> v_total
      or (select count(*) from public.tcg_printings p where p.series_id = v_series_id and p.source = 'tcgdex-ja') <> v_total) then
      raise exception 'JP batch import final batch does not complete % (% cards expected)', v_code, v_total;
    end if;

    insert into private.catalog_jp_import_batch_audit (kind, game_id, source, series_provider_id, series_id, batch_index,
      batch_count, series_card_count, plan_digest, manifest_hash, source_hash, seed_hash, source_observed_at, actor,
      card_count, plan, before_snapshot, after_snapshot)
    values ('import', 'pokemon', 'tcgdex-ja', v_code, v_series_id, v_index, v_count, v_total, v_digest,
      p_plan->>'manifestHash', p_plan->>'sourceHash', p_plan->>'seedHash', (p_plan->>'sourceObservedAt')::timestamptz,
      p_actor, v_card_count, p_plan, v_before, v_after);

    v_result := jsonb_build_object('replay', false, 'dryRun', p_dry_run, 'seriesId', v_series_id, 'batch', v_index,
      'planDigest', v_digest, 'before', v_before,
      'inserted', jsonb_build_object('series', case when v_index = 1 then 1 else 0 end,
        'cards', v_card_count, 'canonical', v_card_count, 'printings', v_card_count));
    if p_dry_run then
      raise exception using errcode = 'CJ003', message = 'JP batch import dry run rolled back';
    end if;
  exception when sqlstate 'CJ003' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.import_pokemon_jp_metadata_batch(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.import_pokemon_jp_metadata_batch(jsonb, text, boolean) to service_role;

comment on function private.import_pokemon_jp_metadata_batch(jsonb, text, boolean) is
  'Insert-only, all-or-nothing import of one ordered batch (<=100 cards) of a Japanese Pokémon series larger than 100 cards; p_dry_run rolls back after full validation.';

-- Enrichment accepts series imported in batches too; otherwise identical to
-- 20261001153532_pokemon_jp_enrichment_cross_series.
create or replace function private.enrich_pokemon_jp_metadata(
  p_plan jsonb,
  p_actor text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '5s'
set statement_timeout = '60s'
as $$
declare
  v_digest text;
  v_code text;
  v_series_id text;
  v_card_count integer;
  v_bad text;
  v_before jsonb;
  v_after jsonb;
  v_changed jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP enrichment requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'kind' is distinct from 'jp-enrich'
    or p_plan->>'source' is distinct from 'tcgdex-ja'
    or jsonb_typeof(p_plan->'cards') is distinct from 'array'
    or coalesce(p_plan->>'evidenceHash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'JP enrichment plan has an unsupported shape';
  end if;

  v_digest := encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
  v_code := p_plan->>'seriesProviderId';
  v_series_id := p_plan->>'seriesId';
  v_card_count := jsonb_array_length(p_plan->'cards');
  if v_card_count > 100 then
    raise exception 'JP enrichment accepts at most 100 cards, got %', v_card_count;
  end if;

  if not exists (
    select 1 from public.tcg_series s
    where s.id = v_series_id and s.source = 'tcgdex-ja' and s.provider_id = v_code and s.region = 'JP'
  ) or not private.pokemon_jp_series_imported(v_code, v_series_id) then
    raise exception 'JP enrichment target % is not an imported tcgdex-ja series', v_code;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-enrich:' || lower(v_code), 0)
  );

  if exists (
    select 1 from private.catalog_jp_enrich_audit a
    where a.kind = 'enrich' and a.series_provider_id = v_code and a.plan_digest = v_digest
  ) then
    if not private.pokemon_jp_enrich_plan_applied(p_plan) then
      raise exception 'JP series % no longer matches enrichment plan %', v_code, v_digest;
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'seriesId', v_series_id,
      'planDigest', v_digest, 'changed', jsonb_build_object('cards', 0, 'links', 0, 'derived', 0, 'rarities', 0, 'series', 0));
    if not p_dry_run then
      insert into private.catalog_jp_enrich_audit (kind, game_id, source, series_provider_id, series_id, plan_digest,
        evidence_hash, actor, card_count, plan, before_snapshot, after_snapshot)
      values ('replay', 'pokemon', 'tcgdex-ja', v_code, v_series_id, v_digest, p_plan->>'evidenceHash', p_actor,
        v_card_count, p_plan, '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  end if;

  if (select count(distinct c->>'id') from jsonb_array_elements(p_plan->'cards') c) <> v_card_count then
    raise exception 'JP enrichment plan repeats a card';
  end if;

  -- Every entry must name a JP card of this series, match its Japanese name,
  -- fill only empty values and carry a consistent name basis.
  select coalesce(c->>'id', '<missing id>') into v_bad
  from jsonb_array_elements(p_plan->'cards') c
  left join public.tcg_cards j on j.id = c->>'id'
  where j.id is null
    or j.series_id is distinct from v_series_id
    or j.source is distinct from 'tcgdex-ja'
    or j.name_ja is distinct from c->>'name_ja'
    or (c->>'link' is null and c->>'name_zh' is null and c->>'rarity_code' is null)
    or (c->>'name_zh' is not null and (j.name_zh is not null or btrim(c->>'name_zh') = ''))
    or (c->>'name_zh' is null) <> (c->>'basis' is null)
    or (c->>'basis' is not null and c->>'basis' not in ('tw-official', 'derived-same-name', 'derived-cross-series'))
    or ((c->>'nameSource' is not null) <> (c->>'basis' is not distinct from 'derived-cross-series'))
    or ((c->>'link' is not null) <> (c->>'basis' is not distinct from 'tw-official'))
    or (c->>'link' is not null and j.canonical_id is distinct from j.id)
    or (c->>'rarity_code' is not null and (
      j.rarity is not null
      or not exists (select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code')
      or exists (select 1 from public.tcg_printings p where p.card_id = j.id and p.rarity_code is not null)))
  limit 1;
  if found then
    raise exception 'JP enrichment entry is invalid for %', v_bad;
  end if;

  -- Links: same Provider ID, same series code, the Taiwanese card's official
  -- name, and a canonical that no other card shares yet (ADR 0003).
  select c->>'id' into v_bad
  from jsonb_array_elements(p_plan->'cards') c
  join public.tcg_cards j on j.id = c->>'id'
  left join public.tcg_cards t on t.id = c->>'link'
  left join public.tcg_series ts on ts.id = t.series_id
  where c->>'link' is not null and (
    t.id is null
    or t.game_id is distinct from 'pokemon'
    or ts.region is distinct from 'TW'
    or upper(ts.official_code) is distinct from upper(v_code)
    or t.provider_id is distinct from j.provider_id
    or t.name_zh is distinct from c->>'name_zh'
    or t.canonical_id is distinct from t.id
    or (select count(*) from public.tcg_cards o where o.canonical_id = t.canonical_id) <> 1)
  limit 1;
  if found then
    raise exception 'JP enrichment link is not proven for %', v_bad;
  end if;

  -- Derived names: an identical Japanese name in the same series that holds
  -- (or receives in this plan) the same official Taiwanese name.
  select c->>'id' into v_bad
  from jsonb_array_elements(p_plan->'cards') c
  where c->>'basis' = 'derived-same-name'
    and not exists (
      select 1 from jsonb_array_elements(p_plan->'cards') l
      where l->>'basis' = 'tw-official' and l->>'name_ja' = c->>'name_ja' and l->>'name_zh' = c->>'name_zh')
    and not exists (
      select 1 from public.tcg_cards k
      where k.series_id = v_series_id and k.name_ja = c->>'name_ja' and k.name_zh = c->>'name_zh'
        and k.metadata->>'nameZhBasis' = 'tw-official')
  limit 1;
  if found then
    raise exception 'JP enrichment derived name has no official source for %', v_bad;
  end if;

  -- Cross-series derived names: the cited Taiwanese card must carry exactly
  -- this name; the matching Japanese name is proven by the Source archive
  -- evidence bound to evidenceHash (ADR 0004).
  select c->>'id' into v_bad
  from jsonb_array_elements(p_plan->'cards') c
  left join public.tcg_cards t on t.id = c->>'nameSource'
  left join public.tcg_series ts on ts.id = t.series_id
  where c->>'basis' = 'derived-cross-series' and (
    t.id is null
    or t.game_id is distinct from 'pokemon'
    or ts.region is distinct from 'TW'
    or t.name_zh is distinct from c->>'name_zh')
  limit 1;
  if found then
    raise exception 'JP enrichment cross-series name is not proven for %', v_bad;
  end if;

  if p_plan->'series' is not null and jsonb_typeof(p_plan->'series') <> 'null' and not exists (
    select 1
    from public.tcg_series s
    join public.tcg_series ts on ts.id = p_plan->'series'->>'twSeriesId'
    where s.id = v_series_id and s.name_zh is null
      and ts.region = 'TW' and ts.game_id = 'pokemon'
      and upper(ts.official_code) = upper(v_code)
      and ts.name_zh = p_plan->'series'->>'name_zh'
  ) then
    raise exception 'JP enrichment series name is not proven for %', v_code;
  end if;

  v_before := jsonb_build_object(
    'series', (select to_jsonb(s) - 'created_at' - 'updated_at' from public.tcg_series s where s.id = v_series_id),
    'cards', (select jsonb_agg(to_jsonb(j) - 'created_at' - 'updated_at' order by j.id)
      from public.tcg_cards j where j.id in (select c->>'id' from jsonb_array_elements(p_plan->'cards') c)),
    'linkedCanonicals', (select jsonb_agg(to_jsonb(k) - 'created_at' - 'updated_at' order by k.id)
      from public.tcg_canonical_cards k
      where k.id in (select c->>'link' from jsonb_array_elements(p_plan->'cards') c where c->>'link' is not null)),
    'printings', (select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.id)
      from public.tcg_printings p
      where p.card_id in (select c->>'id' from jsonb_array_elements(p_plan->'cards') c where c->>'rarity_code' is not null))
  );

  begin
    update public.tcg_cards j
    set canonical_id = coalesce(t.canonical_id, j.canonical_id),
        name_zh = coalesce(c.value->>'name_zh', j.name_zh),
        rarity = coalesce(c.value->>'rarity_code', j.rarity),
        rarity_tier = case when c.value->>'rarity_code' is not null then r.rarity_tier else j.rarity_tier end,
        metadata = j.metadata
          || case when c.value->>'basis' is null then '{}'::jsonb
               else jsonb_build_object('nameZhBasis', c.value->>'basis',
                 'nameZhSourceCardId', coalesce(c.value->>'link', c.value->>'nameSource', (
                   select min(l->>'id') from jsonb_array_elements(p_plan->'cards') l
                   where l->>'basis' = 'tw-official' and l->>'name_ja' = c.value->>'name_ja'
                     and l->>'name_zh' = c.value->>'name_zh'), (
                   select min(k.id) from public.tcg_cards k
                   where k.series_id = v_series_id and k.name_ja = c.value->>'name_ja'
                     and k.name_zh = c.value->>'name_zh' and k.metadata->>'nameZhBasis' = 'tw-official')),
                 'nameZhEvidenceHash', p_plan->>'evidenceHash') end
          || case when c.value->>'link' is null then '{}'::jsonb
               else jsonb_build_object('linkedCardId', c.value->>'link', 'linkBasis', 'same-provider-id-and-series-code') end,
        updated_at = now()
    from jsonb_array_elements(p_plan->'cards') c
    left join public.tcg_cards t on t.id = c.value->>'link'
    left join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c.value->>'rarity_code'
    where j.id = c.value->>'id';

    update public.tcg_printings p
    set rarity = r.rarity_code, rarity_code = r.rarity_code, rarity_label = r.rarity_label, updated_at = now()
    from jsonb_array_elements(p_plan->'cards') c
    join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c.value->>'rarity_code'
    where p.card_id = c.value->>'id' and c.value->>'rarity_code' is not null;

    if p_plan->'series' is not null and jsonb_typeof(p_plan->'series') <> 'null' then
      update public.tcg_series s
      set name_zh = p_plan->'series'->>'name_zh',
          metadata = s.metadata || jsonb_build_object('nameZhBasis', 'tw-official',
            'nameZhSourceSeriesId', p_plan->'series'->>'twSeriesId', 'nameZhEvidenceHash', p_plan->>'evidenceHash'),
          updated_at = now()
      where s.id = v_series_id;
    end if;

    if not private.pokemon_jp_enrich_plan_applied(p_plan) then
      raise exception 'JP enrichment did not reach the planned state for %', v_code;
    end if;

    v_after := jsonb_build_object(
      'series', (select to_jsonb(s) - 'created_at' - 'updated_at' from public.tcg_series s where s.id = v_series_id),
      'cards', (select jsonb_agg(to_jsonb(j) - 'created_at' - 'updated_at' order by j.id)
        from public.tcg_cards j where j.id in (select c->>'id' from jsonb_array_elements(p_plan->'cards') c)),
      'linkedCanonicals', (select jsonb_agg(to_jsonb(k) - 'created_at' - 'updated_at' order by k.id)
        from public.tcg_canonical_cards k
        where k.id in (select c->>'link' from jsonb_array_elements(p_plan->'cards') c where c->>'link' is not null)),
      'printings', (select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.id)
        from public.tcg_printings p
        where p.card_id in (select c->>'id' from jsonb_array_elements(p_plan->'cards') c where c->>'rarity_code' is not null))
    );

    v_changed := jsonb_build_object(
      'cards', v_card_count,
      'links', (select count(*) from jsonb_array_elements(p_plan->'cards') c where c->>'link' is not null),
      'derived', (select count(*) from jsonb_array_elements(p_plan->'cards') c where c->>'basis' in ('derived-same-name', 'derived-cross-series')),
      'rarities', (select count(*) from jsonb_array_elements(p_plan->'cards') c where c->>'rarity_code' is not null),
      'series', case when p_plan->'series' is not null and jsonb_typeof(p_plan->'series') <> 'null' then 1 else 0 end);

    insert into private.catalog_jp_enrich_audit (kind, game_id, source, series_provider_id, series_id, plan_digest,
      evidence_hash, actor, card_count, plan, before_snapshot, after_snapshot)
    values ('enrich', 'pokemon', 'tcgdex-ja', v_code, v_series_id, v_digest, p_plan->>'evidenceHash', p_actor,
      v_card_count, p_plan, v_before, v_after);

    v_result := jsonb_build_object('replay', false, 'dryRun', p_dry_run, 'seriesId', v_series_id,
      'planDigest', v_digest, 'changed', v_changed);
    if p_dry_run then
      raise exception using errcode = 'CJ002', message = 'JP enrichment dry run rolled back';
    end if;
  exception when sqlstate 'CJ002' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.enrich_pokemon_jp_metadata(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.enrich_pokemon_jp_metadata(jsonb, text, boolean) to service_role;
grant execute on function private.pokemon_jp_enrich_plan_applied(jsonb) to service_role;

comment on function private.enrich_pokemon_jp_metadata(jsonb, text, boolean) is
  'Fill-only, all-or-nothing enrichment (TW canonical links, official or derived name_zh, missing rarity, series name_zh) for one imported Japanese Pokémon series; p_dry_run rolls back after full validation.';
