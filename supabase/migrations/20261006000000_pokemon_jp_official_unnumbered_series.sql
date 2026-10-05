-- CardScope (ADR 0026): Japanese DP-era cards print no
-- card number. A card may now have no official number, but only when its metadata says the number
-- was never printed, so a number that is merely missing still fails. The DP sets are imported from
-- the official "（DPx の全てのカード）" lists with the official detail page ID as identity
-- (pokemon-official-ja-<series>-c<detail ID>), otherwise as private.import_pokemon_jp_official_series.

alter table public.tcg_cards alter column official_card_number drop not null;
alter table public.tcg_cards drop constraint if exists tcg_cards_number_or_not_printed;
-- NOT VALID: checks new and updated rows at once without scanning the existing ~71,000 cards under
-- an exclusive lock; 20261006000100 validates them separately with a lighter lock.
alter table public.tcg_cards add constraint tcg_cards_number_or_not_printed
  check (official_card_number is not null or coalesce(metadata->>'numberStatus', '') = 'not-printed') not valid;

create table if not exists private.catalog_jp_official_unnumbered_audit (
  audit_id bigint generated always as identity primary key,
  kind text not null check (kind in ('import', 'replay')),
  game_id text not null check (game_id = 'pokemon'),
  source text not null check (source = 'pokemon-card-official-jp'),
  series_provider_id text not null,
  series_id text not null,
  batch_index integer not null check (batch_index between 1 and 20),
  batch_count integer not null check (batch_count between 1 and 20),
  series_card_count integer not null check (series_card_count between 1 and 2000),
  plan_digest text not null check (plan_digest ~ '^[0-9a-f]{64}$'),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  source_observed_at timestamptz not null,
  actor text not null,
  card_count integer not null check (card_count between 1 and 100),
  plan jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists catalog_jp_official_unnumbered_audit_one_import_per_batch
  on private.catalog_jp_official_unnumbered_audit (game_id, source, series_provider_id, batch_index)
  where kind = 'import';

alter table private.catalog_jp_official_unnumbered_audit enable row level security;
revoke all on table private.catalog_jp_official_unnumbered_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_official_unnumbered_audit to service_role;

drop trigger if exists catalog_jp_official_unnumbered_audit_no_change on private.catalog_jp_official_unnumbered_audit;
create trigger catalog_jp_official_unnumbered_audit_no_change
before update or delete on private.catalog_jp_official_unnumbered_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_official_unnumbered_audit_no_truncate on private.catalog_jp_official_unnumbered_audit;
create trigger catalog_jp_official_unnumbered_audit_no_truncate
before truncate on private.catalog_jp_official_unnumbered_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- p_plan: as private.import_pokemon_jp_official_series, but each card has no official_card_number,
--   id = series id || '-c' || provider_id, and metadata { "numberStatus": "not-printed",
--   "officialListPosition": <1-based position in the official list>, ... }.
create or replace function private.import_pokemon_jp_official_unnumbered_series(
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
  v_source constant text := 'pokemon-card-official-jp';
  v_digest text;
  v_code text;
  v_series jsonb;
  v_series_id text;
  v_card_count integer;
  v_index integer;
  v_count integer;
  v_total integer;
  v_existing private.catalog_jp_official_unnumbered_audit%rowtype;
  v_previous private.catalog_jp_official_unnumbered_audit%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_bad text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP unnumbered import requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'source' is distinct from v_source
    or jsonb_typeof(p_plan->'series') is distinct from 'object'
    or jsonb_typeof(p_plan->'cards') is distinct from 'array'
    or jsonb_typeof(p_plan->'batch') is distinct from 'object' then
    raise exception 'JP unnumbered import plan has an unsupported shape';
  end if;
  if coalesce(p_plan->>'evidenceHash', '') !~ '^[0-9a-f]{64}$' or p_plan->>'sourceObservedAt' is null then
    raise exception 'JP unnumbered import plan is missing provenance';
  end if;

  v_digest := encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
  v_code := p_plan->>'seriesProviderId';
  v_series := p_plan->'series';
  v_series_id := v_series->>'id';
  v_card_count := jsonb_array_length(p_plan->'cards');
  v_index := (p_plan->'batch'->>'index')::integer;
  v_count := (p_plan->'batch'->>'count')::integer;
  v_total := (p_plan->'batch'->>'seriesCardCount')::integer;

  if v_count not between 1 and 20 or v_index not between 1 and v_count or v_total not between 1 and 2000
    or (v_count = 1 and v_total <> v_card_count) or (v_count > 1 and v_total <= 100) then
    raise exception 'JP unnumbered import batch % of % is out of range', v_index, v_count;
  end if;
  if coalesce(v_code, '') !~ '^[A-Za-z0-9]+$'
    or v_series->>'provider_id' is distinct from v_code
    or v_series_id is distinct from 'pokemon-official-ja-' || lower(v_code)
    or coalesce(btrim(v_series->>'name_ja'), '') = ''
    or coalesce(v_series->>'source_url', '') not like 'https://www.pokemon-card.com/card-search/%' then
    raise exception 'JP unnumbered import series identity is invalid for %', v_code;
  end if;
  if v_card_count not between 1 and 100 then
    raise exception 'JP unnumbered import accepts 1-100 cards per batch, got %', v_card_count;
  end if;

  select coalesce(c->>'id', '<missing id>') into v_bad
  from jsonb_array_elements(p_plan->'cards') as c
  where c ? 'official_card_number'
    or coalesce(c->>'provider_id', '') !~ '^[0-9]+$'
    or c->>'id' is distinct from v_series_id || '-c' || (c->>'provider_id')
    or coalesce(btrim(c->>'name_ja'), '') = ''
    or c->'metadata'->>'numberStatus' is distinct from 'not-printed'
    or coalesce(c->'metadata'->>'officialListPosition', '') !~ '^[1-9][0-9]*$'
    or c->>'source_url' is distinct from 'https://www.pokemon-card.com/card-search/details.php/card/' || (c->>'provider_id') || '/regu/all'
    or (c->>'rarity_code' is not null and not exists (
      select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code'))
  limit 1;
  if found then
    raise exception 'JP unnumbered import card identity is invalid for %', v_bad;
  end if;
  if (select count(distinct c->>'provider_id') from jsonb_array_elements(p_plan->'cards') c) <> v_card_count then
    raise exception 'JP unnumbered import plan repeats an official card ID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-import:' || lower(v_code), 0)
  );

  if exists (
    select 1 from public.tcg_series s
    where s.game_id = 'pokemon' and s.region = 'JP' and upper(s.official_code) = upper(v_code) and s.source is distinct from v_source
  ) then
    raise exception 'JP series % already exists from another source', v_code;
  end if;

  select * into v_existing
  from private.catalog_jp_official_unnumbered_audit a
  where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code
    and a.batch_index = v_index and a.kind = 'import';
  if found then
    if v_existing.plan_digest <> v_digest then
      raise exception 'JP series % batch % was already imported from a different plan', v_code, v_index;
    end if;
    if (select count(*) from jsonb_array_elements(p_plan->'cards') c
        join public.tcg_cards k on k.id = c->>'id' and k.source = v_source and k.provider_id = c->>'provider_id'
        join public.tcg_printings p on p.card_id = k.id and p.source = v_source) <> v_card_count then
      raise exception 'JP series % batch % no longer matches its import audit', v_code, v_index;
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'seriesId', v_series_id, 'batch', v_index,
      'planDigest', v_digest, 'inserted', jsonb_build_object('series', 0, 'cards', 0, 'printings', 0));
    if not p_dry_run then
      insert into private.catalog_jp_official_unnumbered_audit (kind, game_id, source, series_provider_id, series_id, batch_index,
        batch_count, series_card_count, plan_digest, evidence_hash, source_observed_at, actor, card_count, plan,
        before_snapshot, after_snapshot)
      values ('replay', 'pokemon', v_source, v_code, v_series_id, v_index, v_count, v_total, v_digest,
        p_plan->>'evidenceHash', (p_plan->>'sourceObservedAt')::timestamptz, p_actor, v_card_count, p_plan,
        '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  end if;

  if v_index > 1 then
    select * into v_previous
    from private.catalog_jp_official_unnumbered_audit a
    where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code
      and a.batch_index = v_index - 1 and a.kind = 'import';
    if not found
      or v_previous.batch_count <> v_count or v_previous.series_card_count <> v_total
      or v_previous.evidence_hash <> p_plan->>'evidenceHash'
      or v_previous.source_observed_at <> (p_plan->>'sourceObservedAt')::timestamptz then
      raise exception 'JP series % batch % needs batch % of the same snapshot first', v_code, v_index, v_index - 1;
    end if;
  elsif exists (
    select 1 from private.catalog_jp_official_unnumbered_audit a
    where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code and a.kind = 'import'
  ) then
    raise exception 'JP series % already has batches from another plan', v_code;
  end if;

  with ids as (
    select c->>'id' as id, c->>'provider_id' as provider_id from jsonb_array_elements(p_plan->'cards') c
  )
  select jsonb_build_object(
    'series', case when v_index = 1 then (select count(*) from public.tcg_series s
      where s.id = v_series_id or (s.source = v_source and s.provider_id = v_code)
        or (s.game_id = 'pokemon' and s.region = 'JP' and upper(s.official_code) = upper(v_code))) else 0 end,
    'cards', (select count(*) from public.tcg_cards c
      where c.id in (select id from ids) or (c.source = v_source and c.provider_id in (select provider_id from ids))),
    'canonical', (select count(*) from public.tcg_canonical_cards k where k.id in (select id from ids)),
    'printings', (select count(*) from public.tcg_printings p
      where p.card_id in (select id from ids) or (p.source = v_source and p.provider_id in (select provider_id from ids)))
  ) into v_before;
  if v_before <> '{"series":0,"cards":0,"canonical":0,"printings":0}'::jsonb then
    raise exception 'JP unnumbered import collides with existing rows for % batch %: %', v_code, v_index, v_before;
  end if;

  begin
    if v_index = 1 then
      insert into public.tcg_series (id, game_id, official_code, name_ja, region, language, release_date,
        source_url, source, provider_id, source_locale, metadata)
      values (v_series_id, 'pokemon', v_code, v_series->>'name_ja', 'JP', 'ja-JP',
        (v_series->>'release_date')::date, v_series->>'source_url', v_source, v_code, 'ja-JP',
        coalesce(v_series->'metadata', '{}'::jsonb));
    end if;

    insert into public.tcg_cards (id, canonical_id, game_id, series_id, official_card_number, rarity, rarity_tier,
      name_ja, aliases, source, provider_id, search_text, metadata, data_status)
    select c->>'id', c->>'id', 'pokemon', v_series_id, null,
      r.rarity_code, r.rarity_tier, c->>'name_ja', '{}'::text[], v_source,
      c->>'provider_id', c->>'search_text', coalesce(c->'metadata', '{}'::jsonb), 'verified'
    from jsonb_array_elements(p_plan->'cards') c
    left join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code';

    insert into public.tcg_printings (card_id, region, language, local_set_code, local_card_number, image_url,
      source_url, release_date, series_id, rarity, rarity_code, rarity_label, source, provider_id,
      image_rehost_required, metadata, image_rights_status, source_locale, data_status)
    select c->>'id', 'JP', 'ja-JP', v_code, null, null,
      c->>'source_url', (v_series->>'release_date')::date, v_series_id, r.rarity_code, r.rarity_code, r.rarity_label,
      v_source, c->>'provider_id', false, coalesce(c->'metadata', '{}'::jsonb), 'not-provided', 'ja-JP',
      case when r.rarity_code is null then 'incomplete' else 'verified' end
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
      raise exception 'JP unnumbered import wrote an unexpected row count for % batch %', v_code, v_index;
    end if;
    if v_index = v_count and (
      (select count(*) from public.tcg_cards c where c.series_id = v_series_id and c.source = v_source) <> v_total
      or (select count(*) from public.tcg_printings p where p.series_id = v_series_id and p.source = v_source) <> v_total) then
      raise exception 'JP unnumbered import final batch does not complete % (% cards expected)', v_code, v_total;
    end if;

    insert into private.catalog_jp_official_unnumbered_audit (kind, game_id, source, series_provider_id, series_id, batch_index,
      batch_count, series_card_count, plan_digest, evidence_hash, source_observed_at, actor, card_count, plan,
      before_snapshot, after_snapshot)
    values ('import', 'pokemon', v_source, v_code, v_series_id, v_index, v_count, v_total, v_digest,
      p_plan->>'evidenceHash', (p_plan->>'sourceObservedAt')::timestamptz, p_actor, v_card_count, p_plan,
      v_before, v_after);

    v_result := jsonb_build_object('replay', false, 'dryRun', p_dry_run, 'seriesId', v_series_id, 'batch', v_index,
      'planDigest', v_digest, 'before', v_before,
      'inserted', jsonb_build_object('series', case when v_index = 1 then 1 else 0 end,
        'cards', v_card_count, 'canonical', v_card_count, 'printings', v_card_count));
    if p_dry_run then
      raise exception using errcode = 'CJ026', message = 'JP unnumbered import dry run rolled back';
    end if;
  exception when sqlstate 'CJ026' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.import_pokemon_jp_official_unnumbered_series(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.import_pokemon_jp_official_unnumbered_series(jsonb, text, boolean) to service_role;

comment on function private.import_pokemon_jp_official_unnumbered_series(jsonb, text, boolean) is
  'DRAFT (ADR 0026 proposed): insert-only import of one batch of a Japanese series whose cards print no number, identified by the official detail page ID; p_dry_run rolls back.';

-- The card lists hand the site only nameZhBasis from card metadata; they now also pass numberStatus so a
-- card without a printed number reads "未印卡號" instead of "卡號待補". A series list keeps the official list
-- order for cards without numbers. The game-wide page keeps its order unchanged: it must walk
-- tcg_cards_game_number_idx. Bodies are the production definitions of 2026-10-05 with only these edits.
CREATE OR REPLACE FUNCTION public.browse_cards_page(p_game text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_desc boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- Two branches so each can walk tcg_cards_game_number_idx; the other is skipped by a one-time filter.
  with page as (
    select * from (
      select k.*
      from public.tcg_cards k
      where not coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number, k.id
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) a
    union all
    select * from (
      select k.*
      from public.tcg_cards k
      where coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number desc, k.id desc
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) d
  )
  select jsonb_build_object(
    'total', (select count(*) from public.tcg_cards k where k.game_id = p_game),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'canonicalId', c.canonical_id, 'game', c.game_id, 'seriesId', c.series_id,
      'officialCardNumber', c.official_card_number, 'rarity', c.rarity, 'nameZh', c.name_zh, 'nameJa', c.name_ja,
      'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', c.metadata->'nameZhBasis', 'numberStatus', c.metadata->'numberStatus')), 'source', c.source,
      'providerId', c.provider_id, 'createdAt', c.created_at, 'updatedAt', c.updated_at,
      'printings', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
          'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
          'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
          'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
          'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
          'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
          'metadata', jsonb_strip_nulls(jsonb_build_object(
          'variantKey', p.metadata->'variantKey', 'variantName', p.metadata->'variantName',
          'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial')),
        'createdAt', p.created_at, 'updatedAt', p.updated_at) order by p.id)
        from public.tcg_printings p where p.card_id = c.id), '[]'::jsonb),
      'images', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id, 'cardId', i.card_id, 'language', i.language, 'source', i.source, 'imageUrl', i.image_url,
          'sourceUrl', i.source_url, 'isPrimary', i.is_primary, 'fetchedAt', i.fetched_at,
          'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)
          order by i.is_primary desc, i.fetched_at desc)
        from public.card_images i where i.card_id = c.id), '[]'::jsonb))
      order by case when coalesce(p_desc, false) then null else c.official_card_number end,
               case when coalesce(p_desc, false) then null else c.id end,
               c.official_card_number desc, c.id desc)
      from page c), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.browse_series_cards(p_game text, p_series text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with printings as (
    select p.* from public.tcg_printings p where p.series_id = p_series
  ),
  cards as (
    select c.* from public.tcg_cards c
    where c.game_id = p_game and c.id in (select card_id from printings)
  )
  select jsonb_build_object(
    'printings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
        'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
        'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
        'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
        'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
        'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
        'metadata', jsonb_strip_nulls(jsonb_build_object(
          'variantKey', p.metadata->'variantKey', 'variantName', p.metadata->'variantName',
          'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial')),
        'createdAt', p.created_at, 'updatedAt', p.updated_at)
      order by p.local_card_number, p.id) from printings p), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'canonicalId', c.canonical_id, 'game', c.game_id, 'seriesId', c.series_id,
        'officialCardNumber', c.official_card_number, 'rarity', c.rarity, 'nameZh', c.name_zh, 'nameJa', c.name_ja,
        'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', c.metadata->'nameZhBasis', 'numberStatus', c.metadata->'numberStatus')), 'source', c.source,
        'providerId', c.provider_id, 'createdAt', c.created_at, 'updatedAt', c.updated_at)
      order by c.official_card_number, (c.metadata->>'officialListPosition')::integer, c.id) from cards c), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'cardId', i.card_id, 'language', i.language, 'source', i.source, 'imageUrl', i.image_url,
        'sourceUrl', i.source_url, 'isPrimary', i.is_primary, 'fetchedAt', i.fetched_at,
        'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)
      order by i.card_id, i.is_primary desc, i.fetched_at desc)
      from public.card_images i where i.card_id in (select id from cards)), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.search_cards_ranked(p_patterns text[], p_needles text[], p_limit integer DEFAULT 40, p_region text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with name_matched as (
    select distinct c.id
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k where k.search_names like lower(pattern)
    ) c
  ),
  -- Only when no name matched: search_text (card numbers such as SV6a-039, provider IDs), at most 100 cards.
  text_matched as (
    select distinct c.id
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k where k.search_text ilike pattern limit 100
    ) c
    where not exists (select 1 from name_matched)
  ),
  -- Only when no card matched at all: series names or codes (「ナイトワンダラー」, "SV6a"), at most 5 series,
  -- listing their first 100 printings in card-number order; ord keeps that order.
  series_hit as (
    select s.id
    from public.tcg_series s
    where not exists (select 1 from name_matched) and not exists (select 1 from text_matched)
      and exists (select 1 from unnest(p_patterns) pattern
                  where s.name_zh ilike pattern or s.name_ja ilike pattern or s.name_en ilike pattern
                     or s.name_ko ilike pattern or s.official_code ilike pattern)
    limit 5
  ),
  series_matched as (
    select card_id as id, min(ord) as ord
    from (select p.card_id, row_number() over (order by p.series_id, p.local_card_number, p.card_id) as ord
          from public.tcg_printings p where p.series_id in (select id from series_hit)
          order by p.series_id, p.local_card_number, p.card_id limit 100) x
    group by card_id
  ),
  matched as (
    select id, null::bigint as ord from name_matched
    union all select id, null from text_matched
    union all select id, ord from series_matched
  ),
  needles as (
    select distinct public.tcg_search_fold(n) as needle from unnest(p_needles) n where public.tcg_search_fold(n) <> ''
  ),
  scored as (
    select c.id, coalesce(c.canonical_id, c.id) as group_id,
      case when m.ord is null then coalesce(c.name_en, c.name_zh, '') else '' end as sort_name,
      -- Series listings keep card-number order; name and text matches are scored like the server.
      case when m.ord is not null then m.ord else coalesce((
        select min(case when f.name = nd.needle then 0 when left(f.name, length(nd.needle)) = nd.needle then 1
                        when strpos(f.name, nd.needle) > 0 then 2 end)
        from (select public.tcg_search_fold(v) as name
              from unnest(array[c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number] || coalesce(c.aliases, '{}')) v
              where v is not null) f
        cross join needles nd
        where f.name <> ''), 3) end as score
    from public.tcg_cards c
    join matched m on m.id = c.id
  ),
  -- With p_region, only groups that hold a printing of that region (the server shows only those
  -- printings); lateral index lookups per group, since a correlated EXISTS is planned as a table scan.
  in_region as (
    select distinct g.group_id
    from (select distinct group_id from scored) g
    cross join lateral (
      select k.id from public.tcg_cards k where k.canonical_id = g.group_id
      union all select g.group_id) k
    join public.tcg_printings p on p.card_id = k.id and p.region = p_region
    where p_region is not null
  ),
  groups as (
    select s.group_id, min(s.score) as score, min(s.sort_name) as sort_name
    from scored s
    where p_region is null or s.group_id in (select group_id from in_region)
    group by s.group_id
  ),
  top_groups as (
    select group_id, score, sort_name from groups
    order by score, sort_name, group_id
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  ),
  -- Two index lookups (canonical_id, id) instead of one OR, which would scan the table.
  cards as (
    select c.*, exists (select 1 from matched m where m.id = c.id) as hit
    from public.tcg_cards c
    where c.id in (
      select k.id from public.tcg_cards k join top_groups g on k.canonical_id = g.group_id
      union
      select k.id from public.tcg_cards k join top_groups g on k.id = g.group_id)
    limit 300
  )
  select jsonb_build_object(
    'matchedBy', case when exists (select 1 from name_matched) then 'name' when exists (select 1 from text_matched) then 'text'
                      when exists (select 1 from series_matched) then 'series' end,
    'matchedSeries', (select count(*) from series_hit),
    'matchCount', (select count(*) from matched),
    'groupCount', (select count(*) from groups),
    'cards', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.id, 'canonicalId', x.canonical_id, 'game', x.game_id, 'seriesId', x.series_id,
      'officialCardNumber', x.official_card_number, 'rarity', x.rarity, 'nameZh', x.name_zh,
      'nameJa', x.name_ja, 'nameEn', x.name_en, 'nameKo', x.name_ko, 'aliases', x.aliases, 'hit', x.hit,
      'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', x.metadata->'nameZhBasis', 'numberStatus', x.metadata->'numberStatus')),
      'printings', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
          'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
          'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
          'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
          'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
          'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
          'metadata', jsonb_strip_nulls(jsonb_build_object(
            'variantKey', p.metadata->'variantKey', 'variantName', p.metadata->'variantName',
            'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial')))) order by p.id)
        from public.tcg_printings p where p.card_id = x.id), '[]'::jsonb))) order by g.score, g.sort_name, g.group_id, x.id)
      from cards x join top_groups g on g.group_id = coalesce(x.canonical_id, x.id)), '[]'::jsonb));
$function$;
