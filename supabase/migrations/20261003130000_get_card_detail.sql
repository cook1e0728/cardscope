-- CardScope: card detail in one round trip. The server used to read the card (by id or
-- canonical id), then the other cards of linked canonicals, then their printings, then
-- the series and the game, each through PostgREST (1.1-2.5 s per detail page, paid
-- twice because the market tab loads the card too). Same selection as
-- loadCardFromDatabase: cards whose id or canonical_id is p_id (max 100), the cards of
-- any other canonical those cards belong to (max 100), every printing of them, and the
-- series and games they reference. Read-only; callable by service_role only.

create or replace function public.get_card_detail(p_id text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with direct as (
    select id from (
      select c.id from public.tcg_cards c where c.id = p_id
      union
      select c.id from public.tcg_cards c where c.canonical_id = p_id
    ) d
    limit 100
  ),
  sibling as (
    select c.id
    from public.tcg_cards c
    where c.canonical_id in (
        select k.canonical_id from public.tcg_cards k
        where k.id in (select id from direct) and k.canonical_id is not null and k.canonical_id <> p_id)
      and c.id not in (select id from direct)
    limit 100
  ),
  cards as (
    select c.* from public.tcg_cards c where c.id in (select id from direct union all select id from sibling)
  ),
  printings as (
    select p.* from public.tcg_printings p where p.card_id in (select id from cards)
  )
  select jsonb_build_object(
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'canonicalId', c.canonical_id, 'game', c.game_id, 'seriesId', c.series_id,
      'officialCardNumber', c.official_card_number, 'rarity', c.rarity, 'nameZh', c.name_zh, 'nameJa', c.name_ja,
      'nameEn', c.name_en, 'nameKo', c.name_ko, 'aliases', c.aliases, 'metadata', c.metadata,
      'printings', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
          'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
          'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
          'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
          'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
          'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
          'metadata', p.metadata, 'createdAt', p.created_at, 'updatedAt', p.updated_at) order by p.id)
        from printings p where p.card_id = c.id), '[]'::jsonb)) order by c.id)
      from cards c), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'game', s.game_id, 'officialCode', s.official_code, 'nameZh', s.name_zh, 'nameJa', s.name_ja,
      'nameEn', s.name_en, 'nameKo', s.name_ko, 'region', s.region, 'releaseDate', s.release_date) order by s.id)
      from public.tcg_series s
      where s.id in (select series_id from printings union select series_id from cards)), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object(
      'id', g.id, 'nameZh', g.name_zh, 'nameJa', g.name_ja, 'nameEn', g.name_en, 'nameKo', g.name_ko) order by g.id)
      from public.tcg_games g where g.id in (select game_id from cards)), '[]'::jsonb));
$$;

revoke all on function public.get_card_detail(text) from public, anon, authenticated;
grant execute on function public.get_card_detail(text) to service_role;

comment on function public.get_card_detail(text) is
  'Card detail in one round trip: cards whose id or canonical_id is p_id, the cards of their other canonicals, all their printings, and the series and games they reference. service_role only.';
