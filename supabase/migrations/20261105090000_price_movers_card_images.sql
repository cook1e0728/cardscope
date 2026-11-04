-- 漲跌榜卡圖（2026-11-05）：版本列沒有 image_url 的卡（例如官方日站補圖的 SM 時代稜鏡之星卡）改用 card_images 的主圖（排除 not-displayable）；其餘與 20261031100000 相同。

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
      and l.card_id not in (select public.price_products_shared(null))
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
         coalesce((select pr.image_url from public.tcg_printings pr where pr.card_id = k.card_id and pr.image_url is not null order by pr.id limit 1),
                  (select i.image_url from public.card_images i where i.card_id = k.card_id and i.image_url is not null and i.image_rights_status <> 'not-displayable' order by i.is_primary desc, i.id limit 1))
  from picked k
  join public.tcg_cards c on c.id = k.card_id
  left join public.tcg_series s on s.id = c.series_id
  left join lateral (select pr.local_card_number from public.tcg_printings pr where pr.card_id = k.card_id order by pr.id limit 1) p on true
  order by k.direction desc, abs(k.pct) desc, k.card_id;
$function$
;

notify pgrst, 'reload schema';
