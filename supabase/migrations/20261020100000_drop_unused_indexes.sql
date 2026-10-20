-- 容量回收（依序執行 112）：丟掉三個從未被掃描（idx_scan = 0）且確定沒有查詢形狀用得到的非唯一索引，共約 6.3 MB。
--   card_images_canonical_primary_idx (canonical_id, is_primary desc, fetched_at desc)：所有 card_images 查詢都以 card_id 過濾
--     （card_images_primary_idx 負責），這個只是 canonical_id 外鍵的支援索引；沒有程式刪除 tcg_canonical_cards，
--     就算刪，card_images 只有約 4.7 萬列，循序掃描可忽略。
--   tcg_card_names_search_idx (locale, name)：沒有任何查詢以 locale + name 相等過濾；同步 upsert 的 ON CONFLICT 目標是唯一鍵
--     (card_id, locale, name, name_type)，讀取走 tcg_card_names_lookup_idx。
--   tcg_cards_number_idx (official_card_number)：所有以卡號排序／過濾的查詢都帶 game_id（tcg_cards_game_number_idx 負責）；
--     SQL 函式裡的卡號比對是 ilike '%…%'，btree 本來就用不到。
-- 唯一索引、主鍵、外鍵支援索引（除上述）與僅幾十 KB 的索引不動。需要時可用下列語句原樣重建。
drop index if exists public.card_images_canonical_primary_idx;
drop index if exists public.tcg_card_names_search_idx;
drop index if exists public.tcg_cards_number_idx;

-- 重建語句（回滾用）：
--   create index card_images_canonical_primary_idx on public.card_images (canonical_id, is_primary desc, fetched_at desc);
--   create index tcg_card_names_search_idx on public.tcg_card_names (locale, name);
--   create index tcg_cards_number_idx on public.tcg_cards (official_card_number);
