-- 複合特徵搜尋（系列＋卡片特徵交集）：
-- 新增 7 參數多載 public.search_cards_ranked(p_patterns, p_needles, p_limit, p_region, p_offset, p_rarities, p_series_ids)，
-- 讓「30th皮卡丘」「30周年皮卡丘 SAR」「M6a皮卡丘」「151 夢幻ex」在資料庫內直接做「系列印刷 × 卡名／卡號／稀有度／版本」交集。
-- 既有 4 參數與 6 參數多載完全保留不動（支援零停機部署與舊端相容），不新增任何表與索引（0 MB 儲存增量）。
-- 同時修正 search_fold_names 的反斜線 LIKE 跳脫筆誤（'\' -> '\\'）。
--
-- ===== 回滾 =====
--   drop function if exists public.search_cards_ranked(text[], text[], integer, text, integer, text[], text[]);

create or replace function public.search_cards_ranked(
  p_patterns text[],
  p_needles text[],
  p_limit integer,
  p_region text,
  p_offset integer,
  p_rarities text[],
  p_series_ids text[]
)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  with params as (
    select
      coalesce(p_series_ids, '{}'::text[])[1:50] as series_ids,
      cardinality(coalesce(p_series_ids, '{}'::text[])) > 0 as has_series_scope,
      coalesce(p_rarities, '{}'::text[]) as rarities,
      cardinality(coalesce(p_rarities, '{}'::text[])) > 0 as has_rarities
  ),
  -- 複合模式（有 p_series_ids）：以既有 tcg_printings_series_idx 找出在目標系列內且同時符合版本與稀有度的 canonical 群組，
  -- 不截斷系列前 100 張，並記錄群組在 p_series_ids 中的最優先順序與卡號供同分排序。
  series_scope_groups as materialized (
    select
      coalesce(c.canonical_id, c.id) as group_id,
      min(array_position(pm.series_ids, p.series_id)) as series_pos,
      min(p.local_card_number) as series_card_no
    from params pm
    join public.tcg_printings p on pm.has_series_scope
      and p.series_id = any(pm.series_ids)
      and (p_region is null or p.region = p_region)
      and (not pm.has_rarities or lower(p.rarity_code) = any(pm.rarities) or lower(p.rarity) = any(pm.rarities))
    join public.tcg_cards c on c.id = p.card_id
    group by coalesce(c.canonical_id, c.id)
  ),
  -- 拉出符合系列群組的所有卡片（含同 canonical_id 的跨地區兄弟卡，例如 JP 卡借用 TW 兄弟卡的 name_zh）。
  scoped_cards as materialized (
    select distinct on (c.id)
      c.id, c.game_id, c.canonical_id, c.name_zh, c.name_ja, c.name_en, c.name_ko,
      c.official_card_number, c.search_names, c.search_text
    from (
      select k.id from public.tcg_cards k join series_scope_groups g on k.canonical_id = g.group_id
      union
      select k.id from public.tcg_cards k join series_scope_groups g on k.id = g.group_id
    ) ids
    join public.tcg_cards c on c.id = ids.id
  ),
  scoped_name_matched as (
    select distinct on (c.id)
      c.id, c.game_id, c.canonical_id, c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number
    from scoped_cards c
    where exists (
      select 1 from unnest(p_patterns) as pattern
      where c.search_names like lower(pattern)
    )
    or exists (
      select 1 from public.tcg_printings p, params pm, unnest(p_patterns) as pattern
      where p.card_id = c.id
        and p.series_id = any(pm.series_ids)
        and (p_region is null or p.region = p_region)
        and (not pm.has_rarities or lower(p.rarity_code) = any(pm.rarities) or lower(p.rarity) = any(pm.rarities))
        and lower(coalesce(p.local_card_number, '')) like lower(pattern)
    )
  ),
  scoped_text_matched as (
    select c.id, c.game_id, c.canonical_id, c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number
    from scoped_cards c
    where not exists (select 1 from scoped_name_matched)
      and exists (
        select 1 from unnest(p_patterns) as pattern
        where c.search_text ilike pattern
      )
  ),
  -- 一般模式（無 p_series_ids）：沿用 20261020090000 快速索引路徑。
  name_matched as (
    select distinct on (c.id) c.id, c.game_id, c.canonical_id, c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number
    from params pm
    cross join unnest(p_patterns) as pattern
    cross join lateral (
      select k.id, k.game_id, k.canonical_id, k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number from public.tcg_cards k
      where not pm.has_series_scope and lower(pattern) !~ '^%[^%_\\]{1,2}%$' and k.search_names like lower(pattern)
      union all
      select k.id, k.game_id, k.canonical_id, k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number from public.tcg_cards k
      where not pm.has_series_scope and lower(pattern) ~ '^%[^%_\\]%$' and (k.search_names || '') like lower(pattern)
      union all
      select k.id, k.game_id, k.canonical_id, k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number from public.tcg_cards k
      where not pm.has_series_scope and lower(pattern) ~ '^%[^%_\\]{2}%$'
        and public.tcg_search_bigrams(k.search_names) @> array[substr(lower(pattern), 2, 2)]
        and (k.search_names || '') like lower(pattern)
    ) c
    where not pm.has_series_scope
  ),
  text_matched as (
    select distinct c.id
    from params pm
    cross join unnest(p_patterns) as pattern
    cross join lateral (
      select k.id from public.tcg_cards k where k.search_text ilike pattern
        and (p_region is null or exists (select 1 from public.tcg_printings p where p.card_id = k.id and p.region = p_region))
      limit 100
    ) c
    where not pm.has_series_scope and not exists (select 1 from name_matched)
  ),
  series_hit as (
    select s.id, row_number() over (order by s.release_date desc nulls last, s.id) as srank
    from public.tcg_series s, params pm
    where not pm.has_series_scope and not exists (select 1 from name_matched) and not exists (select 1 from text_matched)
      and (p_region is null or s.region = p_region)
      and exists (select 1 from unnest(p_patterns) pattern
                  where s.name_zh ilike pattern or s.name_ja ilike pattern or s.name_en ilike pattern
                     or s.name_ko ilike pattern or s.official_code ilike pattern)
    order by s.release_date desc nulls last, s.id
    limit 12
  ),
  series_matched as (
    select card_id as id, min(ord) as ord
    from (select p.card_id, row_number() over (order by h.srank, p.local_card_number, p.card_id) as ord
          from public.tcg_printings p join series_hit h on h.id = p.series_id
          where p_region is null or p.region = p_region
          order by h.srank, p.local_card_number, p.card_id limit 100) x
    group by card_id
  ),
  cand as (
    select id, game_id, canonical_id, name_zh, name_ja, name_en, name_ko, official_card_number, null::bigint as ord from scoped_name_matched
    union all
    select id, game_id, canonical_id, name_zh, name_ja, name_en, name_ko, official_card_number, null::bigint as ord from scoped_text_matched
    union all
    select id, game_id, canonical_id, name_zh, name_ja, name_en, name_ko, official_card_number, null::bigint as ord from name_matched
    union all
    select c.id, c.game_id, c.canonical_id, c.name_zh, c.name_ja, c.name_en, c.name_ko, c.official_card_number, m.ord
    from (select id, null::bigint as ord from text_matched union all select id, ord from series_matched) m
    join public.tcg_cards c on c.id = m.id
  ),
  matched as (select id, ord from cand),
  needles as materialized (
    select needle, bool_or(is_primary) as is_primary
    from (select public.tcg_search_fold(n) as needle, o = 1 as is_primary from unnest(p_needles) with ordinality t(n, o)) f
    where needle <> ''
    group by needle
  ),
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
      case when c.ord is not null then 3 else coalesce(r.name_score, 3) end as rank,
      case when c.ord is not null then c.ord
           else coalesce(r.name_score, 3) * 2 + (case when r.primary_hit then 0 else 1 end) end as sort_key
    from cand c
    left join card_score r on r.id = c.id
  ),
  -- 一般模式才需要另外檢查 in_filter；複合模式已在 series_scope_groups 完成同印刷層的版本＋稀有度＋系列檢查。
  in_filter as (
    select distinct g.group_id
    from params pm
    join (select distinct group_id from scored) g on not pm.has_series_scope and (p_region is not null or pm.has_rarities)
    cross join lateral (
      select k.id from public.tcg_cards k where k.canonical_id = g.group_id
      union all select g.group_id) k
    join public.tcg_printings p on p.card_id = k.id
      and (p_region is null or p.region = p_region)
      and (not pm.has_rarities or lower(p.rarity_code) = any(pm.rarities) or lower(p.rarity) = any(pm.rarities))
  ),
  groups as (
    select s.group_id, min(s.rank) as rank, min(s.sort_key) as sort_key, min(s.sort_name) as sort_name,
           min(s.game_id) as game_id, bool_or(s.is_series) as is_series,
           min(sg.series_pos) as series_pos, min(sg.series_card_no) as series_card_no
    from scored s
    cross join params pm
    left join series_scope_groups sg on sg.group_id = s.group_id
    where pm.has_series_scope
       or (p_region is null and not pm.has_rarities)
       or s.group_id in (select group_id from in_filter)
    group by s.group_id
  ),
  ordered as (
    select g.*, case when g.is_series then 0 else min(g.sort_key) over (partition by g.game_id) end as game_best
    from groups g
  ),
  numbered as (
    select o.group_id, o.rank, row_number() over (
      order by o.game_best, case when o.is_series then '' else o.game_id end, o.sort_key,
               coalesce(o.series_pos, 2147483647), coalesce(o.series_card_no, ''), o.sort_name, o.group_id) as pos
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
    'matchedBy', case when exists (select 1 from scoped_name_matched) then 'series+name'
                      when exists (select 1 from scoped_text_matched) then 'series+text'
                      when exists (select 1 from name_matched) then 'name'
                      when exists (select 1 from text_matched) then 'text'
                      when exists (select 1 from series_matched) then 'series' end,
    'matchedSeries', case when (select has_series_scope from params) then (select cardinality(series_ids) from params)
                          else (select count(*) from series_hit) end,
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

revoke all on function public.search_cards_ranked(text[], text[], integer, text, integer, text[], text[]) from public, anon, authenticated;
grant execute on function public.search_cards_ranked(text[], text[], integer, text, integer, text[], text[]) to service_role;

comment on function public.search_cards_ranked(text[], text[], integer, text, integer, text[], text[]) is
  'Compound-aware ranked card search: when p_series_ids is non-empty, intersects target series printings (with region & rarity) against card names/numbers/text across canonical siblings in one round trip. service_role only.';

-- 修正 search_fold_names 的反斜線 LIKE 跳脫（原 migration 寫成 replace(..., ''\'', ''\'') 為無效跳脫）。
create or replace function public.search_fold_names(p_fold text, p_limit integer default 5)
returns table(name text, hits bigint)
language sql
stable
set search_path to ''
as $function$
  with q as (
    select '%' || replace(replace(replace(public.tcg_search_fold(p_fold), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
           length(public.tcg_search_fold(p_fold)) as len
  ),
  m as (
    select k.name_zh, k.name_ja, k.name_en, k.name_ko, k.official_card_number
    from public.tcg_cards k, q
    where q.len >= 3 and public.tcg_search_fold(k.search_names) like q.pattern
    limit 300
  )
  select f.v, count(*)
  from m
  cross join lateral unnest(array[m.name_zh, m.name_ja, m.name_en, m.name_ko, m.official_card_number]) as f(v)
  cross join q
  where f.v is not null and public.tcg_search_fold(f.v) like q.pattern
  group by f.v
  order by count(*) desc, length(f.v), f.v
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$function$;

revoke all on function public.search_fold_names(text, integer) from public, anon, authenticated;
grant execute on function public.search_fold_names(text, integer) to service_role;
