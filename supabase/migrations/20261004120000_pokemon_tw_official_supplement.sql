-- CardScope: add the numbers a Source archive (tcgdex-zh-tw) Taiwanese series lacks, read from
-- the Taiwanese official card search, into that same series (ADR 0023). Cards use the source
-- 'asia-pokemon-card-official-tw' and IDs pokemon-official-tw-<code>-<number>, exactly as ADR 0015;
-- only the series row is the existing archive one. Insert-only, one batch (<=100 cards) per series,
-- gated dry run, digest replay and an append-only audit like private.import_pokemon_tw_official_series.

create table if not exists private.catalog_tw_official_supplement_audit (
  audit_id bigint generated always as identity primary key,
  kind text not null check (kind in ('supplement', 'replay')),
  game_id text not null check (game_id = 'pokemon'),
  source text not null check (source = 'asia-pokemon-card-official-tw'),
  series_provider_id text not null,
  series_id text not null,
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

create unique index if not exists catalog_tw_official_supplement_audit_one_per_series
  on private.catalog_tw_official_supplement_audit (game_id, source, series_provider_id)
  where kind = 'supplement';

alter table private.catalog_tw_official_supplement_audit enable row level security;
revoke all on table private.catalog_tw_official_supplement_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_tw_official_supplement_audit to service_role;

comment on table private.catalog_tw_official_supplement_audit is
  'Append-only plan, before/after snapshot and replay log for numbers added to Source archive Taiwanese Pokémon series from the Taiwanese official card search (ADR 0023).';

drop trigger if exists catalog_tw_official_supplement_audit_no_change on private.catalog_tw_official_supplement_audit;
create trigger catalog_tw_official_supplement_audit_no_change
before update or delete on private.catalog_tw_official_supplement_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_tw_official_supplement_audit_no_truncate on private.catalog_tw_official_supplement_audit;
create trigger catalog_tw_official_supplement_audit_no_truncate
before truncate on private.catalog_tw_official_supplement_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- p_plan: { "planVersion": 1, "source": "asia-pokemon-card-official-tw", "seriesProviderId": "SV9",
--   "evidenceHash": "<sha256>", "sourceObservedAt": "<iso>",
--   "series": { "id": "pokemon-tcgdex-tw-sv9", "provider_id": "SV9" },
--   "alignment": [ { "number": "001", "name_zh": "..." } ],   -- official names of the numbers already present
--   "cards": [ same shape as private.import_pokemon_tw_official_series ] }
create or replace function private.supplement_pokemon_tw_official_series(
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
  v_source constant text := 'asia-pokemon-card-official-tw';
  v_digest text;
  v_code text;
  v_series_id text;
  v_card_count integer;
  v_existing private.catalog_tw_official_supplement_audit%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_bad text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'TW official supplement requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'source' is distinct from v_source
    or jsonb_typeof(p_plan->'series') is distinct from 'object'
    or jsonb_typeof(p_plan->'alignment') is distinct from 'array'
    or jsonb_typeof(p_plan->'cards') is distinct from 'array' then
    raise exception 'TW official supplement plan has an unsupported shape';
  end if;
  if coalesce(p_plan->>'evidenceHash', '') !~ '^[0-9a-f]{64}$' or p_plan->>'sourceObservedAt' is null then
    raise exception 'TW official supplement plan is missing provenance';
  end if;

  v_digest := encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
  v_code := p_plan->>'seriesProviderId';
  v_series_id := p_plan->'series'->>'id';
  v_card_count := jsonb_array_length(p_plan->'cards');

  if coalesce(v_code, '') !~ '^[A-Za-z0-9]+$' or p_plan->'series'->>'provider_id' is distinct from v_code then
    raise exception 'TW official supplement series code is invalid';
  end if;
  if v_card_count not between 1 and 100 then
    raise exception 'TW official supplement accepts 1-100 cards per series, got %', v_card_count;
  end if;

  select coalesce(c->>'id', '<missing id>') into v_bad
  from jsonb_array_elements(p_plan->'cards') as c
  where coalesce(c->>'official_card_number', '') !~ '^[A-Za-z0-9]+$'
    or coalesce(c->>'provider_id', '') !~ '^[0-9]+$'
    or c->>'id' is distinct from 'pokemon-official-tw-' || lower(v_code) || '-' || lower(c->>'official_card_number')
    or coalesce(btrim(c->>'name_zh'), '') = ''
    or c->>'source_url' is distinct from 'https://asia.pokemon-card.com/tw/card-search/detail/' || (c->>'provider_id') || '/'
    or (c->>'rarity_code' is not null and not exists (
      select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code'))
  limit 1;
  if found then
    raise exception 'TW official supplement card identity is invalid for %', v_bad;
  end if;
  if (select count(distinct lower(c->>'official_card_number')) from jsonb_array_elements(p_plan->'cards') c) <> v_card_count
    or (select count(distinct c->>'provider_id') from jsonb_array_elements(p_plan->'cards') c) <> v_card_count then
    raise exception 'TW official supplement plan repeats a card number or official card ID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-import:' || lower(v_code), 0)
  );

  -- The target must be the Source archive series of this code.
  if not exists (
    select 1 from public.tcg_series s
    where s.id = v_series_id and s.game_id = 'pokemon' and s.region = 'TW' and s.source = 'tcgdex-zh-tw'
      and upper(s.official_code) = upper(v_code)
  ) then
    raise exception 'TW official supplement target % is not the archive series of %', v_series_id, v_code;
  end if;

  select * into v_existing
  from private.catalog_tw_official_supplement_audit a
  where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code and a.kind = 'supplement';
  if found then
    if v_existing.plan_digest <> v_digest then
      raise exception 'TW series % was already supplemented from a different plan', v_code;
    end if;
    if (select count(*) from jsonb_array_elements(p_plan->'cards') c
        join public.tcg_cards k on k.id = c->>'id' and k.source = v_source and k.provider_id = c->>'provider_id'
        join public.tcg_printings p on p.card_id = k.id and p.source = v_source and p.series_id = v_series_id) <> v_card_count then
      raise exception 'TW series % no longer matches its supplement audit', v_code;
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'seriesId', v_series_id,
      'planDigest', v_digest, 'inserted', jsonb_build_object('cards', 0, 'printings', 0));
    if not p_dry_run then
      insert into private.catalog_tw_official_supplement_audit (kind, game_id, source, series_provider_id, series_id,
        plan_digest, evidence_hash, source_observed_at, actor, card_count, plan, before_snapshot, after_snapshot)
      values ('replay', 'pokemon', v_source, v_code, v_series_id, v_digest, p_plan->>'evidenceHash',
        (p_plan->>'sourceObservedAt')::timestamptz, p_actor, v_card_count, p_plan, '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  end if;

  -- Alignment: every printing already in the series must appear in the plan's alignment list under
  -- the same number with the same Chinese name, and the list must name nothing that is absent.
  select coalesce(p.local_card_number, a->>'number') into v_bad
  from (select p.local_card_number, k.name_zh from public.tcg_printings p join public.tcg_cards k on k.id = p.card_id
        where p.series_id = v_series_id) p
  full join jsonb_array_elements(p_plan->'alignment') a on a->>'number' = p.local_card_number
  where p.local_card_number is null or a is null or p.name_zh is distinct from a->>'name_zh'
  limit 1;
  if found then
    raise exception 'TW official supplement for % is not aligned with the archive series at number %', v_code, v_bad;
  end if;

  with ids as (
    select c->>'id' as id, c->>'provider_id' as provider_id, c->>'official_card_number' as number
    from jsonb_array_elements(p_plan->'cards') c
  )
  select jsonb_build_object(
    'cards', (select count(*) from public.tcg_cards c
      where c.id in (select id from ids)
        or (c.source = v_source and c.provider_id in (select provider_id from ids))),
    'canonical', (select count(*) from public.tcg_canonical_cards k where k.id in (select id from ids)),
    'printings', (select count(*) from public.tcg_printings p
      where p.card_id in (select id from ids)
        or (p.source = v_source and p.provider_id in (select provider_id from ids))
        or (p.region = 'TW' and upper(p.local_set_code) = upper(v_code) and p.local_card_number in (select number from ids)))
  ) into v_before;
  if v_before <> '{"cards":0,"canonical":0,"printings":0}'::jsonb then
    raise exception 'TW official supplement collides with existing rows for %: %', v_code, v_before;
  end if;

  begin
    insert into public.tcg_cards (id, canonical_id, game_id, series_id, official_card_number, rarity, rarity_tier,
      name_zh, aliases, source, provider_id, search_text, metadata, data_status)
    select c->>'id', c->>'id', 'pokemon', v_series_id, c->>'official_card_number',
      r.rarity_code, r.rarity_tier, c->>'name_zh', array[v_code || '-' || (c->>'official_card_number')], v_source,
      c->>'provider_id', c->>'search_text', coalesce(c->'metadata', '{}'::jsonb), 'verified'
    from jsonb_array_elements(p_plan->'cards') c
    left join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code';

    insert into public.tcg_printings (card_id, region, language, local_set_code, local_card_number, image_url,
      source_url, release_date, series_id, rarity, rarity_code, rarity_label, source, provider_id,
      image_rehost_required, metadata, image_rights_status, source_locale, data_status)
    select c->>'id', 'TW', 'zh-TW', v_code, c->>'official_card_number', null,
      c->>'source_url', s.release_date, v_series_id, r.rarity_code, r.rarity_code, r.rarity_label,
      v_source, c->>'provider_id', false, coalesce(c->'metadata', '{}'::jsonb), 'not-provided', 'zh-TW',
      case when r.rarity_code is null then 'incomplete' else 'verified' end
    from jsonb_array_elements(p_plan->'cards') c
    cross join public.tcg_series s
    left join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code'
    where s.id = v_series_id;

    v_after := jsonb_build_object(
      'cards', (select jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' order by c.id)
        from public.tcg_cards c where c.id in (select x->>'id' from jsonb_array_elements(p_plan->'cards') x)),
      'printings', (select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.provider_id)
        from public.tcg_printings p where p.card_id in (select x->>'id' from jsonb_array_elements(p_plan->'cards') x))
    );
    if jsonb_array_length(v_after->'cards') <> v_card_count or jsonb_array_length(v_after->'printings') <> v_card_count
      or (select count(*) from public.tcg_canonical_cards k where k.id in (select x->>'id' from jsonb_array_elements(p_plan->'cards') x)) <> v_card_count then
      raise exception 'TW official supplement wrote an unexpected row count for %', v_code;
    end if;

    insert into private.catalog_tw_official_supplement_audit (kind, game_id, source, series_provider_id, series_id,
      plan_digest, evidence_hash, source_observed_at, actor, card_count, plan, before_snapshot, after_snapshot)
    values ('supplement', 'pokemon', v_source, v_code, v_series_id, v_digest, p_plan->>'evidenceHash',
      (p_plan->>'sourceObservedAt')::timestamptz, p_actor, v_card_count, p_plan, v_before, v_after);

    v_result := jsonb_build_object('replay', false, 'dryRun', p_dry_run, 'seriesId', v_series_id,
      'planDigest', v_digest, 'before', v_before,
      'inserted', jsonb_build_object('cards', v_card_count, 'canonical', v_card_count, 'printings', v_card_count));
    if p_dry_run then
      raise exception using errcode = 'CJ023', message = 'TW official supplement dry run rolled back';
    end if;
  exception when sqlstate 'CJ023' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.supplement_pokemon_tw_official_series(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.supplement_pokemon_tw_official_series(jsonb, text, boolean) to service_role;

comment on function private.supplement_pokemon_tw_official_series(jsonb, text, boolean) is
  'Insert-only, all-or-nothing addition of the numbers a Source archive Taiwanese Pokémon series lacks, read from the Taiwanese official card search (ADR 0023); requires every existing number to carry the official name; p_dry_run rolls back after full validation.';
