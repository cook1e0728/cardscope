-- Complete the canonical Pokemon rarity vocabulary already used by the public
-- game-specific ordering. Raw provider labels remain in candidate evidence;
-- these rows only establish reviewed canonical codes and ranks.
insert into public.tcg_rarities (
  game_id,
  rarity_code,
  rarity_label,
  rarity_tier,
  source,
  source_url,
  data_status,
  metadata
)
values
  ('pokemon', 'MUR', 'MUR', 0, 'pokemon-card-official-jp', 'https://www.pokemon-card.com/card-search/index.php?mode=statuslist', 'verified', '{"aliases":[]}'::jsonb),
  ('pokemon', 'BWR', 'BWR', 1, 'pokemon-card-official-jp', 'https://www.pokemon-card.com/card-search/index.php?mode=statuslist', 'verified', '{"aliases":[]}'::jsonb),
  ('pokemon', 'SR', 'SR', 6, 'pokemon-card-official-jp', 'https://www.pokemon-card.com/card-search/index.php?mode=statuslist', 'verified', '{"aliases":["Super Rare","Secret Rare"]}'::jsonb),
  ('pokemon', 'CHR', 'CHR', 9, 'pokemon-card-official-jp', 'https://www.pokemon-card.com/card-search/index.php?mode=statuslist', 'verified', '{"aliases":["Character Rare"]}'::jsonb),
  ('pokemon', 'RRR', 'RRR', 11, 'pokemon-card-official-jp', 'https://www.pokemon-card.com/card-search/index.php?mode=statuslist', 'verified', '{"aliases":["Triple Rare"]}'::jsonb)
on conflict (game_id, rarity_code) do nothing;
