-- Free about 8 MB (DB at 431 MB, brake line 440 MB). Both indexes are exact
-- leading-column prefixes of other btree indexes on the same table, so every
-- lookup they served is still covered:
--   tcg_printings_card_region_idx (card_id, region)
--     -> tcg_printings_card_id_region_language_local_set_code_local__key
--   card_images_card_id_idx (card_id)
--     -> card_images_primary_idx (card_id, is_primary desc)
drop index if exists public.tcg_printings_card_region_idx;
drop index if exists public.card_images_card_id_idx;
