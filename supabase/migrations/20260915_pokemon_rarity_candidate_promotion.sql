-- CardScope Phase 2B: auditable, bounded promotion of exact-match Pokémon rarity metadata.
-- Image candidates intentionally remain outside this promotion path.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.tcg_rarities
  add column if not exists source text,
  add column if not exists source_url text,
  add column if not exists data_status text not null default 'incomplete'
    check (data_status in ('verified', 'pending', 'incomplete')),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists tcg_rarities_status_idx
  on public.tcg_rarities(game_id, data_status, rarity_code);

alter table public.catalog_enrichment_candidates
  add column if not exists target_table text,
  add column if not exists target_column text,
  add column if not exists target_key text,
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists promotion_batch_id text,
  add column if not exists promoted_at timestamptz,
  add column if not exists promoted_by text;

alter table public.catalog_enrichment_candidates
  add constraint catalog_enrichment_candidates_target_shape_check
  check (
    status = 'rejected'
    or (
      target_table = 'tcg_cards'
      and target_column in ('rarity', 'name_zh')
      and target_card_id is not null
      and target_printing_id is null
      and target_key = target_card_id
      and (
        (target_column = 'rarity' and field_name = 'rarity_code')
        or (target_column = 'name_zh' and field_name = 'name_zh')
      )
    )
    or (
      target_table = 'tcg_printings'
      and target_column in ('rarity_code', 'rarity_label', 'image_url')
      and target_card_id is not null
      and target_printing_id is not null
      and target_key = target_printing_id::text
      and target_column = field_name
    )
  ) not valid;

alter table public.catalog_enrichment_candidates
  validate constraint catalog_enrichment_candidates_target_shape_check;

create unique index if not exists catalog_enrichment_candidates_active_target_idx
  on public.catalog_enrichment_candidates(target_table, target_key, target_column)
  where status in ('candidate', 'review', 'approved');

create index if not exists catalog_enrichment_candidates_promotion_batch_idx
  on public.catalog_enrichment_candidates(promotion_batch_id, status, id);

