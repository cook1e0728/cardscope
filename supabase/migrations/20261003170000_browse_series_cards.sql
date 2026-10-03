-- CardScope: series browse in one round trip. The server read every printing of the series
-- (paged), then the cards in batches of 100, then their images, all through PostgREST
-- (1.5-3.3 s for a 100-250 card series). This returns the same three row sets in the same
-- order and shape: the series printings by local card number, the cards of the game that
-- hold them by official card number, and those cards' images. Metadata is trimmed to the
-- keys list views read (the detail page loads the full card through get_card_detail):
-- a Japanese series of 237 cards was 607 KB with full source evidence. The default browse
-- page (browse_cards_page) gets the same trim. Read-only; callable by service_role only.

create or replace function public.browse_series_cards(p_game text, p_series text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with printings as (
    select p.* from public.tcg_printings p where p.series_id = p_series
  ),
  cards as (
    select c.* from public.tcg_cards c
    where c.game_id = p_game and c.id in (select card_id from printings)
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
          'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial')),
        'createdAt', p.created_at, 'updatedAt', p.updated_at)
      order by p.local_card_number, p.id) from printings p), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'canonicalId', c.canonical_id, 'game', c.game_id, 'seriesId', c.series_id,
        'officialCardNumber', c.official_card_number, 'rarity', c.rarity, 'nameZh', c.name_zh, 'nameJa', c.name_ja,
        'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', c.metadata->'nameZhBasis')), 'source', c.source,
        'providerId', c.provider_id, 'createdAt', c.created_at, 'updatedAt', c.updated_at)
      order by c.official_card_number, c.id) from cards c), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'cardId', i.card_id, 'language', i.language, 'source', i.source, 'imageUrl', i.image_url,
        'sourceUrl', i.source_url, 'isPrimary', i.is_primary, 'fetchedAt', i.fetched_at,
        'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)
      order by i.card_id, i.is_primary desc, i.fetched_at desc)
      from public.card_images i where i.card_id in (select id from cards)), '[]'::jsonb));
$$;

revoke all on function public.browse_series_cards(text, text) from public, anon, authenticated;
grant execute on function public.browse_series_cards(text, text) to service_role;

comment on function public.browse_series_cards(text, text) is
  'Series browse in one round trip: the series printings, the cards of p_game that hold them, and their images. service_role only.';

-- Same as 20261003160000_browse_cards_page with trimmed metadata.
create or replace function public.browse_cards_page(
  p_game text,
  p_limit integer default 60,
  p_offset integer default 0,
  p_desc boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  -- Two branches so each can walk tcg_cards_game_number_idx; the other is skipped by a one-time filter.
  with page as (
    select * from (
      select k.*
      from public.tcg_cards k
      where not coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number, k.id
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) a
    union all
    select * from (
      select k.*
      from public.tcg_cards k
      where coalesce(p_desc, false) and k.game_id = p_game
      order by k.official_card_number desc, k.id desc
      limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1 offset greatest(coalesce(p_offset, 0), 0)
    ) d
  )
  select jsonb_build_object(
    'total', (select count(*) from public.tcg_cards k where k.game_id = p_game),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'canonicalId', c.canonical_id, 'game', c.game_id, 'seriesId', c.series_id,
      'officialCardNumber', c.official_card_number, 'rarity', c.rarity, 'nameZh', c.name_zh, 'nameJa', c.name_ja,
      'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', c.metadata->'nameZhBasis')), 'source', c.source,
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
$$;

revoke all on function public.browse_cards_page(text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.browse_cards_page(text, integer, integer, boolean) to service_role;

comment on function public.browse_cards_page(text, integer, integer, boolean) is
  'Default browse page in one round trip: p_limit + 1 cards of one game in card-number order with printings and images, plus the exact total. service_role only.';
