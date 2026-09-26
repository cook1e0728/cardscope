-- One-time repair for reviewed Pokémon TW printing rarity values erased by the
-- 2026-09-24 catalog sync. Deploy and revalidate the sync guard before applying.
-- This migration deliberately restores only the 786 later candidates whose
-- original promotion batch audit contains the candidate ID. The ten legacy
-- Sep 15 rows remain in the audit manifest as duplicate provenance only.
-- The migration runner owns the transaction; these local limits and locks
-- therefore roll back with the migration if any validation fails.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('cardscope:pokemon-tw-printing-rarity-repair:20260927', 0)
);

-- Keep the reviewed input and its promotion-batch membership stable while the
-- repair validates, updates, and records its audit row.
lock table public.catalog_enrichment_candidates in share mode;
lock table public.catalog_enrichment_promotion_batches in share mode;

create schema if not exists private;

create table if not exists private.catalog_printing_rarity_repair_audit (
  repair_id text primary key,
  scope text not null check (scope = 'pokemon-tw-printing-rarity'),
  game_id text not null check (game_id = 'pokemon'),
  region text not null check (region = 'TW'),
  actor text not null,
  checksum text not null,
  candidate_checksum text not null,
  candidate_count integer not null check (candidate_count = 796),
  authoritative_candidate_count integer not null check (authoritative_candidate_count = 786),
  excluded_candidate_count integer not null check (excluded_candidate_count = 10),
  candidate_ids bigint[] not null,
  authoritative_candidate_ids bigint[] not null,
  printing_ids bigint[] not null,
  candidate_batch_refs jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table private.catalog_printing_rarity_repair_audit enable row level security;
revoke all on table private.catalog_printing_rarity_repair_audit from public, anon, authenticated, service_role;

comment on table private.catalog_printing_rarity_repair_audit is
  'Append-only manifest and before/after snapshot for the one-time reviewed Pokémon TW printing rarity repair.';

create or replace function private.reject_pokemon_tw_rarity_repair_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'pokemon TW rarity repair audit is append-only';
  return null;
end;
$$;

revoke all on function private.reject_pokemon_tw_rarity_repair_audit_mutation() from public, anon, authenticated, service_role;

drop trigger if exists catalog_printing_rarity_repair_audit_no_change
  on private.catalog_printing_rarity_repair_audit;
create trigger catalog_printing_rarity_repair_audit_no_change
before update or delete on private.catalog_printing_rarity_repair_audit
for each row execute function private.reject_pokemon_tw_rarity_repair_audit_mutation();

drop trigger if exists catalog_printing_rarity_repair_audit_no_truncate
  on private.catalog_printing_rarity_repair_audit;
create trigger catalog_printing_rarity_repair_audit_no_truncate
before truncate on private.catalog_printing_rarity_repair_audit
for each statement execute function private.reject_pokemon_tw_rarity_repair_audit_mutation();

create temporary table pokemon_tw_rarity_repair_candidates on commit drop as
select
  c.*,
  (b.promotion_batch_id is not null) as batch_record_exists,
  coalesce(c.id = any(b.candidate_ids), false) as batch_contains_candidate,
  b.source as batch_source,
  b.game_id as batch_game_id,
  b.checksum as batch_checksum,
  b.candidate_ids as batch_candidate_ids
from public.catalog_enrichment_candidates c
left join public.catalog_enrichment_promotion_batches b
  on b.promotion_batch_id = c.promotion_batch_id
where c.source = 'tcgdex-zh-tw'
  and c.game_id = 'pokemon'
  and c.field_name = 'rarity_code'
  and c.target_table = 'tcg_printings'
  and c.target_column = 'rarity_code'
  and c.status = 'promoted';

do $lock_repair_targets$
begin
  perform 1
  from public.catalog_enrichment_candidates candidate
  where candidate.id in (
    select c.id from pg_temp.pokemon_tw_rarity_repair_candidates c
  )
  order by candidate.id
  for update;

  perform 1
  from public.tcg_cards card
  where card.id in (
    select c.target_card_id
    from pg_temp.pokemon_tw_rarity_repair_candidates c
    where c.batch_record_exists and c.batch_contains_candidate
  )
  order by card.id
  for share;

  perform 1
  from public.tcg_printings printing
  where printing.id in (
    select c.target_printing_id
    from pg_temp.pokemon_tw_rarity_repair_candidates c
    where c.batch_record_exists and c.batch_contains_candidate
  )
  order by printing.id
  for update;

  perform 1
  from public.tcg_rarities rarity
  where rarity.game_id = 'pokemon'
    and rarity.rarity_code in (
      select c.proposed_value #>> '{}'
      from pg_temp.pokemon_tw_rarity_repair_candidates c
      where c.batch_record_exists and c.batch_contains_candidate
    )
  order by rarity.rarity_code
  for share;

  perform 1
  from public.catalog_enrichment_promotion_batches batch
  where batch.promotion_batch_id in (
    select c.promotion_batch_id
    from pg_temp.pokemon_tw_rarity_repair_candidates c
    where c.batch_record_exists and c.batch_contains_candidate
  )
  order by batch.promotion_batch_id
  for share;
end;
$lock_repair_targets$;

create temporary table pokemon_tw_rarity_repair_targets on commit drop as
select
  c.id as candidate_id,
  c.target_card_id,
  c.target_printing_id,
  c.source_record_id,
  c.promotion_batch_id,
  c.locale as candidate_locale,
  c.target_key,
  c.proposed_value,
  c.evidence,
  c.proposed_value #>> '{}' as proposed_rarity_code,
  printing.id as current_printing_id,
  printing.card_id as printing_card_id,
  printing.source as printing_source,
  printing.provider_id as printing_provider_id,
  printing.region as printing_region,
  printing.source_locale as printing_source_locale,
  printing.language as printing_language,
  printing.local_set_code as printing_set_code,
  printing.local_card_number as printing_card_number,
  printing.rarity as printing_rarity,
  printing.rarity_code as printing_rarity_code,
  printing.rarity_label as printing_rarity_label,
  printing.updated_at as printing_updated_at,
  card.id as current_card_id,
  card.game_id as card_game_id,
  card.source as card_source,
  card.provider_id as card_provider_id,
  card.rarity as card_rarity,
  rarity.rarity_code as canonical_rarity_code,
  rarity.rarity_label as canonical_rarity_label,
  rarity.rarity_tier as canonical_rarity_tier
from pg_temp.pokemon_tw_rarity_repair_candidates c
left join public.tcg_printings printing on printing.id = c.target_printing_id
left join public.tcg_cards card on card.id = c.target_card_id
left join public.tcg_rarities rarity
  on rarity.game_id = 'pokemon'
 and rarity.rarity_code = (c.proposed_value #>> '{}')
where c.batch_record_exists and c.batch_contains_candidate;

do $repair$
declare
  v_repair_id constant text := 'pokemon-tw-printing-rarity-repair-20260927';
  v_actor constant text := 'cardscope-pokemon-tw-rarity-repair-migration';
  v_expected_candidate_checksum constant text := 'f36bae4f4f2e0bc5becfc9c0ccb7305e';
  v_candidate_checksum text;
  v_checksum text;
  v_candidate_count integer;
  v_candidate_id_count integer;
  v_distinct_candidate_target_count integer;
  v_authoritative_count integer;
  v_authoritative_candidate_id_count integer;
  v_authoritative_target_count integer;
  v_excluded_count integer;
  v_invalid integer;
  v_updated integer;
  v_candidate_ids bigint[];
  v_authoritative_candidate_ids bigint[];
  v_printing_ids bigint[];
  v_candidate_batch_refs jsonb;
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_existing private.catalog_printing_rarity_repair_audit%rowtype;
  v_has_audit boolean;
begin
  select
    count(*),
    count(distinct c.id),
    count(distinct c.target_printing_id),
    count(*) filter (where c.batch_record_exists and c.batch_contains_candidate),
    count(distinct c.id) filter (where c.batch_record_exists and c.batch_contains_candidate),
    count(distinct c.target_printing_id) filter (where c.batch_record_exists and c.batch_contains_candidate),
    count(*) filter (where not c.batch_record_exists)
  into
    v_candidate_count,
    v_candidate_id_count,
    v_distinct_candidate_target_count,
    v_authoritative_count,
    v_authoritative_candidate_id_count,
    v_authoritative_target_count,
    v_excluded_count
  from pg_temp.pokemon_tw_rarity_repair_candidates c;

  select array_agg(c.id order by c.id)
    into v_candidate_ids
  from pg_temp.pokemon_tw_rarity_repair_candidates c;

  select array_agg(c.id order by c.id)
    into v_authoritative_candidate_ids
  from pg_temp.pokemon_tw_rarity_repair_candidates c
  where c.batch_record_exists and c.batch_contains_candidate;

  if v_candidate_count <> 796
     or v_candidate_id_count <> 796
     or v_distinct_candidate_target_count <> 786
     or v_authoritative_count <> 786
     or v_authoritative_candidate_id_count <> 786
     or v_authoritative_target_count <> 786
     or v_excluded_count <> 10 then
    raise exception 'reviewed Pokémon TW rarity manifest cardinality changed';
  end if;

  if exists (
       select 1
       from pg_temp.pokemon_tw_rarity_repair_candidates c
       where not c.batch_record_exists
         and (
           c.batch_contains_candidate
           or c.promotion_batch_id is distinct from 'pokemon-s10a-001-010-20260915'
         )
     ) or exists (
       select 1
       from public.catalog_enrichment_promotion_batches b
       where b.promotion_batch_id = 'pokemon-s10a-001-010-20260915'
     ) then
    raise exception 'legacy pre-batch candidates changed';
  end if;

  if exists (
    select 1
    from pg_temp.pokemon_tw_rarity_repair_candidates c
    where c.batch_record_exists is distinct from c.batch_contains_candidate
  ) then
    raise exception 'promotion batch membership is incomplete';
  end if;

  if exists (
    select 1
    from pg_temp.pokemon_tw_rarity_repair_candidates c
    where c.source is distinct from 'tcgdex-zh-tw'
       or c.game_id is distinct from 'pokemon'
       or c.field_name is distinct from 'rarity_code'
       or c.target_table is distinct from 'tcg_printings'
       or c.target_column is distinct from 'rarity_code'
       or c.status is distinct from 'promoted'
       or c.matching_method is distinct from 'provider-id'
       or nullif(btrim(c.source_record_id), '') is null
       or c.target_card_id is null
       or c.target_printing_id is null
       or c.target_key is distinct from c.target_printing_id::text
       or jsonb_typeof(c.proposed_value) is distinct from 'string'
       or nullif(btrim(c.proposed_value #>> '{}'), '') is null
       or not (
         c.current_value is null
         or c.current_value = 'null'::jsonb
         or nullif(btrim(c.current_value #>> '{}'), '') is null
       )
       or c.reviewed_at is null
       or nullif(btrim(c.reviewed_by), '') is null
       or c.promoted_at is null
       or nullif(btrim(c.promoted_by), '') is null
       or nullif(btrim(c.promotion_batch_id), '') is null
       or (c.locale is not null and c.locale is distinct from 'zh-Hant-TW')
       or nullif(btrim(c.evidence ->> 'providerId'), '') is null
       or c.evidence ->> 'providerId' is distinct from c.source_record_id
       or nullif(btrim(c.evidence ->> 'setCode'), '') is null
       or nullif(btrim(c.evidence ->> 'cardNumber'), '') is null
       or c.evidence ->> 'normalizedRarityCode' is distinct from (c.proposed_value #>> '{}')
    ) then
    raise exception 'candidate scope, review, proposed value, or evidence is invalid';
  end if;

  select md5(string_agg(
    jsonb_build_array(
      c.id, c.source, c.source_record_id, c.game_id,
      c.target_card_id, c.target_printing_id, c.field_name,
      c.locale, c.target_table, c.target_column, c.target_key,
      c.proposed_value, c.current_value, c.matching_method,
      c.payload_hash, c.status,
      case when c.reviewed_at is null then null else extract(epoch from c.reviewed_at) end,
      c.reviewed_by, c.promotion_batch_id,
      case when c.promoted_at is null then null else extract(epoch from c.promoted_at) end,
      c.promoted_by, c.evidence
    )::text,
    E'\n' order by c.id
  ))
  into v_candidate_checksum
  from pg_temp.pokemon_tw_rarity_repair_candidates c;

  if v_candidate_checksum is distinct from v_expected_candidate_checksum then
    raise exception 'reviewed Pokémon TW rarity candidate checksum changed';
  end if;

  select count(*) into v_invalid
  from (
    select c.target_printing_id
    from pg_temp.pokemon_tw_rarity_repair_candidates c
    group by c.target_printing_id
    having count(distinct c.proposed_value #>> '{}') <> 1
       or count(distinct c.target_card_id) <> 1
       or count(distinct c.source_record_id) <> 1
       or count(distinct c.evidence ->> 'providerId') <> 1
       or count(distinct c.evidence ->> 'setCode') <> 1
       or count(distinct c.evidence ->> 'cardNumber') <> 1
       or count(distinct c.evidence ->> 'normalizedRarityCode') <> 1
  ) conflicts;
  if v_invalid <> 0 then
    raise exception 'duplicate printing candidates disagree on reviewed identity';
  end if;

  select count(*) into v_invalid
  from pg_temp.pokemon_tw_rarity_repair_candidates legacy
  left join pg_temp.pokemon_tw_rarity_repair_candidates authoritative
    on authoritative.target_printing_id = legacy.target_printing_id
   and authoritative.batch_record_exists
   and authoritative.batch_contains_candidate
  where not legacy.batch_record_exists
    and (
      authoritative.id is null
      or legacy.target_card_id is distinct from authoritative.target_card_id
      or legacy.source_record_id is distinct from authoritative.source_record_id
      or legacy.proposed_value is distinct from authoritative.proposed_value
      or legacy.evidence ->> 'providerId' is distinct from authoritative.evidence ->> 'providerId'
      or legacy.evidence ->> 'setCode' is distinct from authoritative.evidence ->> 'setCode'
      or legacy.evidence ->> 'cardNumber' is distinct from authoritative.evidence ->> 'cardNumber'
      or legacy.evidence ->> 'normalizedRarityCode' is distinct from authoritative.evidence ->> 'normalizedRarityCode'
      or authoritative.promoted_at <= legacy.promoted_at
      or authoritative.promotion_batch_id is not distinct from legacy.promotion_batch_id
    );
  if v_invalid <> 0 then
    raise exception 'legacy candidate lacks an identical audited candidate';
  end if;

  with selected_batches as (
    select distinct c.promotion_batch_id
    from pg_temp.pokemon_tw_rarity_repair_candidates c
    where c.batch_record_exists and c.batch_contains_candidate
  ), checked_batches as (
    select
      batch.promotion_batch_id,
      batch.source,
      batch.game_id,
      batch.checksum,
      batch.candidate_ids,
      array_agg(candidate.id order by candidate.id) filter (where candidate.id is not null) as actual_candidate_ids,
      md5(string_agg(
        concat_ws('|', candidate.id::text, candidate.payload_hash, candidate.target_table,
          candidate.target_key, candidate.target_column, candidate.proposed_value::text),
        E'\n' order by candidate.id
      )) as recomputed_checksum
    from selected_batches selected
    join public.catalog_enrichment_promotion_batches batch
      on batch.promotion_batch_id = selected.promotion_batch_id
    left join public.catalog_enrichment_candidates candidate
      on candidate.id = any(batch.candidate_ids)
    group by batch.promotion_batch_id, batch.source, batch.game_id, batch.checksum, batch.candidate_ids
  )
  select count(*) into v_invalid
  from checked_batches batch
  where batch.source is distinct from 'tcgdex-zh-tw'
     or batch.game_id is distinct from 'pokemon'
     or batch.actual_candidate_ids is distinct from batch.candidate_ids
     or batch.checksum is distinct from batch.recomputed_checksum;
  if v_invalid <> 0 then
    raise exception 'promotion batch audit checksum or membership is invalid';
  end if;

  select count(*) into v_invalid
  from pg_temp.pokemon_tw_rarity_repair_targets target
  where target.current_printing_id is null
     or target.current_card_id is null
     or target.canonical_rarity_code is null
     or target.canonical_rarity_tier is null
     or target.canonical_rarity_label is null
     or target.printing_card_id is distinct from target.target_card_id
     or target.printing_source is distinct from 'tcgdex-zh-tw'
     or target.printing_provider_id is distinct from target.source_record_id
     or target.printing_region is distinct from 'TW'
     or target.printing_source_locale is distinct from 'zh-Hant-TW'
     or target.printing_language is distinct from 'zh-Hant-TW'
     or (target.candidate_locale is not null and target.candidate_locale is distinct from target.printing_source_locale)
     or target.printing_set_code is distinct from (target.evidence ->> 'setCode')
     or target.printing_card_number is distinct from (target.evidence ->> 'cardNumber')
     or target.card_game_id is distinct from 'pokemon'
     or target.card_source is distinct from 'tcgdex-zh-tw'
     or target.card_provider_id is distinct from target.source_record_id
     or target.card_rarity is distinct from target.proposed_rarity_code
     or target.canonical_rarity_code is distinct from target.proposed_rarity_code
     or target.printing_updated_at < '2026-09-24 00:00:00+00'::timestamptz;
  if v_invalid <> 0 then
    raise exception 'current card, printing, locale, or canonical rarity linkage is invalid';
  end if;

  if (select count(*) from pg_temp.pokemon_tw_rarity_repair_targets) <> 786
     or (select count(distinct target_printing_id) from pg_temp.pokemon_tw_rarity_repair_targets) <> 786 then
    raise exception 'authoritative Pokémon TW target set is incomplete or duplicated';
  end if;

  select array_agg(target.target_printing_id order by target.target_printing_id)
    into v_printing_ids
  from pg_temp.pokemon_tw_rarity_repair_targets target;

  select jsonb_agg(jsonb_build_object(
    'candidateId', c.id,
    'targetPrintingId', c.target_printing_id,
    'targetCardId', c.target_card_id,
    'sourceRecordId', c.source_record_id,
    'proposedRarityCode', c.proposed_value #>> '{}',
    'promotionBatchId', c.promotion_batch_id,
    'batchRecordExists', c.batch_record_exists,
    'batchContainsCandidate', c.batch_contains_candidate,
    'batchChecksum', c.batch_checksum,
    'batchSource', c.batch_source,
    'batchGameId', c.batch_game_id,
    'disposition', case when c.batch_record_exists and c.batch_contains_candidate then 'authoritative_update' else 'excluded' end,
    'exclusionReason', case when not c.batch_record_exists then 'legacy_pre_batch_table' else null end
  ) order by c.id)
  into v_candidate_batch_refs
  from pg_temp.pokemon_tw_rarity_repair_candidates c;

  select * into v_existing
  from private.catalog_printing_rarity_repair_audit audit
  where audit.repair_id = v_repair_id
  for update;
  v_has_audit := found;

  if v_has_audit then
    select jsonb_agg(jsonb_build_object(
      'candidateId', target.candidate_id,
      'printingId', target.target_printing_id,
      'cardId', target.target_card_id,
      'cardRarity', card.rarity,
      'printingRarity', printing.rarity,
      'printingRarityCode', printing.rarity_code,
      'printingRarityLabel', printing.rarity_label,
      'canonicalRarityCode', target.canonical_rarity_code,
      'canonicalRarityLabel', target.canonical_rarity_label,
      'canonicalRarityTier', target.canonical_rarity_tier
    ) order by target.target_printing_id)
    into v_after_snapshot
    from pg_temp.pokemon_tw_rarity_repair_targets target
    join public.tcg_printings printing on printing.id = target.target_printing_id
    join public.tcg_cards card on card.id = target.target_card_id
    where printing.rarity is not distinct from target.proposed_rarity_code
      and printing.rarity_code is not distinct from target.proposed_rarity_code
      and printing.rarity_label is not distinct from target.canonical_rarity_label
      and card.rarity is not distinct from target.proposed_rarity_code;

    v_checksum := md5(jsonb_build_array(
      v_candidate_checksum,
      v_candidate_batch_refs,
      v_existing.before_snapshot,
      v_after_snapshot,
      v_actor
    )::text);

    if v_existing.scope is distinct from 'pokemon-tw-printing-rarity'
       or v_existing.game_id is distinct from 'pokemon'
       or v_existing.region is distinct from 'TW'
       or v_existing.actor is distinct from v_actor
       or v_existing.checksum is distinct from v_checksum
       or v_existing.candidate_checksum is distinct from v_candidate_checksum
       or v_existing.candidate_count <> 796
       or v_existing.authoritative_candidate_count <> 786
       or v_existing.excluded_candidate_count <> 10
       or v_existing.candidate_ids is distinct from v_candidate_ids
       or v_existing.authoritative_candidate_ids is distinct from v_authoritative_candidate_ids
       or v_existing.printing_ids is distinct from v_printing_ids
       or v_existing.candidate_batch_refs is distinct from v_candidate_batch_refs
       or v_existing.after_snapshot is distinct from v_after_snapshot
       or jsonb_array_length(v_existing.before_snapshot) <> 786
       or jsonb_array_length(v_existing.after_snapshot) <> 786 then
      raise exception 'existing repair audit or current targets no longer match the exact repair';
    end if;
  else
    select count(*) into v_invalid
    from pg_temp.pokemon_tw_rarity_repair_targets target
    where nullif(btrim(target.printing_rarity), '') is not null
       or nullif(btrim(target.printing_rarity_code), '') is not null
       or nullif(btrim(target.printing_rarity_label), '') is not null
       or target.printing_updated_at < '2026-09-24 00:00:00+00'::timestamptz;
    if v_invalid <> 0 then
      raise exception 'target printing is partially populated, conflicting, or predates the sync';
    end if;

    select jsonb_agg(jsonb_build_object(
      'candidateId', target.candidate_id,
      'printingId', target.target_printing_id,
      'cardId', target.target_card_id,
      'cardRarity', target.card_rarity,
      'printingRarity', target.printing_rarity,
      'printingRarityCode', target.printing_rarity_code,
      'printingRarityLabel', target.printing_rarity_label,
      'printingUpdatedAt', target.printing_updated_at,
      'canonicalRarityCode', target.canonical_rarity_code,
      'canonicalRarityLabel', target.canonical_rarity_label,
      'canonicalRarityTier', target.canonical_rarity_tier
    ) order by target.target_printing_id)
    into v_before_snapshot
    from pg_temp.pokemon_tw_rarity_repair_targets target;

    if jsonb_array_length(v_before_snapshot) <> 786 then
      raise exception 'before snapshot does not cover all authoritative printings';
    end if;

    update public.tcg_printings printing
    set rarity = target.proposed_rarity_code,
        rarity_code = target.proposed_rarity_code,
        rarity_label = target.canonical_rarity_label,
        updated_at = now()
    from pg_temp.pokemon_tw_rarity_repair_targets target
    where printing.id = target.target_printing_id
      and nullif(btrim(printing.rarity), '') is null
      and nullif(btrim(printing.rarity_code), '') is null
      and nullif(btrim(printing.rarity_label), '') is null;
    get diagnostics v_updated = row_count;
    if v_updated <> 786 then
      raise exception 'printing rarity repair update count mismatch';
    end if;

    select jsonb_agg(jsonb_build_object(
      'candidateId', target.candidate_id,
      'printingId', target.target_printing_id,
      'cardId', target.target_card_id,
      'cardRarity', card.rarity,
      'printingRarity', printing.rarity,
      'printingRarityCode', printing.rarity_code,
      'printingRarityLabel', printing.rarity_label,
      'canonicalRarityCode', target.canonical_rarity_code,
      'canonicalRarityLabel', target.canonical_rarity_label,
      'canonicalRarityTier', target.canonical_rarity_tier
    ) order by target.target_printing_id)
    into v_after_snapshot
    from pg_temp.pokemon_tw_rarity_repair_targets target
    join public.tcg_printings printing on printing.id = target.target_printing_id
    join public.tcg_cards card on card.id = target.target_card_id
    where printing.rarity is not distinct from target.proposed_rarity_code
      and printing.rarity_code is not distinct from target.proposed_rarity_code
      and printing.rarity_label is not distinct from target.canonical_rarity_label
      and card.rarity is not distinct from target.proposed_rarity_code;

    if jsonb_array_length(v_after_snapshot) <> 786 then
      raise exception 'after snapshot does not match every repaired printing';
    end if;

    v_checksum := md5(jsonb_build_array(
      v_candidate_checksum,
      v_candidate_batch_refs,
      v_before_snapshot,
      v_after_snapshot,
      v_actor
    )::text);

    insert into private.catalog_printing_rarity_repair_audit (
      repair_id,
      scope,
      game_id,
      region,
      actor,
      checksum,
      candidate_checksum,
      candidate_count,
      authoritative_candidate_count,
      excluded_candidate_count,
      candidate_ids,
      authoritative_candidate_ids,
      printing_ids,
      candidate_batch_refs,
      before_snapshot,
      after_snapshot
    ) values (
      v_repair_id,
      'pokemon-tw-printing-rarity',
      'pokemon',
      'TW',
      v_actor,
      v_checksum,
      v_candidate_checksum,
      v_candidate_count,
      v_authoritative_count,
      v_excluded_count,
      v_candidate_ids,
      v_authoritative_candidate_ids,
      v_printing_ids,
      v_candidate_batch_refs,
      v_before_snapshot,
      v_after_snapshot
    );
  end if;
end;
$repair$;
