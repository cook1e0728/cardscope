-- 搜尋加速：命中數千張的短詞（ex、V、01）。簽章、輸出（jsonb 欄位、內容、順序、groupCount／matchCount）與
-- 20261019090000 完全相同，只改內部算法；舊的四參數版本不動。
--
-- 診斷（EXPLAIN ANALYZE，正式庫）：慢在 `scored`——每張命中的卡都各自重算一次 needles、各自 fold 五個欄位（fold 在內嵌後還算兩次），
-- 再用主鍵回表一次。ex 命中 4,246 張約 0.5 s（暖快取）、V 7,777 張約 1.2 s、01 約 0.9 s；伺服器端偶爾慢到 3–6 s 是同一份 CPU 工作遇到共用 CPU 被限速。
--
-- 改法（比對、索引使用、排序規則都不變）：
--   1. name_matched 在同一次 heap 掃描就帶出評分要用的欄位，不再用主鍵回表。
--   2. needles 只算一次（materialized）。
--   3. fold 與名稱階層（0 完全相符、1 開頭、2 包含）只依「欄位值」和 needle，不依卡片：
--      先把命中卡片所有不同的欄位值算一次（常見名稱大量重複，約為欄位數的 5–30%），再依欄位值 join 回卡片取最小階層。
--
-- ===== 回滾（移除本 migration 的效果：還原成 20261019090000 的函式內容） =====
--   重新執行 supabase/migrations/20261019090000_search_ranked_offset_rank.sql 的 create or replace function 區塊即可。

create or replace function public.search_cards_ranked(
  p_patterns text[], p_needles text[], p_limit integer, p_region text, p_offset integer, p_rarities text[])
