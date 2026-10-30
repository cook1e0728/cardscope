-- 參考價漲跌榜（ADR 0042 的 price_snapshots 讀取端，2026-10-31）：給 /api/price-movers 用。
--   比的是同一張卡（card_id＝一個 printing）、同一個 variant 的 Cardmarket 參考價（EUR），不跨版本、不換匯；只是平台參考價的變動，不是成交價或價差。
--   起點：p_days 天前（含）最後一筆快照；快照只在變動 >= 2% 或滿 7 天才寫，所以那一筆就是當天的價格。快照從 2026-10-15 才開始，沒有那麼早的就取最早一筆，回傳實際起點日。
--   終點：最新一筆，且要在 14 天內（與 price_reference_best 同一個新鮮度窗口）；起訖至少相隔 7 天，避免剛收錄的卡用一兩天的跳動上榜。
--   門檻：起訖兩端都 >= p_min 歐元，便宜卡的參考價一跳就是幾倍，排除後榜單才有意義。
--   確認：起點之後、最新一筆之前的那一筆（倒數第二筆）也要往同一方向偏離起點，只跳一天的尖峰（成交稀少時常見）不上榜。
--   一張卡只取一個 variant（順序同 price_reference_best：normal、空字串、holo、reverse、其他）；漲、跌各取前 p_limit 名。
--   正式庫（約 7.1 萬列快照）整張表掃一次，伺服器端快取一小時。

create or replace function public.price_movers(p_days integer default 14, p_min numeric default 5, p_limit integer default 20)
 returns table (direction text, card_id text, variant text, currency text, from_date date, from_amount numeric, to_date date, to_amount numeric, change_percent numeric,
                name_zh text, name_ja text, card_number text, series_code text, series_name text, image_url text)
 language sql
 stable
 set search_path to ''
as $function$
  with pairs as (
    select distinct on (l.card_id) l.card_id, l.variant, l.currency, f.snapshot_date as from_date, f.amount as from_amount, l.snapshot_date as to_date, l.amount as to_amount
    from (select distinct on (s.card_id, s.variant) s.* from public.price_snapshots s
          where s.provider = 'cardmarket' and s.snapshot_date >= current_date - 14
          order by s.card_id, s.variant, s.snapshot_date desc) l
    cross join lateral (
      select b.snapshot_date, b.amount from public.price_snapshots b
      where b.card_id = l.card_id and b.provider = 'cardmarket' and b.variant = l.variant and b.currency = l.currency
      order by (b.snapshot_date <= current_date - greatest(p_days, 1)) desc, case when b.snapshot_date <= current_date - greatest(p_days, 1) then b.snapshot_date end desc nulls last, b.snapshot_date asc
      limit 1) f
    cross join lateral (
      select c.amount from public.price_snapshots c
      where c.card_id = l.card_id and c.provider = 'cardmarket' and c.variant = l.variant and c.currency = l.currency
        and c.snapshot_date > f.snapshot_date and c.snapshot_date < l.snapshot_date
      order by c.snapshot_date desc limit 1) prev
    where sign(prev.amount - f.amount) = sign(l.amount - f.amount)
      and l.snapshot_date - f.snapshot_date >= 7 and least(f.amount, l.amount) >= p_min and f.amount > 0
    order by l.card_id, case l.variant when 'normal' then 0 when '' then 1 when 'holo' then 2 when 'reverse' then 3 else 4 end, l.variant
  ), ranked as (
    select p.*, round((p.to_amount / p.from_amount - 1) * 100, 1) as pct from pairs p where p.to_amount <> p.from_amount
  ), picked as (
    (select 'up'::text as direction, r.* from ranked r where r.pct > 0 order by r.pct desc, r.to_amount desc, r.card_id limit least(greatest(p_limit, 1), 50))
    union all
    (select 'down'::text, r.* from ranked r where r.pct < 0 order by r.pct asc, r.from_amount desc, r.card_id limit least(greatest(p_limit, 1), 50))
  )
  select k.direction, k.card_id, k.variant, k.currency, k.from_date, k.from_amount, k.to_date, k.to_amount, k.pct,
         c.name_zh, c.name_ja, coalesce(p.local_card_number, c.official_card_number), s.official_code, coalesce(s.name_zh, s.name_ja, s.name_en),
         (select pr.image_url from public.tcg_printings pr where pr.card_id = k.card_id and pr.image_url is not null order by pr.id limit 1)
  from picked k
  join public.tcg_cards c on c.id = k.card_id
  left join public.tcg_series s on s.id = c.series_id
  left join lateral (select pr.local_card_number from public.tcg_printings pr where pr.card_id = k.card_id order by pr.id limit 1) p on true
  order by k.direction desc, abs(k.pct) desc, k.card_id;
$function$
;

revoke all on function public.price_movers(integer, numeric, integer) from public, anon, authenticated;
grant execute on function public.price_movers(integer, numeric, integer) to service_role;

notify pgrst, 'reload schema';
