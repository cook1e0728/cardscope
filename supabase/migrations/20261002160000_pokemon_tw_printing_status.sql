-- CardScope: Taiwanese printings whose rarity was filled by the September TCGdex
-- enrichment kept data_status 'incomplete' although their card is verified and the
-- rarity is known. The Data status rule (GLOSSARY) makes them 'verified'. Upgrade
-- only, at most 100 per call, append-only audit (kind 'status').

alter table private.catalog_official_rarity_audit drop constraint if exists catalog_official_rarity_audit_kind_check;
alter table private.catalog_official_rarity_audit
  add constraint catalog_official_rarity_audit_kind_check check (kind in ('tw-official', 'jp-via-tw', 'status'));

create or replace function private.promote_pokemon_tw_printing_status(
  p_series_id text,
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
  v_ids bigint[];
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'TW printing status promotion requires an actor';
  end if;
  if not exists (select 1 from public.tcg_series s where s.id = p_series_id and s.source = 'tcgdex-zh-tw' and s.region = 'TW' and s.game_id = 'pokemon') then
    raise exception 'TW printing status target % is not a tcgdex-zh-tw series', p_series_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cardscope:pokemon-official-rarity:' || p_series_id, 0));

  select array_agg(id order by id) into v_ids
  from (
    select p.id
    from public.tcg_printings p
    join public.tcg_cards c on c.id = p.card_id
    where p.series_id = p_series_id and p.source = 'tcgdex-zh-tw' and p.region = 'TW'
      and p.data_status = 'incomplete' and c.data_status = 'verified'
      and p.rarity_code is not null and c.rarity is not distinct from p.rarity
      and exists (select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = p.rarity_code)
    order by p.id
    limit 100
  ) x;

  if v_ids is null then
    return jsonb_build_object('dryRun', p_dry_run, 'seriesId', p_series_id, 'promoted', 0, 'replay', true);
  end if;

  v_before := (select jsonb_agg(jsonb_build_object('id', p.id, 'rarity_code', p.rarity_code, 'data_status', p.data_status) order by p.id)
    from public.tcg_printings p where p.id = any(v_ids));

  begin
    update public.tcg_printings p set data_status = 'verified', updated_at = now()
    where p.id = any(v_ids) and p.data_status = 'incomplete';

    v_after := (select jsonb_agg(jsonb_build_object('id', p.id, 'rarity_code', p.rarity_code, 'data_status', p.data_status) order by p.id)
      from public.tcg_printings p where p.id = any(v_ids));

    if exists (select 1 from public.tcg_printings p where p.id = any(v_ids) and p.data_status <> 'verified') then
      raise exception 'TW printing status promotion did not reach the planned state for %', p_series_id;
    end if;

    insert into private.catalog_official_rarity_audit (game_id, kind, series_id, actor, plan_digest, replay,
      row_count, printing_ids, before_snapshot, after_snapshot)
    values ('pokemon', 'status', p_series_id, p_actor, md5(v_ids::text), false, cardinality(v_ids), v_ids, v_before, v_after);

    v_result := jsonb_build_object('dryRun', p_dry_run, 'seriesId', p_series_id, 'promoted', cardinality(v_ids), 'replay', false,
      'remaining', (select count(*) from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id
        where p.series_id = p_series_id and p.source = 'tcgdex-zh-tw' and p.data_status = 'incomplete'
          and c.data_status = 'verified' and p.rarity_code is not null));
    if p_dry_run then
      raise exception using errcode = 'CJ009', message = 'TW printing status promotion dry run rolled back';
    end if;
  exception when sqlstate 'CJ009' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.promote_pokemon_tw_printing_status(text, text, boolean) from public, anon, authenticated;
grant execute on function private.promote_pokemon_tw_printing_status(text, text, boolean) to service_role;

comment on function private.promote_pokemon_tw_printing_status(text, text, boolean) is
  'Upgrade-only: Taiwanese printings of verified cards with a known rarity move from incomplete to verified (Data status rule); up to 100 per call; p_dry_run rolls back.';
