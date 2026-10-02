-- CardScope: one round trip for the card search. The server used to query names,
-- then the other cards of each matched canonical, each through PostgREST; this
-- function returns both (with embedded printings) in one call. Same matching as
-- the PostgREST filter it replaces: any pattern ilike any name column or the
-- official card number. Read-only; callable by service_role only.

create or replace function public.search_cards_with_siblings(
  p_patterns text[],
  p_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with hits as (
    select c.*
    from public.tcg_cards c
    where exists (
      select 1 from unnest(p_patterns) pattern
      where c.name_zh ilike pattern or c.name_ja ilike pattern or c.name_en ilike pattern
         or c.name_ko ilike pattern or c.official_card_number ilike pattern
    )
    limit least(greatest(coalesce(p_limit, 100), 1), 100)
  ),
  siblings as (
    select c.*
    from public.tcg_cards c
    where c.canonical_id in (select h.canonical_id from hits h where h.canonical_id is not null)
      and c.id not in (select h.id from hits h)
    limit 200
  ),
  shaped as (
    select x.kind, jsonb_build_object(
      'id', x.id, 'canonicalId', x.canonical_id, 'game', x.game_id, 'seriesId', x.series_id,
      'officialCardNumber', x.official_card_number, 'rarity', x.rarity, 'nameZh', x.name_zh,
      'nameJa', x.name_ja, 'nameEn', x.name_en, 'nameKo', x.name_ko, 'aliases', x.aliases,
      'metadata', x.metadata, 'searchText', x.search_text,
      'printings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
          'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
          'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
          'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
          'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
          'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
          'metadata', p.metadata, 'createdAt', p.created_at, 'updatedAt', p.updated_at) order by p.id)
        from public.tcg_printings p where p.card_id = x.id), '[]'::jsonb)) as card
    from (select 'hit' kind, h.* from hits h union all select 'sibling' kind, s.* from siblings s) x
  )
  select jsonb_build_object(
    'hits', coalesce((select jsonb_agg(card) from shaped where kind = 'hit'), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(card) from shaped where kind = 'sibling'), '[]'::jsonb));
$$;

revoke all on function public.search_cards_with_siblings(text[], integer) from public, anon, authenticated;
grant execute on function public.search_cards_with_siblings(text[], integer) to service_role;

comment on function public.search_cards_with_siblings(text[], integer) is
  'Card search in one round trip: cards whose names or official number match any ilike pattern (max 100) plus the other cards of their canonicals (max 200), each with printings. service_role only.';