create or replace function private.promote_pokemon_rarity_candidates(
  p_candidate_ids bigint[],
  p_promotion_batch_id text,
  p_checksum text,
  p_actor text default 'cardscope-phase-2b'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids bigint[];
  v_count integer;
  v_card_count integer;
  v_printing_count integer;
  v_changed_cards integer := 0;
  v_changed_printings integer := 0;
  v_marked integer := 0;
  v_invalid integer;
begin
  select array_agg(id order by id), count(*)
    into v_ids, v_count
  from (select distinct unnest(p_candidate_ids) as id) ids;

  if v_count is null or v_count < 1 or v_count > 100 then
    raise exception 'candidate count must be between 1 and 100';
  end if;
  if cardinality(p_candidate_ids) <> v_count or array_position(v_ids, null) is not null then
    raise exception 'candidate ids must be unique and non-null';
  end if;
  if nullif(btrim(p_promotion_batch_id), '') is null or nullif(btrim(p_actor), '') is null then
    raise exception 'promotion batch id and actor are required';
  end if;
  if md5(array_to_string(v_ids, ',')) <> p_checksum then
    raise exception 'candidate checksum mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cardscope:pokemon-rarity-promotion', 0));
  perform 1
    from public.catalog_enrichment_candidates c
    where c.id = any(v_ids)
    order by c.id
    for update;

  select count(*) into v_invalid
  from unnest(v_ids) requested(id)
  left join public.catalog_enrichment_candidates c on c.id = requested.id
  where c.id is null;
  if v_invalid <> 0 then raise exception 'one or more candidate ids do not exist'; end if;

  -- An identical replay is a verified no-op, not a second write.
  if not exists (
    select 1 from public.catalog_enrichment_candidates c
    where c.id = any(v_ids)
      and (c.status <> 'promoted' or c.promotion_batch_id is distinct from p_promotion_batch_id)
  ) then
    select count(*) into v_invalid
    from public.catalog_enrichment_candidates c
    left join public.tcg_cards card
      on c.target_table = 'tcg_cards' and card.id = c.target_card_id
    left join public.tcg_printings printing
      on c.target_table = 'tcg_printings' and printing.id = c.target_printing_id
    where c.id = any(v_ids)
      and case c.target_table
        when 'tcg_cards' then card.rarity is distinct from (c.proposed_value #>> '{}')
        when 'tcg_printings' then printing.rarity_code is distinct from (c.proposed_value #>> '{}')
        else true
      end;
    if v_invalid <> 0 then raise exception 'promoted replay no longer matches its target'; end if;
    return jsonb_build_object('candidateCount', v_count, 'changedCards', 0, 'changedPrintings', 0, 'replay', true);
  end if;

  select count(*) into v_invalid
  from public.catalog_enrichment_candidates c
  where c.id = any(v_ids)
    and (
      c.status <> 'approved'
      or c.source <> 'tcgdex-zh-tw'
      or c.game_id <> 'pokemon'
      or c.matching_method <> 'provider-id'
      or c.field_name <> 'rarity_code'
      or c.target_table not in ('tcg_cards', 'tcg_printings')
      or c.target_column not in ('rarity', 'rarity_code')
      or jsonb_typeof(c.proposed_value) <> 'string'
      or nullif(btrim(c.proposed_value #>> '{}'), '') is null
      or not (c.current_value is null or c.current_value = 'null'::jsonb or nullif(btrim(c.current_value #>> '{}'), '') is null)
    );
  if v_invalid <> 0 then raise exception 'candidate scope, status, value, or match method is invalid'; end if;

  select count(*) into v_invalid
  from public.catalog_enrichment_candidates c
  left join public.tcg_rarities r
    on r.game_id = 'pokemon'
   and r.rarity_code = (c.proposed_value #>> '{}')
   and r.rarity_tier is not null
  where c.id = any(v_ids) and r.rarity_code is null;
  if v_invalid <> 0 then raise exception 'candidate rarity is not a ranked canonical code'; end if;

  select count(*) into v_invalid
  from public.catalog_enrichment_candidates c
  left join public.tcg_cards card on card.id = c.target_card_id
  left join public.tcg_printings printing on printing.id = c.target_printing_id
  where c.id = any(v_ids)
    and (
      card.id is null
      or card.game_id <> 'pokemon'
      or card.source <> 'tcgdex-zh-tw'
      or card.provider_id <> c.source_record_id
      or (c.target_canonical_id is not null and card.canonical_id is distinct from c.target_canonical_id)
      or (c.target_table = 'tcg_cards' and nullif(btrim(card.rarity), '') is not null)
      or (c.target_table = 'tcg_printings' and (
        printing.id is null
        or printing.card_id <> card.id
        or printing.source <> 'tcgdex-zh-tw'
        or printing.provider_id <> c.source_record_id
        or printing.region <> 'TW'
        or coalesce(printing.source_locale, printing.language) <> 'zh-Hant-TW'
        or nullif(btrim(printing.rarity_code), '') is not null
      ))
    );
  if v_invalid <> 0 then raise exception 'candidate target linkage is invalid, stale, or non-empty'; end if;

  select count(*) filter (where target_table = 'tcg_cards'),
         count(*) filter (where target_table = 'tcg_printings')
    into v_card_count, v_printing_count
  from public.catalog_enrichment_candidates
  where id = any(v_ids);

  with selected as (
    select c.target_card_id, c.proposed_value #>> '{}' as rarity_code, r.rarity_tier
    from public.catalog_enrichment_candidates c
    join public.tcg_rarities r
      on r.game_id = 'pokemon' and r.rarity_code = (c.proposed_value #>> '{}')
    where c.id = any(v_ids) and c.target_table = 'tcg_cards'
  ), updated as (
    update public.tcg_cards card
    set rarity = selected.rarity_code,
        rarity_tier = selected.rarity_tier,
        updated_at = now()
    from selected
    where card.id = selected.target_card_id
      and nullif(btrim(card.rarity), '') is null
    returning card.id
  ) select count(*) into v_changed_cards from updated;
  if v_changed_cards <> v_card_count then raise exception 'card update count mismatch'; end if;

  with selected as (
    select c.target_printing_id, c.proposed_value #>> '{}' as rarity_code, r.rarity_label
    from public.catalog_enrichment_candidates c
    join public.tcg_rarities r
      on r.game_id = 'pokemon' and r.rarity_code = (c.proposed_value #>> '{}')
    where c.id = any(v_ids) and c.target_table = 'tcg_printings'
  ), updated as (
    update public.tcg_printings printing
    set rarity = selected.rarity_code,
        rarity_code = selected.rarity_code,
        rarity_label = coalesce(selected.rarity_label, selected.rarity_code),
        updated_at = now()
    from selected
    where printing.id = selected.target_printing_id
      and nullif(btrim(printing.rarity_code), '') is null
    returning printing.id
  ) select count(*) into v_changed_printings from updated;
  if v_changed_printings <> v_printing_count then raise exception 'printing update count mismatch'; end if;

  update public.catalog_enrichment_candidates
  set status = 'promoted',
      promotion_batch_id = p_promotion_batch_id,
      promoted_at = now(),
      promoted_by = p_actor,
      updated_at = now()
  where id = any(v_ids) and status = 'approved';
  get diagnostics v_marked = row_count;
  if v_marked <> v_count then raise exception 'candidate promotion count mismatch'; end if;

  return jsonb_build_object(
    'candidateCount', v_count,
    'changedCards', v_changed_cards,
    'changedPrintings', v_changed_printings,
    'replay', false
  );
end;
$$;

revoke all on function private.promote_pokemon_rarity_candidates(bigint[], text, text, text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.promote_pokemon_rarity_candidates(bigint[], text, text, text) to service_role;

comment on function private.promote_pokemon_rarity_candidates(bigint[], text, text, text) is
  'Promotes an explicitly reviewed 1-100 row Pokemon TCGdex rarity batch. No image or arbitrary-column writes.';
