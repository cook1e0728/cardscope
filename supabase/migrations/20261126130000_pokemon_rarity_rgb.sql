-- CardScope：新增寶可夢稀有度 RGB（2026-11-26）。30th CELEBRATION（M6a）的赤／綠／藍夢幻，卡號 R／G／B（印 R/RGB 等），
-- TCGdex 稀有度「RGB Rare」，原本沒有對應代碼，日版三張的稀有度一直是空值，首頁本彈大獎排不進去。
-- 排序：本彈最高（使用者 2026-11-26：最大獎），排在 MUR 之後、FUR 之前，與 data/rarity-rankings.json 一致。重跑不改變任何資料。
do $$
declare v_mur integer;
begin
  select rarity_tier into v_mur from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'MUR';
  if not exists (select 1 from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'RGB') then
    update public.tcg_rarities set rarity_tier = rarity_tier + 1 where game_id = 'pokemon' and rarity_tier > v_mur;
  end if;
  insert into public.tcg_rarities (game_id, rarity_code, rarity_label, rarity_tier, source, source_url, data_status, metadata)
  values ('pokemon', 'RGB', 'RGB', v_mur + 1, 'tcgdex',
    'https://api.tcgdex.net/v2/ja/cards/M6a-R', 'verified',
    '{"aliases":["RGB Rare"],"meaningZh":"RGB 稀有（M6a 30 週年赤／綠／藍夢幻）"}'::jsonb)
  on conflict (game_id, rarity_code) do update
  set rarity_label = excluded.rarity_label, rarity_tier = excluded.rarity_tier, source = excluded.source,
      source_url = excluded.source_url, data_status = excluded.data_status, metadata = excluded.metadata;

  update public.tcg_printings
  set rarity = 'RGB', rarity_code = 'RGB', rarity_label = 'RGB', updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || '{"rawRarity":"RGB Rare","rarityStatus":"mapped","normalizedRarityCode":"RGB","normalizedRarityLabel":"RGB"}'::jsonb
  where card_id in ('pokemon-tcgdex-ja-m6a-r', 'pokemon-tcgdex-ja-m6a-g', 'pokemon-tcgdex-ja-m6a-b')
    and source = 'tcgdex-ja' and rarity_code is null;
  update public.tcg_cards set rarity = 'RGB', updated_at = now()
  where id in ('pokemon-tcgdex-ja-m6a-r', 'pokemon-tcgdex-ja-m6a-g', 'pokemon-tcgdex-ja-m6a-b') and rarity is null;
end
$$;
