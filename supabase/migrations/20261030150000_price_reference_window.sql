-- 卡牆參考價的新鮮度窗口（ADR 0042 的 price_snapshots 讀取端，2026-10-30）。只換 price_reference_best 的內容，簽章、回傳欄位與權限都不變。
--   為什麼放寬：每日價格快照只在「價格變動 >= 2%」或「該卡最後一筆已 >= 7 天」時才寫新列，所以價格不動的卡，最新快照本來就會是 7 天前；
--   舊窗口（只看最近 7 天）剛好卡在邊界，每日任務只要停一天，這些卡的參考價就整批從卡牆消失（正式庫實測：1 天內 12132 張、6-7 天 2730 張、8-13 天 245 張，最久 13 天）。
--   新窗口 14 天 = 7 天心跳 + 7 天緩衝；仍然只取每張卡「最新一筆」，介面照實顯示觀測日（snapshot_date），不會把舊價格當成今天的價格。
--   效能：舊寫法對窗口內每一列回表讀取並排序，窗口放寬到 14 天會讀約 4 倍的頁數；改成先用主鍵索引（card_id, provider, variant, snapshot_date）的 index-only 掃描
--   找出每個 (card, variant) 的最新日期，再用主鍵回表只讀那一列。結果與「舊寫法把窗口改成 14 天」逐列相同（正式庫比對 0 差異）。
--   正式庫 EXPLAIN ANALYZE（p_ids 為空、熱快取）：舊 7 天約 68 ms／16k buffers，舊寫法改 14 天約 530 ms／63k buffers，新寫法 14 天約 105 ms／2.7k buffers；給 60 個 id 時 1.4 ms（舊 4.3 ms）。
-- 其餘語意不變：只比同一張卡（card_id＝一個 printing）自己的快照，不跨版本、不換匯（全部 EUR）；多個 variant 時固定取 normal、空字串、holo、reverse、其他；沒有資料就沒有價格，不補 0。

create or replace function public.price_reference_best(p_ids text[] default null)
 returns table (card_id text, variant text, currency text, amount numeric, snapshot_date date, observed_at timestamptz)
 language sql
 stable
 set search_path to ''
as $function$
  select distinct on (l.card_id) l.card_id, l.variant, l.currency, l.amount, l.snapshot_date, l.observed_at
  from (
    -- two branches instead of "p_ids is null or ...": a named list uses the primary key (card_id first) instead of reading the whole table
    (select s.card_id, s.variant, s.currency, s.amount, s.snapshot_date, s.observed_at
     from (select m.card_id, m.variant, max(m.snapshot_date) as d
           from public.price_snapshots m
           where p_ids is not null and m.card_id = any(p_ids) and m.provider = 'cardmarket' and m.snapshot_date >= current_date - 14
           group by m.card_id, m.variant) k
     join public.price_snapshots s on s.card_id = k.card_id and s.provider = 'cardmarket' and s.variant = k.variant and s.snapshot_date = k.d)
    union all
    (select s.card_id, s.variant, s.currency, s.amount, s.snapshot_date, s.observed_at
     from (select m.card_id, m.variant, max(m.snapshot_date) as d
           from public.price_snapshots m
           where p_ids is null and m.provider = 'cardmarket' and m.snapshot_date >= current_date - 14
           group by m.card_id, m.variant) k
     join public.price_snapshots s on s.card_id = k.card_id and s.provider = 'cardmarket' and s.variant = k.variant and s.snapshot_date = k.d)
  ) l
  order by l.card_id, case l.variant when 'normal' then 0 when '' then 1 when 'holo' then 2 when 'reverse' then 3 else 4 end, l.variant;
$function$
;

revoke all on function public.price_reference_best(text[]) from public, anon, authenticated;
grant execute on function public.price_reference_best(text[]) to service_role;

notify pgrst, 'reload schema';
