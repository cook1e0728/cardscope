-- Region pages page through the region index first (see 20261009130000, whose exists-per-card filter slowed down
-- with every page). Same arguments and result; adds tcg_printings_region_card_idx.
create index if not exists tcg_printings_region_card_idx on public.tcg_printings (region, card_id);

CREATE OR REPLACE FUNCTION public.browse_cards_page(p_game text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_desc boolean DEFAULT false, p_region text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- Without a region: two branches so each can walk tcg_cards_game_number_idx; the other is skipped by a one-time filter.
  -- With a region: the card ids come from tcg_printings_region_card_idx first, then sort and page (walking the number
  -- index and testing each card for the region slowed down with every page, 3.5 s at offset 200).
  with region_cards as (
    select distinct r.card_id id from public.tcg_printings r where p_region is not null and r.region = p_region
  ),
  page as (
    select * from (
      select k.*
      from public.tcg_cards k
      where p_region is null and not coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number, k.id
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) a
    union all
    select * from (
      select k.*
      from public.tcg_cards k
      where p_region is null and coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number desc, k.id desc
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) d
    union all
    select * from (
      select k.*
      from public.tcg_cards k join region_cards rc on rc.id = k.id
      where not coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number, k.id
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) ra
    union all
    select * from (
      select k.*
      from public.tcg_cards k join region_cards rc on rc.id = k.id
      where coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number desc, k.id desc
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) rd
  )
  select jsonb_build_object(
    'total', case when p_region is null then (select count(*) from public.tcg_cards k where k.game_id = p_game)
               else (select count(*) from public.tcg_cards k join region_cards rc on rc.id = k.id where k.game_id = p_game) end,
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
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
          'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial')),
        'createdAt', p.created_at, 'updatedAt', p.updated_at) order by p.id)
        from public.tcg_printings p where p.card_id = c.id), '[]'::jsonb),
      'images', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id, 'cardId', i.card_id, 'language', i.language, 'source', i.source, 'imageUrl', i.image_url,
          'sourceUrl', i.source_url, 'isPrimary', i.is_primary, 'fetchedAt', i.fetched_at,
          'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)
          order by i.is_primary desc, i.fetched_at desc)
        from public.card_images i where i.card_id = c.id), '[]'::jsonb))
      order by case when coalesce(p_desc, false) then null else c.official_card_number end,
               case when coalesce(p_desc, false) then null else c.id end,
               c.official_card_number desc, c.id desc)
      from page c), '[]'::jsonb));
$function$;
