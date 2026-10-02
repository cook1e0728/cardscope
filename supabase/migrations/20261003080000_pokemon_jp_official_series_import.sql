-- CardScope: import Japanese Pokémon series that the Source archive has no
-- Japanese card names for, straight from the official pokemon-card.com card
-- search (ADR 0012). Source 'pokemon-card-official-jp', Provider ID = official
-- card ID, IDs pokemon-official-ja-<series>[-<number>]. Ordered batches of at most
-- 100 cards (ADR 0005 rules: batch 1 inserts the series, batch N needs batch N-1
-- of the same snapshot, the last batch checks the total), insert-only, dry run,
-- digest replay, append-only audit, any collision with existing JP rows aborts.
-- Cards are verified (identity read from the official page); printings are
-- verified when the rarity is known, otherwise incomplete.
--
-- Also lets private.fill_pokemon_jp_from_tw_official (ADR 0011) fill these series.

create table if not exists private.catalog_jp_official_import_audit (
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

create unique index if not exists catalog_jp_official_import_audit_one_import_per_batch
  on private.catalog_jp_official_import_audit (game_id, source, series_provider_id, batch_index)
  where kind = 'import';

alter table private.catalog_jp_official_import_audit enable row level security;
revoke all on table private.catalog_jp_official_import_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_official_import_audit to service_role;

comment on table private.catalog_jp_official_import_audit is
  'Append-only plan, before/after snapshot and replay log for Japanese Pokémon series imported from the official card search (ADR 0012).';

drop trigger if exists catalog_jp_official_import_audit_no_change on private.catalog_jp_official_import_audit;
create trigger catalog_jp_official_import_audit_no_change
before update or delete on private.catalog_jp_official_import_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_official_import_audit_no_truncate on private.catalog_jp_official_import_audit;
create trigger catalog_jp_official_import_audit_no_truncate
before truncate on private.catalog_jp_official_import_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- p_plan: { "planVersion": 1, "source": "pokemon-card-official-jp", "seriesProviderId": "S4",
--   "evidenceHash": "<sha256>", "sourceObservedAt": "<iso>",
--   "batch": { "index": 1, "count": 2, "seriesCardCount": 111 },
--   "series": { "id": "pokemon-official-ja-s4", "provider_id": "S4", "name_ja": "...", "release_date": "2020-09-18",
--     "source_url": "https://www.pokemon-card.com/card-search/...", "metadata": {} },
--   "cards": [ { "id": "pokemon-official-ja-s4-001", "provider_id": "38499", "official_card_number": "001",
--     "name_ja": "...", "rarity_code": "C" | null, "source_url": "<details url>", "search_text": "...",
--     "metadata": {} } ] }
create or replace function private.import_pokemon_jp_official_series(
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
  v_existing private.catalog_jp_official_import_audit%rowtype;
  v_previous private.catalog_jp_official_import_audit%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_bad text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP official import requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'source' is distinct from v_source
    or jsonb_typeof(p_plan->'series') is distinct from 'object'
    or jsonb_typeof(p_plan->'cards') is distinct from 'array'
    or jsonb_typeof(p_plan->'batch') is distinct from 'object' then
    raise exception 'JP official import plan has an unsupported shape';
  end if;
  if coalesce(p_plan->>'evidenceHash', '') !~ '^[0-9a-f]{64}$' or p_plan->>'sourceObservedAt' is null then
    raise exception 'JP official import plan is missing provenance';
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
    raise exception 'JP official import batch % of % is out of range', v_index, v_count;
  end if;
  if coalesce(v_code, '') !~ '^[A-Za-z0-9]+$'
    or v_series->>'provider_id' is distinct from v_code
    or v_series_id is distinct from 'pokemon-official-ja-' || lower(v_code)
    or coalesce(btrim(v_series->>'name_ja'), '') = ''
    or coalesce(v_series->>'source_url', '') not like 'https://www.pokemon-card.com/card-search/%' then
    raise exception 'JP official import series identity is invalid for %', v_code;
  end if;
  if v_card_count not between 1 and 100 then
    raise exception 'JP official import accepts 1-100 cards per batch, got %', v_card_count;
  end if;

  select coalesce(c->>'id', '<missing id>') into v_bad
  from jsonb_array_elements(p_plan->'cards') as c
  where coalesce(c->>'official_card_number', '') !~ '^[A-Za-z0-9]+$'
    or coalesce(c->>'provider_id', '') !~ '^[0-9]+$'
    or c->>'id' is distinct from v_series_id || '-' || lower(c->>'official_card_number')
    or coalesce(btrim(c->>'name_ja'), '') = ''
    or c->>'source_url' is distinct from 'https://www.pokemon-card.com/card-search/details.php/card/' || (c->>'provider_id') || '/regu/all'
    or (c->>'rarity_code' is not null and not exists (
      select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code'))
  limit 1;
  if found then
    raise exception 'JP official import card identity is invalid for %', v_bad;
  end if;
  if (select count(distinct lower(c->>'official_card_number')) from jsonb_array_elements(p_plan->'cards') c) <> v_card_count
    or (select count(distinct c->>'provider_id') from jsonb_array_elements(p_plan->'cards') c) <> v_card_count then
    raise exception 'JP official import plan repeats a card number or official card ID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-import:' || lower(v_code), 0)
  );

  -- A series code that already has an archive (tcgdex-ja) series is never imported again (ADR 0012).
  if exists (
    select 1 from public.tcg_series s
    where s.game_id = 'pokemon' and s.region = 'JP' and upper(s.official_code) = upper(v_code) and s.source is distinct from v_source
  ) then
    raise exception 'JP series % already exists from another source', v_code;
  end if;

  select * into v_existing
  from private.catalog_jp_official_import_audit a
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
      insert into private.catalog_jp_official_import_audit (kind, game_id, source, series_provider_id, series_id, batch_index,
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
    from private.catalog_jp_official_import_audit a
    where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code
      and a.batch_index = v_index - 1 and a.kind = 'import';
    if not found
      or v_previous.batch_count <> v_count or v_previous.series_card_count <> v_total
      or v_previous.evidence_hash <> p_plan->>'evidenceHash'
      or v_previous.source_observed_at <> (p_plan->>'sourceObservedAt')::timestamptz then
      raise exception 'JP series % batch % needs batch % of the same snapshot first', v_code, v_index, v_index - 1;
    end if;
    if not exists (select 1 from public.tcg_series s where s.id = v_series_id and s.source = v_source and s.provider_id = v_code) then
      raise exception 'JP series % is missing for batch %', v_code, v_index;
    end if;
  elsif exists (
    select 1 from private.catalog_jp_official_import_audit a
    where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code and a.kind = 'import'
  ) then
    raise exception 'JP series % already has batches from another plan', v_code;
  end if;

  -- Any pre-existing row on an identity this batch claims aborts it; batch 1
  -- also requires the series identity (and the JP series code) to be free.
  with ids as (
    select c->>'id' as id, c->>'provider_id' as provider_id, c->>'official_card_number' as number
    from jsonb_array_elements(p_plan->'cards') c
  )
  select jsonb_build_object(
    'series', case when v_index = 1 then (select count(*) from public.tcg_series s
      where s.id = v_series_id
        or (s.source = v_source and s.provider_id = v_code)
        or (s.game_id = 'pokemon' and s.region = 'JP' and upper(s.official_code) = upper(v_code))) else 0 end,
    'cards', (select count(*) from public.tcg_cards c
      where c.id in (select id from ids)
        or (c.source = v_source and c.provider_id in (select provider_id from ids))),
    'canonical', (select count(*) from public.tcg_canonical_cards k where k.id in (select id from ids)),
    'printings', (select count(*) from public.tcg_printings p
      where p.card_id in (select id from ids)
        or (p.source = v_source and p.provider_id in (select provider_id from ids))
        or (p.region = 'JP' and upper(p.local_set_code) = upper(v_code)
          and p.local_card_number in (select number from ids)))
  ) into v_before;
  if v_before <> '{"series":0,"cards":0,"canonical":0,"printings":0}'::jsonb then
    raise exception 'JP official import collides with existing rows for % batch %: %', v_code, v_index, v_before;
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
    select c->>'id', c->>'id', 'pokemon', v_series_id, c->>'official_card_number',
      r.rarity_code, r.rarity_tier, c->>'name_ja', array[v_code || '-' || (c->>'official_card_number')], v_source,
      c->>'provider_id', c->>'search_text', coalesce(c->'metadata', '{}'::jsonb), 'verified'
    from jsonb_array_elements(p_plan->'cards') c
    left join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code';

    insert into public.tcg_printings (card_id, region, language, local_set_code, local_card_number, image_url,
      source_url, release_date, series_id, rarity, rarity_code, rarity_label, source, provider_id,
      image_rehost_required, metadata, image_rights_status, source_locale, data_status)
    select c->>'id', 'JP', 'ja-JP', v_code, c->>'official_card_number', null,
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
      raise exception 'JP official import wrote an unexpected row count for % batch %', v_code, v_index;
    end if;
    if v_index = v_count and (
      (select count(*) from public.tcg_cards c where c.series_id = v_series_id and c.source = v_source) <> v_total
      or (select count(*) from public.tcg_printings p where p.series_id = v_series_id and p.source = v_source) <> v_total) then
      raise exception 'JP official import final batch does not complete % (% cards expected)', v_code, v_total;
    end if;

    insert into private.catalog_jp_official_import_audit (kind, game_id, source, series_provider_id, series_id, batch_index,
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
      raise exception using errcode = 'CJ012', message = 'JP official import dry run rolled back';
    end if;
  exception when sqlstate 'CJ012' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.import_pokemon_jp_official_series(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.import_pokemon_jp_official_series(jsonb, text, boolean) to service_role;

comment on function private.import_pokemon_jp_official_series(jsonb, text, boolean) is
  'Insert-only, all-or-nothing import of one ordered batch (<=100 cards) of a Japanese Pokémon series read from the official card search (ADR 0012); p_dry_run rolls back after full validation.';

-- ADR 0011 fill for official-search series too; otherwise identical to
-- 20261003000000_pokemon_jp_from_tw_official (the printing must share the series source).
create or replace function private.fill_pokemon_jp_from_tw_official(
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
  v_series_id text := p_plan->>'seriesId';
  v_digest text := md5(p_plan::text);
  v_rows jsonb := p_plan->'rows';
  v_source text;
  v_count integer;
  v_ids bigint[];
  v_bad text;
  v_names integer;
  v_rarities integer;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP fill from TW official requires an actor';
  end if;
  if (p_plan->>'version') is distinct from '1' or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'JP fill from TW official plan must be version 1 with a rows array';
  end if;
  v_count := jsonb_array_length(v_rows);
  if v_count < 1 or v_count > 100 then
    raise exception 'JP fill from TW official takes 1 to 100 rows, got %', v_count;
  end if;
  select s.source into v_source from public.tcg_series s
  where s.id = v_series_id and s.source in ('tcgdex-ja', 'pokemon-card-official-jp') and s.region = 'JP' and s.game_id = 'pokemon';
  if v_source is null then
    raise exception 'JP fill from TW official target % is not a Japanese series', v_series_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cardscope:pokemon-official-rarity:' || v_series_id, 0));

  create temporary table jp_tw_plan on commit drop as
  select (r->>'printingId')::bigint printing_id, r->>'cardId' card_id, r->>'number' number, r->>'nameJa' name_ja,
    nullif(btrim(r->>'nameZh'), '') name_zh, r->>'rarity' rarity, r->'officialDetailIds' official_detail_ids
  from jsonb_array_elements(v_rows) r;

  if (select count(distinct printing_id) from jp_tw_plan) <> v_count then
    raise exception 'JP fill from TW official plan repeats a printing';
  end if;

  select string_agg(coalesce(x.printing_id::text, '?') || ':' || x.reason, ', ') into v_bad
  from (
    select pl.printing_id,
      case
        when p.id is null then 'missing'
        when p.source <> v_source or p.region <> 'JP' then 'source'
        when p.series_id <> v_series_id then 'series'
        when p.local_card_number is distinct from pl.number then 'number'
        when p.card_id is distinct from pl.card_id then 'card'
        when c.name_ja is distinct from pl.name_ja then 'name'
        when pl.name_zh is null and pl.rarity is null then 'nothing-planned'
        when jsonb_typeof(pl.official_detail_ids) <> 'array' or jsonb_array_length(pl.official_detail_ids) = 0 then 'official-id'
        when pl.rarity is not null and not exists (select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = pl.rarity) then 'rarity-code'
        when pl.rarity is not null and p.rarity_code is not null and p.rarity_code <> pl.rarity then 'printing-conflict'
        when pl.rarity is not null and c.rarity is not null and c.rarity <> pl.rarity then 'card-conflict'
        when pl.name_zh is not null and c.name_zh is not null and c.name_zh <> pl.name_zh then 'name-conflict'
      end reason
    from jp_tw_plan pl
    left join public.tcg_printings p on p.id = pl.printing_id
    left join public.tcg_cards c on c.id = p.card_id
  ) x
  where x.reason is not null;
  if v_bad is not null then
    raise exception 'JP fill from TW official rejected rows: %', v_bad;
  end if;

  select array_agg(printing_id order by printing_id) into v_ids from jp_tw_plan;
  select count(*) filter (where pl.name_zh is not null and c.name_zh is null),
         count(*) filter (where pl.rarity is not null and p.rarity_code is null)
    into v_names, v_rarities
  from jp_tw_plan pl join public.tcg_printings p on p.id = pl.printing_id join public.tcg_cards c on c.id = p.card_id;

  v_before := (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'rarity', p.rarity, 'data_status', p.data_status,
      'card_rarity', c.rarity, 'name_zh', c.name_zh, 'card_status', c.data_status) order by p.id)
    from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where p.id = any(v_ids));

  begin
    update public.tcg_cards c
    set name_zh = pl.name_zh,
      metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('nameZhBasis', 'tw-official-same-number', 'nameZhOfficialDetailIds', pl.official_detail_ids),
      updated_at = now()
    from jp_tw_plan pl
    where c.id = pl.card_id and pl.name_zh is not null and c.name_zh is null;

    update public.tcg_printings p
    set rarity = pl.rarity, rarity_code = pl.rarity, rarity_label = pl.rarity,
      data_status = case when p.data_status = 'incomplete' and c.data_status = 'verified' then 'verified' else p.data_status end,
      metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('rarityBasis', 'asia-pokemon-card-official-tw-same-number', 'officialDetailIds', pl.official_detail_ids),
      updated_at = now()
    from jp_tw_plan pl, public.tcg_cards c
    where p.id = pl.printing_id and c.id = p.card_id and pl.rarity is not null and p.rarity_code is null;

    update public.tcg_cards c
    set rarity = pl.rarity, updated_at = now()
    from jp_tw_plan pl
    where c.id = pl.card_id and pl.rarity is not null and c.rarity is null;

    v_after := (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'rarity', p.rarity, 'data_status', p.data_status,
        'card_rarity', c.rarity, 'name_zh', c.name_zh, 'card_status', c.data_status) order by p.id)
      from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where p.id = any(v_ids));

    if exists (select 1 from jp_tw_plan pl join public.tcg_printings p on p.id = pl.printing_id join public.tcg_cards c on c.id = p.card_id
               where (pl.name_zh is not null and c.name_zh is distinct from pl.name_zh)
                  or (pl.rarity is not null and (p.rarity_code is distinct from pl.rarity or c.rarity is distinct from pl.rarity))
                  or (p.data_status = 'incomplete' and c.data_status = 'verified' and p.rarity_code is not null)) then
      raise exception 'JP fill from TW official did not reach the planned state for %', v_series_id;
    end if;

    insert into private.catalog_official_rarity_audit (game_id, kind, series_id, actor, plan_digest, replay,
      row_count, printing_ids, before_snapshot, after_snapshot)
    values ('pokemon', 'jp-tw-same-number', v_series_id, p_actor, v_digest, v_names + v_rarities = 0, v_count, v_ids, v_before, v_after);

    v_result := jsonb_build_object('dryRun', p_dry_run, 'seriesId', v_series_id, 'planDigest', v_digest,
      'replay', v_names + v_rarities = 0, 'rows', v_count, 'names', v_names, 'rarities', v_rarities, 'filled', v_names + v_rarities);
    if p_dry_run then
      raise exception using errcode = 'CJ010', message = 'JP fill from TW official dry run rolled back';
    end if;
  exception when sqlstate 'CJ010' then
    null;
  end;
  drop table if exists jp_tw_plan;
  return v_result;
end;
$$;

revoke all on function private.fill_pokemon_jp_from_tw_official(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.fill_pokemon_jp_from_tw_official(jsonb, text, boolean) to service_role;

comment on function private.fill_pokemon_jp_from_tw_official(jsonb, text, boolean) is
  'Fill-only Japanese Chinese names and rarities from the Taiwanese official card with the same series code and number (ADR 0011), for archive (tcgdex-ja) and official-search (ADR 0012) series; p_dry_run rolls back.';
