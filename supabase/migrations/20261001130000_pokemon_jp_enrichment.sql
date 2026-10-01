-- CardScope: audited enrichment of already-imported Japanese Pokémon cards.
-- Design: docs/adr/0003-jp-tw-canonical-linking.md and GLOSSARY.md
-- (Canonical card, Derived name). One call enriches one imported tcgdex-ja
-- series, filling only empty values:
--   * link a JP card into the Taiwanese card's canonical when both carry the
--     same Provider ID in the same series code, and copy its official name_zh;
--   * give a JP card a Derived name (same series, identical name_ja);
--   * set a missing rarity;
--   * give the JP series the Taiwanese series' official name_zh.
-- Nothing is overwritten. A replay of the same plan records a replay audit
-- row and changes nothing.

-- ACE SPEC cards print the rarity mark "ACE" in Japan; TCGdex calls it
-- "ACE SPEC Rare". Keep the tier order aligned with data/rarity-rankings.json
-- (ACE sits between RR and Rare Holo).
do $$
begin
  if not exists (
    select 1 from public.tcg_rarities
    where game_id = 'pokemon' and rarity_code = 'ACE'
  ) then
    update public.tcg_rarities
    set rarity_tier = rarity_tier + 1
    where game_id = 'pokemon' and rarity_tier >= 14;
  end if;

  insert into public.tcg_rarities (
    game_id, rarity_code, rarity_label, rarity_tier, source, source_url, data_status, metadata
  ) values (
    'pokemon', 'ACE', 'ACE', 14, 'pokemon-card-official-jp',
    'https://www.pokemon-card.com/card-search/index.php?mode=statuslist', 'verified',
    '{"aliases":["ACE SPEC Rare"],"meaningZh":"ACE SPEC"}'::jsonb
  )
  on conflict (game_id, rarity_code) do update
  set rarity_label = excluded.rarity_label,
      rarity_tier = excluded.rarity_tier,
      source = excluded.source,
      source_url = excluded.source_url,
      data_status = excluded.data_status,
      metadata = excluded.metadata;
end
$$;

