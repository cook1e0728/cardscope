-- 排球少年、芙莉蓮系列缺發售日：用同 game、同 series_id 商品的最早 release_date 回填（只填空值，可重複執行）。
-- 其他遊戲（寶可夢區域不同、不能直接套用）不在此 migration 範圍。
update public.tcg_series s
set release_date = p.d
from (
  select game_id, series_id, min(release_date) as d
  from public.tcg_products
  where release_date is not null and series_id is not null
  group by game_id, series_id
) p
where s.game_id = p.game_id and s.id = p.series_id
  and s.game_id in ('haikyuu', 'weiss-schwarz')
  and s.release_date is null;
