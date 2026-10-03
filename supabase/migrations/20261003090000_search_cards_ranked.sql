-- CardScope: smaller, ranked card search in one round trip. search_cards_with_siblings
-- returned up to 100 unordered hits plus siblings with full metadata (150-230 KB for
-- common words), and the server then ranked and kept 40. This function ranks in SQL
-- with the same scoring as the server (exact name 0, prefix 1, substring 2, other 3),
-- keeps the best p_limit canonical groups, returns every card of those groups with
-- printings, and trims metadata to the keys the search UI reads. A trigram index on
-- the joined name columns lets longer patterns skip the sequential scan.

create index if not exists tcg_cards_names_trgm_idx on public.tcg_cards using gin (
  (coalesce(name_zh, '') || chr(1) || coalesce(name_ja, '') || chr(1) || coalesce(name_en, '') || chr(1)
    || coalesce(name_ko, '') || chr(1) || coalesce(official_card_number, '')) gin_trgm_ops
);

-- Same folding as the server's normalizeSearch: lower case, NFKC, drop spaces and the
-- separators / Source name markup characters it ignores.
create or replace function public.tcg_search_fold(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(normalize(lower(coalesce(p_value, '')), NFKC),
    '[[:space:]・·._:：''’"<>\[\]​-‍⁠﻿-]', '', 'g');
$$;

create or replace function public.search_cards_ranked(
  p_patterns text[],
  p_needles text[],
  p_limit integer default 40,
  p_region text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with matched as (
    select distinct c.id
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k
      where (coalesce(k.name_zh, '') || chr(1) || coalesce(k.name_ja, '') || chr(1) || coalesce(k.name_en, '') || chr(1)
        || coalesce(k.name_ko, '') || chr(1) || coalesce(k.official_card_number, '')) ilike pattern
    ) c
  ),
  needles as (
    select distinct public.tcg_search_fold(n) as needle from unnest(p_needles) n where public.tcg_search_fold(n) <> ''
  ),
  scored as (
    select c.id, coalesce(c.canonical_id, c.id) as group_id, coalesce(c.name_en, c.name_zh, '') as sort_name,
      coalesce((
        select min(case when f.name = nd.needle then 0 when left(f.name, length(nd.needle)) = nd.needle then 1
                        when strpos(f.name, nd.needle) > 0 then 2 end)
        from (select public.tcg_search_fold(v) as name
              from unnest(array[c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number] || coalesce(c.aliases, '{}')) v
              where v is not null) f
        cross join needles nd
        where f.name <> ''), 3) as score
    from public.tcg_cards c
    where c.id in (select id from matched)
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
    'matchCount', (select count(*) from matched),
    'groupCount', (select count(*) from groups),
    'cards', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.id, 'canonicalId', x.canonical_id, 'game', x.game_id, 'seriesId', x.series_id,
      'officialCardNumber', x.official_card_number, 'rarity', x.rarity, 'nameZh', x.name_zh,
      'nameJa', x.name_ja, 'nameEn', x.name_en, 'nameKo', x.name_ko, 'aliases', x.aliases, 'hit', x.hit,
      'metadata', jsonb_strip_nulls(jsonb_build_object('nameZhBasis', x.metadata->'nameZhBasis')),
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
        from public.tcg_printings p where p.card_id = x.id), '[]'::jsonb))) order by g.score, g.sort_name, g.group_id, x.id)
      from cards x join top_groups g on g.group_id = coalesce(x.canonical_id, x.id)), '[]'::jsonb));
$$;

revoke all on function public.search_cards_ranked(text[], text[], integer, text) from public, anon, authenticated;
grant execute on function public.search_cards_ranked(text[], text[], integer, text) to service_role;

comment on function public.search_cards_ranked(text[], text[], integer, text) is
  'Ranked card search in one round trip: the best p_limit canonical groups (with a printing in p_region, when given) whose names or official number match any ilike pattern, every card of those groups with printings, trimmed metadata, plus matchCount and groupCount. service_role only.';
