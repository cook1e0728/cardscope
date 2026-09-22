-- TCGdex calls the official Pokemon K rarity "Radiant Rare". Keep the
-- database tier order aligned with the public game-specific rarity registry.
do $$
begin
  if not exists (
    select 1 from public.tcg_rarities
    where game_id = 'pokemon' and rarity_code = 'K'
  ) then
    update public.tcg_rarities
    set rarity_tier = rarity_tier + 1
    where game_id = 'pokemon' and rarity_tier >= 11;
  end if;

  insert into public.tcg_rarities (
    game_id,
    rarity_code,
    rarity_label,
    rarity_tier,
    source,
    source_url,
    data_status,
    metadata
  ) values (
    'pokemon',
    'K',
    'K',
    11,
    'pokemon-card-official-tw',
    'https://asia.pokemon-card.com/tw/card-search/',
    'verified',
    '{"aliases":["Radiant Rare"],"meaningZh":"光輝寶可夢"}'::jsonb
  )
  on conflict (game_id, rarity_code) do update
  set rarity_label = excluded.rarity_label,
      rarity_tier = excluded.rarity_tier,
      source = excluded.source,
      source_url = excluded.source_url,
      data_status = excluded.data_status,
      metadata = excluded.metadata;
end
$$;
