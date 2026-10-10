-- CardScope：ADR 0032 分盒。第 1 盒沿用原代碼系列，若該系列已有部分卡（SCS 已有 021），其餘卡以補卡函式補入；
-- 這些卡各只有一個官方詳細頁，原本「officialCardIds 至少 2 個」（ADR 0025 同號同名合併）會擋下。
-- 改為：卡片 metadata 帶有 officialProduct（官方「収録商品」，ADR 0032 的分盒依據）時至少 1 個即可，其他檢查不變。

CREATE OR REPLACE FUNCTION private.supplement_pokemon_jp_official_series(p_plan jsonb, p_actor text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '5s'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_source constant text := 'pokemon-card-official-jp';
  v_digest text;
  v_code text;
  v_series_id text;
  v_card_count integer;
  v_existing private.catalog_jp_official_supplement_audit%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_bad text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP official supplement requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'source' is distinct from v_source
    or jsonb_typeof(p_plan->'series') is distinct from 'object'
    or jsonb_typeof(p_plan->'cards') is distinct from 'array' then
    raise exception 'JP official supplement plan has an unsupported shape';
  end if;
  if coalesce(p_plan->>'evidenceHash', '') !~ '^[0-9a-f]{64}$' or p_plan->>'sourceObservedAt' is null then
    raise exception 'JP official supplement plan is missing provenance';
  end if;

  v_digest := encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
  v_code := p_plan->>'seriesProviderId';
  v_series_id := p_plan->'series'->>'id';
  v_card_count := jsonb_array_length(p_plan->'cards');

  -- Same code rule as the official import (ADR 0017/0018): letters and digits, optional -P or one hyphen suffix.
  if coalesce(v_code, '') !~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)?$' or p_plan->'series'->>'provider_id' is distinct from v_code
    or v_series_id is distinct from 'pokemon-official-ja-' || lower(v_code) then
    raise exception 'JP official supplement series identity is invalid for %', v_code;
  end if;
  if v_card_count not between 1 and 100 then
    raise exception 'JP official supplement accepts 1-100 cards per series, got %', v_card_count;
  end if;

  select coalesce(c->>'id', '<missing id>') into v_bad
  from jsonb_array_elements(p_plan->'cards') as c
  where coalesce(c->>'official_card_number', '') !~ '^[A-Za-z0-9]+$'
    or coalesce(c->>'provider_id', '') !~ '^[0-9]+$'
    or c->>'id' is distinct from v_series_id || '-' || lower(c->>'official_card_number')
    or coalesce(btrim(c->>'name_ja'), '') = ''
    or c->>'source_url' is distinct from 'https://www.pokemon-card.com/card-search/details.php/card/' || (c->>'provider_id') || '/regu/all'
    or jsonb_typeof(c->'metadata'->'officialCardIds') is distinct from 'array'
    or jsonb_array_length(c->'metadata'->'officialCardIds') < case when coalesce(btrim(c->'metadata'->>'officialProduct'), '') <> '' then 1 else 2 end
    or not (c->'metadata'->'officialCardIds') ? (c->>'provider_id')
    or (c->>'rarity_code' is not null and not exists (
      select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code'))
  limit 1;
  if found then
    raise exception 'JP official supplement card identity is invalid for %', v_bad;
  end if;
  if (select count(distinct lower(c->>'official_card_number')) from jsonb_array_elements(p_plan->'cards') c) <> v_card_count
    or (select count(distinct c->>'provider_id') from jsonb_array_elements(p_plan->'cards') c) <> v_card_count then
    raise exception 'JP official supplement plan repeats a card number or official card ID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-import:' || lower(v_code), 0)
  );

  if not exists (
    select 1 from public.tcg_series s
    where s.id = v_series_id and s.game_id = 'pokemon' and s.region = 'JP' and s.source = v_source and s.provider_id = v_code
  ) then
    raise exception 'JP official supplement target % is not the official series of %', v_series_id, v_code;
  end if;

  select * into v_existing
  from private.catalog_jp_official_supplement_audit a
  where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code and a.kind = 'supplement'
    and a.plan_digest = v_digest;
  if found then
    if (select count(*) from jsonb_array_elements(p_plan->'cards') c
        join public.tcg_cards k on k.id = c->>'id' and k.source = v_source and k.provider_id = c->>'provider_id'
        join public.tcg_printings p on p.card_id = k.id and p.source = v_source and p.series_id = v_series_id) <> v_card_count then
      raise exception 'JP series % no longer matches its supplement audit', v_code;
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'seriesId', v_series_id,
      'planDigest', v_digest, 'inserted', jsonb_build_object('cards', 0, 'printings', 0));
    if not p_dry_run then
      insert into private.catalog_jp_official_supplement_audit (kind, game_id, source, series_provider_id, series_id,
        plan_digest, evidence_hash, source_observed_at, actor, card_count, plan, before_snapshot, after_snapshot)
      values ('replay', 'pokemon', v_source, v_code, v_series_id, v_digest, p_plan->>'evidenceHash',
        (p_plan->>'sourceObservedAt')::timestamptz, p_actor, v_card_count, p_plan, '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  end if;

  -- Any existing row on a claimed identity (card ID, any listed official page ID, or JP number in this code) aborts.
  with ids as (
    select c->>'id' as id, c->>'official_card_number' as number from jsonb_array_elements(p_plan->'cards') c
  ), pages as (
    select jsonb_array_elements_text(c->'metadata'->'officialCardIds') as page_id from jsonb_array_elements(p_plan->'cards') c
  )
  select jsonb_build_object(
    'cards', (select count(*) from public.tcg_cards c
      where c.id in (select id from ids) or (c.source = v_source and c.provider_id in (select page_id from pages))),
    'canonical', (select count(*) from public.tcg_canonical_cards k where k.id in (select id from ids)),
    'printings', (select count(*) from public.tcg_printings p
      where p.card_id in (select id from ids)
        or (p.source = v_source and p.provider_id in (select page_id from pages))
        or (p.region = 'JP' and upper(p.local_set_code) = upper(v_code) and p.local_card_number in (select number from ids)))
  ) into v_before;
  if v_before <> '{"cards":0,"canonical":0,"printings":0}'::jsonb then
    raise exception 'JP official supplement collides with existing rows for %: %', v_code, v_before;
  end if;

  begin
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
      c->>'source_url', s.release_date, v_series_id, r.rarity_code, r.rarity_code, r.rarity_label,
      v_source, c->>'provider_id', false, coalesce(c->'metadata', '{}'::jsonb), 'not-provided', 'ja-JP',
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
      raise exception 'JP official supplement wrote an unexpected row count for %', v_code;
    end if;

    insert into private.catalog_jp_official_supplement_audit (kind, game_id, source, series_provider_id, series_id,
      plan_digest, evidence_hash, source_observed_at, actor, card_count, plan, before_snapshot, after_snapshot)
    values ('supplement', 'pokemon', v_source, v_code, v_series_id, v_digest, p_plan->>'evidenceHash',
      (p_plan->>'sourceObservedAt')::timestamptz, p_actor, v_card_count, p_plan, v_before, v_after);

    v_result := jsonb_build_object('replay', false, 'dryRun', p_dry_run, 'seriesId', v_series_id,
      'planDigest', v_digest, 'before', v_before,
      'inserted', jsonb_build_object('cards', v_card_count, 'canonical', v_card_count, 'printings', v_card_count));
    if p_dry_run then
      raise exception using errcode = 'CJ025', message = 'JP official supplement dry run rolled back';
    end if;
  exception when sqlstate 'CJ025' then
    null;
  end;
  return v_result;
end;
$function$;
