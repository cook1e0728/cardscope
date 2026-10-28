-- 移除沒有任何印刷版本的空系列（2026-10-29）。點進去都是 0 張，卻出現在系列清單與 sitemap。
-- pokemon-base1-us、yugioh-qccu-jp：8-31 示範資料，掛著 3 張示範卡（噴火龍、超夢與正式 Base Set 卡重複，黑魔導女孩日版為孤兒），印刷版本都沒有系列。
-- yugioh-ygoprodeck-adc1／dpc5／yucb：YGOPRODeck 系列清單有、但沒有任何卡的 card_sets 用到這個名稱；catalog-sync 已改成不再建立這種系列。
-- 刪除前備份：docs/evidence/cleanup-20261029/empty-series-backup.json。印刷版本、卡圖等經外鍵 cascade 一併刪除。

delete from public.tcg_cards where id in ('pokemon-charizard-base1-4-us','pokemon-mewtwo-base1-10-us','yugioh-dark-magician-girl-qccu-jp002-jp');
delete from public.tcg_products where series_id in ('yugioh-ygoprodeck-adc1','yugioh-ygoprodeck-dpc5','yugioh-ygoprodeck-yucb');
delete from public.tcg_series s
where s.id in ('pokemon-base1-us','yugioh-qccu-jp','yugioh-ygoprodeck-adc1','yugioh-ygoprodeck-dpc5','yugioh-ygoprodeck-yucb')
  and not exists (select 1 from public.tcg_printings p where p.series_id = s.id)
  and not exists (select 1 from public.tcg_cards c where c.series_id = s.id);
