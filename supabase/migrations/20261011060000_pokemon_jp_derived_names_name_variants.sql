-- CardScope：ADR 0013 補充（2026-10-11）。同一日文名的官方中文名只差寫法時視為唯一：
-- 全形半形（NFKC）、零寬字元、Source name markup（<X的> 的角括號、[支援者] 等方括號附註），以及結尾的括號人名
-- （博士的研究（山梨博士）、老大的指令（坂木））。採用的寫法必須是去掉這些差異後的形式，且本身是某張卡的官方原字串。
-- 只有空白位置不同（月月熊 赫月 ex／月月熊 赫月ex）不在此列，仍視為不唯一。

create or replace function private.zh_official_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $f$
  -- 零寬字元 U+200B–U+200D、U+2060、U+FEFF 以 chr() 表示，避免原始碼含不可見字元。
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    normalize(p_name, NFKC), '[' || chr(8203) || '-' || chr(8205) || chr(8288) || chr(65279) || ']', '', 'g'),
    '[<>]', '', 'g'), '\[[^]]*\]', '', 'g'), '\([^()]*\)$', '')), '')
$f$;
revoke all on function private.zh_official_name_key(text) from public, anon, authenticated;
grant execute on function private.zh_official_name_key(text) to service_role;

CREATE OR REPLACE FUNCTION private.derive_pokemon_jp_names_from_official(p_plan jsonb, p_actor text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '5s'
 SET statement_timeout TO '60s'
AS $function$
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
            and private.zh_official_name_key(o.name_zh) is distinct from private.zh_official_name_key(pl.name_zh)) then 'not-unique'
        -- 官方中文名有多種寫法時，只採用不帶附註、標記的那一種（且須是某張卡的官方原字串，見 src 檢查）。
        when pl.name_zh is distinct from private.zh_official_name_key(pl.name_zh) and exists (
          select 1 from public.tcg_cards o join public.tcg_series os on os.id = o.series_id
          where os.region = 'JP' and o.game_id = 'pokemon' and private.jp_name_key(o.name_ja) = private.jp_name_key(pl.name_ja)
            and o.metadata->>'nameZhBasis' in ('tw-official', 'tw-official-same-number')
            and o.name_zh is distinct from pl.name_zh) then 'not-plain'
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
$function$;
