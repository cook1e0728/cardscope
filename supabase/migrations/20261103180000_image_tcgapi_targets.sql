-- 寶可夢日版系列裡完全沒有圖的卡（本卡沒有、同作品層其他卡也沒有），給 TCG API 工作補 TCGplayer 商品圖（2026-11-03）。
-- 只回缺圖的卡；補完後系列自然不再出現，所以每天只花在還有缺圖的系列上。
create or replace function public.image_tcgapi_targets(p_limit integer default 100)
 returns table (series_id text, official_code text, cards jsonb)
 language sql
 stable
 set search_path to ''
as $function$
  with missing as (
    select c.id, c.canonical_id, c.series_id, c.official_card_number
    from public.tcg_cards c join public.tcg_series s on s.id = c.series_id
    where c.game_id = 'pokemon' and s.region = 'JP'
      and not exists (select 1 from public.card_images i where i.card_id = c.id and i.image_url is not null)
      and not exists (select 1 from public.tcg_printings p where p.card_id = c.id and p.image_url is not null)
      and not exists (select 1 from public.tcg_cards o where o.canonical_id = c.canonical_id and o.id <> c.id and (
        exists (select 1 from public.card_images i where i.card_id = o.id and i.image_url is not null)
        or exists (select 1 from public.tcg_printings p where p.card_id = o.id and p.image_url is not null)))
  )
  select s.id, s.official_code,
    jsonb_agg(jsonb_build_object('id', m.id, 'canonicalId', m.canonical_id, 'number', m.official_card_number) order by m.id)
  from missing m join public.tcg_series s on s.id = m.series_id
  where coalesce(s.official_code, '') <> ''
  group by s.id, s.official_code
  order by s.id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$
;

revoke all on function public.image_tcgapi_targets(integer) from public, anon, authenticated;
grant execute on function public.image_tcgapi_targets(integer) to service_role;

notify pgrst, 'reload schema';
