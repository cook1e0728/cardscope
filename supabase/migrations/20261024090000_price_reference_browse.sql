-- 卡牆參考價與價格排序（寶可夢；ADR 0042 的 price_snapshots 讀取端，2026-10-24）。只新增三個函式，不改既有函式的簽章與回傳，不新增資料表或索引。
--   price_reference_best(p_ids)                 每張卡「最新一筆 Cardmarket 參考價」（EUR，7 天內；p_ids 為空代表整張表）。同一張卡有多個 variant 時固定取 normal、空字串、holo、reverse、其他，
--                                                這只是決定卡牆顯示哪一個 variant，不是比較價格；variant 隨列一併回傳，由介面照實標示。
--   browse_cards_json(p_ids)                    依 p_ids 順序回傳卡片（含 printing、圖片），欄位與 browse_cards_filtered 的 cards 完全相同。
--   browse_cards_priced(game, region, token, desc, limit, offset, rmap)
--                                                有 Cardmarket 參考價的卡依價格排序（高到低或低到高，同價以 id），沒有參考價的卡排在最後（以 id）；地區與稀有度篩選語意同 browse_cards_filtered
--                                                （世代鍵新鮮時讀 browse_card_keys_mat，否則退回 browse_card_keys 的即時版本）；回傳 total、priced（有價格的卡數）、unmapped、cards。
-- 只比同一張卡（card_id＝一個 printing）自己的快照，不跨版本、不換匯比較（全部是 EUR）；沒有資料就沒有價格，不補 0。

create or replace function public.price_reference_best(p_ids text[] default null)
 returns table (card_id text, variant text, currency text, amount numeric, snapshot_date date, observed_at timestamptz)
 language sql
 stable
 set search_path to ''
as $function$
  select distinct on (l.card_id) l.card_id, l.variant, l.currency, l.amount, l.snapshot_date, l.observed_at
  from (
    -- two branches instead of "p_ids is null or ...": a named list uses the primary key (card_id first) instead of reading the whole table
    (select distinct on (s.card_id, s.variant) s.card_id, s.variant, s.currency, s.amount, s.snapshot_date, s.observed_at
     from public.price_snapshots s
     where p_ids is not null and s.card_id = any(p_ids) and s.provider = 'cardmarket' and s.snapshot_date >= current_date - 7
     order by s.card_id, s.variant, s.snapshot_date desc)
    union all
    (select distinct on (s.card_id, s.variant) s.card_id, s.variant, s.currency, s.amount, s.snapshot_date, s.observed_at
     from public.price_snapshots s
     where p_ids is null and s.provider = 'cardmarket' and s.snapshot_date >= current_date - 7
     order by s.card_id, s.variant, s.snapshot_date desc)
  ) l
  order by l.card_id, case l.variant when 'normal' then 0 when '' then 1 when 'holo' then 2 when 'reverse' then 3 else 4 end, l.variant;
$function$
;

create or replace function public.browse_cards_json(p_ids text[])
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'canonicalId', c.canonical_id, 'game', c.game_id, 'seriesId', c.series_id,
        'officialCardNumber', c.official_card_number, 'rarity', c.rarity, 'nameZh', c.name_zh, 'nameJa', c.name_ja,
        'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', c.metadata->'nameZhBasis', 'numberStatus', c.metadata->'numberStatus')), 'source', c.source,
        'providerId', c.provider_id, 'createdAt', c.created_at, 'updatedAt', c.updated_at,
        'printings', coalesce((select jsonb_agg(jsonb_build_object(
            'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
            'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
            'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
            'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
            'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
            'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
            'metadata', jsonb_strip_nulls(jsonb_build_object(
              'variantKey', p.metadata->'variantKey', 'variantName', p.metadata->'variantName',
              'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial', 'officialListing', p.metadata->'officialListing')),
            'createdAt', p.created_at, 'updatedAt', p.updated_at) order by p.id)
            from public.tcg_printings p where p.card_id = c.id), '[]'::jsonb),
        'images', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'cardId', i.card_id, 'language', i.language, 'source', i.source, 'imageUrl', i.image_url,
            'sourceUrl', i.source_url, 'isPrimary', i.is_primary, 'fetchedAt', i.fetched_at,
            'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)
            order by i.is_primary desc, i.fetched_at desc)
            from public.card_images i where i.card_id = c.id), '[]'::jsonb)) order by t.ord), '[]'::jsonb)
  from unnest(p_ids) with ordinality as t(id, ord)
  join public.tcg_cards c on c.id = t.id;
