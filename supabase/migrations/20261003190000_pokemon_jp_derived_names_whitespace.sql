-- CardScope: ADR 0013 compares Japanese names after NFKC and whitespace removal. Sun &
-- Moon cards write regional forms without a space (アローラロコン) where later cards write
-- アローラ ロコン; the space does not change the name. Uniqueness is checked on the same key.
-- Otherwise identical to 20261003140000_pokemon_jp_derived_names_from_official.

create or replace function private.jp_name_key(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(normalize(coalesce(p_value, ''), NFKC), '[[:space:]]', '', 'g');
$$;

revoke all on function private.jp_name_key(text) from public, anon, authenticated;
grant execute on function private.jp_name_key(text) to service_role;

-- p_plan: { "version": 1, "rule": "adr-0013", "rows": [ { "cardId": "...", "nameJa": "...",
--   "nameZh": "...", "sourceCardId": "..." } ] }
create or replace function private.derive_pokemon_jp_names_from_official(
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
  v_names integer;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP derived names require an actor';
  end if;
  if (p_plan->>'version') is distinct from '1' or (p_plan->>'rule') is distinct from 'adr-0013' or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'JP derived name plan must be version 1, rule adr-0013, with a rows array';
  end if;
  v_count := jsonb_array_length(v_rows);
  if v_count < 1 or v_count > 100 then
    raise exception 'JP derived names take 1 to 100 rows, got %', v_count;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cardscope:pokemon-jp-derived-names', 0));

  create temporary table jp_derived_plan on commit drop as
  select r->>'cardId' card_id, r->>'nameJa' name_ja, nullif(btrim(r->>'nameZh'), '') name_zh, r->>'sourceCardId' source_card_id
  from jsonb_array_elements(v_rows) r;

  if (select count(distinct card_id) from jp_derived_plan) <> v_count then
    raise exception 'JP derived name plan repeats a card';
  end if;

  select string_agg(coalesce(x.card_id, '?') || ':' || x.reason, ', ') into v_bad
  from (
    select pl.card_id,
      case
        when c.id is null then 'missing'
        when c.game_id <> 'pokemon' or s.region is distinct from 'JP' then 'not-jp'
        when c.name_ja is distinct from pl.name_ja or coalesce(btrim(pl.name_ja), '') = '' then 'name-ja'
        when pl.name_zh is null then 'no-name'
        when c.name_zh is not null and c.name_zh <> pl.name_zh then 'name-conflict'
        when src.id is null or src.id = c.id then 'source-missing'
        when src.game_id <> 'pokemon' or ss.region is distinct from 'JP' then 'source-not-jp'
        when private.jp_name_key(src.name_ja) is distinct from private.jp_name_key(pl.name_ja) then 'source-name-ja'
        when src.name_zh is distinct from pl.name_zh then 'source-name-zh'
        when coalesce(src.metadata->>'nameZhBasis', '') not in ('tw-official', 'tw-official-same-number') then 'source-basis'
        when exists (
          select 1 from public.tcg_cards o join public.tcg_series os on os.id = o.series_id
          where os.region = 'JP' and o.game_id = 'pokemon' and private.jp_name_key(o.name_ja) = private.jp_name_key(pl.name_ja)
            and o.metadata->>'nameZhBasis' in ('tw-official', 'tw-official-same-number')
            and o.name_zh is distinct from pl.name_zh) then 'not-unique'
      end reason
    from jp_derived_plan pl
    left join public.tcg_cards c on c.id = pl.card_id
    left join public.tcg_series s on s.id = c.series_id
    left join public.tcg_cards src on src.id = pl.source_card_id
    left join public.tcg_series ss on ss.id = src.series_id
  ) x
  where x.reason is not null;
  if v_bad is not null then
    raise exception 'JP derived names rejected rows: %', v_bad;
  end if;

  select array_agg(card_id order by card_id) into v_ids from jp_derived_plan;
  select count(*) filter (where c.name_zh is null) into v_names
  from jp_derived_plan pl join public.tcg_cards c on c.id = pl.card_id;

  v_before := (select jsonb_agg(jsonb_build_object('id', c.id, 'name_zh', c.name_zh, 'basis', c.metadata->'nameZhBasis') order by c.id)
    from public.tcg_cards c where c.id = any(v_ids));

  begin
    update public.tcg_cards c
    set name_zh = pl.name_zh,
      metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('nameZhBasis', 'derived-cross-series',
        'nameZhSourceCardId', pl.source_card_id, 'nameZhRule', 'adr-0013'),
      updated_at = now()
    from jp_derived_plan pl
    where c.id = pl.card_id and c.name_zh is null;

    v_after := (select jsonb_agg(jsonb_build_object('id', c.id, 'name_zh', c.name_zh, 'basis', c.metadata->'nameZhBasis') order by c.id)
      from public.tcg_cards c where c.id = any(v_ids));

    if exists (select 1 from jp_derived_plan pl join public.tcg_cards c on c.id = pl.card_id where c.name_zh is distinct from pl.name_zh) then
      raise exception 'JP derived names did not reach the planned state';
    end if;

    insert into private.catalog_jp_derived_name_audit (game_id, rule, actor, plan_digest, replay, row_count, card_ids, plan,
      before_snapshot, after_snapshot)
    values ('pokemon', 'adr-0013', p_actor, v_digest, v_names = 0, v_count, v_ids, p_plan, v_before, v_after);

    v_result := jsonb_build_object('dryRun', p_dry_run, 'planDigest', v_digest, 'replay', v_names = 0, 'rows', v_count, 'names', v_names);
    if p_dry_run then
      raise exception using errcode = 'CJ013', message = 'JP derived names dry run rolled back';
    end if;
  exception when sqlstate 'CJ013' then
    null;
  end;
  drop table if exists jp_derived_plan;
  return v_result;
end;
$$;

revoke all on function private.derive_pokemon_jp_names_from_official(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.derive_pokemon_jp_names_from_official(jsonb, text, boolean) to service_role;

comment on function private.derive_pokemon_jp_names_from_official(jsonb, text, boolean) is
  'Fill-only Japanese Derived names from a Japanese card with the same Japanese name (NFKC, whitespace ignored) and an official Chinese name, unique per Japanese name (ADR 0013); p_dry_run rolls back.';
