-- 遊戲王沒有系列的印刷版本（盤點「681 筆 unspecified」，2026-10-29）。catalog-sync 已改成只收有 TCG 印刷的卡、系列名稱不分大小寫比對。
-- 1. 卡片早期沒有 card_sets 時建的「unspecified」版本，卡片之後已收錄進正式系列，這筆殘留沒被清掉（88 筆）。
-- 2. YGOPRODeck 沒有任何 TCG 系列的卡（OCG 限定、遊戲用卡、衍生物、尚未發售）：網站上只會顯示成 unspecified 版本與卡片密碼（596 張，含其印刷版本與卡圖，經外鍵 cascade）。正式收錄進系列後，下次同步會帶著系列加回來。
-- 3. Tag Force 5 促銷卡：系列名稱大小寫與 YGOPRODeck 系列清單不同而沒對上（3 筆）。
-- 價格快照、價格觀測皆 0 筆；熱門卡中文搜尋別名（data/yugioh-zh-aliases.json）沒有任何一張在其中。刪除前備份：docs/evidence/cleanup-20261029/setless-yugioh-backup.json。

-- 先補系列再刪，否則只有 Tag Force 5 版本的卡會在第 2 步被當成沒有系列刪掉。
update public.tcg_printings p set series_id = s.id, updated_at = now()
from public.tcg_series s
where p.series_id is null and p.card_id like 'yugioh-ygoprodeck-%'
  and s.game_id = 'yugioh' and s.source = 'ygoprodeck' and lower(s.name_en) = lower(p.local_set_code);

delete from public.tcg_printings p
where p.series_id is null and p.local_set_code = 'unspecified' and p.card_id like 'yugioh-ygoprodeck-%'
  and exists (select 1 from public.tcg_printings q where q.card_id = p.card_id and q.series_id is not null);

delete from public.tcg_cards c
where c.id like 'yugioh-ygoprodeck-%'
  and not exists (select 1 from public.tcg_printings q where q.card_id = c.id and q.series_id is not null);
