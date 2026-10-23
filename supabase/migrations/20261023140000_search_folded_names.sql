-- 搜尋忽略空白與中點：「日向翔陽」「阿羅拉喵喵」找不到資料裡寫成「日向 翔陽」「阿羅拉 喵喵」的卡；
-- 「OP-17-118」「BETB EN060」找不到「OP17-118」「BETB-EN060」。
-- 做法：在 tcg_search_fold（與 search_cards_ranked 評分同一個折疊：小寫、NFKC、去空白／中點／連字號等）後的 search_names 上
-- 建一個 trigram GIN 索引，新函式 search_fold_names 只回「折疊後包含查詢」的卡名原文（依出現次數排序）。
-- 伺服器只在一般搜尋零結果時呼叫它，再用回傳的原文寫法（例如「日向 翔陽」）重新搜尋一次，排序、分頁、稀有度篩選都沿用原本的路徑。
-- 不改 search_cards_ranked；只新增本函式與一個索引（約 9 MB，與 tcg_cards_search_names_trgm_idx 同級）。
-- 折疊後少於 3 個字元沒有 trigram 可用，函式直接回空（避免掃整張表）。
--
-- ===== 回滾 =====
--   drop function if exists public.search_fold_names(text, integer);
--   drop index if exists public.tcg_cards_search_names_fold_trgm_idx;

set local lock_timeout = '20s';

create index if not exists tcg_cards_search_names_fold_trgm_idx
  on public.tcg_cards using gin ((public.tcg_search_fold(search_names)) extensions.gin_trgm_ops);

create or replace function public.search_fold_names(p_fold text, p_limit integer default 5)
returns table(name text, hits bigint)
language sql
stable
set search_path to ''
as $function$
  with q as (
    select '%' || replace(replace(replace(public.tcg_search_fold(p_fold), '\', '\'), '%', '\%'), '_', '\_') || '%' as pattern,
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

comment on function public.search_fold_names(text, integer) is
  'Card names (any language) and card numbers whose tcg_search_fold contains the folded query; used when a search found nothing to retry with the database''s own spelling (spaces, middle dots, hyphens).';

revoke all on function public.search_fold_names(text, integer) from public, anon, authenticated;
grant execute on function public.search_fold_names(text, integer) to service_role;
