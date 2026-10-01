-- CardScope: additive, single-transaction Japanese Pokémon metadata import.
-- Design: docs/PRODUCT_PLAN.md Phase 2C and docs/adr/0001-jp-canonical-isolation.md.
-- One call imports one whole series (1-100 cards) from tcgdex-ja as INSERTs
-- only. Any existing row on an ID, provider ID, natural key or canonical ID
-- aborts the call. A replay of the same plan records a replay audit row and
-- changes nothing; a different plan for an imported series is rejected.

create schema if not exists private;

create table if not exists private.catalog_jp_import_audit (
  audit_id bigint generated always as identity primary key,
  kind text not null check (kind in ('import', 'replay')),
  game_id text not null check (game_id = 'pokemon'),
  source text not null check (source = 'tcgdex-ja'),
  series_provider_id text not null,
  series_id text not null,
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

create unique index if not exists catalog_jp_import_audit_one_import_per_series
  on private.catalog_jp_import_audit (game_id, source, series_provider_id)
  where kind = 'import';

alter table private.catalog_jp_import_audit enable row level security;
revoke all on table private.catalog_jp_import_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_import_audit to service_role;

comment on table private.catalog_jp_import_audit is
  'Append-only plan, before/after snapshot and replay log for Japanese Pokémon metadata imports.';

create or replace function private.reject_catalog_jp_import_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'catalog JP import audit is append-only';
  return null;
end;
$$;

revoke all on function private.reject_catalog_jp_import_audit_mutation() from public, anon, authenticated, service_role;

drop trigger if exists catalog_jp_import_audit_no_change on private.catalog_jp_import_audit;
create trigger catalog_jp_import_audit_no_change
before update or delete on private.catalog_jp_import_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_import_audit_no_truncate on private.catalog_jp_import_audit;
create trigger catalog_jp_import_audit_no_truncate
before truncate on private.catalog_jp_import_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

create or replace function private.import_pokemon_jp_metadata(
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
  v_existing private.catalog_jp_import_audit%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_bad text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP import requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'source' is distinct from 'tcgdex-ja'
    or jsonb_typeof(p_plan->'series') is distinct from 'object'
    or jsonb_typeof(p_plan->'cards') is distinct from 'array' then
    raise exception 'JP import plan has an unsupported shape';
  end if;
  if coalesce(p_plan->>'manifestHash', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_plan->>'sourceHash', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_plan->>'seedHash', '') !~ '^[0-9a-f]{64}$'
    or p_plan->>'sourceObservedAt' is null then
    raise exception 'JP import plan is missing provenance hashes';
  end if;

  v_digest := encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
  v_code := p_plan->>'seriesProviderId';
  v_series := p_plan->'series';
  v_series_id := v_series->>'id';
  v_card_count := jsonb_array_length(p_plan->'cards');

  -- Exact identity rules; mirrored by providers/pokemon-jp-manifest.mjs.
  if coalesce(v_code, '') !~ '^[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$'
    or v_series->>'provider_id' is distinct from v_code
    or v_series_id is distinct from 'pokemon-tcgdex-ja-' || lower(v_code)
    or coalesce(btrim(v_series->>'name_ja'), '') = ''
    or v_series->>'source_url' is distinct from 'https://api.tcgdex.net/v2/ja/sets/' || v_code then
    raise exception 'JP import series identity is invalid for %', v_code;
  end if;
  if v_card_count not between 1 and 100 then
    raise exception 'JP import accepts 1-100 cards, got %', v_card_count;
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
    raise exception 'JP import card identity is invalid for %', v_bad;
  end if;
  if (select count(distinct lower(c->>'official_card_number')) from jsonb_array_elements(p_plan->'cards') c) <> v_card_count then
    raise exception 'JP import plan repeats a card number';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-import:' || lower(v_code), 0)
  );

  select * into v_existing
  from private.catalog_jp_import_audit a
  where a.game_id = 'pokemon' and a.source = 'tcgdex-ja' and a.series_provider_id = v_code and a.kind = 'import';
  if found then
    if v_existing.plan_digest <> v_digest then
      raise exception 'JP series % was already imported from a different plan', v_code;
    end if;
    v_after := jsonb_build_object(
      'series', (select count(*) from public.tcg_series s where s.id = v_series_id and s.source = 'tcgdex-ja'),
      'cards', (select count(*) from public.tcg_cards c where c.series_id = v_series_id and c.source = 'tcgdex-ja'),
      'printings', (select count(*) from public.tcg_printings p where p.series_id = v_series_id and p.source = 'tcgdex-ja')
    );
    if v_after <> jsonb_build_object('series', 1, 'cards', v_card_count, 'printings', v_card_count) then
      raise exception 'JP series % no longer matches its import audit: %', v_code, v_after;
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'seriesId', v_series_id,
      'planDigest', v_digest, 'inserted', jsonb_build_object('series', 0, 'cards', 0, 'printings', 0), 'present', v_after);
    if not p_dry_run then
      insert into private.catalog_jp_import_audit (kind, game_id, source, series_provider_id, series_id, plan_digest,
        manifest_hash, source_hash, seed_hash, source_observed_at, actor, card_count, plan, before_snapshot, after_snapshot)
      values ('replay', 'pokemon', 'tcgdex-ja', v_code, v_series_id, v_digest, p_plan->>'manifestHash',
        p_plan->>'sourceHash', p_plan->>'seedHash', (p_plan->>'sourceObservedAt')::timestamptz, p_actor,
        v_card_count, p_plan, v_after, v_after);
    end if;
    return v_result;
  end if;

  -- Any pre-existing row on any identity this plan would claim aborts the import.
  with ids as (
    select c->>'id' as id, c->>'provider_id' as provider_id, c->>'official_card_number' as num
    from jsonb_array_elements(p_plan->'cards') c
  )
  select jsonb_build_object(
    'series', (select count(*) from public.tcg_series s
      where s.id = v_series_id
        or (s.source = 'tcgdex-ja' and s.provider_id = v_code)
        or (s.game_id = 'pokemon' and s.region = 'JP' and upper(s.official_code) = upper(v_code))),
    'cards', (select count(*) from public.tcg_cards c
      where c.id in (select id from ids)
        or (c.source = 'tcgdex-ja' and c.provider_id in (select provider_id from ids))),
    'canonical', (select count(*) from public.tcg_canonical_cards k where k.id in (select id from ids)),
    'printings', (select count(*) from public.tcg_printings p
      where p.card_id in (select id from ids)
        or (p.source = 'tcgdex-ja' and p.provider_id in (select provider_id from ids))
        or (p.region = 'JP' and upper(p.local_set_code) = upper(v_code)))
  ) into v_before;
  if v_before <> '{"series":0,"cards":0,"canonical":0,"printings":0}'::jsonb then
    raise exception 'JP import collides with existing rows for %: %', v_code, v_before;
  end if;

  begin
    insert into public.tcg_series (id, game_id, official_code, name_ja, region, language, release_date,
      source_url, source, provider_id, source_locale, metadata)
    values (v_series_id, 'pokemon', v_code, v_series->>'name_ja', 'JP', 'ja-JP',
      (v_series->>'release_date')::date, v_series->>'source_url', 'tcgdex-ja', v_code, 'ja-JP',
      coalesce(v_series->'metadata', '{}'::jsonb));

    -- The canonical trigger creates one canonical row per card (ADR 0001).
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
      'series', (select to_jsonb(s) from public.tcg_series s where s.id = v_series_id),
      'cards', (select jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' order by c.id)
        from public.tcg_cards c where c.series_id = v_series_id),
      'canonical', (select jsonb_agg(to_jsonb(k) - 'created_at' - 'updated_at' order by k.id)
        from public.tcg_canonical_cards k where k.id in (select c.id from public.tcg_cards c where c.series_id = v_series_id)),
      'printings', (select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.provider_id)
        from public.tcg_printings p where p.series_id = v_series_id)
    );
    if jsonb_array_length(v_after->'cards') <> v_card_count
      or jsonb_array_length(v_after->'canonical') <> v_card_count
      or jsonb_array_length(v_after->'printings') <> v_card_count then
      raise exception 'JP import wrote an unexpected row count for %: %', v_code, v_after;
    end if;

    insert into private.catalog_jp_import_audit (kind, game_id, source, series_provider_id, series_id, plan_digest,
      manifest_hash, source_hash, seed_hash, source_observed_at, actor, card_count, plan, before_snapshot, after_snapshot)
    values ('import', 'pokemon', 'tcgdex-ja', v_code, v_series_id, v_digest, p_plan->>'manifestHash',
      p_plan->>'sourceHash', p_plan->>'seedHash', (p_plan->>'sourceObservedAt')::timestamptz, p_actor,
      v_card_count, p_plan, v_before, v_after);

    v_result := jsonb_build_object('replay', false, 'dryRun', p_dry_run, 'seriesId', v_series_id,
      'planDigest', v_digest, 'before', v_before,
      'inserted', jsonb_build_object('series', 1, 'cards', v_card_count, 'canonical', v_card_count, 'printings', v_card_count));
    if p_dry_run then
      raise exception using errcode = 'CJ001', message = 'JP import dry run rolled back';
    end if;
  exception when sqlstate 'CJ001' then
    -- Dry run: everything inside this block is rolled back; the summary survives.
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.import_pokemon_jp_metadata(jsonb, text, boolean) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.import_pokemon_jp_metadata(jsonb, text, boolean) to service_role;

comment on function private.import_pokemon_jp_metadata(jsonb, text, boolean) is
  'Insert-only, all-or-nothing Japanese Pokémon metadata import for one series; p_dry_run rolls back after full validation.';
