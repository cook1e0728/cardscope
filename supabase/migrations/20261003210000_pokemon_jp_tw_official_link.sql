-- CardScope: link a Japanese card to the Taiwanese official-search card it took its Chinese
-- name from (ADR 0015, following ADR 0003): the JP card's name basis is
-- tw-official-same-number (ADR 0011), the cited official detail IDs include one of the TW
-- card's versions, series code and card number match, the Chinese names are equal, and the TW
-- card's canonical is not shared yet. The JP card joins the TW card's canonical. Up to 100
-- rows per call, every row re-checked, dry run, replay changes nothing, append-only audit.

create table if not exists private.catalog_jp_tw_link_audit (
  audit_id bigint generated always as identity primary key,
  game_id text not null check (game_id = 'pokemon'),
  rule text not null check (rule = 'adr-0015'),
  actor text not null,
  plan_digest text not null,
  replay boolean not null,
  row_count integer not null check (row_count between 1 and 100),
  card_ids text[] not null,
  plan jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table private.catalog_jp_tw_link_audit enable row level security;
revoke all on table private.catalog_jp_tw_link_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_tw_link_audit to service_role;

drop trigger if exists catalog_jp_tw_link_audit_no_change on private.catalog_jp_tw_link_audit;
create trigger catalog_jp_tw_link_audit_no_change
before update or delete on private.catalog_jp_tw_link_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_tw_link_audit_no_truncate on private.catalog_jp_tw_link_audit;
create trigger catalog_jp_tw_link_audit_no_truncate
before truncate on private.catalog_jp_tw_link_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- p_plan: { "version": 1, "rule": "adr-0015", "rows": [ { "jpCardId": "...", "twCardId": "..." } ] }
create or replace function private.link_pokemon_jp_tw_official(
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
  v_rows jsonb := p_plan->'rows';
  v_digest text := md5(p_plan::text);
  v_count integer;
  v_ids text[];
  v_bad text;
  v_links integer;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP-TW link requires an actor';
  end if;
  if (p_plan->>'version') is distinct from '1' or (p_plan->>'rule') is distinct from 'adr-0015' or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'JP-TW link plan must be version 1, rule adr-0015, with a rows array';
  end if;
  v_count := jsonb_array_length(v_rows);
  if v_count < 1 or v_count > 100 then
    raise exception 'JP-TW link takes 1 to 100 rows, got %', v_count;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cardscope:pokemon-jp-tw-link', 0));

  create temporary table jp_tw_link_plan on commit drop as
  select r->>'jpCardId' jp_id, r->>'twCardId' tw_id from jsonb_array_elements(v_rows) r;

  if (select count(distinct jp_id) from jp_tw_link_plan) <> v_count or (select count(distinct tw_id) from jp_tw_link_plan) <> v_count then
    raise exception 'JP-TW link plan repeats a card';
  end if;

  select string_agg(coalesce(x.jp_id, '?') || ':' || x.reason, ', ') into v_bad
  from (
    select pl.jp_id,
      case
        when j.id is null or t.id is null then 'missing'
        when js.region is distinct from 'JP' or j.game_id <> 'pokemon' then 'jp-region'
        when ts.region is distinct from 'TW' or ts.source is distinct from 'asia-pokemon-card-official-tw' then 'tw-source'
        when j.canonical_id = t.id then null
        when j.canonical_id is distinct from j.id then 'jp-already-linked'
        when coalesce(j.metadata->>'nameZhBasis', '') <> 'tw-official-same-number' then 'jp-name-basis'
        when upper(js.official_code) is distinct from upper(ts.official_code) then 'series-code'
        when j.official_card_number is distinct from t.official_card_number then 'number'
        when j.name_zh is distinct from t.name_zh then 'name'
        when t.canonical_id is distinct from t.id then 'tw-canonical'
        when exists (select 1 from public.tcg_cards o where o.canonical_id = t.id and o.id <> t.id) then 'tw-canonical-shared'
        when not exists (
          select 1 from jsonb_array_elements_text(coalesce(j.metadata->'nameZhOfficialDetailIds', '[]'::jsonb)) a
          join jsonb_array_elements_text(coalesce(t.metadata->'officialDetailIds', '[]'::jsonb)) b on a = b) then 'detail-id'
      end reason
    from jp_tw_link_plan pl
    left join public.tcg_cards j on j.id = pl.jp_id
    left join public.tcg_series js on js.id = j.series_id
    left join public.tcg_cards t on t.id = pl.tw_id
    left join public.tcg_series ts on ts.id = t.series_id
  ) x
  where x.reason is not null;
  if v_bad is not null then
    raise exception 'JP-TW link rejected rows: %', v_bad;
  end if;

  select array_agg(jp_id order by jp_id) into v_ids from jp_tw_link_plan;
  select count(*) filter (where j.canonical_id is distinct from pl.tw_id) into v_links
  from jp_tw_link_plan pl join public.tcg_cards j on j.id = pl.jp_id;

  v_before := (select jsonb_agg(jsonb_build_object('id', j.id, 'canonical_id', j.canonical_id) order by j.id)
    from public.tcg_cards j where j.id = any(v_ids));

  begin
    update public.tcg_cards j
    set canonical_id = pl.tw_id,
      metadata = coalesce(j.metadata, '{}'::jsonb) || jsonb_build_object('linkedCardId', pl.tw_id, 'linkBasis', 'tw-official-detail-id', 'linkRule', 'adr-0015'),
      updated_at = now()
    from jp_tw_link_plan pl
    where j.id = pl.jp_id and j.canonical_id is distinct from pl.tw_id;

    v_after := (select jsonb_agg(jsonb_build_object('id', j.id, 'canonical_id', j.canonical_id) order by j.id)
      from public.tcg_cards j where j.id = any(v_ids));

    if exists (select 1 from jp_tw_link_plan pl join public.tcg_cards j on j.id = pl.jp_id where j.canonical_id is distinct from pl.tw_id) then
      raise exception 'JP-TW link did not reach the planned state';
    end if;

    insert into private.catalog_jp_tw_link_audit (game_id, rule, actor, plan_digest, replay, row_count, card_ids, plan, before_snapshot, after_snapshot)
    values ('pokemon', 'adr-0015', p_actor, v_digest, v_links = 0, v_count, v_ids, p_plan, v_before, v_after);

    v_result := jsonb_build_object('dryRun', p_dry_run, 'planDigest', v_digest, 'replay', v_links = 0, 'rows', v_count, 'links', v_links);
    if p_dry_run then
      raise exception using errcode = 'CJ016', message = 'JP-TW link dry run rolled back';
    end if;
  exception when sqlstate 'CJ016' then
    null;
  end;
  drop table if exists jp_tw_link_plan;
  return v_result;
end;
$$;

revoke all on function private.link_pokemon_jp_tw_official(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.link_pokemon_jp_tw_official(jsonb, text, boolean) to service_role;

comment on function private.link_pokemon_jp_tw_official(jsonb, text, boolean) is
  'Link Japanese cards named from Taiwanese official same-number cards (ADR 0011) to the imported Taiwanese official-search card (ADR 0015); p_dry_run rolls back.';
