-- CardScope: claim the hand-written SV4a Seed for the official card search
-- import (ADR 0016). The Seed series pokemon-sv4a-jp and card
-- pokemon-mew-ex-sv4a-347-jp keep their IDs; the claim adds the official source
-- identity once the Seed still holds its recorded values and the official page
-- shows the same set mark, number and Japanese name. The original values go to
-- metadata.seedClaim.before and an append-only audit. import_pokemon_jp_official_series
-- then imports the other official cards into the claimed series; unclaimed series
-- behave exactly as before (20261003080000).

create table if not exists private.catalog_jp_seed_claim_audit (
  audit_id bigint generated always as identity primary key,
  kind text not null check (kind in ('claim', 'replay')),
  series_code text not null,
  seed_series_id text not null,
  seed_card_id text not null,
  seed_printing_id bigint not null,
  official_card_id text not null check (official_card_id ~ '^[0-9]+$'),
  plan_digest text not null check (plan_digest ~ '^[0-9a-f]{64}$'),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  source_observed_at timestamptz not null,
  actor text not null,
  plan jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists catalog_jp_seed_claim_audit_one_claim_per_series
  on private.catalog_jp_seed_claim_audit (series_code)
  where kind = 'claim';

alter table private.catalog_jp_seed_claim_audit enable row level security;
revoke all on table private.catalog_jp_seed_claim_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_seed_claim_audit to service_role;

comment on table private.catalog_jp_seed_claim_audit is
  'Append-only plan, before/after snapshot and replay log for hand-written JP Seeds claimed by the official card search import (ADR 0016).';

drop trigger if exists catalog_jp_seed_claim_audit_no_change on private.catalog_jp_seed_claim_audit;
create trigger catalog_jp_seed_claim_audit_no_change
before update or delete on private.catalog_jp_seed_claim_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_seed_claim_audit_no_truncate on private.catalog_jp_seed_claim_audit;
create trigger catalog_jp_seed_claim_audit_no_truncate
before truncate on private.catalog_jp_seed_claim_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- p_plan: { "planVersion": 1, "source": "pokemon-card-official-jp", "seriesProviderId": "SV4a",
--   "evidenceHash": "<sha256>", "sourceObservedAt": "<iso>",
--   "seed": { "seriesId": "pokemon-sv4a-jp", "cardId": "pokemon-mew-ex-sv4a-347-jp", "printingId": 1,
--     "cardNumber": "347/190", "nameJa": "ミュウex", "cardRarity": "SSR", "printingRarity": null },
--   "series": { "name_ja": "...", "release_date": "2023-12-01", "source_url": "https://www.pokemon-card.com/card-search/...", "metadata": {} },
--   "card": { "provider_id": "44513", "official_card_number": "347", "name_ja": "ミュウex", "rarity_code": "SSR" | null,
--     "source_url": "<details url>", "search_text": "...", "metadata": {} } }
create or replace function private.claim_pokemon_jp_seed_series(
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
  v_source constant text := 'pokemon-card-official-jp';
  v_digest text;
  v_code text := p_plan->>'seriesProviderId';
  v_seed jsonb := p_plan->'seed';
  v_series jsonb := p_plan->'series';
  v_card jsonb := p_plan->'card';
  v_series_id text := p_plan->'seed'->>'seriesId';
  v_card_id text := p_plan->'seed'->>'cardId';
  v_printing_id bigint;
  v_rarity public.tcg_rarities%rowtype;
  v_existing private.catalog_jp_seed_claim_audit%rowtype;
  v_s public.tcg_series%rowtype;
  v_c public.tcg_cards%rowtype;
  v_p public.tcg_printings%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP Seed claim requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'source' is distinct from v_source
    or jsonb_typeof(v_seed) is distinct from 'object'
    or jsonb_typeof(v_series) is distinct from 'object'
    or jsonb_typeof(v_card) is distinct from 'object'
    or coalesce(p_plan->>'evidenceHash', '') !~ '^[0-9a-f]{64}$'
    or p_plan->>'sourceObservedAt' is null then
    raise exception 'JP Seed claim plan has an unsupported shape';
  end if;
  if coalesce(v_code, '') !~ '^[A-Za-z0-9]+$'
    or coalesce(v_seed->>'printingId', '') !~ '^[0-9]+$'
    or coalesce(v_card->>'provider_id', '') !~ '^[0-9]+$'
    or coalesce(v_card->>'official_card_number', '') !~ '^[A-Za-z0-9]+$'
    or split_part(v_seed->>'cardNumber', '/', 1) is distinct from v_card->>'official_card_number'
    or v_card->>'name_ja' is distinct from v_seed->>'nameJa'
    or v_card->>'source_url' is distinct from 'https://www.pokemon-card.com/card-search/details.php/card/' || (v_card->>'provider_id') || '/regu/all'
    or coalesce(v_series->>'source_url', '') not like 'https://www.pokemon-card.com/card-search/%' then
    raise exception 'JP Seed claim identity is invalid for %', v_code;
  end if;
  v_printing_id := (v_seed->>'printingId')::bigint;
  if v_card->>'rarity_code' is not null then
    select * into v_rarity from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = v_card->>'rarity_code';
    if not found then
      raise exception 'JP Seed claim rarity % is unknown', v_card->>'rarity_code';
    end if;
  end if;

  v_digest := encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-import:' || lower(v_code), 0)
  );

  select * into v_existing from private.catalog_jp_seed_claim_audit a where a.kind = 'claim' and a.series_code = v_code;
  if found then
    if v_existing.plan_digest <> v_digest then
      raise exception 'JP Seed % was already claimed by a different plan', v_code;
    end if;
    if not exists (select 1 from public.tcg_series s where s.id = v_series_id and s.source = v_source and s.provider_id = v_code)
      or not exists (select 1 from public.tcg_cards c where c.id = v_card_id and c.source = v_source and c.provider_id = v_card->>'provider_id')
      or not exists (select 1 from public.tcg_printings p where p.id = v_printing_id and p.card_id = v_card_id
        and p.source = v_source and p.provider_id = v_card->>'provider_id') then
      raise exception 'JP Seed % no longer matches its claim audit', v_code;
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'seriesId', v_series_id, 'planDigest', v_digest,
      'updated', jsonb_build_object('series', 0, 'cards', 0, 'printings', 0));
    if not p_dry_run then
      insert into private.catalog_jp_seed_claim_audit (kind, series_code, seed_series_id, seed_card_id, seed_printing_id,
        official_card_id, plan_digest, evidence_hash, source_observed_at, actor, plan, before_snapshot, after_snapshot)
      values ('replay', v_code, v_series_id, v_card_id, v_printing_id, v_card->>'provider_id', v_digest,
        p_plan->>'evidenceHash', (p_plan->>'sourceObservedAt')::timestamptz, p_actor, p_plan, '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  end if;

  -- The Seed must still be exactly what the plan recorded: the only JP series for the
  -- code, without a source, holding one card with one printing, both without a source.
  select * into v_s from public.tcg_series s where s.id = v_series_id;
  if not found or v_s.game_id <> 'pokemon' or v_s.region <> 'JP' or v_s.official_code <> v_code
    or v_s.source is not null or v_s.provider_id is not null
    or v_s.name_ja is distinct from v_series->>'name_ja'
    or v_s.release_date is distinct from (v_series->>'release_date')::date then
    raise exception 'JP Seed series % does not match the claim plan', v_series_id;
  end if;
  if (select count(*) from public.tcg_series s where s.game_id = 'pokemon' and s.region = 'JP' and upper(s.official_code) = upper(v_code)) <> 1
    or (select count(*) from public.tcg_cards c where c.series_id = v_series_id) <> 1
    or (select count(*) from public.tcg_printings p where p.series_id = v_series_id or p.card_id = v_card_id) <> 1 then
    raise exception 'JP Seed series % holds other rows', v_series_id;
  end if;
  select * into v_c from public.tcg_cards c where c.id = v_card_id;
  select * into v_p from public.tcg_printings p where p.id = v_printing_id;
  if v_c.id is null or v_c.series_id <> v_series_id or v_c.source is not null or v_c.provider_id is not null
    or v_c.official_card_number is distinct from v_seed->>'cardNumber' or v_c.name_ja is distinct from v_seed->>'nameJa'
    or v_c.rarity is distinct from v_seed->>'cardRarity'
    or v_p.id is null or v_p.card_id <> v_card_id or v_p.source is not null or v_p.provider_id is not null
    or v_p.region <> 'JP' or v_p.local_set_code <> v_code or v_p.local_card_number is distinct from v_seed->>'cardNumber'
    or v_p.rarity_code is distinct from v_seed->>'printingRarity' then
    raise exception 'JP Seed card % does not match the claim plan', v_card_id;
  end if;
  if exists (select 1 from public.tcg_cards c where c.source = v_source and c.provider_id = v_card->>'provider_id')
    or exists (select 1 from public.tcg_printings p where p.source = v_source and p.provider_id = v_card->>'provider_id')
    or exists (select 1 from public.tcg_printings p where p.region = 'JP' and upper(p.local_set_code) = upper(v_code)
      and p.local_card_number = v_card->>'official_card_number') then
    raise exception 'JP Seed claim collides with existing official rows for %', v_code;
  end if;

  v_before := jsonb_build_object(
    'series', to_jsonb(v_s) - 'created_at' - 'updated_at',
    'card', to_jsonb(v_c) - 'created_at' - 'updated_at' - 'search_names',
    'printing', to_jsonb(v_p) - 'created_at' - 'updated_at');

  begin
    update public.tcg_series s
    set source = v_source, provider_id = v_code, source_url = v_series->>'source_url',
      language = coalesce(s.language, 'ja-JP'), source_locale = coalesce(s.source_locale, 'ja-JP'),
      metadata = coalesce(s.metadata, '{}'::jsonb) || coalesce(v_series->'metadata', '{}'::jsonb)
        || jsonb_build_object('seedClaim', jsonb_build_object('adr', '0016', 'before', jsonb_build_object(
          'source', v_s.source, 'provider_id', v_s.provider_id, 'source_url', v_s.source_url,
          'language', v_s.language, 'source_locale', v_s.source_locale))),
      updated_at = now()
    where s.id = v_series_id;

    update public.tcg_cards c
    set source = v_source, provider_id = v_card->>'provider_id', official_card_number = v_card->>'official_card_number',
      rarity = coalesce(v_rarity.rarity_code, c.rarity),
      rarity_tier = case when v_rarity.rarity_code is null then c.rarity_tier else v_rarity.rarity_tier end,
      search_text = coalesce(c.search_text, v_card->>'search_text'),
      data_status = 'verified',
      metadata = coalesce(c.metadata, '{}'::jsonb) || coalesce(v_card->'metadata', '{}'::jsonb)
        || jsonb_build_object('seedClaim', jsonb_build_object('adr', '0016', 'before', jsonb_build_object(
          'source', v_c.source, 'provider_id', v_c.provider_id, 'official_card_number', v_c.official_card_number,
          'rarity', v_c.rarity, 'rarity_tier', v_c.rarity_tier, 'search_text', v_c.search_text, 'data_status', v_c.data_status))),
      updated_at = now()
    where c.id = v_card_id;

    update public.tcg_printings p
    set source = v_source, provider_id = v_card->>'provider_id', local_card_number = v_card->>'official_card_number',
      source_url = v_card->>'source_url', series_id = v_series_id, source_locale = coalesce(p.source_locale, 'ja-JP'),
      release_date = coalesce(p.release_date, v_s.release_date),
      rarity = coalesce(v_rarity.rarity_code, p.rarity), rarity_code = coalesce(v_rarity.rarity_code, p.rarity_code),
      rarity_label = coalesce(v_rarity.rarity_label, p.rarity_label),
      data_status = case when coalesce(v_rarity.rarity_code, p.rarity_code) is null then p.data_status else 'verified' end,
      metadata = coalesce(p.metadata, '{}'::jsonb) || coalesce(v_card->'metadata', '{}'::jsonb)
        || jsonb_build_object('seedClaim', jsonb_build_object('adr', '0016', 'before', jsonb_build_object(
          'source', v_p.source, 'provider_id', v_p.provider_id, 'local_card_number', v_p.local_card_number,
          'source_url', v_p.source_url, 'series_id', v_p.series_id, 'source_locale', v_p.source_locale,
          'release_date', v_p.release_date, 'rarity', v_p.rarity, 'rarity_code', v_p.rarity_code,
          'rarity_label', v_p.rarity_label, 'data_status', v_p.data_status)))
        || case when v_c.rarity is not null and v_rarity.rarity_code is not null and v_c.rarity <> v_rarity.rarity_code
          then jsonb_build_object('rarityBeforeOfficial', v_c.rarity) else '{}'::jsonb end,
      updated_at = now()
    where p.id = v_printing_id;

    v_after := jsonb_build_object(
      'series', (select to_jsonb(s) - 'created_at' - 'updated_at' from public.tcg_series s where s.id = v_series_id),
      'card', (select to_jsonb(c) - 'created_at' - 'updated_at' - 'search_names' from public.tcg_cards c where c.id = v_card_id),
      'printing', (select to_jsonb(p) - 'created_at' - 'updated_at' from public.tcg_printings p where p.id = v_printing_id));

    insert into private.catalog_jp_seed_claim_audit (kind, series_code, seed_series_id, seed_card_id, seed_printing_id,
      official_card_id, plan_digest, evidence_hash, source_observed_at, actor, plan, before_snapshot, after_snapshot)
    values ('claim', v_code, v_series_id, v_card_id, v_printing_id, v_card->>'provider_id', v_digest,
      p_plan->>'evidenceHash', (p_plan->>'sourceObservedAt')::timestamptz, p_actor, p_plan, v_before, v_after);

    v_result := jsonb_build_object('replay', false, 'dryRun', p_dry_run, 'seriesId', v_series_id, 'planDigest', v_digest,
      'rarity', jsonb_build_object('before', v_c.rarity, 'after', v_after->'card'->>'rarity'),
      'updated', jsonb_build_object('series', 1, 'cards', 1, 'printings', 1));
    if p_dry_run then
      raise exception using errcode = 'CJ017', message = 'JP Seed claim dry run rolled back';
    end if;
  exception when sqlstate 'CJ017' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.claim_pokemon_jp_seed_series(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.claim_pokemon_jp_seed_series(jsonb, text, boolean) to service_role;

comment on function private.claim_pokemon_jp_seed_series(jsonb, text, boolean) is
  'One-shot claim of a hand-written JP Seed series and card for the official card search import (ADR 0016); keeps IDs, stores originals in metadata.seedClaim.before; p_dry_run rolls back after full validation.';

-- ADR 0012 import, extended for a claimed Seed series (ADR 0016); otherwise identical to 20261003080000.
create or replace function private.import_pokemon_jp_official_series(
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
  v_source constant text := 'pokemon-card-official-jp';
  v_digest text;
  v_code text;
  v_series jsonb;
  v_series_id text;
  v_card_count integer;
  v_index integer;
  v_count integer;
  v_total integer;
  v_existing private.catalog_jp_official_import_audit%rowtype;
  v_previous private.catalog_jp_official_import_audit%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_bad text;
  v_claim_series text;
  v_claim_card text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP official import requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'source' is distinct from v_source
    or jsonb_typeof(p_plan->'series') is distinct from 'object'
    or jsonb_typeof(p_plan->'cards') is distinct from 'array'
    or jsonb_typeof(p_plan->'batch') is distinct from 'object' then
    raise exception 'JP official import plan has an unsupported shape';
  end if;
  if coalesce(p_plan->>'evidenceHash', '') !~ '^[0-9a-f]{64}$' or p_plan->>'sourceObservedAt' is null then
    raise exception 'JP official import plan is missing provenance';
  end if;

  v_digest := encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
  v_code := p_plan->>'seriesProviderId';
  v_series := p_plan->'series';
  v_series_id := v_series->>'id';
  v_card_count := jsonb_array_length(p_plan->'cards');
  v_index := (p_plan->'batch'->>'index')::integer;
  v_count := (p_plan->'batch'->>'count')::integer;
  v_total := (p_plan->'batch'->>'seriesCardCount')::integer;

  -- ADR 0016: a series code whose hand-written Seed was claimed imports into the Seed series.
  select a.seed_series_id, a.seed_card_id into v_claim_series, v_claim_card
  from private.catalog_jp_seed_claim_audit a
  where a.kind = 'claim' and a.series_code = v_code;

  if v_count not between 1 and 20 or v_index not between 1 and v_count or v_total not between 1 and 2000
    or (v_count = 1 and v_total <> v_card_count) or (v_count > 1 and v_total <= 100) then
    raise exception 'JP official import batch % of % is out of range', v_index, v_count;
  end if;
  if coalesce(v_code, '') !~ '^[A-Za-z0-9]+$'
    or v_series->>'provider_id' is distinct from v_code
    or v_series_id is distinct from coalesce(v_claim_series, 'pokemon-official-ja-' || lower(v_code))
    or coalesce(btrim(v_series->>'name_ja'), '') = ''
    or coalesce(v_series->>'source_url', '') not like 'https://www.pokemon-card.com/card-search/%' then
    raise exception 'JP official import series identity is invalid for %', v_code;
  end if;
  if v_card_count not between 1 and 100 then
    raise exception 'JP official import accepts 1-100 cards per batch, got %', v_card_count;
  end if;

  select coalesce(c->>'id', '<missing id>') into v_bad
  from jsonb_array_elements(p_plan->'cards') as c
  where coalesce(c->>'official_card_number', '') !~ '^[A-Za-z0-9]+$'
    or coalesce(c->>'provider_id', '') !~ '^[0-9]+$'
    or c->>'id' is distinct from 'pokemon-official-ja-' || lower(v_code) || '-' || lower(c->>'official_card_number')
    or coalesce(btrim(c->>'name_ja'), '') = ''
    or c->>'source_url' is distinct from 'https://www.pokemon-card.com/card-search/details.php/card/' || (c->>'provider_id') || '/regu/all'
    or (c->>'rarity_code' is not null and not exists (
      select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code'))
  limit 1;
  if found then
    raise exception 'JP official import card identity is invalid for %', v_bad;
  end if;
  if (select count(distinct lower(c->>'official_card_number')) from jsonb_array_elements(p_plan->'cards') c) <> v_card_count
    or (select count(distinct c->>'provider_id') from jsonb_array_elements(p_plan->'cards') c) <> v_card_count then
    raise exception 'JP official import plan repeats a card number or official card ID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-import:' || lower(v_code), 0)
  );

  -- A series code that already has an archive (tcgdex-ja) series is never imported again (ADR 0012).
  if exists (
    select 1 from public.tcg_series s
    where s.game_id = 'pokemon' and s.region = 'JP' and upper(s.official_code) = upper(v_code) and s.source is distinct from v_source
  ) then
    raise exception 'JP series % already exists from another source', v_code;
  end if;

  select * into v_existing
  from private.catalog_jp_official_import_audit a
  where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code
    and a.batch_index = v_index and a.kind = 'import';
  if found then
    if v_existing.plan_digest <> v_digest then
      raise exception 'JP series % batch % was already imported from a different plan', v_code, v_index;
    end if;
    if (select count(*) from jsonb_array_elements(p_plan->'cards') c
        join public.tcg_cards k on k.id = c->>'id' and k.source = v_source and k.provider_id = c->>'provider_id'
        join public.tcg_printings p on p.card_id = k.id and p.source = v_source) <> v_card_count then
      raise exception 'JP series % batch % no longer matches its import audit', v_code, v_index;
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'seriesId', v_series_id, 'batch', v_index,
      'planDigest', v_digest, 'inserted', jsonb_build_object('series', 0, 'cards', 0, 'printings', 0));
    if not p_dry_run then
      insert into private.catalog_jp_official_import_audit (kind, game_id, source, series_provider_id, series_id, batch_index,
        batch_count, series_card_count, plan_digest, evidence_hash, source_observed_at, actor, card_count, plan,
        before_snapshot, after_snapshot)
      values ('replay', 'pokemon', v_source, v_code, v_series_id, v_index, v_count, v_total, v_digest,
        p_plan->>'evidenceHash', (p_plan->>'sourceObservedAt')::timestamptz, p_actor, v_card_count, p_plan,
        '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  end if;

  if v_index > 1 then
    select * into v_previous
    from private.catalog_jp_official_import_audit a
    where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code
      and a.batch_index = v_index - 1 and a.kind = 'import';
    if not found
      or v_previous.batch_count <> v_count or v_previous.series_card_count <> v_total
      or v_previous.evidence_hash <> p_plan->>'evidenceHash'
      or v_previous.source_observed_at <> (p_plan->>'sourceObservedAt')::timestamptz then
      raise exception 'JP series % batch % needs batch % of the same snapshot first', v_code, v_index, v_index - 1;
    end if;
    if not exists (select 1 from public.tcg_series s where s.id = v_series_id and s.source = v_source and s.provider_id = v_code) then
      raise exception 'JP series % is missing for batch %', v_code, v_index;
    end if;
  elsif exists (
    select 1 from private.catalog_jp_official_import_audit a
    where a.game_id = 'pokemon' and a.source = v_source and a.series_provider_id = v_code and a.kind = 'import'
  ) then
    raise exception 'JP series % already has batches from another plan', v_code;
  elsif v_claim_series is not null and not exists (
    select 1 from public.tcg_series s where s.id = v_claim_series and s.source = v_source and s.provider_id = v_code
  ) then
    raise exception 'JP series % claimed Seed series % is missing', v_code, v_claim_series;
  end if;

  -- Any pre-existing row on an identity this batch claims aborts it; batch 1
  -- also requires the series identity (and the JP series code) to be free.
  with ids as (
    select c->>'id' as id, c->>'provider_id' as provider_id, c->>'official_card_number' as number
    from jsonb_array_elements(p_plan->'cards') c
  )
  select jsonb_build_object(
    'series', case when v_index = 1 then (select count(*) from public.tcg_series s
      where s.id is distinct from v_claim_series and (s.id = v_series_id
        or (s.source = v_source and s.provider_id = v_code)
        or (s.game_id = 'pokemon' and s.region = 'JP' and upper(s.official_code) = upper(v_code)))) else 0 end,
    'cards', (select count(*) from public.tcg_cards c
      where c.id in (select id from ids)
        or (c.source = v_source and c.provider_id in (select provider_id from ids))),
    'canonical', (select count(*) from public.tcg_canonical_cards k where k.id in (select id from ids)),
    'printings', (select count(*) from public.tcg_printings p
      where p.card_id in (select id from ids)
        or (p.source = v_source and p.provider_id in (select provider_id from ids))
        or (p.region = 'JP' and upper(p.local_set_code) = upper(v_code)
          and p.local_card_number in (select number from ids)))
  ) into v_before;
  if v_before <> '{"series":0,"cards":0,"canonical":0,"printings":0}'::jsonb then
    raise exception 'JP official import collides with existing rows for % batch %: %', v_code, v_index, v_before;
  end if;

  begin
    if v_index = 1 and v_claim_series is null then
      insert into public.tcg_series (id, game_id, official_code, name_ja, region, language, release_date,
        source_url, source, provider_id, source_locale, metadata)
      values (v_series_id, 'pokemon', v_code, v_series->>'name_ja', 'JP', 'ja-JP',
        (v_series->>'release_date')::date, v_series->>'source_url', v_source, v_code, 'ja-JP',
        coalesce(v_series->'metadata', '{}'::jsonb));
    end if;

    insert into public.tcg_cards (id, canonical_id, game_id, series_id, official_card_number, rarity, rarity_tier,
      name_ja, aliases, source, provider_id, search_text, metadata, data_status)
    select c->>'id', c->>'id', 'pokemon', v_series_id, c->>'official_card_number',
      r.rarity_code, r.rarity_tier, c->>'name_ja', array[v_code || '-' || (c->>'official_card_number')], v_source,
      c->>'provider_id', c->>'search_text', coalesce(c->'metadata', '{}'::jsonb), 'verified'
    from jsonb_array_elements(p_plan->'cards') c
    left join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code';

    insert into public.tcg_printings (card_id, region, language, local_set_code, local_card_number, image_url,
      source_url, release_date, series_id, rarity, rarity_code, rarity_label, source, provider_id,
      image_rehost_required, metadata, image_rights_status, source_locale, data_status)
    select c->>'id', 'JP', 'ja-JP', v_code, c->>'official_card_number', null,
      c->>'source_url', (v_series->>'release_date')::date, v_series_id, r.rarity_code, r.rarity_code, r.rarity_label,
      v_source, c->>'provider_id', false, coalesce(c->'metadata', '{}'::jsonb), 'not-provided', 'ja-JP',
      case when r.rarity_code is null then 'incomplete' else 'verified' end
    from jsonb_array_elements(p_plan->'cards') c
    left join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code';

    v_after := jsonb_build_object(
      'series', case when v_index = 1 and v_claim_series is null then (select to_jsonb(s) - 'created_at' - 'updated_at' from public.tcg_series s where s.id = v_series_id) end,
      'cards', (select jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' order by c.id)
        from public.tcg_cards c where c.id in (select x->>'id' from jsonb_array_elements(p_plan->'cards') x)),
      'printings', (select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.provider_id)
        from public.tcg_printings p where p.card_id in (select x->>'id' from jsonb_array_elements(p_plan->'cards') x))
    );
    if jsonb_array_length(v_after->'cards') <> v_card_count or jsonb_array_length(v_after->'printings') <> v_card_count
      or (select count(*) from public.tcg_canonical_cards k where k.id in (select x->>'id' from jsonb_array_elements(p_plan->'cards') x)) <> v_card_count then
      raise exception 'JP official import wrote an unexpected row count for % batch %', v_code, v_index;
    end if;
    if v_index = v_count and (
      (select count(*) from public.tcg_cards c where c.series_id = v_series_id and c.source = v_source
        and c.id is distinct from v_claim_card) <> v_total
      or (select count(*) from public.tcg_printings p where p.series_id = v_series_id and p.source = v_source
        and p.card_id is distinct from v_claim_card) <> v_total) then
      raise exception 'JP official import final batch does not complete % (% cards expected)', v_code, v_total;
    end if;

    insert into private.catalog_jp_official_import_audit (kind, game_id, source, series_provider_id, series_id, batch_index,
      batch_count, series_card_count, plan_digest, evidence_hash, source_observed_at, actor, card_count, plan,
      before_snapshot, after_snapshot)
    values ('import', 'pokemon', v_source, v_code, v_series_id, v_index, v_count, v_total, v_digest,
      p_plan->>'evidenceHash', (p_plan->>'sourceObservedAt')::timestamptz, p_actor, v_card_count, p_plan,
      v_before, v_after);

    v_result := jsonb_build_object('replay', false, 'dryRun', p_dry_run, 'seriesId', v_series_id, 'batch', v_index,
      'planDigest', v_digest, 'before', v_before,
      'inserted', jsonb_build_object('series', case when v_index = 1 and v_claim_series is null then 1 else 0 end,
        'cards', v_card_count, 'canonical', v_card_count, 'printings', v_card_count));
    if p_dry_run then
      raise exception using errcode = 'CJ012', message = 'JP official import dry run rolled back';
    end if;
  exception when sqlstate 'CJ012' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.import_pokemon_jp_official_series(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.import_pokemon_jp_official_series(jsonb, text, boolean) to service_role;

comment on function private.import_pokemon_jp_official_series(jsonb, text, boolean) is
  'Insert-only, all-or-nothing import of one ordered batch (<=100 cards) of a Japanese Pokémon series read from the official card search (ADR 0012); p_dry_run rolls back after full validation.';

