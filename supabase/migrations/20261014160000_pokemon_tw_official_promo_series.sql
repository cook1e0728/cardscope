-- CardScope：台版特典卡（SV-P 補號、M-P、S-P、SM-P；ADR 0041）。
-- 1. 台灣官方系列匯入與補號函式的系列代碼檢查由 ^[A-Za-z0-9]+$ 放寬為 ^[A-Za-z0-9]+(-P)?$（比照日版 20261004010000）。
-- 2. 補號原本每個系列只允許一份計畫（上限 100 張）；SV-P 要補 132 張，改為同一系列可有多份計畫：同一 digest 視為重播，
--    不同計畫一律經既有的對齊與碰撞檢查（比照日版 20261010130000）。
-- 其餘與正式庫現行定義逐字相同（import md5 c8b0bdbf…、supplement md5 8dd8941e…）。

drop index if exists private.catalog_tw_official_supplement_audit_one_per_series;
create unique index if not exists catalog_tw_official_supplement_audit_one_per_plan
  on private.catalog_tw_official_supplement_audit (game_id, source, series_provider_id, plan_digest) where kind = 'supplement';

CREATE OR REPLACE FUNCTION private.import_pokemon_tw_official_series(p_plan jsonb, p_actor text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '5s'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_source constant text := 'asia-pokemon-card-official-tw';
  v_digest text;
  v_code text;
  v_series jsonb;
  v_series_id text;
  v_card_count integer;
  v_index integer;
  v_count integer;
  v_total integer;
  v_existing private.catalog_tw_official_import_audit%rowtype;
  v_previous private.catalog_tw_official_import_audit%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_bad text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'TW official import requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'source' is distinct from v_source
    or jsonb_typeof(p_plan->'series') is distinct from 'object'
    or jsonb_typeof(p_plan->'cards') is distinct from 'array'
    or jsonb_typeof(p_plan->'batch') is distinct from 'object' then
    raise exception 'TW official import plan has an unsupported shape';
  end if;
  if coalesce(p_plan->>'evidenceHash', '') !~ '^[0-9a-f]{64}$' or p_plan->>'sourceObservedAt' is null then
    raise exception 'TW official import plan is missing provenance';
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
    raise exception 'TW official import batch % of % is out of range', v_index, v_count;
  end if;
  if coalesce(v_code, '') !~ '^[A-Za-z0-9]+(-P)?$'
    or v_series->>'provider_id' is distinct from v_code
    or v_series_id is distinct from 'pokemon-official-tw-' || lower(v_code)
    or coalesce(btrim(v_series->>'name_zh'), '') = ''
    or coalesce(v_series->>'source_url', '') not like 'https://asia.pokemon-card.com/tw/card-search/%' then
    raise exception 'TW official import series identity is invalid for %', v_code;
  end if;
  if v_card_count not between 1 and 100 then
    raise exception 'TW official import accepts 1-100 cards per batch, got %', v_card_count;
  end if;

  select coalesce(c->>'id', '<missing id>') into v_bad
  from jsonb_array_elements(p_plan->'cards') as c
  where coalesce(c->>'official_card_number', '') !~ '^[A-Za-z0-9]+$'
    or coalesce(c->>'provider_id', '') !~ '^[0-9]+$'
    or c->>'id' is distinct from v_series_id || '-' || lower(c->>'official_card_number')
    or coalesce(btrim(c->>'name_zh'), '') = ''
    or c->>'source_url' is distinct from 'https://asia.pokemon-card.com/tw/card-search/detail/' || (c->>'provider_id') || '/'
    or (c->>'rarity_code' is not null and not exists (
      select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code'))
  limit 1;
  if found then
    raise exception 'TW official import card identity is invalid for %', v_bad;
  end if;
  if (select count(distinct lower(c->>'official_card_number')) from jsonb_array_elements(p_plan->'cards') c) <> v_card_count
    or (select count(distinct c->>'provider_id') from jsonb_array_elements(p_plan->'cards') c) <> v_card_count then
    raise exception 'TW official import plan repeats a card number or official card ID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-import:' || lower(v_code), 0)
  );

  -- A series code that already has an archive (tcgdex-ja) series is never imported again (ADR 0012).
  if exists (
    select 1 from public.tcg_series s
    where s.game_id = 'pokemon' and s.region = 'TW' and upper(s.official_code) = upper(v_code) and s.source is distinct from v_source
  ) then
    raise exception 'TW series % already exists from another source', v_code;
  end if;

  select * into v_existing
  from private.catalog_tw_official_import_audit a
  where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code
    and a.batch_index = v_index and a.kind = 'import';
  if found then
    if v_existing.plan_digest <> v_digest then
      raise exception 'TW series % batch % was already imported from a different plan', v_code, v_index;
    end if;
    if (select count(*) from jsonb_array_elements(p_plan->'cards') c
        join public.tcg_cards k on k.id = c->>'id' and k.source = v_source and k.provider_id = c->>'provider_id'
        join public.tcg_printings p on p.card_id = k.id and p.source = v_source) <> v_card_count then
      raise exception 'TW series % batch % no longer matches its import audit', v_code, v_index;
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'seriesId', v_series_id, 'batch', v_index,
      'planDigest', v_digest, 'inserted', jsonb_build_object('series', 0, 'cards', 0, 'printings', 0));
    if not p_dry_run then
      insert into private.catalog_tw_official_import_audit (kind, game_id, source, series_provider_id, series_id, batch_index,
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
    from private.catalog_tw_official_import_audit a
    where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code
      and a.batch_index = v_index - 1 and a.kind = 'import';
    if not found
      or v_previous.batch_count <> v_count or v_previous.series_card_count <> v_total
      or v_previous.evidence_hash <> p_plan->>'evidenceHash'
      or v_previous.source_observed_at <> (p_plan->>'sourceObservedAt')::timestamptz then
      raise exception 'TW series % batch % needs batch % of the same snapshot first', v_code, v_index, v_index - 1;
    end if;
    if not exists (select 1 from public.tcg_series s where s.id = v_series_id and s.source = v_source and s.provider_id = v_code) then
      raise exception 'TW series % is missing for batch %', v_code, v_index;
    end if;
  elsif exists (
    select 1 from private.catalog_tw_official_import_audit a
    where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code and a.kind = 'import'
  ) then
    raise exception 'TW series % already has batches from another plan', v_code;
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
        or (s.game_id = 'pokemon' and s.region = 'TW' and upper(s.official_code) = upper(v_code))) else 0 end,
    'cards', (select count(*) from public.tcg_cards c
      where c.id in (select id from ids)
        or (c.source = v_source and c.provider_id in (select provider_id from ids))),
    'canonical', (select count(*) from public.tcg_canonical_cards k where k.id in (select id from ids)),
    'printings', (select count(*) from public.tcg_printings p
      where p.card_id in (select id from ids)
        or (p.source = v_source and p.provider_id in (select provider_id from ids))
        or (p.region = 'TW' and upper(p.local_set_code) = upper(v_code)
          and p.local_card_number in (select number from ids)))
  ) into v_before;
  if v_before <> '{"series":0,"cards":0,"canonical":0,"printings":0}'::jsonb then
    raise exception 'TW official import collides with existing rows for % batch %: %', v_code, v_index, v_before;
  end if;

  begin
    if v_index = 1 then
      insert into public.tcg_series (id, game_id, official_code, name_zh, region, language, release_date,
        source_url, source, provider_id, source_locale, metadata)
      values (v_series_id, 'pokemon', v_code, v_series->>'name_zh', 'TW', 'zh-TW',
        (v_series->>'release_date')::date, v_series->>'source_url', v_source, v_code, 'zh-TW',
        coalesce(v_series->'metadata', '{}'::jsonb));
    end if;

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
      c->>'source_url', (v_series->>'release_date')::date, v_series_id, r.rarity_code, r.rarity_code, r.rarity_label,
      v_source, c->>'provider_id', false, coalesce(c->'metadata', '{}'::jsonb), 'not-provided', 'zh-TW',
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
      raise exception 'TW official import wrote an unexpected row count for % batch %', v_code, v_index;
    end if;
    if v_index = v_count and (
      (select count(*) from public.tcg_cards c where c.series_id = v_series_id and c.source = v_source) <> v_total
      or (select count(*) from public.tcg_printings p where p.series_id = v_series_id and p.source = v_source) <> v_total) then
      raise exception 'TW official import final batch does not complete % (% cards expected)', v_code, v_total;
    end if;

    insert into private.catalog_tw_official_import_audit (kind, game_id, source, series_provider_id, series_id, batch_index,
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
      raise exception using errcode = 'CJ015', message = 'TW official import dry run rolled back';
    end if;
  exception when sqlstate 'CJ015' then
    null;
  end;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.supplement_pokemon_tw_official_series(p_plan jsonb, p_actor text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '5s'
 SET statement_timeout TO '60s'
AS $function$
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

  if coalesce(v_code, '') !~ '^[A-Za-z0-9]+(-P)?$' or p_plan->'series'->>'provider_id' is distinct from v_code then
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

  -- The target must be the Taiwanese series of this code: the Source archive one, or one imported from the official search (ADR 0015).
  if not exists (
    select 1 from public.tcg_series s
    where s.id = v_series_id and s.game_id = 'pokemon' and s.region = 'TW' and s.source in ('tcgdex-zh-tw', 'asia-pokemon-card-official-tw')
      and upper(s.official_code) = upper(v_code)
  ) then
    raise exception 'TW official supplement target % is not the Taiwanese series of %', v_series_id, v_code;
  end if;

  select * into v_existing
  from private.catalog_tw_official_supplement_audit a
  where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code and a.kind = 'supplement'
    and a.plan_digest = v_digest;
  if found then
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
$function$;
revoke all on function private.import_pokemon_tw_official_series(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.import_pokemon_tw_official_series(jsonb, text, boolean) to service_role;
revoke all on function private.supplement_pokemon_tw_official_series(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.supplement_pokemon_tw_official_series(jsonb, text, boolean) to service_role;
