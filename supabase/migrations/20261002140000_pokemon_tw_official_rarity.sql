-- CardScope: No rarity mark as rarity code NONE, Taiwanese rarities from the
-- Taiwanese official card search, and Japanese rarities taken over from the
-- linked Taiwanese printing when the Japanese page shows no rarity (ADR 0010).
-- Fill-only, up to 100 rows per call, every row re-checked, replay changes
-- nothing, append-only audit.

-- NONE sorts below C (tier 26), so nothing else moves.
insert into public.tcg_rarities (
  game_id, rarity_code, rarity_label, rarity_tier, source, source_url, data_status, metadata
) values (
  'pokemon', 'NONE', '無標記', 27, 'asia-pokemon-card-official-tw',
  'https://asia.pokemon-card.com/tw/card-search/', 'verified',
  '{"meaningZh":"卡面沒有稀有度記號（官方明確標示無標記）"}'::jsonb
)
on conflict (game_id, rarity_code) do update
set rarity_label = excluded.rarity_label,
    rarity_tier = excluded.rarity_tier,
    source = excluded.source,
    source_url = excluded.source_url,
    data_status = excluded.data_status,
    metadata = excluded.metadata;

create table if not exists private.catalog_official_rarity_audit (
  audit_id bigint generated always as identity primary key,
  game_id text not null check (game_id = 'pokemon'),
  kind text not null check (kind in ('tw-official', 'jp-via-tw')),
  series_id text not null,
  actor text not null,
  plan_digest text not null,
  replay boolean not null,
  row_count integer not null check (row_count between 1 and 100),
  printing_ids bigint[] not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table private.catalog_official_rarity_audit enable row level security;
revoke all on table private.catalog_official_rarity_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_official_rarity_audit to service_role;

comment on table private.catalog_official_rarity_audit is
  'Append-only before/after log of rarities filled from the Taiwanese official card search (ADR 0010).';

drop trigger if exists catalog_official_rarity_audit_no_change on private.catalog_official_rarity_audit;
create trigger catalog_official_rarity_audit_no_change
before update or delete on private.catalog_official_rarity_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_official_rarity_audit_no_truncate on private.catalog_official_rarity_audit;
create trigger catalog_official_rarity_audit_no_truncate
before truncate on private.catalog_official_rarity_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- p_plan: { "version": 1, "kind": "tw-official" | "jp-via-tw", "seriesId": "pokemon-tcgdex-tw-sv8a",
--   "rows": [ { "printingId": 1, "cardId": "...", "number": "001", "name": "...", "rarity": "NONE",
--               "officialDetailIds": ["11526"] }                       -- tw-official
--           | { ..., "viaCardId": "pokemon-tcgdex-tw-sv8a-001" } ] }  -- jp-via-tw
create or replace function private.fill_pokemon_official_rarity_tw(
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
  v_kind text := p_plan->>'kind';
  v_series_id text := p_plan->>'seriesId';
  v_source text;
  v_region text;
  v_digest text := md5(p_plan::text);
  v_rows jsonb := p_plan->'rows';
  v_count integer;
  v_ids bigint[];
  v_bad text;
  v_to_fill integer;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'official rarity fill requires an actor';
  end if;
  if (p_plan->>'version') is distinct from '1' or jsonb_typeof(v_rows) <> 'array' or v_kind not in ('tw-official', 'jp-via-tw') then
    raise exception 'official rarity fill plan must be version 1, kind tw-official or jp-via-tw, with a rows array';
  end if;
  v_count := jsonb_array_length(v_rows);
  if v_count < 1 or v_count > 100 then
    raise exception 'official rarity fill takes 1 to 100 rows, got %', v_count;
  end if;
  v_source := case v_kind when 'tw-official' then 'tcgdex-zh-tw' else 'tcgdex-ja' end;
  v_region := case v_kind when 'tw-official' then 'TW' else 'JP' end;
  if not exists (select 1 from public.tcg_series s where s.id = v_series_id and s.source = v_source and s.region = v_region and s.game_id = 'pokemon') then
    raise exception 'official rarity fill target % is not a % series', v_series_id, v_source;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cardscope:pokemon-official-rarity:' || v_series_id, 0));

  create temporary table official_rarity_plan on commit drop as
  select (r->>'printingId')::bigint printing_id, r->>'cardId' card_id, r->>'number' number, r->>'name' name,
    r->>'rarity' rarity, r->'officialDetailIds' official_detail_ids, r->>'viaCardId' via_card_id
  from jsonb_array_elements(v_rows) r;

  if (select count(distinct printing_id) from official_rarity_plan) <> v_count then
    raise exception 'official rarity fill plan repeats a printing';
  end if;

  select string_agg(coalesce(x.printing_id::text, '?') || ':' || x.reason, ', ') into v_bad
  from (
    select pl.printing_id,
      case
        when p.id is null then 'missing'
        when p.source <> v_source or p.region <> v_region then 'source'
        when p.series_id <> v_series_id then 'series'
        when p.local_card_number is distinct from pl.number then 'number'
        when p.card_id is distinct from pl.card_id then 'card'
        when v_kind = 'tw-official' and c.name_zh is distinct from pl.name then 'name'
        when v_kind = 'jp-via-tw' and c.name_ja is distinct from pl.name then 'name'
        when not exists (select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = pl.rarity) then 'rarity-code'
        when v_kind = 'tw-official' and (jsonb_typeof(pl.official_detail_ids) <> 'array' or jsonb_array_length(pl.official_detail_ids) = 0) then 'official-id'
        -- A Japanese row needs its ADR 0003 link to the named Taiwanese card, whose printing
        -- (same number) already holds this rarity from the Taiwanese official search.
        when v_kind = 'jp-via-tw' and (c.metadata->>'linkedCardId' is distinct from pl.via_card_id or not exists (
          select 1 from public.tcg_printings tp
          where tp.card_id = pl.via_card_id and tp.source = 'tcgdex-zh-tw' and tp.local_card_number = pl.number
            and tp.rarity_code = pl.rarity and tp.metadata->>'rarityBasis' = 'asia-pokemon-card-official-tw')) then 'via-link'
        when p.rarity_code is not null and p.rarity_code <> pl.rarity then 'printing-conflict'
        when c.rarity is not null and c.rarity <> pl.rarity then 'card-conflict'
      end reason
    from official_rarity_plan pl
    left join public.tcg_printings p on p.id = pl.printing_id
    left join public.tcg_cards c on c.id = p.card_id
  ) x
  where x.reason is not null;
  if v_bad is not null then
    raise exception 'official rarity fill rejected rows: %', v_bad;
  end if;

  select array_agg(printing_id order by printing_id) into v_ids from official_rarity_plan;
  select count(*) into v_to_fill from public.tcg_printings p where p.id = any(v_ids) and p.rarity_code is null;

  v_before := (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'rarity', p.rarity, 'rarity_code', p.rarity_code,
      'data_status', p.data_status, 'card_rarity', c.rarity, 'card_status', c.data_status) order by p.id)
    from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where p.id = any(v_ids));

  begin
    update public.tcg_printings p
    set rarity = pl.rarity, rarity_code = pl.rarity, rarity_label = pl.rarity,
      data_status = case when p.data_status = 'incomplete' and c.data_status = 'verified' then 'verified' else p.data_status end,
      metadata = coalesce(p.metadata, '{}'::jsonb) || case v_kind
        when 'tw-official' then jsonb_build_object('rarityBasis', 'asia-pokemon-card-official-tw', 'officialDetailIds', pl.official_detail_ids)
        else jsonb_build_object('rarityBasis', 'asia-pokemon-card-official-tw-via-link', 'rarityViaCardId', pl.via_card_id) end,
      updated_at = now()
    from official_rarity_plan pl, public.tcg_cards c
    where p.id = pl.printing_id and c.id = p.card_id and p.rarity_code is null;

    update public.tcg_cards c
    set rarity = pl.rarity, updated_at = now()
    from official_rarity_plan pl
    where c.id = pl.card_id and c.rarity is null;

    v_after := (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'rarity', p.rarity, 'rarity_code', p.rarity_code,
        'data_status', p.data_status, 'card_rarity', c.rarity, 'card_status', c.data_status) order by p.id)
      from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where p.id = any(v_ids));

    if exists (select 1 from official_rarity_plan pl join public.tcg_printings p on p.id = pl.printing_id join public.tcg_cards c on c.id = p.card_id
               where p.rarity_code is distinct from pl.rarity or c.rarity is distinct from pl.rarity
                 or (p.data_status = 'incomplete' and c.data_status = 'verified')) then
      raise exception 'official rarity fill did not reach the planned state for %', v_series_id;
    end if;

    insert into private.catalog_official_rarity_audit (game_id, kind, series_id, actor, plan_digest, replay,
      row_count, printing_ids, before_snapshot, after_snapshot)
    values ('pokemon', v_kind, v_series_id, p_actor, v_digest, v_to_fill = 0, v_count, v_ids, v_before, v_after);

    v_result := jsonb_build_object('dryRun', p_dry_run, 'kind', v_kind, 'seriesId', v_series_id, 'planDigest', v_digest,
      'replay', v_to_fill = 0, 'rows', v_count, 'filled', v_to_fill,
      'verified', (select count(*) from public.tcg_printings p where p.id = any(v_ids) and p.data_status = 'verified'));
    if p_dry_run then
      raise exception using errcode = 'CJ008', message = 'official rarity fill dry run rolled back';
    end if;
  exception when sqlstate 'CJ008' then
    null;
  end;
  drop table if exists official_rarity_plan;
  return v_result;
end;
$$;

revoke all on function private.fill_pokemon_official_rarity_tw(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.fill_pokemon_official_rarity_tw(jsonb, text, boolean) to service_role;

comment on function private.fill_pokemon_official_rarity_tw(jsonb, text, boolean) is
  'Fill-only Taiwanese (and linked Japanese) Pokémon rarities from the Taiwanese official card search for up to 100 printings (ADR 0010); p_dry_run rolls back.';
