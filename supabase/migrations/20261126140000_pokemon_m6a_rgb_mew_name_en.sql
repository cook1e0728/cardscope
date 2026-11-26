-- 30th CELEBRATION（M6a）R／G／B 夢幻補英文名 Mew（2026-11-26）：詳細頁的 eBay 現售掛牌要用英文名＋卡號（R/RGB）查，
-- 這三張日版卡原本沒有英文名，eBay 區塊整個不顯示。英文版卡名同為 Mew（30C R/RGB 等）。只補空值，重跑不改變任何資料。
update public.tcg_cards set name_en = 'Mew', updated_at = now()
where id in ('pokemon-tcgdex-ja-m6a-r', 'pokemon-tcgdex-ja-m6a-g', 'pokemon-tcgdex-ja-m6a-b') and name_en is null;
