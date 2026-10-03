-- CardScope: case-insensitive name matching without per-row lower-casing. ilike on
-- non-ASCII text lower-cases every row (a two-character Chinese query took 135 ms, and
-- seconds when the instance CPU is throttled); a stored lower-case copy of the joined
-- names matched with like takes about 25 ms, and its trigram index serves patterns of
-- three or more characters in about 1 ms. Adding the column rewrites tcg_cards once
-- (about 15 s under an exclusive lock). search_cards_ranked is otherwise identical to
-- 20261003110000_search_cards_ranked_series_fallback; the expression index it used is
-- replaced by the index on the stored column.

set local lock_timeout = '20s';

alter table public.tcg_cards add column if not exists search_names text generated always as (
  lower(coalesce(name_zh, '') || chr(1) || coalesce(name_ja, '') || chr(1) || coalesce(name_en, '') || chr(1)
    || coalesce(name_ko, '') || chr(1) || coalesce(official_card_number, ''))
) stored;

comment on column public.tcg_cards.search_names is
  'Lower-case joined names and official card number (chr(1) separated) for search_cards_ranked; generated.';

create index if not exists tcg_cards_search_names_trgm_idx on public.tcg_cards using gin (search_names gin_trgm_ops);
drop index if exists public.tcg_cards_names_trgm_idx;

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
  'Ranked card search in one round trip (names, else search_text, else series names): the best p_limit canonical groups (with a printing in p_region, when given) whose names or official number match any ilike pattern, every card of those groups with printings, trimmed metadata, plus matchedBy, matchedSeries, matchCount and groupCount. service_role only.';

analyze public.tcg_cards;
