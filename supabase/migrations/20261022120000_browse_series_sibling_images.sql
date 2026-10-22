-- 系列卡表多回傳 siblingImages：同作品層（canonical）其他卡的圖片，供卡牆在本卡圖片載入失敗時備援。
-- 起因：2026-10-22 台灣官方站維護，台版圖片全部失效；台版 M4 的 120 個作品層都有日版圖可用。
-- 其餘三組資料與 20261014140000 的定義相同；同作品層以 canonical_id 與 id 兩次索引查找（避免 OR 掃表）。
CREATE OR REPLACE FUNCTION public.browse_series_cards(p_game text, p_series text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with printings as (
    select p.* from public.tcg_printings p where p.series_id = p_series
  ),
  cards as (
    select c.* from public.tcg_cards c
    where c.game_id = p_game and c.id in (select card_id from printings)
  ),
  groups as (
    select distinct coalesce(c.canonical_id, c.id) as group_id from cards c
  ),
  siblings as (
    select k.id, g.group_id from groups g join public.tcg_cards k on k.canonical_id = g.group_id
    union
    select k.id, g.group_id from groups g join public.tcg_cards k on k.id = g.group_id
  )
  select jsonb_build_object(
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
        'createdAt', p.created_at, 'updatedAt', p.updated_at)
      order by p.local_card_number, p.id) from printings p), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'canonicalId', c.canonical_id, 'game', c.game_id, 'seriesId', c.series_id,
        'officialCardNumber', c.official_card_number, 'rarity', c.rarity, 'nameZh', c.name_zh, 'nameJa', c.name_ja,
        'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', c.metadata->'nameZhBasis', 'numberStatus', c.metadata->'numberStatus')), 'source', c.source,
        'providerId', c.provider_id, 'createdAt', c.created_at, 'updatedAt', c.updated_at)
      order by c.official_card_number, (c.metadata->>'officialListPosition')::integer, c.id) from cards c), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'cardId', i.card_id, 'language', i.language, 'source', i.source, 'imageUrl', i.image_url,
        'sourceUrl', i.source_url, 'isPrimary', i.is_primary, 'fetchedAt', i.fetched_at,
        'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)
      order by i.card_id, i.is_primary desc, i.fetched_at desc)
      from public.card_images i where i.card_id in (select id from cards)), '[]'::jsonb),
    'siblingImages', coalesce((select jsonb_agg(jsonb_build_object(
        'groupId', s.group_id, 'cardId', i.card_id, 'language', i.language, 'source', i.source, 'imageUrl', i.image_url,
        'sourceUrl', i.source_url, 'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)
      order by s.group_id, i.is_primary desc, i.fetched_at desc, i.card_id)
      from siblings s join public.card_images i on i.card_id = s.id
      where s.id not in (select id from cards) and i.image_url is not null), '[]'::jsonb));
$function$
;
