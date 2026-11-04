-- 卡牆與詳細頁的「近 7 天漲跌」需要比較價：每個 (card, provider, variant) 在 p_days 天前（含）的最新一筆（2026-11-05）。
--   price_snapshots 只在價格變動約 2% 以上才寫一筆，所以某一天的價格＝那天或之前最近一筆；這裡取 snapshot_date <= 今天 - p_days 的最新列。
--   超過 60 天的舊紀錄不算（太舊的比較沒有意義），讓伺服器當沒有比較價。provider 篩選與 price_reference_best 相同（cardmarket，加上 'tcgapi-' 開頭的 tcgplayer）。
--   伺服器用 card_id + provider + variant 配回 price_reference_best 選出的那一筆再算百分比。只新增函式：不改既有函式、不建表、不加索引（主鍵 card_id, provider, variant, snapshot_date 已足夠）。
--   權限與 price_reference_best 相同（20261102090000 之後的慣例）：只有 service_role 能呼叫，伺服器用 service key 查。

create or replace function public.price_reference_prior(p_ids text[], p_days integer default 7)
 returns table (card_id text, provider text, variant text, currency text, amount numeric, snapshot_date date)
 language sql
 stable
 set search_path to ''
as $function$
  select distinct on (s.card_id, s.provider, s.variant) s.card_id, s.provider, s.variant, s.currency, s.amount, s.snapshot_date
  from public.price_snapshots s
  where p_ids is not null and s.card_id = any(p_ids)
    and s.snapshot_date <= current_date - least(greatest(coalesce(p_days, 7), 1), 30)
    and s.snapshot_date >= current_date - 60
    and s.amount > 0
    and (s.provider = 'cardmarket' or (s.provider = 'tcgplayer' and s.variant like 'tcgapi-%'))
  order by s.card_id, s.provider, s.variant, s.snapshot_date desc;
$function$
;

revoke all on function public.price_reference_prior(text[], integer) from public, anon, authenticated;
grant execute on function public.price_reference_prior(text[], integer) to service_role;

notify pgrst, 'reload schema';
