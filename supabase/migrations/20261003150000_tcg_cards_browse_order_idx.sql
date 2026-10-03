-- CardScope: the browse page orders a game's cards by official card number and id. With
-- only an index on official_card_number the planner walked every game's cards and sorted
-- incrementally (about 115 ms for the first page); this index serves the page directly.

create index if not exists tcg_cards_game_number_idx on public.tcg_cards (game_id, official_card_number, id);