$function$
;

create or replace function public.browse_cards_priced(p_game text, p_region text, p_token text, p_desc boolean, p_limit integer, p_offset integer, p_rmap jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
 set statement_timeout to '20s'
 set work_mem to '32MB'
as $function$
declare
  v_take integer := least(greatest(coalesce(p_limit, 60), 1), 100);
  v_skip integer := greatest(coalesce(p_offset, 0), 0);
  v_fresh boolean := p_region is distinct from '' and public.browse_keys_fresh(p_game);
  v_gen bigint := (select s.gen from public.browse_key_state s where s.game_id = p_game);
  v_result jsonb;
begin
  with rmap as (
    select m.raw, m.code, m.token, m.rank
    from jsonb_to_recordset(coalesce(p_rmap, '[]'::jsonb)) as m(raw text, code text, token text, rank integer)
  ),
  sel as materialized (
    select m.id
    from public.browse_card_keys_mat m
    where v_fresh and m.game_id = p_game and m.gen = v_gen
      and (p_region is null or p_region = any(m.regions))
      and (p_token is null or m.raws && array(select r.raw from rmap r where r.token = p_token))
    union all
    select k.id from public.browse_card_keys(p_game, p_region, p_token, p_rmap) k where not v_fresh and k.matched
  ),
  priced as materialized (
    select s.id, b.amount from sel s join public.price_reference_best(null) b on b.card_id = s.id
  ),
  np as materialized (select count(*)::integer as n from priced),
  page as (
    select q.id, 0 as part, q.rn
    from (select pr.id, row_number() over (order by case when p_desc then pr.amount end desc nulls last, case when not p_desc then pr.amount end asc nulls last, pr.id collate "C") as rn from priced pr) q
    where q.rn > v_skip and q.rn <= v_skip + v_take
    union all
    select u.id, 1, u.rn
    from (select s.id, row_number() over (order by s.id collate "C") as rn from sel s where v_skip + v_take > (select n from np) and not exists (select 1 from priced pr where pr.id = s.id)) u
    where u.rn + (select n from np) > v_skip and u.rn + (select n from np) <= v_skip + v_take
  )
  select jsonb_build_object(
    'total', (select count(*) from sel),
    'priced', (select n from np),
    'unmapped', case when v_fresh then exists (
        select 1 from public.browse_key_raws w
        where w.game_id = p_game and w.region = coalesce(p_region, '')
          and not exists (select 1 from rmap mm where mm.raw = w.raw))
      else exists (select 1 from public.browse_card_keys(p_game, p_region, p_token, p_rmap) k2 where k2.has_unmapped) end,
    'cards', public.browse_cards_json(array(select pg.id from page pg order by pg.part, pg.rn)))
  into v_result;
  return v_result;
end;
$function$
;

revoke all on function public.price_reference_best(text[]) from public, anon, authenticated;
grant execute on function public.price_reference_best(text[]) to service_role;
revoke all on function public.browse_cards_json(text[]) from public, anon, authenticated;
grant execute on function public.browse_cards_json(text[]) to service_role;
revoke all on function public.browse_cards_priced(text, text, text, boolean, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.browse_cards_priced(text, text, text, boolean, integer, integer, jsonb) to service_role;

notify pgrst, 'reload schema';
