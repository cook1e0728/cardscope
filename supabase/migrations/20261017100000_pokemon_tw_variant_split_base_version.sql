-- CardScope：ADR 0043 補充。台版同號多版本的原卡已有 TCGdex 台版圖時（SV2a 17、SV8a 144 張），原卡既有的圖不一定是官方 ID 最小的那一頁：
-- 逐張比對 TCGdex 圖與兩個官方卡圖後，SV2a 全是最小 ID，SV8a 多數是較大的 ID（證據 docs/evidence/pokemon-tw/variant-split-20261017/）。
-- 原卡對應到哪個官方 ID，就以那一頁的版本序號為準（版本序號仍依官方 ID 由小到大排），其餘各頁各新增 `<原卡 ID>-v<k>`（k 為該頁版本序號，
-- 原卡不是版本 1 時會出現 `-v1`）。計畫列新增選用欄位 baseVersionIndex（預設 1，與 20261016100000 的計畫完全相容）；
-- 原卡 metadata 另記 variantOfficialDetailId（原卡對應的官方 ID）。其餘規則、核對、稽核與 100 張上限不變，原卡既有的圖不動。
-- 只用 create or replace 取代函式，不動稽核表與權限以外的任何資料。

-- p_plan: { "version": 1, "rule": "adr-0043", "rows": [ { "baseCardId": "pokemon-official-tw-sv11b-001", "seriesCode": "SV11B", "number": "001", "nameZh": "藤藤蛇",
--   "officialDetailIds": ["小", ..., "大"], "baseVersionIndex": 2 (選用，原卡對應 officialDetailIds 的第幾個，預設 1),
--   "baseOfficial": { "detailId": "原卡對應的那一頁", "imageUrl": "https://asia.pokemon-card.com/tw/card-img/tw000<小>.png", "sourceUrl": "https://asia.pokemon-card.com/tw/card-search/detail/小/" },
--   "variants": [ { "cardId": "<base>-v2", "detailId": "...", "variantIndex": 2, "variantName": "版本 2",
--     "imageUrl": "https://asia.pokemon-card.com/tw/card-img/tw<8 位補零>.png", "sourceUrl": "https://asia.pokemon-card.com/tw/card-search/detail/.../" } ] } ] }
create or replace function private.split_pokemon_tw_official_variants(
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
  v_source constant text := 'asia-pokemon-card-official-tw';
  v_tcgdex constant text := 'tcgdex-zh-tw';
  v_image_source constant text := 'pokemon-tw-official';
  v_image_prefix constant text := 'https://asia.pokemon-card.com/tw/card-img/tw';
  v_page_prefix constant text := 'https://asia.pokemon-card.com/tw/card-search/detail/';
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
    raise exception 'TW variant split requires an actor';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object' or p_plan->>'version' is distinct from '1' or p_plan->>'rule' is distinct from 'adr-0043'
    or jsonb_typeof(p_plan->'rows') is distinct from 'array' then
    raise exception 'TW variant split plan has an unsupported shape';
  end if;
  -- 逐列形狀：物件、非空文字欄位、官方 ID 清單／原卡官方頁／版本清單的型別；通過後才檢查長度與元素，再展開成暫存表。
  if exists (
    select 1 from jsonb_array_elements(p_plan->'rows') r
    where jsonb_typeof(r) is distinct from 'object'
      or jsonb_typeof(r->'officialDetailIds') is distinct from 'array'
      or jsonb_typeof(r->'baseOfficial') is distinct from 'object'
      or jsonb_typeof(r->'variants') is distinct from 'array'
      or coalesce(r->>'baseCardId', '') = '' or coalesce(r->>'seriesCode', '') = '' or coalesce(r->>'number', '') = '' or coalesce(r->>'nameZh', '') = ''
      or (r->'baseVersionIndex' is not null and (jsonb_typeof(r->'baseVersionIndex') is distinct from 'number' or (r->>'baseVersionIndex') !~ '^[0-9]{1,3}$'))
  ) then
    raise exception 'TW variant split plan has an unsupported shape';
  end if;
  -- 至少 2 個官方 ID（全是數字字串）、至少 1 個版本，每個版本的欄位齊全。
  if exists (
    select 1 from jsonb_array_elements(p_plan->'rows') r
    where jsonb_array_length(r->'officialDetailIds') < 2 or jsonb_array_length(r->'variants') < 1
      or exists (select 1 from jsonb_array_elements(r->'officialDetailIds') o where jsonb_typeof(o) is distinct from 'string' or (o #>> '{}') !~ '^[0-9]{1,9}$')
      or exists (select 1 from jsonb_array_elements(r->'variants') v
        where jsonb_typeof(v) is distinct from 'object' or coalesce(v->>'variantIndex', '') !~ '^[0-9]{1,3}$'
          or coalesce(v->>'cardId', '') = '' or coalesce(v->>'detailId', '') = '' or coalesce(v->>'variantName', '') = ''
          or coalesce(v->>'imageUrl', '') = '' or coalesce(v->>'sourceUrl', '') = '')
  ) then
    raise exception 'TW variant split plan has an unsupported shape';
  end if;

  drop table if exists pg_temp.tw_official_variant_plan;
  create temporary table tw_official_variant_plan on commit drop as
  select r->>'baseCardId' base_id, r->>'seriesCode' series_code, r->>'number' num, r->>'nameZh' name_zh,
    r->'officialDetailIds' official_ids, coalesce((r->>'baseVersionIndex')::integer, 1) base_idx, r->'baseOfficial'->>'detailId' base_detail_id,
    r->'baseOfficial'->>'imageUrl' base_image_url, r->'baseOfficial'->>'sourceUrl' base_source_url,
    v->>'cardId' card_id, v->>'detailId' detail_id, (v->>'variantIndex')::integer idx,
    v->>'variantName' variant_name, v->>'imageUrl' image_url, v->>'sourceUrl' source_url
  from jsonb_array_elements(p_plan->'rows') r cross join jsonb_array_elements(r->'variants') v;

  select count(distinct base_id), count(*) into v_bases, v_variants from tw_official_variant_plan;
  if v_bases not between 1 and 100 or v_variants not between 1 and 100
    or v_bases <> jsonb_array_length(p_plan->'rows')
    or (select count(distinct card_id) from tw_official_variant_plan) <> v_variants
    or (select count(distinct detail_id) from tw_official_variant_plan) <> v_variants then
    raise exception 'TW variant split accepts 1-100 distinct new cards per call';
  end if;
  -- 整份計畫裡每個官方詳細頁 ID 只能出現一次（原卡那一頁與各版本頁都不重複）。
  if (select count(*) <> count(distinct o) from (
        select jsonb_array_elements_text(b.official_ids) o from (select distinct base_id, official_ids from tw_official_variant_plan) b) x) then
    raise exception 'TW variant split official IDs must be unique across the plan';
  end if;

  -- 逐列核對：原卡為寶可夢卡、來源是台灣官方匯入或 TCGdex、中文名相符、台版 Printing 恰好一筆且來源／系列代碼／卡號相符、
  -- Printing 的官方 ID 清單與計畫相同（依數字由小到大）、台灣官方原卡的 Provider ID 是最小的官方 ID、新卡 ID／序號／官方 ID／
  -- 版本名稱（只有中性的「版本 k」）／圖片與詳細頁網址一致。
  select coalesce(x.card_id, '<plan>') || ':' || x.reason into v_bad from (
    select pl.card_id,
      case
        when c.id is null then 'base-missing'
        when c.game_id <> 'pokemon' or c.source not in (v_source, v_tcgdex) then 'base-source'
        when c.name_zh is distinct from pl.name_zh then 'base-name'
        when c.official_card_number is distinct from pl.num then 'base-number'
        when tw.n <> 1 then 'base-printings'
        when tw.src is distinct from c.source then 'base-printing-source'
        when tw.code is distinct from pl.series_code or tw.num is distinct from pl.num then 'base-printing-number'
        when tw.ids is distinct from pl.official_ids then 'official-ids'
        when c.metadata->'officialDetailIds' is not null and c.metadata->'officialDetailIds' is distinct from pl.official_ids then 'card-official-ids'
        when (select array_agg(value order by value::bigint) from jsonb_array_elements_text(pl.official_ids)) is distinct from
             (select array_agg(value order by ord) from jsonb_array_elements_text(pl.official_ids) with ordinality t(value, ord)) then 'official-ids-order'
        when pl.base_idx < 1 or pl.base_idx > jsonb_array_length(pl.official_ids) then 'base-index'
        when c.source = v_source and c.provider_id is distinct from pl.official_ids->>(pl.base_idx - 1) then 'base-provider-id'
        when pl.idx < 1 or pl.idx > jsonb_array_length(pl.official_ids) or pl.idx = pl.base_idx then 'index'
        when pl.detail_id is distinct from pl.official_ids->>(pl.idx - 1) then 'detail-id'
        when pl.base_detail_id is distinct from pl.official_ids->>(pl.base_idx - 1) then 'base-detail-id'
        when pl.card_id is distinct from pl.base_id || '-v' || pl.idx then 'card-id'
        when pl.variant_name is distinct from '版本 ' || pl.idx then 'variant-name'
        when pl.image_url is distinct from v_image_prefix || lpad(pl.detail_id, 8, '0') || '.png' then 'image-url'
        when pl.base_image_url is distinct from v_image_prefix || lpad(pl.base_detail_id, 8, '0') || '.png' then 'base-image-url'
        when pl.source_url is distinct from v_page_prefix || pl.detail_id || '/' then 'source-url'
        when pl.base_source_url is distinct from v_page_prefix || pl.base_detail_id || '/' then 'base-source-url'
      end reason
    from tw_official_variant_plan pl
    left join public.tcg_cards c on c.id = pl.base_id
    left join lateral (
      select count(*) n, min(p.local_set_code) code, min(p.local_card_number) num, min(p.source) src,
        (array_agg(p.metadata->'officialDetailIds'))[1] ids
      from public.tcg_printings p where p.card_id = pl.base_id and p.region = 'TW'
    ) tw on true
  ) x where x.reason is not null limit 1;
  if found then
    raise exception 'TW variant split rejected row %', v_bad;
  end if;
  -- 每個原卡的所有額外官方頁都要在同一份計畫裡（不拆一半）。
  if exists (select 1 from tw_official_variant_plan group by base_id, official_ids having count(*) <> jsonb_array_length(official_ids) - 1) then
    raise exception 'TW variant split must include every extra official page of a base card';
  end if;

  select count(*) into v_existing from public.tcg_cards c join tw_official_variant_plan pl on pl.card_id = c.id;
  if v_existing = v_variants then
    -- 重播：所有新卡已存在、官方 ID 與版本序號相符、各有一筆台版 Printing 與官方卡圖，且每個原卡已記下相同的 officialDetailIds。
    if (select count(*) from public.tcg_cards c join tw_official_variant_plan pl on pl.card_id = c.id
        where c.source = v_source and c.provider_id = pl.detail_id and c.metadata->>'variantOf' = pl.base_id
          and c.metadata->>'variantIndex' = pl.idx::text and c.metadata->>'variantRule' = 'adr-0043') <> v_variants
      or (select count(*) from public.tcg_printings p join tw_official_variant_plan pl on pl.card_id = p.card_id
        where p.source = v_source and p.provider_id = pl.detail_id and p.region = 'TW') <> v_variants
      or (select count(*) from public.card_images i join tw_official_variant_plan pl on pl.card_id = i.card_id
        where i.source = v_image_source and i.image_url = pl.image_url and i.source_url = pl.source_url) <> v_variants
      or exists (select 1 from (select distinct base_id, official_ids, base_idx from tw_official_variant_plan) b
        join public.tcg_cards c on c.id = b.base_id where c.metadata->'officialDetailIds' is distinct from b.official_ids
          or c.metadata->>'variantIndex' is distinct from b.base_idx::text) then
      raise exception 'TW variant split no longer matches existing variant cards';
    end if;
    v_result := jsonb_build_object('dryRun', p_dry_run, 'replay', true, 'planDigest', v_digest,
      'inserted', jsonb_build_object('cards', 0, 'printings', 0, 'images', 0, 'baseImages', 0),
      'updated', jsonb_build_object('baseCards', 0, 'basePrintings', 0));
    if not p_dry_run then
      insert into private.catalog_tw_variant_split_audit (game_id, rule, actor, plan_digest, replay, base_count, variant_count, plan, before_snapshot, after_snapshot)
      values ('pokemon', 'adr-0043', p_actor, v_digest, true, v_bases, v_variants, p_plan, '{}'::jsonb, '{}'::jsonb);
    end if;
    return v_result;
  elsif v_existing > 0 then
    raise exception 'TW variant split collides with % existing card(s)', v_existing;
  end if;
  -- 官方詳細頁 ID（原卡那一頁與各版本頁）不得已被台灣官方來源的其他卡片或 Printing 使用（原卡本身可以）；
  -- 規劃的卡圖網址不得已被任何卡圖使用；新卡也不得已有卡圖。
  if exists (select 1 from public.tcg_printings p join (
        select b.base_id, jsonb_array_elements_text(b.official_ids) detail_id from (select distinct base_id, official_ids from tw_official_variant_plan) b) ids
        on p.source = v_source and p.provider_id = ids.detail_id and p.card_id <> ids.base_id)
    or exists (select 1 from public.tcg_cards c join (
        select b.base_id, jsonb_array_elements_text(b.official_ids) detail_id from (select distinct base_id, official_ids from tw_official_variant_plan) b) ids
        on c.source = v_source and c.provider_id = ids.detail_id and c.id <> ids.base_id)
    or exists (select 1 from public.card_images i join tw_official_variant_plan pl on i.card_id = pl.card_id or i.image_url = pl.image_url)
    or exists (select 1 from public.card_images i join (select distinct base_id, base_image_url from tw_official_variant_plan) b on i.image_url = b.base_image_url and i.card_id <> b.base_id) then
    raise exception 'TW variant split collides with an existing official ID or image';
  end if;

  -- 原卡沒有任何卡圖（card_images 與 Printing 的 image_url 都沒有）時，才補上版本 1 那一頁的官方卡圖。
  select count(*) into v_base_images from (select distinct base_id from tw_official_variant_plan) b
  where not exists (select 1 from public.card_images i where i.card_id = b.base_id)
    and not exists (select 1 from public.tcg_printings p where p.card_id = b.base_id and p.image_url is not null and p.image_url <> '');

  v_before := (select jsonb_agg(jsonb_build_object('id', c.id, 'metadata', c.metadata,
      'printingMetadata', (select p.metadata from public.tcg_printings p where p.card_id = c.id and p.region = 'TW'),
      'hasImage', exists (select 1 from public.card_images i where i.card_id = c.id)) order by c.id)
    from public.tcg_cards c where c.id in (select base_id from tw_official_variant_plan));

  begin
    -- 新卡 metadata 只帶白名單鍵（稀有度依據、官方稀有度標記、中文名依據、卡號狀態），不帶 TCGdex 的圖片與來源鍵。
    insert into public.tcg_cards (id, canonical_id, game_id, series_id, official_card_number, rarity, rarity_tier,
      name_ja, name_zh, name_en, name_ko, aliases, source, provider_id, search_text, metadata, data_status)
    select pl.card_id, c.canonical_id, c.game_id, c.series_id, c.official_card_number, c.rarity, c.rarity_tier,
      c.name_ja, c.name_zh, c.name_en, c.name_ko, c.aliases, v_source, pl.detail_id, c.search_text,
      jsonb_strip_nulls(jsonb_build_object(
        'rarityBasis', coalesce(c.metadata->'rarityBasis', p.metadata->'rarityBasis'),
        'rarityLabels', coalesce(c.metadata->'rarityLabels', p.metadata->'rarityLabels'),
        'nameZhBasis', c.metadata->'nameZhBasis', 'numberStatus', c.metadata->'numberStatus'))
      || jsonb_build_object('officialDetailIds', jsonb_build_array(pl.detail_id), 'variantOf', c.id, 'variantIndex', pl.idx,
        'variantName', pl.variant_name, 'variantRule', 'adr-0043'),
      c.data_status
    from tw_official_variant_plan pl join public.tcg_cards c on c.id = pl.base_id
    join public.tcg_printings p on p.card_id = pl.base_id and p.region = 'TW';
    get diagnostics v_cards = row_count;

    insert into public.tcg_printings (card_id, region, language, local_set_code, local_card_number, image_url, source_url,
      release_date, series_id, rarity, rarity_code, rarity_label, source, provider_id, image_rehost_required, metadata,
      image_rights_status, image_license_expires_at, rights_note, source_locale, data_status)
    -- 卡圖只放 card_images（與 ADR 0035 相同），撤回 ADR 0031 時刪一張表即可。
    select pl.card_id, p.region, p.language, p.local_set_code, p.local_card_number, null, pl.source_url,
      p.release_date, p.series_id, p.rarity, p.rarity_code, p.rarity_label, v_source, pl.detail_id, p.image_rehost_required,
      jsonb_strip_nulls(jsonb_build_object('rarityBasis', p.metadata->'rarityBasis', 'rarityLabels', p.metadata->'rarityLabels',
        'numberStatus', p.metadata->'numberStatus'))
      || jsonb_build_object('officialDetailIds', jsonb_build_array(pl.detail_id), 'variantKey', 'v' || pl.idx, 'variantName', pl.variant_name),
      p.image_rights_status, p.image_license_expires_at, p.rights_note, p.source_locale, p.data_status
    from tw_official_variant_plan pl join public.tcg_printings p on p.card_id = pl.base_id and p.region = 'TW';
    get diagnostics v_printings = row_count;

    insert into public.card_images (card_id, canonical_id, language, source, image_url, source_url, is_primary, image_rights_status, rights_note)
    select pl.card_id, c.canonical_id, 'zh-Hant-TW', v_image_source, pl.image_url, pl.source_url, true, 'not-provided', 'ADR 0031'
    from tw_official_variant_plan pl join public.tcg_cards c on c.id = pl.base_id;
    get diagnostics v_images = row_count;

    -- 原卡沒有任何卡圖時，補上版本 1 那一頁的官方卡圖（ADR 0031）；已有圖則不動。
    insert into public.card_images (card_id, canonical_id, language, source, image_url, source_url, is_primary, image_rights_status, rights_note)
    select c.id, c.canonical_id, 'zh-Hant-TW', v_image_source, b.base_image_url, b.base_source_url, true, 'not-provided', 'ADR 0031'
    from (select distinct base_id, base_image_url, base_source_url from tw_official_variant_plan) b
    join public.tcg_cards c on c.id = b.base_id
    where not exists (select 1 from public.card_images i where i.card_id = c.id)
      and not exists (select 1 from public.tcg_printings p where p.card_id = c.id and p.image_url is not null and p.image_url <> '');
    get diagnostics v_inserted_base_images = row_count;

    update public.tcg_cards c set metadata = c.metadata || jsonb_build_object('officialDetailIds', b.official_ids,
      'variantIndex', b.base_idx, 'variantName', '版本 ' || b.base_idx, 'variantRule', 'adr-0043', 'variantOfficialDetailId', b.base_detail_id), updated_at = now()
    from (select distinct base_id, official_ids, base_idx, base_detail_id from tw_official_variant_plan) b where c.id = b.base_id;
    get diagnostics v_updated_cards = row_count;
    update public.tcg_printings p set metadata = p.metadata || jsonb_build_object('variantKey', 'v' || b.base_idx, 'variantName', '版本 ' || b.base_idx), updated_at = now()
    from (select distinct base_id, base_idx from tw_official_variant_plan) b where p.region = 'TW' and p.card_id = b.base_id;
    get diagnostics v_updated_printings = row_count;

    if v_cards <> v_variants or v_printings <> v_variants or v_images <> v_variants
      or v_inserted_base_images <> v_base_images or v_updated_cards <> v_bases or v_updated_printings <> v_bases then
      raise exception 'TW variant split wrote an unexpected row count';
    end if;

    v_after := jsonb_build_object(
      'cards', (select jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' - 'search_names' order by c.id) from public.tcg_cards c where c.id in (select card_id from tw_official_variant_plan)),
      'baseCards', (select jsonb_agg(jsonb_build_object('id', c.id, 'metadata', c.metadata) order by c.id) from public.tcg_cards c where c.id in (select base_id from tw_official_variant_plan)),
      'printings', (select count(*) from public.tcg_printings p where p.card_id in (select card_id from tw_official_variant_plan)),
      'images', (select count(*) from public.card_images i where i.card_id in (select card_id from tw_official_variant_plan)),
      'baseImages', v_inserted_base_images);
    if jsonb_array_length(v_after->'cards') <> v_variants or (v_after->>'printings')::integer <> v_variants or (v_after->>'images')::integer <> v_variants then
      raise exception 'TW variant split wrote an unexpected row count';
    end if;

    insert into private.catalog_tw_variant_split_audit (game_id, rule, actor, plan_digest, replay, base_count, variant_count, plan, before_snapshot, after_snapshot)
    values ('pokemon', 'adr-0043', p_actor, v_digest, false, v_bases, v_variants, p_plan, coalesce(v_before, '[]'::jsonb), v_after);

    v_result := jsonb_build_object('dryRun', p_dry_run, 'replay', false, 'planDigest', v_digest,
      'inserted', jsonb_build_object('cards', v_cards, 'printings', v_printings, 'images', v_images, 'baseImages', v_inserted_base_images),
      'updated', jsonb_build_object('baseCards', v_updated_cards, 'basePrintings', v_updated_printings));
    if p_dry_run then
      raise exception using errcode = 'CJ043', message = 'TW variant split dry run rolled back';
    end if;
  exception when sqlstate 'CJ043' then
    null;
  end;
  return v_result;
end;
$$;

revoke all on function private.split_pokemon_tw_official_variants(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function private.split_pokemon_tw_official_variants(jsonb, text, boolean) to service_role;

comment on function private.split_pokemon_tw_official_variants(jsonb, text, boolean) is
  'ADR 0043: split each extra official detail page of a Taiwanese Pokemon card with several officialDetailIds under one number into its own asia-pokemon-card-official-tw card under the same canonical card (版本 k); the base card may correspond to a non-smallest page (baseVersionIndex).';
