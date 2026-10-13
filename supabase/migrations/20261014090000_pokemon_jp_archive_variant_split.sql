-- CardScope：ADR 0039。ADR 0035 只處理日本官方來源（`pokemon-card-official-jp`）的原卡；S9a／S10a／S11a／S12a 是
-- Source archive（`tcgdex-ja`）匯入的系列，同系列標記＋同卡號＋同日文名＋同稀有度圖示的兩個官方詳細頁，資料庫只有一張原卡。
-- 本函式把每個額外的官方詳細頁拆成同一作品層下的一張卡（`<原卡 ID>-v<k>`，來源 `pokemon-card-official-jp`、
-- Provider ID 為官方卡片 ID），卡號、日文名、中文名（含依據）、稀有度沿用原卡，詳細頁網址與官方卡圖（ADR 0031）用該頁自己的。
-- 原卡（`tcgdex-ja`）只新增 metadata 鍵（officialCardIds／variantIndex／variantName／variantRule）；原卡沒有任何
-- `card_images` 時補上版本 1 那一頁的官方卡圖，已有圖則不動。
-- 每次最多 100 張新卡、dry-run、重播零異動、追加式稽核。

create table if not exists private.catalog_jp_archive_variant_audit (
  audit_id bigint generated always as identity primary key,
  game_id text not null check (game_id = 'pokemon'),
  rule text not null check (rule = 'adr-0039'),
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

alter table private.catalog_jp_archive_variant_audit enable row level security;
revoke all on table private.catalog_jp_archive_variant_audit from public, anon, authenticated, service_role;
grant select, insert on table private.catalog_jp_archive_variant_audit to service_role;

drop trigger if exists catalog_jp_archive_variant_audit_no_change on private.catalog_jp_archive_variant_audit;
create trigger catalog_jp_archive_variant_audit_no_change
before update or delete on private.catalog_jp_archive_variant_audit
for each row execute function private.reject_catalog_jp_import_audit_mutation();

drop trigger if exists catalog_jp_archive_variant_audit_no_truncate on private.catalog_jp_archive_variant_audit;
create trigger catalog_jp_archive_variant_audit_no_truncate
before truncate on private.catalog_jp_archive_variant_audit
for each statement execute function private.reject_catalog_jp_import_audit_mutation();

-- p_plan: { "version": 1, "rule": "adr-0039", "rows": [ { "baseCardId": "...", "seriesCode": "S9a", "number": "001", "nameJa": "...",
--   "officialCardIds": ["小", ..., "大"],
--   "baseOfficial": { "officialCardId": "小", "imageUrl": "https://www.pokemon-card.com/assets/images/card_images/large/...", "sourceUrl": "https://www.pokemon-card.com/card-search/details.php/card/小/regu/all" },
--   "variants": [ { "cardId": "<base>-v2", "officialCardId": "...", "variantIndex": 2, "variantName": "版本 2" 或 "版本 2（ミラー）",
--     "imageUrl": "https://www.pokemon-card.com/assets/images/card_images/large/...", "sourceUrl": "https://www.pokemon-card.com/card-search/details.php/card/.../regu/all" } ] } ] }
create or replace function private.split_pokemon_jp_archive_variants(
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
  v_archive constant text := 'tcgdex-ja';
  v_image_prefix constant text := 'https://www.pokemon-card.com/assets/images/card_images/large/';
  v_page_prefix constant text := 'https://www.pokemon-card.com/card-search/details.php/card/';
  v_digest text := encode(pg_catalog.sha256(convert_to(p_plan::text, 'UTF8')), 'hex');
  v_bases integer;
  v_variants integer;
  v_base_images integer;
  v_bad text;
  v_existing integer;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_cards integer;
  v_printings integer;
  v_images integer;
  v_inserted_base_images integer;
  v_updated_cards integer;
  v_updated_printings integer;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'JP archive variant split requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object' or p_plan->>'version' is distinct from '1' or p_plan->>'rule' is distinct from 'adr-0039'
    or jsonb_typeof(p_plan->'rows') is distinct from 'array' then
    raise exception 'JP archive variant split plan has an unsupported shape';
  end if;
  -- 逐列形狀：物件、非空文字欄位、官方 ID 清單／原卡官方頁／版本清單的型別；通過後才檢查長度與元素，再展開成暫存表。
  if exists (
    select 1 from jsonb_array_elements(p_plan->'rows') r
    where jsonb_typeof(r) is distinct from 'object'
      or jsonb_typeof(r->'officialCardIds') is distinct from 'array'
      or jsonb_typeof(r->'baseOfficial') is distinct from 'object'
      or jsonb_typeof(r->'variants') is distinct from 'array'
      or coalesce(r->>'baseCardId', '') = '' or coalesce(r->>'seriesCode', '') = '' or coalesce(r->>'number', '') = '' or coalesce(r->>'nameJa', '') = ''
  ) then
    raise exception 'JP archive variant split plan has an unsupported shape';
  end if;
  -- 至少 2 個官方 ID（全是數字字串）、至少 1 個版本，每個版本的欄位齊全。
  if exists (
    select 1 from jsonb_array_elements(p_plan->'rows') r
    where jsonb_array_length(r->'officialCardIds') < 2 or jsonb_array_length(r->'variants') < 1
      or exists (select 1 from jsonb_array_elements(r->'officialCardIds') o where jsonb_typeof(o) is distinct from 'string' or (o #>> '{}') !~ '^[0-9]{1,9}$')
      or exists (select 1 from jsonb_array_elements(r->'variants') v
        where jsonb_typeof(v) is distinct from 'object' or coalesce(v->>'variantIndex', '') !~ '^[0-9]{1,3}$'
          or coalesce(v->>'cardId', '') = '' or coalesce(v->>'officialCardId', '') = '' or coalesce(v->>'variantName', '') = ''
          or coalesce(v->>'imageUrl', '') = '' or coalesce(v->>'sourceUrl', '') = '')
  ) then
    raise exception 'JP archive variant split plan has an unsupported shape';
  end if;

  drop table if exists jp_archive_variant_plan;
  create temporary table jp_archive_variant_plan on commit drop as
  select r->>'baseCardId' base_id, r->>'seriesCode' series_code, r->>'number' num, r->>'nameJa' name_ja,
    r->'officialCardIds' official_ids, r->'baseOfficial'->>'officialCardId' base_official_id,
    r->'baseOfficial'->>'imageUrl' base_image_url, r->'baseOfficial'->>'sourceUrl' base_source_url,
    v->>'cardId' card_id, v->>'officialCardId' official_id, (v->>'variantIndex')::integer idx,
    v->>'variantName' variant_name, v->>'imageUrl' image_url, v->>'sourceUrl' source_url
  from jsonb_array_elements(p_plan->'rows') r cross join jsonb_array_elements(r->'variants') v;

  select count(distinct base_id), count(*) into v_bases, v_variants from jp_archive_variant_plan;
  if v_bases not between 1 and 100 or v_variants not between 1 and 100
    or v_bases <> jsonb_array_length(p_plan->'rows')
    or (select count(distinct card_id) from jp_archive_variant_plan) <> v_variants
    or (select count(distinct official_id) from jp_archive_variant_plan) <> v_variants then
    raise exception 'JP archive variant split accepts 1-100 distinct new cards per call';
  end if;
  -- 整份計畫裡每個官方卡片 ID 只能出現一次（原卡那一頁與各版本頁都不重複）。
  if (select count(*) <> count(distinct o) from (
        select jsonb_array_elements_text(b.official_ids) o from (select distinct base_id, official_ids from jp_archive_variant_plan) b) x) then
    raise exception 'JP archive variant split official IDs must be unique across the plan';
  end if;

  -- 逐列核對：原卡為 tcgdex-ja 的寶可夢卡、日文名相符、日版 Printing 恰好一筆且系列代碼／卡號相符、官方 ID 清單與原卡相同（依數字排序）、
  -- 新卡 ID／序號／官方 ID／版本名稱／圖片與詳細頁網址一致（檔名帶 _m 才可標「（ミラー）」）。
  select coalesce(x.card_id, '<plan>') || ':' || x.reason into v_bad from (
    select pl.card_id,
      case
        when c.id is null then 'base-missing'
        when c.source is distinct from v_archive or c.game_id <> 'pokemon' then 'base-source'
        when c.name_ja is distinct from pl.name_ja then 'base-name'
        when jp.n <> 1 then 'base-printings'
        when jp.src is distinct from v_archive then 'base-printing-source'
        when jp.code is distinct from pl.series_code or jp.num is distinct from pl.num then 'base-printing-number'
        when c.metadata->'officialCardIds' is not null and c.metadata->'officialCardIds' is distinct from pl.official_ids then 'official-ids'
        when (select array_agg(value order by value::bigint) from jsonb_array_elements_text(pl.official_ids)) is distinct from
             (select array_agg(value order by ord) from jsonb_array_elements_text(pl.official_ids) with ordinality t(value, ord)) then 'official-ids-order'
        when pl.idx < 2 or pl.idx > jsonb_array_length(pl.official_ids) then 'index'
        when pl.official_id is distinct from pl.official_ids->>(pl.idx - 1) then 'official-id'
        when pl.base_official_id is distinct from pl.official_ids->>0 then 'base-official-id'
        when pl.card_id is distinct from pl.base_id || '-v' || pl.idx then 'card-id'
        when pl.variant_name is distinct from '版本 ' || pl.idx || case when right(pl.image_url, 6) = '_m.jpg' then '（ミラー）' else '' end then 'variant-name'
        when pl.image_url !~ '^https://www\.pokemon-card\.com/assets/images/card_images/large/[A-Za-z0-9_/.-]+\.jpg$' then 'image-url'
        when pl.base_image_url !~ '^https://www\.pokemon-card\.com/assets/images/card_images/large/[A-Za-z0-9_/.-]+\.jpg$' then 'base-image-url'
        when pl.source_url is distinct from v_page_prefix || pl.official_id || '/regu/all' then 'source-url'
        when pl.base_source_url is distinct from v_page_prefix || pl.base_official_id || '/regu/all' then 'base-source-url'
      end reason
    from jp_archive_variant_plan pl
    left join public.tcg_cards c on c.id = pl.base_id
    left join lateral (
      select count(*) n, min(p.local_set_code) code, min(p.local_card_number) num, min(p.source) src
      from public.tcg_printings p where p.card_id = pl.base_id and p.region = 'JP'
    ) jp on true
  ) x where x.reason is not null limit 1;
  if found then
    raise exception 'JP archive variant split rejected row %', v_bad;
  end if;
  -- 每個原卡的所有額外官方頁都要在同一份計畫裡（不拆一半）。
  if exists (select 1 from jp_archive_variant_plan group by base_id, official_ids having count(*) <> jsonb_array_length(official_ids) - 1) then
    raise exception 'JP archive variant split must include every extra official page of a base card';
  end if;

  select count(*) into v_existing from public.tcg_cards c join jp_archive_variant_plan pl on pl.card_id = c.id;
  if v_existing = v_variants then
    -- 重播：所有新卡已存在、官方 ID 與版本序號相符、各有一筆日版 Printing，且每個原卡已記下相同的 officialCardIds。
    if (select count(*) from public.tcg_cards c join jp_archive_variant_plan pl on pl.card_id = c.id
        where c.source = v_source and c.provider_id = pl.official_id and c.metadata->>'variantOf' = pl.base_id
          and c.metadata->>'variantIndex' = pl.idx::text and c.metadata->>'variantRule' = 'adr-0039') <> v_variants
      or (select count(*) from public.tcg_printings p join jp_archive_variant_plan pl on pl.card_id = p.card_id
        where p.source = v_source and p.provider_id = pl.official_id and p.region = 'JP') <> v_variants
      or exists (select 1 from (select distinct base_id, official_ids from jp_archive_variant_plan) b
        join public.tcg_cards c on c.id = b.base_id where c.metadata->'officialCardIds' is distinct from b.official_ids) then
      raise exception 'JP archive variant split no longer matches existing variant cards';
    end if;
    v_result := jsonb_build_object('dryRun', p_dry_run, 'replay', true, 'planDigest', v_digest,
      'inserted', jsonb_build_object('cards', 0, 'printings', 0, 'images', 0, 'baseImages', 0),
      'updated', jsonb_build_object('baseCards', 0, 'basePrintings', 0));
    if not p_dry_run then
      insert into private.catalog_jp_archive_variant_audit (game_id, rule, actor, plan_digest, replay, base_count, variant_count, plan, before_snapshot, after_snapshot)
      values ('pokemon', 'adr-0039', p_actor, v_digest, true, v_bases, v_variants, p_plan, '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  elsif v_existing > 0 then
    raise exception 'JP archive variant split collides with % existing card(s)', v_existing;
  end if;
  -- 官方 ID（原卡那一頁與各版本頁）不得已被任何官方來源卡片或 Printing 使用；新卡也不得已有卡圖。
  if exists (select 1 from public.tcg_printings p where p.source = v_source and p.provider_id in (
        select jsonb_array_elements_text(b.official_ids) from (select distinct official_ids from jp_archive_variant_plan) b))
    or exists (select 1 from public.tcg_cards c where c.source = v_source and c.provider_id in (
        select jsonb_array_elements_text(b.official_ids) from (select distinct official_ids from jp_archive_variant_plan) b))
    or exists (select 1 from public.card_images i join jp_archive_variant_plan pl on i.card_id = pl.card_id) then
    raise exception 'JP archive variant split collides with an existing official ID or image';
  end if;

  select count(*) into v_base_images from (select distinct base_id from jp_archive_variant_plan) b
  where not exists (select 1 from public.card_images i where i.card_id = b.base_id);

  v_before := (select jsonb_agg(jsonb_build_object('id', c.id, 'metadata', c.metadata,
      'printingMetadata', (select p.metadata from public.tcg_printings p where p.card_id = c.id and p.region = 'JP'),
      'hasImage', exists (select 1 from public.card_images i where i.card_id = c.id)) order by c.id)
    from public.tcg_cards c where c.id in (select base_id from jp_archive_variant_plan));

  begin
    insert into public.tcg_cards (id, canonical_id, game_id, series_id, official_card_number, rarity, rarity_tier,
      name_ja, name_zh, name_en, name_ko, aliases, source, provider_id, search_text, metadata, data_status)
    select pl.card_id, c.canonical_id, c.game_id, c.series_id, c.official_card_number, c.rarity, c.rarity_tier,
      c.name_ja, c.name_zh, c.name_en, c.name_ko, c.aliases, v_source, pl.official_id, c.search_text,
      (c.metadata - 'officialCardIds' - 'seedHash' - 'tcgdexId' - 'sourceHash' - 'manifestHash' - 'sourceEvidence') || jsonb_build_object(
        'officialCardId', pl.official_id, 'variantOf', c.id, 'variantIndex', pl.idx, 'variantName', pl.variant_name, 'variantRule', 'adr-0039'),
      c.data_status
    from jp_archive_variant_plan pl join public.tcg_cards c on c.id = pl.base_id;
    get diagnostics v_cards = row_count;

    insert into public.tcg_printings (card_id, region, language, local_set_code, local_card_number, image_url, source_url,
      release_date, series_id, rarity, rarity_code, rarity_label, source, provider_id, image_rehost_required, metadata,
      image_rights_status, image_license_expires_at, rights_note, source_locale, data_status)
    -- 卡圖只放 card_images（與 ADR 0035 相同），撤回 ADR 0031 時刪一張表即可。
    select pl.card_id, p.region, p.language, p.local_set_code, p.local_card_number, null, pl.source_url,
      p.release_date, p.series_id, p.rarity, p.rarity_code, p.rarity_label, v_source, pl.official_id, p.image_rehost_required,
      (p.metadata - 'officialCardIds' - 'seedHash' - 'tcgdexId' - 'sourceHash' - 'manifestHash' - 'sourceEvidence') || jsonb_build_object(
        'officialCardId', pl.official_id, 'variantKey', 'v' || pl.idx, 'variantName', pl.variant_name),
      p.image_rights_status, p.image_license_expires_at, p.rights_note, p.source_locale, p.data_status
    from jp_archive_variant_plan pl join public.tcg_printings p on p.card_id = pl.base_id and p.region = 'JP';
    get diagnostics v_printings = row_count;

    insert into public.card_images (card_id, canonical_id, language, source, image_url, source_url, is_primary, image_rights_status, rights_note)
    select pl.card_id, c.canonical_id, 'ja-JP', v_source, pl.image_url, pl.source_url, true, 'not-provided', 'ADR 0031'
    from jp_archive_variant_plan pl join public.tcg_cards c on c.id = pl.base_id;
    get diagnostics v_images = row_count;

    -- 原卡沒有任何卡圖時，補上版本 1 那一頁的官方卡圖（ADR 0031）；已有圖則不動。
    insert into public.card_images (card_id, canonical_id, language, source, image_url, source_url, is_primary, image_rights_status, rights_note)
    select c.id, c.canonical_id, 'ja-JP', v_source, b.base_image_url, b.base_source_url, true, 'not-provided', 'ADR 0031'
    from (select distinct base_id, base_image_url, base_source_url from jp_archive_variant_plan) b
    join public.tcg_cards c on c.id = b.base_id
    where not exists (select 1 from public.card_images i where i.card_id = c.id);
    get diagnostics v_inserted_base_images = row_count;

    update public.tcg_cards c set metadata = c.metadata || jsonb_build_object('officialCardIds', b.official_ids,
      'variantIndex', 1, 'variantName', '版本 1', 'variantRule', 'adr-0039'), updated_at = now()
    from (select distinct base_id, official_ids from jp_archive_variant_plan) b where c.id = b.base_id;
    get diagnostics v_updated_cards = row_count;
    update public.tcg_printings p set metadata = p.metadata || jsonb_build_object('variantKey', 'v1', 'variantName', '版本 1'), updated_at = now()
    where p.region = 'JP' and p.card_id in (select base_id from jp_archive_variant_plan);
    get diagnostics v_updated_printings = row_count;

    if v_cards <> v_variants or v_printings <> v_variants or v_images <> v_variants
      or v_inserted_base_images <> v_base_images or v_updated_cards <> v_bases or v_updated_printings <> v_bases then
      raise exception 'JP archive variant split wrote an unexpected row count';
    end if;

    v_after := jsonb_build_object(
      'cards', (select jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' - 'search_names' order by c.id) from public.tcg_cards c where c.id in (select card_id from jp_archive_variant_plan)),
      'baseCards', (select jsonb_agg(jsonb_build_object('id', c.id, 'metadata', c.metadata) order by c.id) from public.tcg_cards c where c.id in (select base_id from jp_archive_variant_plan)),
      'printings', (select count(*) from public.tcg_printings p where p.card_id in (select card_id from jp_archive_variant_plan)),
      'images', (select count(*) from public.card_images i where i.card_id in (select card_id from jp_archive_variant_plan)),
      'baseImages', v_inserted_base_images);
    if jsonb_array_length(v_after->'cards') <> v_variants or (v_after->>'printings')::integer <> v_variants or (v_after->>'images')::integer <> v_variants then
      raise exception 'JP archive variant split wrote an unexpected row count';
    end if;

    insert into private.catalog_jp_archive_variant_audit (game_id, rule, actor, plan_digest, replay, base_count, variant_count, plan, before_snapshot, after_snapshot)
    values ('pokemon', 'adr-0039', p_actor, v_digest, false, v_bases, v_variants, p_plan, coalesce(v_before, '[]'::jsonb), v_after);

    v_result := jsonb_build_object('dryRun', p_dry_run, 'replay', false, 'planDigest', v_digest,
      'inserted', jsonb_build_object('cards', v_cards, 'printings', v_printings, 'images', v_images, 'baseImages', v_inserted_base_images),
      'updated', jsonb_build_object('baseCards', v_updated_cards, 'basePrintings', v_updated_printings));
    if p_dry_run then
      raise exception using errcode = 'CJ039', message = 'JP archive variant split dry run rolled back';
    end if;
  exception when sqlstate 'CJ039' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.split_pokemon_jp_archive_variants(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.split_pokemon_jp_archive_variants(jsonb, text, boolean) to service_role;

comment on function private.split_pokemon_jp_archive_variants(jsonb, text, boolean) is
  'ADR 0039: split each extra official detail page of a tcgdex-ja archive card (S9a/S10a/S11a/S12a) into its own pokemon-card-official-jp card under the same canonical card (版本 k).';
