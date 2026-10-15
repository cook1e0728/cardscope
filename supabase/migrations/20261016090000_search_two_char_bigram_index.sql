-- CardScope：兩字查詢（魯夫、超夢）不再讀整張 tcg_cards 堆積表。
-- 原因：search_names 的 trigram 索引對兩字樣式（沒有任何 trigram）回傳全部 7.6 萬列，bitmap heap scan 讀完 6,497 個 8 kB 區塊（51 MB）；
-- 暖快取約 0.3 秒，冷快取（剛啟動或被擠出）實測 8–23 秒。三字以上的樣式本來就用 trigram 索引，只讀幾十個區塊。
-- 修正：樣式剛好是「%兩個字%」時，兩個字就是一個 bigram，改查 tcg_search_bigrams(search_names) 的 GIN 索引（約 6–9 MB），
-- 再用原本的 like 複核；其他樣式的程式路徑不變。search_cards_ranked 簽章與輸出不變，只改 name_matched 這一段。
-- 套用時 create index 會短暫擋住 tcg_cards 寫入（全表約 7.6 萬列），不重寫資料表，不需要 VACUUM。

set local lock_timeout = '20s';

create or replace function public.tcg_search_bigrams(t text)
returns text[]
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(distinct substr(t, i, 2)), '{}'::text[])
  from generate_series(1, length(t) - 1) as i
$$;

comment on function public.tcg_search_bigrams(text) is
  'Distinct two-character windows of a string; GIN-indexed on tcg_cards.search_names so two-character searches avoid a full heap scan.';

create index if not exists tcg_cards_search_names_bigram_idx on public.tcg_cards using gin (public.tcg_search_bigrams(search_names));

analyze public.tcg_cards;

CREATE OR REPLACE FUNCTION public.search_cards_ranked(p_patterns text[], p_needles text[], p_limit integer DEFAULT 40, p_region text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- A two-character pattern has no trigram, so the trigram index hands back every row (76k) and the bitmap scan reads the
  -- whole 51 MB heap (魯夫: 8-23 s with a cold cache). A two-character substring is exactly one bigram, so
  -- tcg_search_bigrams (GIN) finds those rows directly; the like stays as a filter and (|| '') keeps it off the trigram index.
  -- Every other pattern takes the trigram index as before; the branch not taken is skipped by a one-time filter.
  with name_matched as (
    select distinct c.id
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k
      where lower(pattern) !~ '^%[^%_\\]{2}%$' and k.search_names like lower(pattern)
      union all
      select k.id from public.tcg_cards k
      where lower(pattern) ~ '^%[^%_\\]{2}%$'
        and public.tcg_search_bigrams(k.search_names) @> array[substr(lower(pattern), 2, 2)]
        and (k.search_names || '') like lower(pattern)
    ) c
  ),
  -- Only when no name matched: search_text (card numbers such as SV6a-039, provider IDs), at most 100 cards.
  -- With p_region only cards printed in that region count, so other regions cannot fill the 100 slots
  -- (US search_text carries the series name "30th Celebration"; JP cards would never be reached).
  text_matched as (
    select distinct c.id
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k where k.search_text ilike pattern
        and (p_region is null or exists (select 1 from public.tcg_printings p where p.card_id = k.id and p.region = p_region))
      limit 100
    ) c
    where not exists (select 1 from name_matched)
  ),
  -- Only when no card matched at all: series names or codes (「ナイトワンダラー」, "SV6a"), at most 5 series,
  -- listing their first 100 printings in card-number order; ord keeps that order.
  -- With p_region only that region's series are candidates (otherwise 5 other-region series could fill the slots and
  -- the region filter below would leave nothing, e.g. 30th on the JP page picked the US me55 sets); newest first.
  series_hit as (
    select s.id, row_number() over (order by s.release_date desc nulls last, s.id) as srank
    from public.tcg_series s
    where not exists (select 1 from name_matched) and not exists (select 1 from text_matched)
      and (p_region is null or s.region = p_region)
      and exists (select 1 from unnest(p_patterns) pattern
                  where s.name_zh ilike pattern or s.name_ja ilike pattern or s.name_en ilike pattern
                     or s.name_ko ilike pattern or s.official_code ilike pattern)
    order by s.release_date desc nulls last, s.id
    limit 5
  ),
  series_matched as (
    select card_id as id, min(ord) as ord
    from (select p.card_id, row_number() over (order by h.srank, p.local_card_number, p.card_id) as ord
          from public.tcg_printings p join series_hit h on h.id = p.series_id
          where p_region is null or p.region = p_region
          order by h.srank, p.local_card_number, p.card_id limit 100) x
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
            'imageId', p.metadata->'imageId', 'rarityBeforeOfficial', p.metadata->'rarityBeforeOfficial', 'officialListing', p.metadata->'officialListing')))) order by p.id)
        from public.tcg_printings p where p.card_id = x.id), '[]'::jsonb), 'images', coalesce((select jsonb_agg(jsonb_build_object('source', i.source, 'imageUrl', i.image_url, 'sourceUrl', i.source_url, 'language', i.language, 'isPrimary', i.is_primary, 'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)) from (select * from public.card_images i where i.card_id = x.id order by i.is_primary desc, i.fetched_at desc limit 3) i), '[]'::jsonb))) order by g.score, g.sort_name, g.group_id, x.id)
      from cards x join top_groups g on g.group_id = coalesce(x.canonical_id, x.id)), '[]'::jsonb));
$function$;


revoke all on function public.search_cards_ranked(text[], text[], integer, text) from public, anon, authenticated;
grant execute on function public.search_cards_ranked(text[], text[], integer, text) to service_role;
