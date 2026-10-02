-- CardScope: correct Japanese Pokémon rarities that differ from the official card
-- page (ADR 0009) and promote pending Japanese cards whose identity the official
-- page confirms (ADR 0008). Both take at most 100 rows, re-check every row, replay
-- with zero changes, and write append-only audit rows.

alter table private.catalog_jp_rarity_audit
  add column if not exists mode text not null default 'fill' check (mode in ('fill', 'correct'));

-- p_plan: { "version": 1, "seriesProviderId": "SV6a", "rows": [ { "printingId": 1, "cardId": "...",
--   "number": "080", "nameJa": "...", "from": "UR", "rarity": "SR", "officialCardId": "46057" } ] }
create or replace function private.correct_pokemon_jp_official_rarity(
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
  v_to_fix integer;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP rarity correction requires an actor';
  end if;
  if (p_plan->>'version') is distinct from '1' or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'JP rarity correction plan must be version 1 with a rows array';
  end if;
  v_count := jsonb_array_length(v_rows);
  if v_count < 1 or v_count > 100 then
    raise exception 'JP rarity correction takes 1 to 100 rows, got %', v_count;
  end if;
  select s.id into v_series_id
  from public.tcg_series s
  where s.source = 'tcgdex-ja' and s.provider_id = v_series_provider_id and s.region = 'JP';
  if v_series_id is null or not private.pokemon_jp_series_imported(v_series_provider_id, v_series_id) then
    raise exception 'JP rarity correction target % is not an imported tcgdex-ja series', v_series_provider_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-rarity:' || lower(v_series_provider_id), 0)
  );

  create temporary table jp_rarity_fix on commit drop as
  select (r->>'printingId')::bigint printing_id, r->>'cardId' card_id, r->>'number' number,
    r->>'nameJa' name_ja, r->>'from' from_rarity, r->>'rarity' rarity, r->>'officialCardId' official_card_id
  from jsonb_array_elements(v_rows) r;

  if (select count(distinct printing_id) from jp_rarity_fix) <> v_count then
    raise exception 'JP rarity correction plan repeats a printing';
  end if;

  -- Each row must still be the same printing, and its rarity must be either the
  -- planned old value (to correct) or already the official value (replay).
  select string_agg(coalesce(x.printing_id::text, '?') || ':' || x.reason, ', ') into v_bad
  from (
    select f.printing_id,
      case
        when p.id is null then 'missing'
        when p.source <> 'tcgdex-ja' or p.region <> 'JP' then 'not-jp'
        when p.series_id <> v_series_id then 'series'
        when p.local_card_number is distinct from f.number then 'number'
        when p.card_id is distinct from f.card_id then 'card'
        when c.name_ja is distinct from f.name_ja then 'name'
        when f.from_rarity is null or f.from_rarity = f.rarity then 'no-change-planned'
        when not exists (select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = f.rarity) then 'rarity-code'
        when p.rarity_code is distinct from f.from_rarity and p.rarity_code is distinct from f.rarity then 'printing-moved'
        when c.rarity is distinct from f.from_rarity and c.rarity is distinct from f.rarity then 'card-moved'
      end reason
    from jp_rarity_fix f
    left join public.tcg_printings p on p.id = f.printing_id
    left join public.tcg_cards c on c.id = p.card_id
  ) x
  where x.reason is not null;
  if v_bad is not null then
    raise exception 'JP rarity correction rejected rows: %', v_bad;
  end if;

  select array_agg(printing_id order by printing_id) into v_ids from jp_rarity_fix;
  select count(*) into v_to_fix from public.tcg_printings p join jp_rarity_fix f on f.printing_id = p.id where p.rarity_code = f.from_rarity;

  v_before := (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'rarity', p.rarity, 'rarity_code', p.rarity_code,
      'data_status', p.data_status, 'card_rarity', c.rarity) order by p.id)
    from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where p.id = any(v_ids));

  begin
    update public.tcg_printings p
    set rarity = f.rarity, rarity_code = f.rarity, rarity_label = f.rarity,
      metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
        'rarityBasis', 'pokemon-card-official-jp', 'officialCardId', f.official_card_id,
        'rarityBeforeOfficial', jsonb_build_object('rarity', p.rarity, 'basis', coalesce(p.metadata->>'rarityBasis', p.source))),
      updated_at = now()
    from jp_rarity_fix f
    where p.id = f.printing_id and p.rarity_code = f.from_rarity;

    update public.tcg_cards c
    set rarity = f.rarity, updated_at = now()
    from jp_rarity_fix f
    where c.id = f.card_id and c.rarity = f.from_rarity;

    v_after := (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'rarity', p.rarity, 'rarity_code', p.rarity_code,
        'data_status', p.data_status, 'card_rarity', c.rarity) order by p.id)
      from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where p.id = any(v_ids));

    if exists (select 1 from jp_rarity_fix f join public.tcg_printings p on p.id = f.printing_id join public.tcg_cards c on c.id = p.card_id
               where p.rarity_code is distinct from f.rarity or c.rarity is distinct from f.rarity) then
      raise exception 'JP rarity correction did not reach the planned state for %', v_series_provider_id;
    end if;

    insert into private.catalog_jp_rarity_audit (game_id, source, series_provider_id, series_id, actor, plan_digest, replay,
      row_count, printing_ids, before_snapshot, after_snapshot, mode)
    values ('pokemon', 'tcgdex-ja', v_series_provider_id, v_series_id, p_actor, v_digest, v_to_fix = 0,
      v_count, v_ids, v_before, v_after, 'correct');

    v_result := jsonb_build_object('dryRun', p_dry_run, 'seriesId', v_series_id, 'planDigest', v_digest,
      'replay', v_to_fix = 0, 'rows', v_count, 'corrected', v_to_fix);
    if p_dry_run then
      raise exception using errcode = 'CJ006', message = 'JP rarity correction dry run rolled back';
    end if;
  exception when sqlstate 'CJ006' then
    null;
  end;
  drop table if exists jp_rarity_fix;
  return v_result;
