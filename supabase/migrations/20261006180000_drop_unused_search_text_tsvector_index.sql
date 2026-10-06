-- The full-text index on tcg_cards.search_text has never been scanned since statistics began
-- (2026-08-25): search uses the trigram indexes on search_text and search_names instead, and no
-- function or server query uses to_tsvector. It takes 19 MB of a database that is at 86% of the
-- free plan's 500 MB. Recreating it later is a plain CREATE INDEX; no data changes.
drop index if exists public.tcg_cards_search_text_idx;
