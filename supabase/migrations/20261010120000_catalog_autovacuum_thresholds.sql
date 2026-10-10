-- CardScope: browse and search read these tables with index-only scans, which need the
-- visibility map. Bulk imports and enrichment rewrite thousands of rows at a time, but the
-- default thresholds (20% inserted or dead rows) left tcg_cards and tcg_printings with an
-- empty visibility map for days (2026-10-10: relallvisible 0, region browse 3-9 s; after a
-- manual VACUUM about 100 ms). Lower thresholds let autovacuum refresh it after each batch.

alter table public.tcg_cards set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.tcg_printings set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.tcg_canonical_cards set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.card_images set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