end;
$$;

revoke all on function private.correct_pokemon_jp_official_rarity(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.correct_pokemon_jp_official_rarity(jsonb, text, boolean) to service_role;

comment on function private.correct_pokemon_jp_official_rarity(jsonb, text, boolean) is
  'Correct up to 100 Japanese Pokémon rarities to the pokemon-card.com value, keeping the old value in metadata (ADR 0009); p_dry_run rolls back.';

-- p_plan: { "version": 1, "seriesProviderId": "SVLN", "rows": [ { "cardId": "...", "number": "005",
--   "nameJa": "...", "officialCardId": "46210" } ] }
create or replace function private.promote_pokemon_jp_official_identity(
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
  v_rows jsonb := p_plan->'rows';
  v_count integer;
  v_ids text[];
  v_bad text;
  v_to_promote integer;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP identity promotion requires an actor';
  end if;
  if (p_plan->>'version') is distinct from '1' or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'JP identity promotion plan must be version 1 with a rows array';
  end if;
  v_count := jsonb_array_length(v_rows);
  if v_count < 1 or v_count > 100 then
    raise exception 'JP identity promotion takes 1 to 100 rows, got %', v_count;
  end if;
  select s.id into v_series_id
  from public.tcg_series s
  where s.source = 'tcgdex-ja' and s.provider_id = v_series_provider_id and s.region = 'JP';
  if v_series_id is null or not private.pokemon_jp_series_imported(v_series_provider_id, v_series_id) then
    raise exception 'JP identity promotion target % is not an imported tcgdex-ja series', v_series_provider_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-status:' || lower(v_series_provider_id), 0)
  );

  create temporary table jp_identity_plan on commit drop as
  select r->>'cardId' card_id, r->>'number' number, r->>'nameJa' name_ja, r->>'officialCardId' official_card_id
  from jsonb_array_elements(v_rows) r;

  if (select count(distinct card_id) from jp_identity_plan) <> v_count then
    raise exception 'JP identity promotion plan repeats a card';
  end if;

  -- The card must be tcgdex-ja in this series with exactly one printing whose number
  -- matches the official page, and the Japanese name must match.
  select string_agg(coalesce(x.card_id, '?') || ':' || x.reason, ', ') into v_bad
  from (
    select pl.card_id,
      case
        when c.id is null then 'missing'
        when c.source <> 'tcgdex-ja' then 'not-jp'
        when c.series_id <> v_series_id then 'series'
        when c.name_ja is distinct from pl.name_ja then 'name'
        when (select count(*) from public.tcg_printings p where p.card_id = c.id) <> 1 then 'printing-count'
        when not exists (select 1 from public.tcg_printings p where p.card_id = c.id and p.series_id = v_series_id
                         and p.local_card_number = pl.number) then 'number'
        when pl.official_card_id is null or btrim(pl.official_card_id) = '' then 'official-id'
      end reason
    from jp_identity_plan pl
    left join public.tcg_cards c on c.id = pl.card_id
  ) x
  where x.reason is not null;
  if v_bad is not null then
    raise exception 'JP identity promotion rejected rows: %', v_bad;
  end if;

  select array_agg(card_id order by card_id collate "C") into v_ids from jp_identity_plan;
  select count(*) into v_to_promote from public.tcg_cards c where c.id = any(v_ids) and c.data_status = 'pending';

  v_before := jsonb_build_object(
    'cards', (select jsonb_agg(jsonb_build_object('id', c.id, 'data_status', c.data_status) order by c.id collate "C")
      from public.tcg_cards c where c.id = any(v_ids)),
    'printings', (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'data_status', p.data_status, 'rarity_code', p.rarity_code) order by p.id)
      from public.tcg_printings p where p.card_id = any(v_ids)));

  begin
    update public.tcg_cards c
    set data_status = 'verified',
      metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('identityBasis', 'pokemon-card-official-jp', 'officialCardId', pl.official_card_id),
      updated_at = now()
    from jp_identity_plan pl
    where c.id = pl.card_id and c.data_status = 'pending';

    update public.tcg_printings p
    set data_status = case when p.rarity_code is not null then 'verified' else 'incomplete' end, updated_at = now()
    where p.card_id = any(v_ids) and p.source = 'tcgdex-ja' and p.data_status = 'pending';

    v_after := jsonb_build_object(
      'cards', (select jsonb_agg(jsonb_build_object('id', c.id, 'data_status', c.data_status) order by c.id collate "C")
        from public.tcg_cards c where c.id = any(v_ids)),
      'printings', (select jsonb_agg(jsonb_build_object('id', p.id, 'card_id', p.card_id, 'data_status', p.data_status, 'rarity_code', p.rarity_code) order by p.id)
        from public.tcg_printings p where p.card_id = any(v_ids)));

    if (select count(*) from public.tcg_cards c where c.id = any(v_ids) and c.data_status = 'verified') <> v_count
      or exists (select 1 from public.tcg_printings p where p.card_id = any(v_ids) and p.data_status = 'pending') then
      raise exception 'JP identity promotion did not reach the planned state for %', v_series_provider_id;
    end if;

    if v_to_promote > 0 then
      insert into private.catalog_jp_status_audit (game_id, source, series_provider_id, series_id, actor, card_count,
        card_ids, before_snapshot, after_snapshot)
      values ('pokemon', 'tcgdex-ja', v_series_provider_id, v_series_id, p_actor, v_count, v_ids, v_before, v_after);
    end if;

    v_result := jsonb_build_object('dryRun', p_dry_run, 'seriesId', v_series_id, 'rows', v_count,
      'promoted', v_to_promote, 'replay', v_to_promote = 0,
      'printings', jsonb_build_object(
        'verified', (select count(*) from public.tcg_printings p where p.card_id = any(v_ids) and p.data_status = 'verified'),
        'incomplete', (select count(*) from public.tcg_printings p where p.card_id = any(v_ids) and p.data_status = 'incomplete')));
    if p_dry_run then
      raise exception using errcode = 'CJ007', message = 'JP identity promotion dry run rolled back';
    end if;
  exception when sqlstate 'CJ007' then
    null;
  end;
  drop table if exists jp_identity_plan;
  return v_result;
end;
$$;

revoke all on function private.promote_pokemon_jp_official_identity(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.promote_pokemon_jp_official_identity(jsonb, text, boolean) to service_role;

comment on function private.promote_pokemon_jp_official_identity(jsonb, text, boolean) is
  'Upgrade-only promotion of up to 100 Japanese Pokémon cards confirmed by the pokemon-card.com card page (ADR 0008); p_dry_run rolls back.';