create table if not exists private.catalog_jp_enrich_audit (
  audit_id bigint generated always as identity primary key,
  kind text not null check (kind in ('enrich', 'replay')),
  game_id text not null check (game_id = 'pokemon'),
  source text not null check (source = 'tcgdex-ja'),
  series_provider_id text not null,
  series_id text not null,
  plan_digest text not null check (plan_digest ~ '^[0-9a-f]{64}$'),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  actor text not null,
  card_count integer not null check (card_count between 0 and 100),
  plan jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists catalog_jp_enrich_audit_one_enrich_per_plan
  on private.catalog_jp_enrich_audit (series_provider_id, plan_digest)
  where kind = 'enrich';

alter table private.catalog_jp_enrich_audit enable row level security;
revoke all on table private.catalog_jp_enrich_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_enrich_audit to service_role;

comment on table private.catalog_jp_enrich_audit is
  'Append-only plan, before/after snapshot and replay log for Japanese Pokémon enrichment (links, names, rarities).';

drop trigger if exists catalog_jp_enrich_audit_no_change on private.catalog_jp_enrich_audit;
create trigger catalog_jp_enrich_audit_no_change
before update or delete on private.catalog_jp_enrich_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_enrich_audit_no_truncate on private.catalog_jp_enrich_audit;
create trigger catalog_jp_enrich_audit_no_truncate
before truncate on private.catalog_jp_enrich_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- True when every change in the plan is already present.
create or replace function private.pokemon_jp_enrich_plan_applied(p_plan jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1
    from jsonb_array_elements(p_plan->'cards') c
    join public.tcg_cards j on j.id = c->>'id'
    left join public.tcg_cards t on t.id = c->>'link'
    where (c->>'name_zh' is not null and j.name_zh is distinct from c->>'name_zh')
      or (c->>'link' is not null and j.canonical_id is distinct from t.canonical_id)
      or (c->>'rarity_code' is not null and j.rarity is distinct from c->>'rarity_code')
  )
  and (
    p_plan->'series' is null or jsonb_typeof(p_plan->'series') = 'null'
    or exists (
      select 1 from public.tcg_series s
      where s.id = p_plan->>'seriesId' and s.name_zh = p_plan->'series'->>'name_zh'
    )
  );
$$;

revoke all on function private.pokemon_jp_enrich_plan_applied(jsonb) from public, anon, authenticated;

create or replace function private.enrich_pokemon_jp_metadata(
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
  v_digest text;
  v_code text;
  v_series_id text;
  v_card_count integer;
  v_bad text;
  v_before jsonb;
  v_after jsonb;
  v_changed jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP enrichment requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'planVersion' is distinct from '1'
    or p_plan->>'kind' is distinct from 'jp-enrich'
    or p_plan->>'source' is distinct from 'tcgdex-ja'
    or jsonb_typeof(p_plan->'cards') is distinct from 'array'
    or coalesce(p_plan->>'evidenceHash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'JP enrichment plan has an unsupported shape';
  end if;

  v_digest := encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
  v_code := p_plan->>'seriesProviderId';
  v_series_id := p_plan->>'seriesId';
  v_card_count := jsonb_array_length(p_plan->'cards');
  if v_card_count > 100 then
    raise exception 'JP enrichment accepts at most 100 cards, got %', v_card_count;
  end if;

  if not exists (
    select 1 from public.tcg_series s
    where s.id = v_series_id and s.source = 'tcgdex-ja' and s.provider_id = v_code and s.region = 'JP'
  ) or not exists (
    select 1 from private.catalog_jp_import_audit a
    where a.kind = 'import' and a.series_provider_id = v_code and a.series_id = v_series_id
  ) then
    raise exception 'JP enrichment target % is not an imported tcgdex-ja series', v_code;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cardscope:pokemon-jp-enrich:' || lower(v_code), 0)
  );

  if exists (
    select 1 from private.catalog_jp_enrich_audit a
    where a.kind = 'enrich' and a.series_provider_id = v_code and a.plan_digest = v_digest
  ) then
    if not private.pokemon_jp_enrich_plan_applied(p_plan) then
      raise exception 'JP series % no longer matches enrichment plan %', v_code, v_digest;
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'seriesId', v_series_id,
      'planDigest', v_digest, 'changed', jsonb_build_object('cards', 0, 'links', 0, 'derived', 0, 'rarities', 0, 'series', 0));
    if not p_dry_run then
      insert into private.catalog_jp_enrich_audit (kind, game_id, source, series_provider_id, series_id, plan_digest,
        evidence_hash, actor, card_count, plan, before_snapshot, after_snapshot)
      values ('replay', 'pokemon', 'tcgdex-ja', v_code, v_series_id, v_digest, p_plan->>'evidenceHash', p_actor,
        v_card_count, p_plan, '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  end if;

  if (select count(distinct c->>'id') from jsonb_array_elements(p_plan->'cards') c) <> v_card_count then
    raise exception 'JP enrichment plan repeats a card';
  end if;

  -- Every entry must name a JP card of this series, match its Japanese name,
  -- fill only empty values and carry a consistent name basis.
  select coalesce(c->>'id', '<missing id>') into v_bad
  from jsonb_array_elements(p_plan->'cards') c
  left join public.tcg_cards j on j.id = c->>'id'
  where j.id is null
    or j.series_id is distinct from v_series_id
    or j.source is distinct from 'tcgdex-ja'
    or j.name_ja is distinct from c->>'name_ja'
    or (c->>'link' is null and c->>'name_zh' is null and c->>'rarity_code' is null)
    or (c->>'name_zh' is not null and (j.name_zh is not null or btrim(c->>'name_zh') = ''))
    or (c->>'name_zh' is null) <> (c->>'basis' is null)
    or (c->>'basis' is not null and c->>'basis' not in ('tw-official', 'derived-same-name'))
    or ((c->>'link' is not null) <> (c->>'basis' is not distinct from 'tw-official'))
    or (c->>'link' is not null and j.canonical_id is distinct from j.id)
    or (c->>'rarity_code' is not null and (
      j.rarity is not null
      or not exists (select 1 from public.tcg_rarities r where r.game_id = 'pokemon' and r.rarity_code = c->>'rarity_code')
      or exists (select 1 from public.tcg_printings p where p.card_id = j.id and p.rarity_code is not null)))
  limit 1;
  if found then
    raise exception 'JP enrichment entry is invalid for %', v_bad;
  end if;

  -- Links: same Provider ID, same series code, the Taiwanese card's official
  -- name, and a canonical that no other card shares yet (ADR 0003).
  select c->>'id' into v_bad
  from jsonb_array_elements(p_plan->'cards') c
  join public.tcg_cards j on j.id = c->>'id'
  left join public.tcg_cards t on t.id = c->>'link'
  left join public.tcg_series ts on ts.id = t.series_id
  where c->>'link' is not null and (
    t.id is null
    or t.game_id is distinct from 'pokemon'
    or ts.region is distinct from 'TW'
    or upper(ts.official_code) is distinct from upper(v_code)
    or t.provider_id is distinct from j.provider_id
    or t.name_zh is distinct from c->>'name_zh'
    or t.canonical_id is distinct from t.id
    or (select count(*) from public.tcg_cards o where o.canonical_id = t.canonical_id) <> 1)
  limit 1;
  if found then
    raise exception 'JP enrichment link is not proven for %', v_bad;
  end if;

  -- Derived names: an identical Japanese name in the same series that holds
  -- (or receives in this plan) the same official Taiwanese name.
  select c->>'id' into v_bad
  from jsonb_array_elements(p_plan->'cards') c
  where c->>'basis' = 'derived-same-name'
    and not exists (
      select 1 from jsonb_array_elements(p_plan->'cards') l
      where l->>'basis' = 'tw-official' and l->>'name_ja' = c->>'name_ja' and l->>'name_zh' = c->>'name_zh')
    and not exists (
      select 1 from public.tcg_cards k
      where k.series_id = v_series_id and k.name_ja = c->>'name_ja' and k.name_zh = c->>'name_zh'
        and k.metadata->>'nameZhBasis' = 'tw-official')
  limit 1;
  if found then
    raise exception 'JP enrichment derived name has no official source for %', v_bad;
  end if;

  if p_plan->'series' is not null and jsonb_typeof(p_plan->'series') <> 'null' and not exists (
    select 1
    from public.tcg_series s
    join public.tcg_series ts on ts.id = p_plan->'series'->>'twSeriesId'
    where s.id = v_series_id and s.name_zh is null
      and ts.region = 'TW' and ts.game_id = 'pokemon'
      and upper(ts.official_code) = upper(v_code)
      and ts.name_zh = p_plan->'series'->>'name_zh'
  ) then
    raise exception 'JP enrichment series name is not proven for %', v_code;
  end if;

  v_before := jsonb_build_object(
    'series', (select to_jsonb(s) - 'created_at' - 'updated_at' from public.tcg_series s where s.id = v_series_id),
    'cards', (select jsonb_agg(to_jsonb(j) - 'created_at' - 'updated_at' order by j.id)
      from public.tcg_cards j where j.id in (select c->>'id' from jsonb_array_elements(p_plan->'cards') c)),
    'linkedCanonicals', (select jsonb_agg(to_jsonb(k) - 'created_at' - 'updated_at' order by k.id)
      from public.tcg_canonical_cards k
      where k.id in (select c->>'link' from jsonb_array_elements(p_plan->'cards') c where c->>'link' is not null)),
    'printings', (select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.id)
      from public.tcg_printings p
      where p.card_id in (select c->>'id' from jsonb_array_elements(p_plan->'cards') c where c->>'rarity_code' is not null))
  );

  begin
    update public.tcg_cards j
    set canonical_id = coalesce(t.canonical_id, j.canonical_id),
        name_zh = coalesce(c.value->>'name_zh', j.name_zh),
        rarity = coalesce(c.value->>'rarity_code', j.rarity),
        rarity_tier = case when c.value->>'rarity_code' is not null then r.rarity_tier else j.rarity_tier end,
        metadata = j.metadata
          || case when c.value->>'basis' is null then '{}'::jsonb
               else jsonb_build_object('nameZhBasis', c.value->>'basis',
                 'nameZhSourceCardId', coalesce(c.value->>'link', (
                   select min(l->>'id') from jsonb_array_elements(p_plan->'cards') l
                   where l->>'basis' = 'tw-official' and l->>'name_ja' = c.value->>'name_ja'
                     and l->>'name_zh' = c.value->>'name_zh'), (
                   select min(k.id) from public.tcg_cards k
                   where k.series_id = v_series_id and k.name_ja = c.value->>'name_ja'
                     and k.name_zh = c.value->>'name_zh' and k.metadata->>'nameZhBasis' = 'tw-official')),
                 'nameZhEvidenceHash', p_plan->>'evidenceHash') end
          || case when c.value->>'link' is null then '{}'::jsonb
               else jsonb_build_object('linkedCardId', c.value->>'link', 'linkBasis', 'same-provider-id-and-series-code') end,
        updated_at = now()
    from jsonb_array_elements(p_plan->'cards') c
    left join public.tcg_cards t on t.id = c.value->>'link'
    left join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c.value->>'rarity_code'
    where j.id = c.value->>'id';

    update public.tcg_printings p
    set rarity = r.rarity_code, rarity_code = r.rarity_code, rarity_label = r.rarity_label, updated_at = now()
    from jsonb_array_elements(p_plan->'cards') c
    join public.tcg_rarities r on r.game_id = 'pokemon' and r.rarity_code = c.value->>'rarity_code'
    where p.card_id = c.value->>'id' and c.value->>'rarity_code' is not null;

    if p_plan->'series' is not null and jsonb_typeof(p_plan->'series') <> 'null' then
      update public.tcg_series s
      set name_zh = p_plan->'series'->>'name_zh',
          metadata = s.metadata || jsonb_build_object('nameZhBasis', 'tw-official',
            'nameZhSourceSeriesId', p_plan->'series'->>'twSeriesId', 'nameZhEvidenceHash', p_plan->>'evidenceHash'),
          updated_at = now()
      where s.id = v_series_id;
    end if;

    if not private.pokemon_jp_enrich_plan_applied(p_plan) then
      raise exception 'JP enrichment did not reach the planned state for %', v_code;
    end if;

    v_after := jsonb_build_object(
      'series', (select to_jsonb(s) - 'created_at' - 'updated_at' from public.tcg_series s where s.id = v_series_id),
      'cards', (select jsonb_agg(to_jsonb(j) - 'created_at' - 'updated_at' order by j.id)
        from public.tcg_cards j where j.id in (select c->>'id' from jsonb_array_elements(p_plan->'cards') c)),
      'linkedCanonicals', (select jsonb_agg(to_jsonb(k) - 'created_at' - 'updated_at' order by k.id)
        from public.tcg_canonical_cards k
        where k.id in (select c->>'link' from jsonb_array_elements(p_plan->'cards') c where c->>'link' is not null)),
      'printings', (select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.id)
        from public.tcg_printings p
        where p.card_id in (select c->>'id' from jsonb_array_elements(p_plan->'cards') c where c->>'rarity_code' is not null))
    );

    v_changed := jsonb_build_object(
      'cards', v_card_count,
      'links', (select count(*) from jsonb_array_elements(p_plan->'cards') c where c->>'link' is not null),
      'derived', (select count(*) from jsonb_array_elements(p_plan->'cards') c where c->>'basis' = 'derived-same-name'),
      'rarities', (select count(*) from jsonb_array_elements(p_plan->'cards') c where c->>'rarity_code' is not null),
      'series', case when p_plan->'series' is not null and jsonb_typeof(p_plan->'series') <> 'null' then 1 else 0 end);

    insert into private.catalog_jp_enrich_audit (kind, game_id, source, series_provider_id, series_id, plan_digest,
      evidence_hash, actor, card_count, plan, before_snapshot, after_snapshot)
    values ('enrich', 'pokemon', 'tcgdex-ja', v_code, v_series_id, v_digest, p_plan->>'evidenceHash', p_actor,
      v_card_count, p_plan, v_before, v_after);

    v_result := jsonb_build_object('replay', false, 'dryRun', p_dry_run, 'seriesId', v_series_id,
      'planDigest', v_digest, 'changed', v_changed);
    if p_dry_run then
      raise exception using errcode = 'CJ002', message = 'JP enrichment dry run rolled back';
    end if;
  exception when sqlstate 'CJ002' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.enrich_pokemon_jp_metadata(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.enrich_pokemon_jp_metadata(jsonb, text, boolean) to service_role;
grant execute on function private.pokemon_jp_enrich_plan_applied(jsonb) to service_role;

comment on function private.enrich_pokemon_jp_metadata(jsonb, text, boolean) is
  'Fill-only, all-or-nothing enrichment (TW canonical links, official or derived name_zh, missing rarity, series name_zh) for one imported Japanese Pokémon series; p_dry_run rolls back after full validation.';
