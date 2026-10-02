-- CardScope: fill empty Japanese Pokémon rarities from the official card search
-- (ADR 0007). Up to 100 printings per call; fills nulls only, never overwrites;
-- every row is re-checked against the database (same series code, card number
-- and Japanese name); a replay of the same plan changes nothing; append-only
-- audit. Printings of verified cards move from incomplete to verified (ADR 0006).

create table if not exists private.catalog_jp_rarity_audit (
  audit_id bigint generated always as identity primary key,
  game_id text not null check (game_id = 'pokemon'),
  source text not null check (source = 'tcgdex-ja'),
  series_provider_id text not null,
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

alter table private.catalog_jp_rarity_audit enable row level security;
revoke all on table private.catalog_jp_rarity_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_rarity_audit to service_role;

comment on table private.catalog_jp_rarity_audit is
  'Append-only before/after log of Japanese Pokémon rarities filled from pokemon-card.com (ADR 0007).';

drop trigger if exists catalog_jp_rarity_audit_no_change on private.catalog_jp_rarity_audit;
create trigger catalog_jp_rarity_audit_no_change
before update or delete on private.catalog_jp_rarity_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_rarity_audit_no_truncate on private.catalog_jp_rarity_audit;
create trigger catalog_jp_rarity_audit_no_truncate
before truncate on private.catalog_jp_rarity_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- p_plan: { "version": 1, "seriesProviderId": "SV8a", "rows": [ { "printingId": 1, "cardId": "...",
--   "number": "103", "nameJa": "...", "rarity": "RR", "officialCardId": "46764" } ] }
create or replace function private.fill_pokemon_jp_official_rarity(
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
  v_series_provider_id text := p_plan->>'seriesProviderId';
  v_series_id text;
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
    raise exception 'JP rarity fill requires an actor';
  end if;
  if (p_plan->>'version') is distinct from '1' or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'JP rarity fill plan must be version 1 with a rows array';
  end if;
  v_count := jsonb_array_length(v_rows);
  if v_count < 1 or v_count > 100 then
    raise exception 'JP rarity fill takes 1 to 100 rows, got %', v_count;
  end if;
  select s.id into v_series_id
  from public.tcg_series s
  where s.source = 'tcgdex-ja' and s.provider_id = v_series_provider_id and s.region = 'JP';
  if v_series_id is null or not private.pokemon_jp_series_imported(v_series_provider_id, v_series_id) then
    raise exception 'JP rarity fill target % is not an imported tcgdex-ja series', v_series_provider_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-rarity:' || lower(v_series_provider_id), 0)
  );

  create temporary table jp_rarity_plan on commit drop as
  select (r->>'printingId')::bigint printing_id, r->>'cardId' card_id, r->>'number' number,
    r->>'nameJa' name_ja, r->>'rarity' rarity, r->>'officialCardId' official_card_id
  from jsonb_array_elements(v_rows) r;

  if (select count(distinct printing_id) from jp_rarity_plan) <> v_count then
    raise exception 'JP rarity fill plan repeats a printing';
  end if;

  -- Every row must still describe the same printing: tcgdex-ja, this series, same number,
  -- same card and Japanese name, a known rarity code, and an empty or identical rarity.
  select string_agg(coalesce(x.printing_id::text, '?') || ':' || x.reason, ', ') into v_bad
  from (
    select pl.printing_id,
      case
        when p.id is null then 'missing'
        when p.source <> 'tcgdex-ja' or p.region <> 'JP' then 'not-jp'
        when p.series_id <> v_series_id then 'series'
        when p.local_card_number is distinct from pl.number then 'number'
        when p.card_id is distinct from pl.card_id then 'card'
        when c.name_ja is distinct from pl.name_ja then 'name'
        when not exists (select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = pl.rarity) then 'rarity-code'
        when p.rarity_code is not null and p.rarity_code <> pl.rarity then 'printing-conflict'
        when c.rarity is not null and c.rarity <> pl.rarity then 'card-conflict'
      end reason
    from jp_rarity_plan pl
    left join public.tcg_printings p on p.id = pl.printing_id
    left join public.tcg_cards c on c.id = p.card_id
  ) x
  where x.reason is not null;
  if v_bad is not null then
    raise exception 'JP rarity fill rejected rows: %', v_bad;
  end if;

  select array_agg(printing_id order by printing_id) into v_ids from jp_rarity_plan;
  select count(*) into v_to_fill from public.tcg_printings p where p.id = any(v_ids) and p.rarity_code is null;

  v_before := (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'rarity', p.rarity, 'rarity_code', p.rarity_code,
      'data_status', p.data_status, 'card_rarity', c.rarity, 'card_status', c.data_status) order by p.id)
    from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where p.id = any(v_ids));

  begin
    update public.tcg_printings p
    set rarity = pl.rarity, rarity_code = pl.rarity, rarity_label = pl.rarity,
      data_status = case when p.data_status = 'incomplete' and c.data_status = 'verified' then 'verified' else p.data_status end,
      metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('rarityBasis', 'pokemon-card-official-jp', 'officialCardId', pl.official_card_id),
      updated_at = now()
    from jp_rarity_plan pl, public.tcg_cards c
    where p.id = pl.printing_id and c.id = p.card_id and p.rarity_code is null;

    update public.tcg_cards c
    set rarity = pl.rarity, updated_at = now()
    from jp_rarity_plan pl
    where c.id = pl.card_id and c.rarity is null;

    v_after := (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'rarity', p.rarity, 'rarity_code', p.rarity_code,
        'data_status', p.data_status, 'card_rarity', c.rarity, 'card_status', c.data_status) order by p.id)
      from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where p.id = any(v_ids));

    if exists (select 1 from jp_rarity_plan pl join public.tcg_printings p on p.id = pl.printing_id join public.tcg_cards c on c.id = p.card_id
               where p.rarity_code is distinct from pl.rarity or c.rarity is distinct from pl.rarity
                 or (p.data_status = 'incomplete' and c.data_status = 'verified')) then
      raise exception 'JP rarity fill did not reach the planned state for %', v_series_provider_id;
    end if;

    insert into private.catalog_jp_rarity_audit (game_id, source, series_provider_id, series_id, actor, plan_digest, replay,
      row_count, printing_ids, before_snapshot, after_snapshot)
    values ('pokemon', 'tcgdex-ja', v_series_provider_id, v_series_id, p_actor, v_digest, v_to_fill = 0,
      v_count, v_ids, v_before, v_after);

    v_result := jsonb_build_object('dryRun', p_dry_run, 'seriesId', v_series_id, 'planDigest', v_digest,
      'replay', v_to_fill = 0, 'rows', v_count, 'filled', v_to_fill,
      'verified', (select count(*) from public.tcg_printings p where p.id = any(v_ids) and p.data_status = 'verified'),
      'pending', (select count(*) from public.tcg_printings p where p.id = any(v_ids) and p.data_status = 'pending'));
    if p_dry_run then
      raise exception using errcode = 'CJ005', message = 'JP rarity fill dry run rolled back';
    end if;
  exception when sqlstate 'CJ005' then
    null;
  end;
  drop table if exists jp_rarity_plan;
  return v_result;
end;
$$;

revoke all on function private.fill_pokemon_jp_official_rarity(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.fill_pokemon_jp_official_rarity(jsonb, text, boolean) to service_role;

comment on function private.fill_pokemon_jp_official_rarity(jsonb, text, boolean) is
  'Fill-only Japanese Pokémon rarities from pokemon-card.com for up to 100 printings (ADR 0007); same plan replays with zero changes; p_dry_run rolls back.';
