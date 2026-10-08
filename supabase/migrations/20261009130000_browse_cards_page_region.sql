-- Game pages always browse one region (the series band), so the one-round-trip browse page takes an optional
-- region: only cards with a printing in that region, and the total counted the same way. Null keeps the old result.
-- The argument list changes, so the old four-argument function is dropped first (a second overload would make
-- PostgREST calls ambiguous).
drop function if exists public.browse_cards_page(text, integer, integer, boolean);
CREATE OR REPLACE FUNCTION public.browse_cards_page(p_game text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_desc boolean DEFAULT false, p_region text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- Two branches so each can walk tcg_cards_game_number_idx; the other is skipped by a one-time filter.
  with page as (
    select * from (
      select k.*
      from public.tcg_cards k
      where not coalesce(p_desc, false) and k.game_id = p_game and (p_region is null or exists (select 1 from public.tcg_printings r where r.card_id = k.id and r.region = p_region))
      order by k.official_card_number, k.id
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) a
    union all
    select * from (
      select k.*
      from public.tcg_cards k
      where coalesce(p_desc, false) and k.game_id = p_game and (p_region is null or exists (select 1 from public.tcg_printings r where r.card_id = k.id and r.region = p_region))
      order by k.official_card_number desc, k.id desc
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) d
  )
  select jsonb_build_object(
    'total', (select count(*) from public.tcg_cards k where k.game_id = p_game and (p_region is null or exists (select 1 from public.tcg_printings r where r.card_id = k.id and r.region = p_region))),
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

revoke all on function public.browse_cards_page(text, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.browse_cards_page(text, integer, integer, boolean, text) to service_role;
