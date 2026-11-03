-- 卡牆參考價補上 TCG API（tcgapi.dev）轉來的 TCGplayer 美元市價（2026-11-03）。
--   為什麼：寶可夢日版有 221 個系列在 Cardmarket 完全沒有價格（例如 M6a 30th CELEBRATION，TCGdex 已不收錄這個系列），
--   卡牆沒有參考價，也不能照價格排序。TCG API 免費方案（非商業、每天 100 次）一次回一個系列最多 100 張卡的 TCGplayer 市價。
--   寫入端：providers/tcgapi-pricing.mjs 每天把這些系列的價格寫進 price_snapshots，provider 'tcgplayer'、currency 'USD'、variant 以 'tcgapi-' 開頭
--   （例如 'tcgapi-holofoil'），跟 TCGdex 轉來的 tcgplayer 列分開。
--   讀取端：price_reference_best 只有在這張卡 14 天內沒有任何 Cardmarket 價格時，才改用 'tcgapi-' 的美元價；有 Cardmarket 就照舊只用歐元。
--   簽章、回傳欄位與權限都不變；回傳的 currency 會是 'EUR' 或 'USD'，伺服器依幣別換算新台幣。
--   shortcut: browse_cards_priced（整個遊戲照價格排序）直接比 amount，歐元與美元會混在一起比（差約一成）；系列內排序在伺服器先換成歐元再比。
--   要整個遊戲也精準時，改成在這裡帶匯率或另存換算後的金額。

create or replace function public.price_reference_best(p_ids text[] default null)
 returns table (card_id text, variant text, currency text, amount numeric, snapshot_date date, observed_at timestamptz)
 language sql
 stable
 set search_path to ''
as $function$
  select distinct on (l.card_id) l.card_id, l.variant, l.currency, l.amount, l.snapshot_date, l.observed_at
  from (
    (select s.card_id, s.provider, s.variant, s.currency, s.amount, s.snapshot_date, s.observed_at
     from (select m.card_id, m.provider, m.variant, max(m.snapshot_date) as d
           from public.price_snapshots m
           where p_ids is not null and m.card_id = any(p_ids) and m.snapshot_date >= current_date - 14
             and (m.provider = 'cardmarket' or (m.provider = 'tcgplayer' and m.variant like 'tcgapi-%'))
           group by m.card_id, m.provider, m.variant) k
     join public.price_snapshots s on s.card_id = k.card_id and s.provider = k.provider and s.variant = k.variant and s.snapshot_date = k.d)
    union all
    (select s.card_id, s.provider, s.variant, s.currency, s.amount, s.snapshot_date, s.observed_at
     from (select m.card_id, m.provider, m.variant, max(m.snapshot_date) as d
           from public.price_snapshots m
           where p_ids is null and m.snapshot_date >= current_date - 14
             and (m.provider = 'cardmarket' or (m.provider = 'tcgplayer' and m.variant like 'tcgapi-%'))
           group by m.card_id, m.provider, m.variant) k
     join public.price_snapshots s on s.card_id = k.card_id and s.provider = k.provider and s.variant = k.variant and s.snapshot_date = k.d)
  ) l
  order by l.card_id, (l.provider <> 'cardmarket'),
    case l.variant when 'normal' then 0 when '' then 1 when 'holo' then 2 when 'reverse' then 3 when 'tcgapi-normal' then 4 when 'tcgapi-holofoil' then 5 else 6 end, l.variant;
$function$
;

revoke all on function public.price_reference_best(text[]) from public, anon, authenticated;
grant execute on function public.price_reference_best(text[]) to service_role;

-- 每天要向 TCG API 補價的寶可夢日版系列：14 天內整個系列沒有任何 Cardmarket 價格。
-- 最久沒補（或從沒補過）的排前面，讓每天的請求額度輪流用在每個系列；cards 是 [{id, number}]。
create or replace function public.price_tcgapi_targets(p_limit integer default 100)
 returns table (series_id text, official_code text, last_priced date, cards jsonb)
 language sql
 stable
 set search_path to ''
as $function$
  select s.id, s.official_code,
    (select max(p.snapshot_date) from public.price_snapshots p join public.tcg_cards c3 on c3.id = p.card_id
      where c3.series_id = s.id and p.provider = 'tcgplayer' and p.variant like 'tcgapi-%') as last_priced,
    (select jsonb_agg(jsonb_build_object('id', c.id, 'number', c.official_card_number) order by c.id) from public.tcg_cards c where c.series_id = s.id) as cards
  from public.tcg_series s
  where s.game_id = 'pokemon' and s.region = 'JP' and coalesce(s.official_code, '') <> ''
    and exists (select 1 from public.tcg_cards c where c.series_id = s.id)
    and not exists (select 1 from public.price_snapshots p join public.tcg_cards c2 on c2.id = p.card_id
      where c2.series_id = s.id and p.provider = 'cardmarket' and p.snapshot_date >= current_date - 14)
  order by 3 asc nulls first, s.release_date desc nulls last, s.id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$
;

revoke all on function public.price_tcgapi_targets(integer) from public, anon, authenticated;
grant execute on function public.price_tcgapi_targets(integer) to service_role;

notify pgrst, 'reload schema';
