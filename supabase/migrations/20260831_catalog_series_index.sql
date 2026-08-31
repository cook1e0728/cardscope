-- The existing (game_id, series_id) index cannot serve lookups by series_id alone.
create index if not exists tcg_cards_series_idx on public.tcg_cards(series_id);
