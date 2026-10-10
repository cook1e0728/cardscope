-- CardScope：瀏覽與搜尋以 index-only scan 讀這幾張表，需要可見性對照表（visibility map）。
-- 大批匯入與補資料一次改寫數千列，但預設門檻（新增或失效列達 20%）讓 tcg_cards、
-- tcg_printings 的可見性對照表空了好幾天（2026-10-10：relallvisible 為 0，版本瀏覽 3–9 秒；
-- 手動 VACUUM 後約 100 ms）。調低門檻讓 autovacuum 在每批寫入後自動更新。

alter table public.tcg_cards set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.tcg_printings set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.tcg_canonical_cards set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.card_images set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
