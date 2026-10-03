-- CardScope: Sun & Moon Japanese rarities shown on the official card page (ADR 0007):
-- TR (ic_rare_tr, trainer cards numbered after the regular set, before SR) and the
-- existing 'Rare Prism Star' code (ic_prismstar), which had no rank. Order after RRR:
-- TR 15, Rare Prism Star 16, then RR and below move down by two. Keep aligned with
-- data/rarity-rankings.json. Re-running changes nothing.
do $$
begin
  if not exists (select 1 from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'TR') then
    update public.tcg_rarities
    set rarity_tier = rarity_tier + 2
    where game_id = 'pokemon' and rarity_tier >= 15;
  end if;

  insert into public.tcg_rarities (
    game_id, rarity_code, rarity_label, rarity_tier, source, source_url, data_status, metadata
  ) values (
    'pokemon', 'TR', 'TR', 15, 'pokemon-card-official-jp',
    'https://www.pokemon-card.com/card-search/index.php?mode=statuslist', 'verified',
    '{"aliases":["Trainer Rare"],"officialIcon":"ic_rare_tr"}'::jsonb
  )
  on conflict (game_id, rarity_code) do update
  set rarity_label = excluded.rarity_label,
      rarity_tier = excluded.rarity_tier,
      source = excluded.source,
      source_url = excluded.source_url,
      data_status = excluded.data_status,
      metadata = excluded.metadata;

  update public.tcg_rarities
  set rarity_tier = 16
  where game_id = 'pokemon' and rarity_code = 'Rare Prism Star';
end
$$;
