-- 搜尋零結果時的「你是不是要找」：用 pg_trgm 在卡名（繁中／日／英／韓）上找最相似的一個名稱。
-- 不新增索引也不新增資料：沿用 20261003120000 的 tcg_cards_search_names_trgm_idx（GIN gin_trgm_ops，支援 <% 運算子）取候選，
-- 只對候選（上限 200 張）逐欄算相似度；實測 100 ms 內。word_similarity_threshold 在函式內（只限該交易）降到 0.3，
-- 讓「噴火籠」這種一字之差（只有 2 個共用 trigram）也能當候選；同分時取在候選裡出現最多次的名稱（噴火籠：噴火龍比噴火駝常見）；最後還要整串 similarity 達門檻（中日韓 0.3、拉丁字母 0.45）才回傳，避免亂湊。
-- 伺服器只在零結果時呼叫。不動 search_cards_ranked；只新增本函式。
--
-- ===== 回滾 =====
--   drop function if exists public.search_name_suggestion(text, text);

create extension if not exists pg_trgm with schema extensions;

create or replace function public.search_name_suggestion(p_q text, p_region text default null)
returns text
language plpgsql
volatile
set search_path to public, extensions
as $function$
begin
  -- 閾值只在這個交易內降到 0.3（函式層級的 SET 不允許設擴充套件參數）。
  perform set_config('pg_trgm.word_similarity_threshold', '0.3', true);
  return (
  with q as (select lower(btrim(coalesce(p_q, ''))) as t),
  cand as (
    select k.name_zh, k.name_ja, k.name_en, k.name_ko
    from public.tcg_cards k, q
    where length(q.t) >= 3 and q.t <% k.search_names
      and (p_region is null or exists (select 1 from public.tcg_printings p where p.card_id = k.id and p.region = p_region))
    order by word_similarity(q.t, k.search_names) desc
    limit 200
  )
  select f.name
  from cand c
  cross join lateral unnest(array[c.name_zh, c.name_ja, c.name_en, c.name_ko]) as f(name)
  cross join q
  where f.name is not null and btrim(f.name) <> '' and lower(f.name) <> q.t
    -- 含中日韓字的查詢 trigram 本來就少（三個字只有 4 個），門檻 0.3；純拉丁字母的門檻 0.45，避免 pokemon -> Poker 這種湊出來的建議。
    and similarity(lower(f.name), q.t) >= case when q.t ~ '[^ -~]' then 0.3 else 0.45 end
  group by f.name, q.t
  order by similarity(lower(f.name), q.t) desc, count(*) desc, length(f.name), f.name
  limit 1
  );
end
$function$;

comment on function public.search_name_suggestion(text, text) is
  'Closest card name (any language) to a query that found nothing; pg_trgm word_similarity on search_names narrows, similarity picks. NULL when nothing is close.';

revoke all on function public.search_name_suggestion(text, text) from public, anon, authenticated;
grant execute on function public.search_name_suggestion(text, text) to service_role;
