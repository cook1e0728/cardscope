-- 寶可夢日版本卡沒有自己卡圖的卡，給 official-jp-images 工作從日本官方卡片搜尋補外連圖（ADR 0031，2026-11-26）。
-- 和 image_tcgapi_targets 不同：同作品層的台版有圖也算缺（M6a 日版借台版圖就是這種）。補完後該卡自然不再出現。
create or replace function public.image_official_jp_targets(p_limit integer default 100)
returns table(series_id text, official_code text, cards jsonb)
language sql
stable
set search_path to ''
as $$
  with missing as (
    select c.id, c.canonical_id, c.series_id, c.official_card_number, c.name_ja
    from public.tcg_cards c join public.tcg_series s on s.id = c.series_id
    where c.game_id = 'pokemon' and s.region = 'JP' and coalesce(c.name_ja, '') <> ''
      and not exists (select 1 from public.card_images i where i.card_id = c.id and i.image_url is not null)
      and not exists (select 1 from public.tcg_printings p where p.card_id = c.id and p.image_url is not null)
  )
  select s.id, s.official_code,
    jsonb_agg(jsonb_build_object('id', m.id, 'canonicalId', m.canonical_id, 'number', m.official_card_number, 'nameJa', m.name_ja) order by m.id)
  from missing m join public.tcg_series s on s.id = m.series_id
  where coalesce(s.official_code, '') <> ''
  group by s.id, s.official_code
  order by s.id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke all on function public.image_official_jp_targets(integer) from public, anon, authenticated;
grant execute on function public.image_official_jp_targets(integer) to service_role;
