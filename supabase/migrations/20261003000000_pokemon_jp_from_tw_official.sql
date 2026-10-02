-- CardScope: fill empty Japanese Chinese names and rarities from the Taiwanese
-- official card with the same series code and card number (ADR 0011). Fill-only,
-- up to 100 rows per call, every row re-checked, replay changes nothing,
-- append-only audit (kind 'jp-tw-same-number').

alter table private.catalog_official_rarity_audit drop constraint if exists catalog_official_rarity_audit_kind_check;
alter table private.catalog_official_rarity_audit
  add constraint catalog_official_rarity_audit_kind_check check (kind in ('tw-official', 'jp-via-tw', 'status', 'jp-tw-same-number'));

-- p_plan: { "version": 1, "seriesId": "pokemon-tcgdex-ja-sv11b", "rows": [ { "printingId": 1,
--   "cardId": "...", "number": "001", "nameJa": "...", "nameZh": "..." | null, "rarity": "C" | null,
--   "officialDetailIds": ["..."] } ] }
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
  if not exists (select 1 from public.tcg_series s where s.id = v_series_id and s.source = 'tcgdex-ja' and s.region = 'JP' and s.game_id = 'pokemon') then
    raise exception 'JP fill from TW official target % is not a tcgdex-ja series', v_series_id;
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
        when p.source <> 'tcgdex-ja' or p.region <> 'JP' then 'source'
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
  'Fill-only Japanese Chinese names and rarities from the Taiwanese official card with the same series code and number (ADR 0011); p_dry_run rolls back.';
