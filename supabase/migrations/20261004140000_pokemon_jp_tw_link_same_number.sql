-- CardScope: link a Japanese card to the Taiwanese card with the same series code and official
-- card number (ADR 0024). Each row: JP card not linked yet, TW card from the Source archive or the
-- Taiwanese official search with an unshared canonical, one card per number on each side, and equal
-- Chinese names under the ADR 0010 rule. Each series in the plan must also be aligned: every named
-- unlinked same-number pair agrees, and no JP card is linked to a TW card of another number.
-- Up to 100 rows per call, dry run, replay changes nothing, audit in private.catalog_jp_tw_link_audit.

alter table private.catalog_jp_tw_link_audit drop constraint if exists catalog_jp_tw_link_audit_rule_check;
alter table private.catalog_jp_tw_link_audit add constraint catalog_jp_tw_link_audit_rule_check
  check (rule in ('adr-0015', 'adr-0024'));

-- ADR 0010 name key: NFKC, no zero-width characters, no Source name markup brackets, no spaces.
create or replace function private.tw_name_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(regexp_replace(normalize(coalesce(p_value, ''), NFKC), '[​-‍⁠﻿]', '', 'g'), '[<>[:space:]]', '', 'g')
$$;

-- Equal keys, or one title adds a single bracketed card note to the other (妮莫 / 妮莫（過去）).
create or replace function private.same_tw_name(p_a text, p_b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with k as (select private.tw_name_key(p_a) a, private.tw_name_key(p_b) b)
  select a <> '' and b <> '' and (a = b
    or (left(b, length(a)) = a and substr(b, length(a) + 1) ~ '^\([^()]+\)$')
    or (left(a, length(b)) = b and substr(a, length(b) + 1) ~ '^\([^()]+\)$'))
  from k
$$;

-- p_plan: { "version": 1, "rule": "adr-0024", "rows": [ { "jpCardId": "...", "twCardId": "..." } ] }
create or replace function private.link_pokemon_jp_tw_same_number(
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
  v_rows jsonb := p_plan->'rows';
  v_digest text := md5(p_plan::text);
  v_count integer;
  v_ids text[];
  v_bad text;
  v_links integer;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP-TW link requires an actor';
  end if;
  if (p_plan->>'version') is distinct from '1' or (p_plan->>'rule') is distinct from 'adr-0024' or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'JP-TW same-number link plan must be version 1, rule adr-0024, with a rows array';
  end if;
  v_count := jsonb_array_length(v_rows);
  if v_count < 1 or v_count > 100 then
    raise exception 'JP-TW link takes 1 to 100 rows, got %', v_count;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cardscope:pokemon-jp-tw-link', 0));

  create temporary table jp_tw_same_number_plan on commit drop as
  select r->>'jpCardId' jp_id, r->>'twCardId' tw_id from jsonb_array_elements(v_rows) r;

  if (select count(distinct jp_id) from jp_tw_same_number_plan) <> v_count or (select count(distinct tw_id) from jp_tw_same_number_plan) <> v_count then
    raise exception 'JP-TW link plan repeats a card';
  end if;

  select string_agg(coalesce(x.jp_id, '?') || ':' || x.reason, ', ') into v_bad
  from (
    select pl.jp_id,
      case
        when j.id is null or t.id is null then 'missing'
        when js.region is distinct from 'JP' or j.game_id <> 'pokemon' or t.game_id <> 'pokemon' then 'jp-region'
        when ts.region is distinct from 'TW' or ts.source not in ('tcgdex-zh-tw', 'asia-pokemon-card-official-tw') then 'tw-source'
        when j.canonical_id = t.id then null
        when j.canonical_id is distinct from j.id then 'jp-already-linked'
        when upper(js.official_code) is distinct from upper(ts.official_code) then 'series-code'
        when j.official_card_number is distinct from t.official_card_number then 'number'
        when j.name_zh is distinct from t.name_zh and not private.same_tw_name(j.name_zh, t.name_zh) then 'name'
        when t.canonical_id is distinct from t.id then 'tw-canonical'
        when exists (select 1 from public.tcg_cards o where o.canonical_id = t.id and o.id <> t.id) then 'tw-canonical-shared'
        when (select count(*) from public.tcg_cards o join public.tcg_series os on os.id = o.series_id
              where os.region = 'JP' and upper(os.official_code) = upper(js.official_code) and o.official_card_number = j.official_card_number) <> 1 then 'jp-number-repeated'
        when (select count(*) from public.tcg_cards o join public.tcg_series os on os.id = o.series_id
              where os.region = 'TW' and upper(os.official_code) = upper(ts.official_code) and o.official_card_number = t.official_card_number) <> 1 then 'tw-number-repeated'
      end reason
    from jp_tw_same_number_plan pl
    left join public.tcg_cards j on j.id = pl.jp_id
    left join public.tcg_series js on js.id = j.series_id
    left join public.tcg_cards t on t.id = pl.tw_id
    left join public.tcg_series ts on ts.id = t.series_id
  ) x
  where x.reason is not null;
  if v_bad is not null then
    raise exception 'JP-TW same-number link rejected rows: %', v_bad;
  end if;

  -- Series alignment over every series the plan touches.
  with codes as (
    select distinct upper(js.official_code) code
    from jp_tw_same_number_plan pl join public.tcg_cards j on j.id = pl.jp_id join public.tcg_series js on js.id = j.series_id
  ), pairs as (
    select c.code, j.id jp_id, j.canonical_id jc, j.name_zh jn, t.id tw_id, t.name_zh tn
    from codes c
    join public.tcg_series js on js.region = 'JP' and upper(js.official_code) = c.code
    join public.tcg_cards j on j.series_id = js.id
    join public.tcg_series ts on ts.region = 'TW' and upper(ts.official_code) = c.code
    join public.tcg_cards t on t.series_id = ts.id and t.official_card_number = j.official_card_number
  ), linked_elsewhere as (
    select c.code, j.id jp_id
    from codes c
    join public.tcg_series js on js.region = 'JP' and upper(js.official_code) = c.code
    join public.tcg_cards j on j.series_id = js.id
    join public.tcg_cards t on t.id = j.canonical_id
    join public.tcg_series ts on ts.id = t.series_id and ts.region = 'TW'
    where t.official_card_number is distinct from j.official_card_number or upper(ts.official_code) <> c.code
  )
  select string_agg(distinct code, ', ') into v_bad from (
    select code from pairs where jc = jp_id and jn is not null and jn is distinct from tn and not private.same_tw_name(jn, tn)
    union all
    select code from linked_elsewhere
  ) misaligned;
  if v_bad is not null then
    raise exception 'JP-TW same-number link: series not aligned: %', v_bad;
  end if;

  select array_agg(jp_id order by jp_id) into v_ids from jp_tw_same_number_plan;
  select count(*) filter (where j.canonical_id is distinct from pl.tw_id) into v_links
  from jp_tw_same_number_plan pl join public.tcg_cards j on j.id = pl.jp_id;

  v_before := (select jsonb_agg(jsonb_build_object('id', j.id, 'canonical_id', j.canonical_id) order by j.id)
    from public.tcg_cards j where j.id = any(v_ids));

  begin
    update public.tcg_cards j
    set canonical_id = pl.tw_id,
      metadata = coalesce(j.metadata, '{}'::jsonb) || jsonb_build_object('linkedCardId', pl.tw_id, 'linkBasis', 'same-series-official-number', 'linkRule', 'adr-0024'),
      updated_at = now()
    from jp_tw_same_number_plan pl
    where j.id = pl.jp_id and j.canonical_id is distinct from pl.tw_id;

    v_after := (select jsonb_agg(jsonb_build_object('id', j.id, 'canonical_id', j.canonical_id) order by j.id)
      from public.tcg_cards j where j.id = any(v_ids));

    if exists (select 1 from jp_tw_same_number_plan pl join public.tcg_cards j on j.id = pl.jp_id where j.canonical_id is distinct from pl.tw_id) then
      raise exception 'JP-TW same-number link did not reach the planned state';
    end if;

    insert into private.catalog_jp_tw_link_audit (game_id, rule, actor, plan_digest, replay, row_count, card_ids, plan, before_snapshot, after_snapshot)
    values ('pokemon', 'adr-0024', p_actor, v_digest, v_links = 0, v_count, v_ids, p_plan, v_before, v_after);

    v_result := jsonb_build_object('dryRun', p_dry_run, 'planDigest', v_digest, 'replay', v_links = 0, 'rows', v_count, 'links', v_links);
    if p_dry_run then
      raise exception using errcode = 'CJ024', message = 'JP-TW same-number link dry run rolled back';
    end if;
  exception when sqlstate 'CJ024' then
    null;
  end;
  drop table if exists jp_tw_same_number_plan;
  return v_result;
end;
$$;

revoke all on function private.link_pokemon_jp_tw_same_number(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.link_pokemon_jp_tw_same_number(jsonb, text, boolean) to service_role;
revoke all on function private.tw_name_key(text) from public, anon, authenticated;
revoke all on function private.same_tw_name(text, text) from public, anon, authenticated;

comment on function private.link_pokemon_jp_tw_same_number(jsonb, text, boolean) is
  'Link Japanese cards to the Taiwanese card with the same series code and official number in an aligned series (ADR 0024); p_dry_run rolls back.';
