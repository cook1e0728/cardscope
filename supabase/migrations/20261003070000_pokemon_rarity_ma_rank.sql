-- CardScope: MA ranks just below SAR, not after RR (20261003060000 placed it after RR).
-- In MEGAドリームex the official numbering runs AR 194-213, SR 214-222, MA 223-232,
-- SAR 233-249, MUR 250. Move MA to SAR + 1; the tiers between move down by one.
-- Keep this order aligned with data/rarity-rankings.json. Re-running changes nothing.
do $$
declare v_sar integer; v_ma integer;
begin
  select rarity_tier into v_sar from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'SAR';
  select rarity_tier into v_ma from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'MA';
  if v_ma is not null and v_ma <> v_sar + 1 then
    update public.tcg_rarities
    set rarity_tier = rarity_tier + 1
    where game_id = 'pokemon' and rarity_tier > v_sar and rarity_tier < v_ma;
    update public.tcg_rarities
    set rarity_tier = v_sar + 1
    where game_id = 'pokemon' and rarity_code = 'MA';
  end if;
end
$$;
