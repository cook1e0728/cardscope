-- CardScope: add CSR (Character Super Rare), printed on Sword & Shield Japanese
-- cards and shown as ic_rare_csr on the official card page (ADR 0007). It ranks
-- right after SR; tiers from S (7) down move by one. Keep this order aligned
-- with data/rarity-rankings.json. Re-running changes nothing.
do $$
begin
  if not exists (select 1 from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'CSR') then
    update public.tcg_rarities
    set rarity_tier = rarity_tier + 1
    where game_id = 'pokemon' and rarity_tier >= 7;
  end if;

  insert into public.tcg_rarities (
    game_id, rarity_code, rarity_label, rarity_tier, source, source_url, data_status, metadata
  ) values (
    'pokemon', 'CSR', 'CSR', 7, 'pokemon-card-official-jp',
    'https://www.pokemon-card.com/card-search/index.php?mode=statuslist', 'verified',
    '{"aliases":["Character Super Rare"],"meaningZh":"角色超稀有"}'::jsonb
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
