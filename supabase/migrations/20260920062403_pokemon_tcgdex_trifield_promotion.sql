-- CardScope: atomic Pokémon TCGdex reconciliation for rarity, official zh-Hant-TW
-- names, and exact-printing images. This remains a private reviewed workflow.

-- Production did not receive the earlier optional name-provenance migration.
-- Keep this promotion self-contained and additive so every written official
-- name retains its provider evidence.
alter table public.tcg_card_names
  add column if not exists source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.catalog_enrichment_promotion_batches (
  promotion_batch_id text primary key,
  checksum text not null,
  actor text not null,
  source text not null,
  game_id text not null references public.tcg_games(id) on delete restrict,
  candidate_ids bigint[] not null,
  before_snapshot jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.catalog_enrichment_promotion_batches enable row level security;
revoke all on table public.catalog_enrichment_promotion_batches from anon, authenticated;
grant select, insert on table public.catalog_enrichment_promotion_batches to service_role;

comment on table public.catalog_enrichment_promotion_batches is
  'Append-only audit for reviewed atomic enrichment promotion batches. Not exposed to public clients.';

create or replace function private.promote_pokemon_tcgdex_candidates(
  p_candidate_ids bigint[],
  p_promotion_batch_id text,
  p_checksum text,
  p_actor text default 'cardscope-pokemon-trifield'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids bigint[];
  v_count integer;
  v_invalid integer;
  v_checksum text;
  v_existing_batch public.catalog_enrichment_promotion_batches%rowtype;
  v_before jsonb;
  v_changed_card_rarities integer := 0;
  v_changed_printing_rarities integer := 0;
  v_changed_names integer := 0;
  v_inserted_name_rows integer := 0;
  v_changed_images integer := 0;
  v_verified_names integer := 0;
  v_marked integer := 0;
  v_result jsonb;
begin
  select array_agg(id order by id), count(*)
    into v_ids, v_count
  from (select distinct unnest(p_candidate_ids) as id) requested;

  if v_count is null or v_count < 1 or v_count > 100 then
    raise exception 'candidate count must be between 1 and 100';
  end if;
  if cardinality(p_candidate_ids) <> v_count or array_position(v_ids, null) is not null then
    raise exception 'candidate ids must be unique and non-null';
  end if;
  if nullif(btrim(p_promotion_batch_id), '') is null
     or nullif(btrim(p_actor), '') is null
     or nullif(btrim(p_checksum), '') is null then
    raise exception 'promotion batch id, checksum, and actor are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-tcgdex-trifield-promotion', 0)
  );

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

  select md5(string_agg(
    concat_ws('|', c.id::text, c.payload_hash, c.target_table, c.target_key, c.target_column, c.proposed_value::text),
    E'\n' order by c.id
  )) into v_checksum
  from public.catalog_enrichment_candidates c
  where c.id = any(v_ids);

  if v_checksum is distinct from p_checksum then
    raise exception 'candidate checksum mismatch';
  end if;

  select * into v_existing_batch
  from public.catalog_enrichment_promotion_batches b
  where b.promotion_batch_id = p_promotion_batch_id;

  if found then
    if v_existing_batch.checksum is distinct from p_checksum then
      raise exception 'promotion batch id already exists with a different checksum';
    end if;
    select count(*) into v_invalid
    from public.catalog_enrichment_candidates c
    left join public.tcg_cards card on card.id = c.target_card_id
    left join public.tcg_printings printing on printing.id = c.target_printing_id
    where c.id = any(v_ids)
      and (
        c.status <> 'promoted'
        or c.promotion_batch_id is distinct from p_promotion_batch_id
        or case c.field_name
          when 'rarity_code' then case c.target_table
            when 'tcg_cards' then card.rarity is distinct from (c.proposed_value #>> '{}')
            when 'tcg_printings' then printing.rarity_code is distinct from (c.proposed_value #>> '{}')
            else true
          end
          when 'name_zh' then card.name_zh is distinct from (c.proposed_value #>> '{}')
          when 'image_url' then printing.image_url is distinct from (c.proposed_value ->> 'url')
          else true
        end
      );
    if v_invalid <> 0 then raise exception 'exact replay no longer matches its target'; end if;
    return v_existing_batch.result || jsonb_build_object(
      'replay', true,
      'changedCardRarities', 0,
      'changedPrintingRarities', 0,
      'changedNames', 0,
      'changedImages', 0
    );
  end if;

  select count(*) into v_invalid
  from public.catalog_enrichment_candidates c
  where c.id = any(v_ids)
    and (
      c.status <> 'approved'
      or c.reviewed_at is null
      or nullif(btrim(c.reviewed_by), '') is null
      or c.source <> 'tcgdex-zh-tw'
      or c.game_id <> 'pokemon'
      or c.matching_method <> 'provider-id'
      or c.field_name not in ('rarity_code', 'name_zh', 'image_url')
      or c.target_table not in ('tcg_cards', 'tcg_printings')
      or nullif(btrim(c.evidence ->> 'sourceNameZh'), '') is null
      or not (c.current_value is null or c.current_value = 'null'::jsonb or nullif(btrim(c.current_value #>> '{}'), '') is null)
      or case c.field_name
        when 'rarity_code' then not (
          jsonb_typeof(c.proposed_value) = 'string'
          and nullif(btrim(c.proposed_value #>> '{}'), '') is not null
          and ((c.target_table = 'tcg_cards' and c.target_column = 'rarity')
            or (c.target_table = 'tcg_printings' and c.target_column = 'rarity_code'))
        )
        when 'name_zh' then not (
          c.target_table = 'tcg_cards'
          and c.target_column = 'name_zh'
          and c.locale = 'zh-Hant-TW'
          and jsonb_typeof(c.proposed_value) = 'string'
          and nullif(btrim(c.proposed_value #>> '{}'), '') is not null
          and c.proposed_value #>> '{}' = c.evidence ->> 'sourceNameZh'
          and c.evidence ->> 'nameType' = 'official'
        )
        when 'image_url' then not (
          c.target_table = 'tcg_printings'
          and c.target_column = 'image_url'
          and jsonb_typeof(c.proposed_value) = 'object'
          and c.proposed_value ->> 'imageRightsStatus' = 'not-provided'
          and c.proposed_value ->> 'imageRights' = 'not-inferred'
          and c.proposed_value ->> 'url' ~ '^https://assets[.]tcgdex[.]net/.+/(low|high)[.]webp$'
          and c.evidence ->> 'imageProbeStatus' in ('200', '206')
          and c.evidence ->> 'imageContentType' like 'image/%'
          and nullif(btrim(c.evidence ->> 'imageProbedAt'), '') is not null
          and (c.evidence ->> 'imageProbedAt')::timestamptz
            between now() - interval '24 hours' and now() + interval '5 minutes'
        )
        else true
      end
    );
  if v_invalid <> 0 then raise exception 'candidate scope, review, value, or evidence is invalid'; end if;

  -- A source record may produce multiple target rows, but all evidence for the
  -- same physical card must agree on the exact official Traditional Chinese name.
  select count(*) into v_invalid
  from (
    select c.target_card_id
    from public.catalog_enrichment_candidates c
    where c.id = any(v_ids)
    group by c.target_card_id
    having count(distinct c.evidence ->> 'sourceNameZh') <> 1
  ) conflicts;
  if v_invalid <> 0 then raise exception 'candidate source name evidence conflicts'; end if;

  perform 1
  from public.tcg_cards card
  where card.id in (
    select distinct c.target_card_id
    from public.catalog_enrichment_candidates c where c.id = any(v_ids)
  )
  order by card.id
  for update;

  perform 1
  from public.tcg_printings printing
  where printing.id in (
    select distinct c.target_printing_id
    from public.catalog_enrichment_candidates c
    where c.id = any(v_ids) and c.target_printing_id is not null
  )
  order by printing.id
  for update;

  perform 1
  from public.tcg_card_names names
  where names.card_id in (
    select distinct c.target_card_id
    from public.catalog_enrichment_candidates c where c.id = any(v_ids)
  ) and names.locale = 'zh-Hant-TW' and names.name_type = 'official'
  order by names.id
  for update;

  perform 1
  from public.tcg_canonical_cards canonical
  where canonical.id in (
    select distinct card.canonical_id
    from public.tcg_cards card
    join public.catalog_enrichment_candidates c on c.target_card_id = card.id
    where c.id = any(v_ids)
  )
  order by canonical.id
  for update;

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
      or (c.target_table = 'tcg_printings' and (
        printing.id is null
        or printing.card_id <> card.id
        or printing.source <> 'tcgdex-zh-tw'
        or printing.provider_id <> c.source_record_id
        or printing.region <> 'TW'
        or coalesce(printing.source_locale, printing.language) <> 'zh-Hant-TW'
        or nullif(btrim(c.evidence ->> 'setCode'), '') is null
        or lower(regexp_replace(printing.local_set_code, '[[:space:]]+', '', 'g'))
          <> lower(regexp_replace(c.evidence ->> 'setCode', '[[:space:]]+', '', 'g'))
        or lower(regexp_replace(printing.local_card_number, '[[:space:]]+', '', 'g'))
          <> lower(regexp_replace(c.evidence ->> 'cardNumber', '[[:space:]]+', '', 'g'))
      ))
      or (c.field_name = 'rarity_code' and c.target_table = 'tcg_cards' and nullif(btrim(card.rarity), '') is not null)
      or (c.field_name = 'rarity_code' and c.target_table = 'tcg_printings' and nullif(btrim(printing.rarity_code), '') is not null)
      or (c.field_name = 'name_zh' and nullif(btrim(card.name_zh), '') is not null)
      or (c.field_name = 'image_url' and nullif(btrim(printing.image_url), '') is not null)
    );
  if v_invalid <> 0 then raise exception 'candidate target linkage is invalid, stale, or non-empty'; end if;

  select count(*) into v_invalid
  from public.catalog_enrichment_candidates c
  left join public.tcg_rarities r
    on r.game_id = 'pokemon'
   and r.rarity_code = (c.proposed_value #>> '{}')
   and r.rarity_tier is not null
  where c.id = any(v_ids) and c.field_name = 'rarity_code' and r.rarity_code is null;
  if v_invalid <> 0 then raise exception 'candidate rarity is not a ranked canonical code'; end if;

  -- Existing official names are reconciled, not rewritten. A conflicting row
  -- aborts the whole transaction even if another official row happens to agree.
  select count(*) into v_invalid
  from (
    select distinct c.target_card_id, c.evidence ->> 'sourceNameZh' as source_name
    from public.catalog_enrichment_candidates c where c.id = any(v_ids)
  ) expected
  join public.tcg_cards card on card.id = expected.target_card_id
  where (
    nullif(btrim(card.name_zh), '') is not null
    and card.name_zh is distinct from expected.source_name
  ) or exists (
    select 1 from public.tcg_card_names names
    where names.card_id = expected.target_card_id
      and names.locale = 'zh-Hant-TW'
      and names.name_type = 'official'
      and names.name is distinct from expected.source_name
  );
  if v_invalid <> 0 then raise exception 'official Traditional Chinese name conflict'; end if;

  select count(*) into v_invalid
  from public.catalog_enrichment_candidates c
  join public.tcg_cards card on card.id = c.target_card_id
  join public.tcg_canonical_cards canonical on canonical.id = card.canonical_id
  where c.id = any(v_ids) and c.field_name = 'name_zh'
    and nullif(btrim(canonical.name_zh), '') is not null
    and canonical.name_zh is distinct from (c.proposed_value #>> '{}');
  if v_invalid <> 0 then raise exception 'canonical Traditional Chinese name conflict'; end if;

  select count(*) into v_verified_names
  from (
    select distinct c.target_card_id, c.evidence ->> 'sourceNameZh' as source_name
    from public.catalog_enrichment_candidates c where c.id = any(v_ids)
  ) expected
  join public.tcg_cards card
    on card.id = expected.target_card_id and card.name_zh = expected.source_name
  where exists (
    select 1 from public.tcg_card_names names
    where names.card_id = expected.target_card_id
      and names.locale = 'zh-Hant-TW'
      and names.name_type = 'official'
      and names.name = expected.source_name
  );

  -- Cards with an already populated name must have the exact official name row.
  select count(*) into v_invalid
  from (
    select distinct c.target_card_id, c.evidence ->> 'sourceNameZh' as source_name
    from public.catalog_enrichment_candidates c where c.id = any(v_ids)
  ) expected
  join public.tcg_cards card on card.id = expected.target_card_id
  where nullif(btrim(card.name_zh), '') is not null
    and not exists (
      select 1 from public.tcg_card_names names
      where names.card_id = expected.target_card_id
        and names.locale = 'zh-Hant-TW'
        and names.name_type = 'official'
        and names.name = expected.source_name
    );
  if v_invalid <> 0 then raise exception 'official Traditional Chinese name row is missing'; end if;

  select jsonb_build_object(
    'candidates', (select jsonb_agg(to_jsonb(c) order by c.id) from public.catalog_enrichment_candidates c where c.id = any(v_ids)),
    'cards', (select jsonb_agg(to_jsonb(card) order by card.id) from public.tcg_cards card where card.id in (select c.target_card_id from public.catalog_enrichment_candidates c where c.id = any(v_ids))),
    'printings', (select coalesce(jsonb_agg(to_jsonb(printing) order by printing.id), '[]'::jsonb) from public.tcg_printings printing where printing.id in (select c.target_printing_id from public.catalog_enrichment_candidates c where c.id = any(v_ids))),
    'names', (select coalesce(jsonb_agg(to_jsonb(names) order by names.id), '[]'::jsonb) from public.tcg_card_names names where names.card_id in (select c.target_card_id from public.catalog_enrichment_candidates c where c.id = any(v_ids)) and names.locale = 'zh-Hant-TW'),
    'canonical', (select jsonb_agg(to_jsonb(canonical) order by canonical.id) from public.tcg_canonical_cards canonical where canonical.id in (select card.canonical_id from public.tcg_cards card where card.id in (select c.target_card_id from public.catalog_enrichment_candidates c where c.id = any(v_ids))))
  ) into v_before;

  with selected as (
    select c.target_card_id, c.proposed_value #>> '{}' as rarity_code, r.rarity_tier
    from public.catalog_enrichment_candidates c
    join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = (c.proposed_value #>> '{}')
    where c.id = any(v_ids) and c.field_name = 'rarity_code' and c.target_table = 'tcg_cards'
  ), updated as (
    update public.tcg_cards card
    set rarity = selected.rarity_code, rarity_tier = selected.rarity_tier, updated_at = now()
    from selected
    where card.id = selected.target_card_id and nullif(btrim(card.rarity), '') is null
    returning card.id
  ) select count(*) into v_changed_card_rarities from updated;

  with selected as (
    select c.target_printing_id, c.proposed_value #>> '{}' as rarity_code, coalesce(r.rarity_label, c.proposed_value #>> '{}') as rarity_label
    from public.catalog_enrichment_candidates c
    join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = (c.proposed_value #>> '{}')
    where c.id = any(v_ids) and c.field_name = 'rarity_code' and c.target_table = 'tcg_printings'
  ), updated as (
    update public.tcg_printings printing
    set rarity = selected.rarity_code,
        rarity_code = selected.rarity_code,
        rarity_label = selected.rarity_label,
        updated_at = now()
    from selected
    where printing.id = selected.target_printing_id and nullif(btrim(printing.rarity_code), '') is null
    returning printing.id
  ) select count(*) into v_changed_printing_rarities from updated;

  with selected as (
    select c.target_card_id, c.proposed_value #>> '{}' as name_zh, c.source_url
    from public.catalog_enrichment_candidates c
    where c.id = any(v_ids) and c.field_name = 'name_zh'
  ), updated as (
    update public.tcg_cards card
    set name_zh = selected.name_zh,
        aliases = array(select distinct value from unnest(card.aliases || array[selected.name_zh]) value where nullif(btrim(value), '') is not null order by value),
        updated_at = now()
    from selected
    where card.id = selected.target_card_id and nullif(btrim(card.name_zh), '') is null
    returning card.id
  ) select count(*) into v_changed_names from updated;

  insert into public.tcg_card_names(card_id, locale, name, name_type, source, source_url, data_status, metadata, updated_at)
  select c.target_card_id, 'zh-Hant-TW', c.proposed_value #>> '{}', 'official',
         'tcgdex-zh-tw', c.source_url, 'verified',
         jsonb_build_object('enrichmentBatch', p_promotion_batch_id, 'matchingMethod', c.matching_method), now()
  from public.catalog_enrichment_candidates c
  where c.id = any(v_ids) and c.field_name = 'name_zh'
  on conflict (card_id, locale, name, name_type) do nothing;
  get diagnostics v_inserted_name_rows = row_count;

  with selected as (
    select c.target_printing_id, c.proposed_value ->> 'url' as image_url, c.source_url
    from public.catalog_enrichment_candidates c
    where c.id = any(v_ids) and c.field_name = 'image_url'
  ), updated as (
    update public.tcg_printings printing
    set image_url = selected.image_url,
        image_rights_status = 'not-provided',
        image_license_expires_at = null,
        image_rehost_required = false,
        source_url = coalesce(printing.source_url, selected.source_url),
        rights_note = coalesce(printing.rights_note, 'CardScope risk-accepted TCGdex source; not licensed or inferred'),
        metadata = coalesce(printing.metadata, '{}'::jsonb) || jsonb_build_object(
          'enrichmentBatch', p_promotion_batch_id,
          'imageRights', 'not-inferred',
          'imageRightsStatus', 'not-provided'
        ),
        updated_at = now()
    from selected
    where printing.id = selected.target_printing_id and nullif(btrim(printing.image_url), '') is null
    returning printing.id
  ) select count(*) into v_changed_images from updated;

  if v_changed_card_rarities <> (select count(*) from public.catalog_enrichment_candidates c where c.id = any(v_ids) and c.field_name = 'rarity_code' and c.target_table = 'tcg_cards')
    or v_changed_printing_rarities <> (select count(*) from public.catalog_enrichment_candidates c where c.id = any(v_ids) and c.field_name = 'rarity_code' and c.target_table = 'tcg_printings')
    or v_changed_names <> (select count(*) from public.catalog_enrichment_candidates c where c.id = any(v_ids) and c.field_name = 'name_zh')
    or v_inserted_name_rows <> v_changed_names
    or v_changed_images <> (select count(*) from public.catalog_enrichment_candidates c where c.id = any(v_ids) and c.field_name = 'image_url') then
    raise exception 'candidate promotion count mismatch';
  end if;

  update public.catalog_enrichment_candidates
  set status = 'promoted', promotion_batch_id = p_promotion_batch_id,
      promoted_at = now(), promoted_by = p_actor, updated_at = now()
  where id = any(v_ids) and status = 'approved';
  get diagnostics v_marked = row_count;
  if v_marked <> v_count then raise exception 'candidate promotion count mismatch'; end if;

  v_result := jsonb_build_object(
    'candidateCount', v_count,
    'changedCardRarities', v_changed_card_rarities,
    'changedPrintingRarities', v_changed_printing_rarities,
    'changedNames', v_changed_names,
    'insertedNameRows', v_inserted_name_rows,
    'verifiedExistingNames', v_verified_names,
    'changedImages', v_changed_images,
    'replay', false
  );

  insert into public.catalog_enrichment_promotion_batches(
    promotion_batch_id, checksum, actor, source, game_id, candidate_ids, before_snapshot, result
  ) values (
    p_promotion_batch_id, p_checksum, p_actor, 'tcgdex-zh-tw', 'pokemon', v_ids, v_before, v_result
  );

  return v_result;
end;
$$;

revoke all on function private.promote_pokemon_tcgdex_candidates(bigint[], text, text, text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.promote_pokemon_tcgdex_candidates(bigint[], text, text, text) to service_role;

comment on function private.promote_pokemon_tcgdex_candidates(bigint[], text, text, text) is
  'Atomically promotes reviewed exact-match Pokemon TCGdex rarity, official zh-Hant-TW name, and same-printing image candidates. Images remain not-provided/not-inferred.';
