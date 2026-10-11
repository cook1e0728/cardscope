-- CardScope：ADR 0035。ADR 0025 把同系列同卡號同名的多個官方詳細頁合併成一張卡，但這些頁面實體上是不同版本
-- （牌組標記、背景紋路等）。本函式把每個額外的官方詳細頁拆成同一作品層下的一張卡（`<原卡 ID>-v<k>`），
-- 名稱、卡號、稀有度沿用原卡，官方 ID、詳細頁網址與官方卡圖用該頁；原卡與新卡都標上「版本 k」。
-- 每次最多 100 張新卡、dry-run、重播零異動、追加式稽核。原卡只新增 metadata 鍵（variantIndex／variantName），不改其他欄位。

create table if not exists private.catalog_jp_variant_split_audit (
  audit_id bigint generated always as identity primary key,
  game_id text not null check (game_id = 'pokemon'),
  rule text not null check (rule = 'adr-0035'),
  actor text not null,
  plan_digest text not null,
  replay boolean not null,
  base_count integer not null check (base_count between 1 and 100),
  variant_count integer not null check (variant_count between 1 and 100),
  plan jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table private.catalog_jp_variant_split_audit enable row level security;
revoke all on table private.catalog_jp_variant_split_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_variant_split_audit to service_role;

drop trigger if exists catalog_jp_variant_split_audit_no_change on private.catalog_jp_variant_split_audit;
create trigger catalog_jp_variant_split_audit_no_change
before update or delete on private.catalog_jp_variant_split_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_variant_split_audit_no_truncate on private.catalog_jp_variant_split_audit;
create trigger catalog_jp_variant_split_audit_no_truncate
before truncate on private.catalog_jp_variant_split_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- p_plan: { "version": 1, "rule": "adr-0035", "rows": [ { "baseCardId": "...", "officialCardIds": ["小", ..., "大"],
--   "variants": [ { "cardId": "<base>-v2", "officialCardId": "...", "index": 2, "imageUrl": "https://www.pokemon-card.com/assets/images/card_images/large/..." } ] } ] }
create or replace function private.split_pokemon_jp_official_variants(
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
  v_digest text := md5(p_plan::text);
  v_bases integer;
  v_variants integer;
  v_bad text;
  v_existing integer;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP variant split requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object' or p_plan->>'version' is distinct from '1' or p_plan->>'rule' is distinct from 'adr-0035'
    or jsonb_typeof(p_plan->'rows') is distinct from 'array' then
    raise exception 'JP variant split plan has an unsupported shape';
  end if;

  drop table if exists jp_variant_plan;
  create temporary table jp_variant_plan on commit drop as
  select r->>'baseCardId' base_id, r->'officialCardIds' official_ids, v->>'cardId' card_id, v->>'officialCardId' official_id,
    (v->>'index')::integer idx, v->>'imageUrl' image_url
  from jsonb_array_elements(p_plan->'rows') r cross join jsonb_array_elements(r->'variants') v;

  select count(distinct base_id), count(*) into v_bases, v_variants from jp_variant_plan;
  if v_bases not between 1 and 100 or v_variants not between 1 and 100
    or (select count(distinct card_id) from jp_variant_plan) <> v_variants
    or (select count(distinct official_id) from jp_variant_plan) <> v_variants then
    raise exception 'JP variant split accepts 1-100 distinct new cards per call';
  end if;

  -- 逐列核對：原卡為日本官方來源、官方 ID 清單與原卡相同（依數字排序）、原卡是第 1 個；新卡 ID、序號、官方 ID、圖片網址一致。
  select coalesce(x.card_id, '<plan>') || ':' || x.reason into v_bad from (
    select pl.card_id,
      case
        when c.id is null then 'base-missing'
        when c.source is distinct from v_source or c.game_id <> 'pokemon' then 'base-source'
        when c.metadata->'officialCardIds' is distinct from pl.official_ids then 'official-ids'
        when (select array_agg(value order by value::bigint) from jsonb_array_elements_text(pl.official_ids)) is distinct from
             (select array_agg(value order by ord) from jsonb_array_elements_text(pl.official_ids) with ordinality t(value, ord)) then 'official-ids-order'
        when c.provider_id is distinct from pl.official_ids->>0 then 'base-provider'
        when pl.idx < 2 or pl.idx > jsonb_array_length(pl.official_ids) then 'index'
        when pl.official_id is distinct from pl.official_ids->>(pl.idx - 1) then 'official-id'
        when pl.card_id is distinct from pl.base_id || '-v' || pl.idx then 'card-id'
        when coalesce(pl.image_url, '') not like 'https://www.pokemon-card.com/assets/images/card_images/large/%' then 'image-url'
        when (select count(*) from public.tcg_printings p where p.card_id = c.id) <> 1 then 'base-printings'
      end reason
    from jp_variant_plan pl left join public.tcg_cards c on c.id = pl.base_id
  ) x where x.reason is not null limit 1;
  if found then
    raise exception 'JP variant split rejected row %', v_bad;
  end if;
  -- 每個原卡的所有額外官方頁都要在同一份計畫裡（不拆一半）。
  if exists (select 1 from jp_variant_plan group by base_id, official_ids having count(*) <> jsonb_array_length(official_ids) - 1) then
    raise exception 'JP variant split must include every extra official page of a base card';
  end if;

  select count(*) into v_existing from public.tcg_cards c join jp_variant_plan pl on pl.card_id = c.id;
  if v_existing = v_variants then
    -- 重播：所有新卡已存在且官方 ID 相符。
    if (select count(*) from public.tcg_cards c join jp_variant_plan pl on pl.card_id = c.id
        where c.provider_id = pl.official_id and c.metadata->>'variantOf' = pl.base_id) <> v_variants then
      raise exception 'JP variant split no longer matches existing variant cards';
    end if;
    v_result := jsonb_build_object('replay', true, 'dryRun', p_dry_run, 'planDigest', v_digest, 'bases', v_bases, 'variants', 0);
    if not p_dry_run then
      insert into private.catalog_jp_variant_split_audit (game_id, rule, actor, plan_digest, replay, base_count, variant_count, plan, before_snapshot, after_snapshot)
      values ('pokemon', 'adr-0035', p_actor, v_digest, true, v_bases, v_variants, p_plan, '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  elsif v_existing > 0 then
    raise exception 'JP variant split collides with % existing card(s)', v_existing;
  end if;
  if exists (select 1 from public.tcg_printings p join jp_variant_plan pl on p.source = v_source and p.provider_id = pl.official_id)
    or exists (select 1 from public.tcg_cards c join jp_variant_plan pl on c.source = v_source and c.provider_id = pl.official_id)
    or exists (select 1 from public.card_images i join jp_variant_plan pl on i.card_id = pl.card_id) then
    raise exception 'JP variant split collides with an existing official ID or image';
  end if;

  v_before := (select jsonb_agg(jsonb_build_object('id', c.id, 'metadata', c.metadata) order by c.id)
    from public.tcg_cards c where c.id in (select base_id from jp_variant_plan));

  begin
    insert into public.tcg_cards (id, canonical_id, game_id, series_id, official_card_number, rarity, rarity_tier,
      name_ja, name_zh, name_en, name_ko, aliases, source, provider_id, search_text, metadata, data_status)
    select pl.card_id, c.canonical_id, c.game_id, c.series_id, c.official_card_number, c.rarity, c.rarity_tier,
      c.name_ja, c.name_zh, c.name_en, c.name_ko, c.aliases, c.source, pl.official_id, c.search_text,
      (c.metadata - 'officialCardIds' - 'sameNameVersions') || jsonb_build_object('officialCardId', pl.official_id,
        'variantOf', c.id, 'variantIndex', pl.idx, 'variantName', '版本 ' || pl.idx, 'variantRule', 'adr-0035'),
      c.data_status
    from jp_variant_plan pl join public.tcg_cards c on c.id = pl.base_id;

    insert into public.tcg_printings (card_id, region, language, local_set_code, local_card_number, image_url, source_url,
      release_date, series_id, rarity, rarity_code, rarity_label, source, provider_id, image_rehost_required, metadata,
      image_rights_status, image_license_expires_at, rights_note, source_locale, data_status)
    select pl.card_id, p.region, p.language, p.local_set_code, p.local_card_number, null,
      'https://www.pokemon-card.com/card-search/details.php/card/' || pl.official_id || '/regu/all',
      p.release_date, p.series_id, p.rarity, p.rarity_code, p.rarity_label, p.source, pl.official_id, p.image_rehost_required,
      (p.metadata - 'officialCardIds' - 'sameNameVersions') || jsonb_build_object('officialCardId', pl.official_id,
        'variantKey', 'v' || pl.idx, 'variantName', '版本 ' || pl.idx),
      p.image_rights_status, p.image_license_expires_at, p.rights_note, p.source_locale, p.data_status
    from jp_variant_plan pl join public.tcg_printings p on p.card_id = pl.base_id;

    insert into public.card_images (card_id, canonical_id, language, source, image_url, source_url, is_primary, image_rights_status, rights_note)
    select pl.card_id, c.canonical_id, 'ja-JP', v_source, pl.image_url,
      'https://www.pokemon-card.com/card-search/details.php/card/' || pl.official_id || '/regu/all', true, 'not-provided', 'ADR 0031'
    from jp_variant_plan pl join public.tcg_cards c on c.id = pl.base_id;

    update public.tcg_cards c set metadata = c.metadata || jsonb_build_object('variantIndex', 1, 'variantName', '版本 1', 'variantRule', 'adr-0035'),
      updated_at = now()
    where c.id in (select base_id from jp_variant_plan);
    update public.tcg_printings p set metadata = p.metadata || jsonb_build_object('variantKey', 'v1', 'variantName', '版本 1'), updated_at = now()
    where p.card_id in (select base_id from jp_variant_plan);

    v_after := jsonb_build_object(
      'cards', (select jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' - 'search_names' order by c.id) from public.tcg_cards c where c.id in (select card_id from jp_variant_plan)),
      'printings', (select count(*) from public.tcg_printings p where p.card_id in (select card_id from jp_variant_plan)),
      'images', (select count(*) from public.card_images i where i.card_id in (select card_id from jp_variant_plan)));
    if jsonb_array_length(v_after->'cards') <> v_variants or (v_after->>'printings')::integer <> v_variants or (v_after->>'images')::integer <> v_variants then
      raise exception 'JP variant split wrote an unexpected row count';
    end if;

    insert into private.catalog_jp_variant_split_audit (game_id, rule, actor, plan_digest, replay, base_count, variant_count, plan, before_snapshot, after_snapshot)
    values ('pokemon', 'adr-0035', p_actor, v_digest, false, v_bases, v_variants, p_plan, coalesce(v_before, '[]'::jsonb), v_after);

    v_result := jsonb_build_object('replay', false, 'dryRun', p_dry_run, 'planDigest', v_digest, 'bases', v_bases, 'variants', v_variants);
    if p_dry_run then
      raise exception using errcode = 'CJ035', message = 'JP variant split dry run rolled back';
    end if;
  exception when sqlstate 'CJ035' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.split_pokemon_jp_official_variants(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.split_pokemon_jp_official_variants(jsonb, text, boolean) to service_role;

comment on function private.split_pokemon_jp_official_variants(jsonb, text, boolean) is
  'ADR 0035: split each extra official detail page of an ADR 0025 merged card into its own card under the same canonical card (版本 k).';
