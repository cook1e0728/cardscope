-- ADR 0044 Q6/Q7：搜尋分頁、稀有度篩選、matchRank 與「同遊戲相鄰」排序。
--
-- 新增多載 public.search_cards_ranked(p_patterns, p_needles, p_limit, p_region, p_offset, p_rarities)（六個參數，後兩個無預設值）。
-- 舊的四參數版本（20261016090000 的 bigram 版）完全不動：PostgREST 依送出的參數名稱挑函式，舊呼叫（四個參數名）只會對到舊版，
-- 新伺服器送六個參數名只會對到新版；新版不存在時伺服器退回舊版（server.mjs searchCatalogDatabase）。
--
-- 與舊版的差異（其餘比對、索引使用、輸出欄位完全相同）：
--   1. p_offset：群組（作品層卡片）分頁；p_limit 仍上限 100。
--   2. p_rarities：小寫稀有度拼法陣列（代碼＋別名，由伺服器依 data/rarity-rankings.json 展開）；null 或空陣列＝不篩。
--      與 p_region 合併成同一個條件：群組內要有「同時符合版本與稀有度」的 printing 才算（rarity_code 或 rarity 比對，小寫）。
--   3. matchRank（0 完全相符、1 開頭、2 包含、3 只有別名／文字／系列命中）：只比對名稱與卡號，別名不再算 0–2；
--      每張回傳的卡都帶其群組的 matchRank。
--   4. 排序：先依遊戲「最佳排序鍵」，同遊戲相鄰；組內依排序鍵、英文名、群組 id。
--      排序鍵 = matchRank*2 + (原始查詢詞未命中名稱 ? 1 : 0)：「魯夫」被對應成英文 luffy 後，只靠 luffy 命中（例如 Fluffy Berry）排在
--      真的含「魯夫」的卡之後。系列清單（matchedBy=series）維持卡號順序，不做遊戲分組。
--   5. groupCount 現在是套用版本與稀有度之後的群組總數（＝介面的真實總數）。
--
-- ===== 回滾測試（整批回滾，請在交易內執行；不要 COMMIT） =====
--   begin;
--   \i supabase/migrations/20261019090000_search_ranked_offset_rank.sql
--   -- 1) 舊簽章仍在、舊輸出不變（與套用前相同）：
--   select md5(public.search_cards_ranked(array['%魯夫%'],array['魯夫'],40,null)::text);
--   -- 2) 新版：魯夫、不篩選，總數 94（套用前 groupCount 亦為 94）、第一頁 40 組、matchRank 欄位存在：
--   select (r->>'groupCount')::int as total,
--          (select count(distinct coalesce(x->>'canonicalId', x->>'id')) from jsonb_array_elements(r->'cards') x) as groups_in_page,
--          (select min((x->>'matchRank')::int) from jsonb_array_elements(r->'cards') x) as best_rank
--   from (select public.search_cards_ranked(array['%魯夫%','%luffy%'],array['魯夫','luffy'],40,null,0,null) r) t;
--   -- 預期：total=94 起算（以資料庫現況為準）、groups_in_page=40、best_rank=1 或更小。
--   -- 3) 分頁不重疊：offset 40 與 offset 0 的群組集合交集為空：
--   select count(*) from (
--     select distinct coalesce(x->>'canonicalId', x->>'id') g from jsonb_array_elements(
--       public.search_cards_ranked(array['%魯夫%'],array['魯夫'],40,null,0,null)->'cards') x
--     intersect
--     select distinct coalesce(x->>'canonicalId', x->>'id') from jsonb_array_elements(
--       public.search_cards_ranked(array['%魯夫%'],array['魯夫'],40,null,40,null)->'cards') x) z;   -- 預期 0
--   -- 4) 稀有度＋版本：桃歹郎 日版 SAR 的 groupCount 小於不篩選的 groupCount，且回傳的每個群組都有 JP＋SAR printing：
--   select (public.search_cards_ranked(array['%桃歹郎%'],array['桃歹郎'],40,'JP',0,array['sar','special art rare','special illustration rare'])->>'groupCount')::int
--        < (public.search_cards_ranked(array['%桃歹郎%'],array['桃歹郎'],40,null,0,null)->>'groupCount')::int as narrower;   -- 預期 t
--   rollback;
--
-- ===== 回滾（移除本 migration；舊版不受影響） =====
--   drop function if exists public.search_cards_ranked(text[], text[], integer, text, integer, text[]);

create or replace function public.search_cards_ranked(
  p_patterns text[], p_needles text[], p_limit integer, p_region text, p_offset integer, p_rarities text[])
returns jsonb
language sql
stable
set search_path to ''
as $function$
  -- 名稱比對與 20261016090000 的版本相同：恰為 %兩字% 的樣式走 bigram GIN，其餘走 trigram。
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
  matched as (
    select id, null::bigint as ord from name_matched
    union all select id, null from text_matched
    union all select id, ord from series_matched
  ),
  -- is_primary：p_needles 的第一個（使用者原本打的詞；其餘是別名對應或寫法變體）。
  needles as (
    select needle, bool_or(is_primary) as is_primary
    from (select public.tcg_search_fold(n) as needle, o = 1 as is_primary from unnest(p_needles) with ordinality t(n, o)) f
    where needle <> ''
    group by needle
  ),
  scored as (
    select c.id, c.game_id, coalesce(c.canonical_id, c.id) as group_id,
      case when m.ord is null then coalesce(c.name_en, c.name_zh, '') else '' end as sort_name,
      m.ord is not null as is_series,
      -- 只比對名稱與卡號（別名不算）；沒有任何名稱命中（只靠別名／文字／系列）＝ 3。
      case when m.ord is not null then 3 else coalesce(r.name_score, 3) end as rank,
      case when m.ord is not null then m.ord
           else coalesce(r.name_score, 3) * 2 + (case when r.primary_hit then 0 else 1 end) end as sort_key
    from public.tcg_cards c
    join matched m on m.id = c.id
    cross join lateral (
      select min(case when f.name = nd.needle then 0 when left(f.name, length(nd.needle)) = nd.needle then 1
                      when strpos(f.name, nd.needle) > 0 then 2 end) as name_score,
             coalesce(bool_or(nd.is_primary and strpos(f.name, nd.needle) > 0), false) as primary_hit
      from (select public.tcg_search_fold(v) as name
            from unnest(array[c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number]) v
            where v is not null) f
      cross join needles nd
      where f.name <> ''
    ) r
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