returns jsonb
language sql
stable
set search_path to ''
as $function$
  -- 名稱比對與 20261016090000 的版本相同：恰為 %兩字% 的樣式走 bigram GIN，其餘走 trigram。
  -- 多帶幾個欄位（評分用）是同一次 heap 掃描就有的資料。
  with name_matched as (
    select distinct on (c.id) c.id, c.game_id, c.canonical_id, c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number
    from unnest(p_patterns) as pattern
    cross join lateral (
      select k.id, k.game_id, k.canonical_id, k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number from public.tcg_cards k
      where lower(pattern) !~ '^%[^%_\\]{1,2}%$' and k.search_names like lower(pattern)
      union all
      -- 單字樣式（%V%）沒有 trigram 可用，走索引反而得讀整個 GIN 再逐筆複核；`|| ''` 讓它直接掃表（約 40 ms）。
      select k.id, k.game_id, k.canonical_id, k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number from public.tcg_cards k
      where lower(pattern) ~ '^%[^%_\\]%$' and (k.search_names || '') like lower(pattern)
      union all
      select k.id, k.game_id, k.canonical_id, k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number from public.tcg_cards k
      where lower(pattern) ~ '^%[^%_\\]{2}%$'
        and public.tcg_search_bigrams(k.search_names) @> array[substr(lower(pattern), 2, 2)]
        and (k.search_names || '') like lower(pattern)
    ) c
  ),
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
  -- 三種命中方式互斥（後兩種只在前一種沒有任何命中時才有列）；cand = 命中的卡片＋評分用欄位。
  cand as (
    select id, game_id, canonical_id, name_zh, name_ja, name_en, name_ko, official_card_number, null::bigint as ord from name_matched
    union all
    select c.id, c.game_id, c.canonical_id, c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number, m.ord
    from (select id, null::bigint as ord from text_matched union all select id, ord from series_matched) m
    join public.tcg_cards c on c.id = m.id
  ),
  matched as (select id, ord from cand),
  -- is_primary：p_needles 的第一個（使用者原本打的詞；其餘是別名對應或寫法變體）。
  needles as materialized (
    select needle, bool_or(is_primary) as is_primary
    from (select public.tcg_search_fold(n) as needle, o = 1 as is_primary from unnest(p_needles) with ordinality t(n, o)) f
    where needle <> ''
    group by needle
  ),
  -- 每個不同的欄位值各算一次：fold 後與每個 needle 比（0 完全相符、1 開頭、2 包含），fold 後為空字串的值不參與。
  vscore as (
    select f.v,
           min(case when f.name = nd.needle then 0 when left(f.name, length(nd.needle)) = nd.needle then 1
                    when strpos(f.name, nd.needle) > 0 then 2 end) as name_score,
           bool_or(nd.is_primary and strpos(f.name, nd.needle) > 0) as primary_hit
    from (select d.v, public.tcg_search_fold(d.v) as name
          from (select name_zh as v from cand union select name_ja from cand union select name_en from cand
                union select name_ko from cand union select official_card_number from cand) d
          where d.v is not null offset 0) f
    cross join needles nd
    where f.name <> ''
    group by f.v
  ),
  -- 卡片的階層＝它所有欄位值中最好的一個（只比對名稱與卡號，別名不算）。
  card_score as (
    select u.id, min(s.name_score) as name_score, bool_or(s.primary_hit) as primary_hit
    from (select c.id, x.v from cand c
          cross join lateral unnest(array[c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number]) x(v)) u
    join vscore s on s.v = u.v
    group by u.id
  ),
  scored as (
    select c.id, c.game_id, coalesce(c.canonical_id, c.id) as group_id,
      case when c.ord is null then coalesce(c.name_en, c.name_zh, '') else '' end as sort_name,
      c.ord is not null as is_series,
      -- 沒有任何名稱命中（只靠別名／文字／系列）＝ 3。
      case when c.ord is not null then 3 else coalesce(r.name_score, 3) end as rank,
      case when c.ord is not null then c.ord
           else coalesce(r.name_score, 3) * 2 + (case when r.primary_hit then 0 else 1 end) end as sort_key
    from cand c
    left join card_score r on r.id = c.id
  ),
  -- 版本與稀有度同一個 printing 都要符合（伺服器之後只留這些 printing）；以 canonical 群組做索引查詢。
  in_filter as (
    select distinct g.group_id
    from (select distinct group_id from scored) g
    cross join lateral (
      select k.id from public.tcg_cards k where k.canonical_id = g.group_id
      union all select g.group_id) k
    join public.tcg_printings p on p.card_id = k.id
      and (p_region is null or p.region = p_region)
      and (cardinality(coalesce(p_rarities, '{}')) = 0
           or lower(p.rarity_code) = any (p_rarities) or lower(p.rarity) = any (p_rarities))
    where p_region is not null or cardinality(coalesce(p_rarities, '{}')) > 0
  ),
  groups as (
    select s.group_id, min(s.rank) as rank, min(s.sort_key) as sort_key, min(s.sort_name) as sort_name,
           min(s.game_id) as game_id, bool_or(s.is_series) as is_series
    from scored s
    where (p_region is null and cardinality(coalesce(p_rarities, '{}')) = 0) or s.group_id in (select group_id from in_filter)
    group by s.group_id
  ),
  ordered as (
    select g.*, case when g.is_series then 0 else min(g.sort_key) over (partition by g.game_id) end as game_best
    from groups g
  ),
  numbered as (
    select o.group_id, o.rank, row_number() over (
      order by o.game_best, case when o.is_series then '' else o.game_id end, o.sort_key, o.sort_name, o.group_id) as pos
    from ordered o
  ),
  top_groups as (
    select group_id, rank, pos from numbered
    where pos > greatest(coalesce(p_offset, 0), 0)
      and pos <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 40), 1), 100)
  ),
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
      'matchRank', g.rank,
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
        from public.tcg_printings p where p.card_id = x.id), '[]'::jsonb), 'images', coalesce((select jsonb_agg(jsonb_build_object('source', i.source, 'imageUrl', i.image_url, 'sourceUrl', i.source_url, 'language', i.language, 'isPrimary', i.is_primary, 'imageRightsStatus', i.image_rights_status, 'imageLicenseExpiresAt', i.image_license_expires_at)) from (select * from public.card_images i where i.card_id = x.id order by i.is_primary desc, i.fetched_at desc limit 3) i), '[]'::jsonb))) order by g.pos, x.id)
      from cards x join top_groups g on g.group_id = coalesce(x.canonical_id, x.id)), '[]'::jsonb));
$function$;

revoke all on function public.search_cards_ranked(text[], text[], integer, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.search_cards_ranked(text[], text[], integer, text, integer, text[]) to service_role;
