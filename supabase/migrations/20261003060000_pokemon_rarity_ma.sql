-- CardScope: add MA (Mega Attack Rare), shown as ic_rare_ma on the Japanese official card
-- page and as the MA rarity filter on the Taiwanese official search (MEGA era, numbered in
-- the main set). It ranks right after RR; tiers below RR move by one. Keep this order aligned
-- with data/rarity-rankings.json. Re-running changes nothing.
do $$
declare v_rr integer;
begin
  select rarity_tier into v_rr from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'RR';
  if not exists (select 1 from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'MA') then
    update public.tcg_rarities
    set rarity_tier = rarity_tier + 1
    where game_id = 'pokemon' and rarity_tier > v_rr;
  end if;

  insert into public.tcg_rarities (
    game_id, rarity_code, rarity_label, rarity_tier, source, source_url, data_status, metadata
  ) values (
    'pokemon', 'MA', 'MA', v_rr + 1, 'pokemon-card-official-jp',
    'https://www.pokemon-card.com/card-search/index.php?mode=statuslist', 'verified',
    '{"aliases":["Mega Attack Rare","MEGA_ATTACK_RARE"],"meaningZh":"超級進化攻擊稀有"}'::jsonb
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
