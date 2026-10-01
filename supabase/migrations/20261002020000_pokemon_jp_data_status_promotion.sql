-- CardScope: promote Japanese Pokémon cards linked to a verified Taiwanese
-- card from data_status 'pending' to 'verified' (ADR 0006). At most 100 cards
-- per call, upgrade only, append-only audit; printings follow the existing
-- rule (verified with a rarity, incomplete without one).

create table if not exists private.catalog_jp_status_audit (
  audit_id bigint generated always as identity primary key,
  game_id text not null check (game_id = 'pokemon'),
  source text not null check (source = 'tcgdex-ja'),
  series_provider_id text not null,
  series_id text not null,
  actor text not null,
  card_count integer not null check (card_count between 1 and 100),
  card_ids text[] not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table private.catalog_jp_status_audit enable row level security;
revoke all on table private.catalog_jp_status_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_status_audit to service_role;

comment on table private.catalog_jp_status_audit is
  'Append-only before/after log of Japanese Pokémon data_status promotions (ADR 0006).';

drop trigger if exists catalog_jp_status_audit_no_change on private.catalog_jp_status_audit;
create trigger catalog_jp_status_audit_no_change
before update or delete on private.catalog_jp_status_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_status_audit_no_truncate on private.catalog_jp_status_audit;
create trigger catalog_jp_status_audit_no_truncate
before truncate on private.catalog_jp_status_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

create or replace function private.promote_pokemon_jp_data_status(
  p_series_provider_id text,
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
  v_series_id text;
  v_ids text[];
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_remaining integer;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP status promotion requires an actor';
  end if;
  select s.id into v_series_id
  from public.tcg_series s
  where s.source = 'tcgdex-ja' and s.provider_id = p_series_provider_id and s.region = 'JP';
  if v_series_id is null or not private.pokemon_jp_series_imported(p_series_provider_id, v_series_id) then
    raise exception 'JP status promotion target % is not an imported tcgdex-ja series', p_series_provider_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-status:' || lower(p_series_provider_id), 0)
  );

  -- Candidates: still pending, linked by ADR 0003, and the linked Taiwanese
  -- card is verified and still carries the same Provider ID, name and canonical.
  select array_agg(id order by id collate "C") into v_ids
  from (
    select j.id
    from public.tcg_cards j
    join public.tcg_cards t on t.id = j.metadata->>'linkedCardId'
    join public.tcg_series ts on ts.id = t.series_id
    where j.series_id = v_series_id and j.source = 'tcgdex-ja' and j.data_status = 'pending'
      and j.metadata->>'nameZhBasis' = 'tw-official'
      and j.metadata->>'linkBasis' = 'same-provider-id-and-series-code'
      and ts.region = 'TW' and upper(ts.official_code) = upper(p_series_provider_id)
      and t.data_status = 'verified'
      and t.provider_id = j.provider_id
      and t.name_zh is not distinct from j.name_zh
      and t.canonical_id = j.canonical_id
    order by j.id collate "C"
    limit 100
  ) c;

  if v_ids is null then
    return jsonb_build_object('dryRun', p_dry_run, 'seriesId', v_series_id, 'promoted', 0,
      'printings', jsonb_build_object('verified', 0, 'incomplete', 0), 'remaining', 0);
  end if;

  v_before := jsonb_build_object(
    'cards', (select jsonb_agg(jsonb_build_object('id', c.id, 'data_status', c.data_status) order by c.id collate "C")
      from public.tcg_cards c where c.id = any(v_ids)),
    'printings', (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'data_status', p.data_status, 'rarity_code', p.rarity_code) order by p.id)
      from public.tcg_printings p where p.card_id = any(v_ids)));

  begin
    update public.tcg_cards c set data_status = 'verified', updated_at = now()
    where c.id = any(v_ids) and c.data_status = 'pending';

    update public.tcg_printings p
    set data_status = case when p.rarity_code is not null then 'verified' else 'incomplete' end, updated_at = now()
    where p.card_id = any(v_ids) and p.source = 'tcgdex-ja' and p.data_status = 'pending';

    v_after := jsonb_build_object(
      'cards', (select jsonb_agg(jsonb_build_object('id', c.id, 'data_status', c.data_status) order by c.id collate "C")
        from public.tcg_cards c where c.id = any(v_ids)),
      'printings', (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'data_status', p.data_status, 'rarity_code', p.rarity_code) order by p.id)
        from public.tcg_printings p where p.card_id = any(v_ids)));

    if (select count(*) from public.tcg_cards c where c.id = any(v_ids) and c.data_status = 'verified') <> cardinality(v_ids)
      or exists (select 1 from public.tcg_printings p where p.card_id = any(v_ids) and p.data_status = 'pending') then
      raise exception 'JP status promotion did not reach the planned state for %', p_series_provider_id;
    end if;

    insert into private.catalog_jp_status_audit (game_id, source, series_provider_id, series_id, actor, card_count,
      card_ids, before_snapshot, after_snapshot)
    values ('pokemon', 'tcgdex-ja', p_series_provider_id, v_series_id, p_actor, cardinality(v_ids), v_ids, v_before, v_after);

    select count(*) into v_remaining
    from public.tcg_cards j
    join public.tcg_cards t on t.id = j.metadata->>'linkedCardId'
    where j.series_id = v_series_id and j.source = 'tcgdex-ja' and j.data_status = 'pending'
      and j.metadata->>'nameZhBasis' = 'tw-official' and t.data_status = 'verified'
      and t.provider_id = j.provider_id and t.canonical_id = j.canonical_id;

    v_result := jsonb_build_object('dryRun', p_dry_run, 'seriesId', v_series_id, 'promoted', cardinality(v_ids),
      'printings', jsonb_build_object(
        'verified', (select count(*) from public.tcg_printings p where p.card_id = any(v_ids) and p.data_status = 'verified'),
        'incomplete', (select count(*) from public.tcg_printings p where p.card_id = any(v_ids) and p.data_status = 'incomplete')),
      'remaining', v_remaining);
    if p_dry_run then
      raise exception using errcode = 'CJ004', message = 'JP status promotion dry run rolled back';
    end if;
  exception when sqlstate 'CJ004' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.promote_pokemon_jp_data_status(text, text, boolean) from public, anon, authenticated;
grant execute on function private.promote_pokemon_jp_data_status(text, text, boolean) to service_role;

comment on function private.promote_pokemon_jp_data_status(text, text, boolean) is
  'Upgrade-only promotion of up to 100 linked Japanese Pokémon cards (and their printings) from pending to verified (ADR 0006); p_dry_run rolls back.';
