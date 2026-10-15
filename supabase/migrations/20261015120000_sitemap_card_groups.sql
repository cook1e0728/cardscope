-- CardScope：sitemap 的卡片網址一次取得。原本伺服器以 PostgREST keyset 分頁抓 tcg_cards（約 76 頁、冷啟動 40–60 秒），
-- Google Search Console 抓 sitemap.xml 時逾時（「無法擷取」）。改在資料庫內依作品層分組，一次回傳 [id, game, lastmod]。
-- 規則與 providers/seo.mjs 的 mergeCardSitemapRows 相同：有任一名稱的實體卡才算，網址用 canonical_id（沒有就用 id），lastmod 取組內最新 updated_at。
create or replace function public.sitemap_card_groups()
returns jsonb
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '30s'
as $$
  select coalesce(jsonb_agg(jsonb_build_array(g.id, g.game, g.lastmod) order by g.id), '[]'::jsonb)
  from (
    select coalesce(nullif(btrim(c.canonical_id), ''), c.id) as id, min(c.game_id) as game,
      to_char(max(c.updated_at) at time zone 'UTC', 'YYYY-MM-DD') as lastmod
    from public.tcg_cards c
    where coalesce(nullif(btrim(c.name_zh), ''), nullif(btrim(c.name_ja), ''), nullif(btrim(c.name_en), ''), nullif(btrim(c.name_ko), '')) is not null
    group by 1
  ) g;
$$;

revoke all on function public.sitemap_card_groups() from public, anon, authenticated;
grant execute on function public.sitemap_card_groups() to service_role;
