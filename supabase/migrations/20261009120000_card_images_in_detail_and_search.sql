-- ADR 0031: card detail and ranked search also return up to three card_images rows per card (primary first),
-- so official card images stored there show on the detail page and in search results, not only in browse lists.
-- The server still decides what is displayable from the source policy.
CREATE OR REPLACE FUNCTION public.get_card_detail(p_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
        from printings p where p.card_id = c.id), '[]'::jsonb), 'images', coalesce((select jsonb_agg(jsonb_build_object('source', i.source, 'imageUrl', i.image_url, 'sourceUrl', i.source_url, 'language', i.language, 'isPrimary', i.is_primary, 'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)) from (select * from public.card_images i where i.card_id = c.id order by i.is_primary desc, i.fetched_at desc limit 3) i), '[]'::jsonb)) order by c.id)
      from cards c), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'game', s.game_id, 'officialCode', s.official_code, 'nameZh', s.name_zh, 'nameJa', s.name_ja,
      'nameEn', s.name_en, 'nameKo', s.name_ko, 'region', s.region, 'releaseDate', s.release_date) order by s.id)
      from public.tcg_series s
      where s.id in (select series_id from printings union select series_id from cards)), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object(
      'id', g.id, 'nameZh', g.name_zh, 'nameJa', g.name_ja, 'nameEn', g.name_en, 'nameKo', g.name_ko) order by g.id)
      from public.tcg_games g where g.id in (select game_id from cards)), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.search_cards_ranked(p_patterns text[], p_needles text[], p_limit integer DEFAULT 40, p_region text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with name_matched as (
    select distinct c.id
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k where k.search_names like lower(pattern)
    ) c
  ),
  -- Only when no name matched: search_text (card numbers such as SV6a-039, provider IDs), at most 100 cards.
  text_matched as (
    select distinct c.id
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k where k.search_text ilike pattern limit 100
    ) c
    where not exists (select 1 from name_matched)
  ),
  -- Only when no card matched at all: series names or codes (「ナイトワンダラー」, "SV6a"), at most 5 series,
  -- listing their first 100 printings in card-number order; ord keeps that order.
  series_hit as (
    select s.id
    from public.tcg_series s
    where not exists (select 1 from name_matched) and not exists (select 1 from text_matched)
      and exists (select 1 from unnest(p_patterns) pattern
                  where s.name_zh ilike pattern or s.name_ja ilike pattern or s.name_en ilike pattern
                     or s.name_ko ilike pattern or s.official_code ilike pattern)
    limit 5
  ),
  series_matched as (
    select card_id as id, min(ord) as ord
    from (select p.card_id, row_number() over (order by p.series_id, p.local_card_number, p.card_id) as ord
          from public.tcg_printings p where p.series_id in (select id from series_hit)
          order by p.series_id, p.local_card_number, p.card_id limit 100) x
    group by card_id
  ),
  matched as (
    select id, null::bigint as ord from name_matched
    union all select id, null from text_matched
    union all select id, ord from series_matched
  ),
  needles as (
    select distinct public.tcg_search_fold(n) as needle from unnest(p_needles) n where public.tcg_search_fold(n) <> ''
  ),
  scored as (
    select c.id, coalesce(c.canonical_id, c.id) as group_id,
      case when m.ord is null then coalesce(c.name_en, c.name_zh, '') else '' end as sort_name,
      -- Series listings keep card-number order; name and text matches are scored like the server.
      case when m.ord is not null then m.ord else coalesce((
        select min(case when f.name = nd.needle then 0 when left(f.name, length(nd.needle)) = nd.needle then 1
                        when strpos(f.name, nd.needle) > 0 then 2 end)
        from (select public.tcg_search_fold(v) as name
              from unnest(array[c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number] || coalesce(c.aliases, '{}')) v
              where v is not null) f
        cross join needles nd
        where f.name <> ''), 3) end as score
    from public.tcg_cards c
    join matched m on m.id = c.id
  ),
  -- With p_region, only groups that hold a printing of that region (the server shows only those
  -- printings); lateral index lookups per group, since a correlated EXISTS is planned as a table scan.
  in_region as (
    select distinct g.group_id
    from (select distinct group_id from scored) g
    cross join lateral (
      select k.id from public.tcg_cards k where k.canonical_id = g.group_id
      union all select g.group_id) k
    join public.tcg_printings p on p.card_id = k.id and p.region = p_region
    where p_region is not null
  ),
  groups as (
    select s.group_id, min(s.score) as score, min(s.sort_name) as sort_name
    from scored s
    where p_region is null or s.group_id in (select group_id from in_region)
    group by s.group_id
  ),
  top_groups as (
    select group_id, score, sort_name from groups
    order by score, sort_name, group_id
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  ),
  -- Two index lookups (canonical_id, id) instead of one OR, which would scan the table.
  cards as (
    select c.*, exists (select 1 from matched m where m.id = c.id) as hit
    from public.tcg_cards c
    where c.id in (
      select k.id from public.tcg_cards k join top_groups g on k.canonical_id = g.group_id
      union
      select k.id from public.tcg_cards k join top_groups g on k.id = g.group_id)
    limit 300
  )
  select jsonb_build_object(
    'matchedBy', case when exists (select 1 from name_matched) then 'name' when exists (select 1 from text_matched) then 'text'
                      when exists (select 1 from series_matched) then 'series' end,
    'matchedSeries', (select count(*) from series_hit),
    'matchCount', (select count(*) from matched),
    'groupCount', (select count(*) from groups),
    'cards', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.id, 'canonicalId', x.canonical_id, 'game', x.game_id, 'seriesId', x.series_id,
      'officialCardNumber', x.official_card_number, 'rarity', x.rarity, 'nameZh', x.name_zh,
      'nameJa', x.name_ja, 'nameEn', x.name_en, 'nameKo', x.name_ko, 'aliases', x.aliases, 'hit', x.hit,
      'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', x.metadata->'nameZhBasis', 'numberStatus', x.metadata->'numberStatus')),
      'printings', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', p.id, 'cardId', p.card_id, 'seriesId', p.series_id, 'region', p.region, 'language', p.language,
          'localSetCode', p.local_set_code, 'localCardNumber', p.local_card_number, 'rarity', p.rarity,
          'rarityCode', p.rarity_code, 'rarityLabel', p.rarity_label, 'imageUrl', p.image_url,
          'sourceUrl', p.source_url, 'source', p.source, 'providerId', p.provider_id,
          'releaseDate', p.release_date, 'imageRehostRequired', p.image_rehost_required,
          'imageRightsStatus', p.image_rights_status, 'imageLicenseExpiresAt', p.image_license_expires_at,
          'metadata', jsonb_strip_nulls(jsonb_build_object(
            'variantKey', p.metadata->'variantKey', 'variantName', p.metadata->'variantName',
            'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial')))) order by p.id)
        from public.tcg_printings p where p.card_id = x.id), '[]'::jsonb), 'images', coalesce((select jsonb_agg(jsonb_build_object('source', i.source, 'imageUrl', i.image_url, 'sourceUrl', i.source_url, 'language', i.language, 'isPrimary', i.is_primary, 'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)) from (select * from public.card_images i where i.card_id = x.id order by i.is_primary desc, i.fetched_at desc limit 3) i), '[]'::jsonb))) order by g.score, g.sort_name, g.group_id, x.id)
      from cards x join top_groups g on g.group_id = coalesce(x.canonical_id, x.id)), '[]'::jsonb));
$function$;
