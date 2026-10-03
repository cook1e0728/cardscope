-- CardScope: the default browse page (one game, every region and rarity, card-number order)
-- in one round trip. The server read the page with an exact count, then the printings and
-- the images of those cards, through PostgREST. Same rows and fields as
-- browseDatabasePageFast: p_limit + 1 cards to tell whether more follow, the exact total,
-- every printing and every card_images row of the returned cards. Read-only; callable by
-- service_role only.

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
      'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', c.metadata, 'source', c.source,
      'providerId', c.provider_id, 'createdAt', c.created_at, 'updatedAt', c.updated_at,
      'printings', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
          'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
          'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
          'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
          'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
          'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
          'metadata', p.metadata, 'createdAt', p.created_at, 'updatedAt', p.updated_at) order by p.id)
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
