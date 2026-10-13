-- CardScope：新增寶可夢稀有度 FUR 與 PR（2026-10-14，官方來源完整度稽核第 5 項）。
-- 台灣官方卡片搜尋的稀有度篩選有 FUR（M6a 134 超夢ex、135 夢幻ex，30 週年收錄）與 PR（AC2a 14 張、AC2b 13 張的特典標記），
-- 資料庫沒有這兩個代碼，這 29 張台版卡的稀有度一直是空值。
-- 排序：FUR 是該系列卡號最後的收錄、首發價格最高，排在 MUR 之後、BWR 之前；PR 是特典標記，不代表稀有程度，
-- 排在 C 之後、NONE 之前。與 data/rarity-rankings.json 保持一致。重跑不改變任何資料。
do $$
declare v_mur integer; v_c integer;
begin
  select rarity_tier into v_mur from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'MUR';
  if not exists (select 1 from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'FUR') then
    update public.tcg_rarities set rarity_tier = rarity_tier + 1 where game_id = 'pokemon' and rarity_tier > v_mur;
  end if;
  insert into public.tcg_rarities (game_id, rarity_code, rarity_label, rarity_tier, source, source_url, data_status, metadata)
  values ('pokemon', 'FUR', 'FUR', v_mur + 1, 'asia-pokemon-card-official-tw',
    'https://asia.pokemon-card.com/tw/card-search/', 'verified',
    '{"aliases":[],"meaningZh":"官方稀有度 FUR（M6a 30 週年收錄）"}'::jsonb)
  on conflict (game_id, rarity_code) do update
  set rarity_label = excluded.rarity_label, rarity_tier = excluded.rarity_tier, source = excluded.source,
      source_url = excluded.source_url, data_status = excluded.data_status, metadata = excluded.metadata;

  select rarity_tier into v_c from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'C';
  if not exists (select 1 from public.tcg_rarities where game_id = 'pokemon' and rarity_code = 'PR') then
    update public.tcg_rarities set rarity_tier = rarity_tier + 1 where game_id = 'pokemon' and rarity_tier > v_c;
  end if;
  insert into public.tcg_rarities (game_id, rarity_code, rarity_label, rarity_tier, source, source_url, data_status, metadata)
  values ('pokemon', 'PR', 'PR', v_c + 1, 'asia-pokemon-card-official-tw',
    'https://asia.pokemon-card.com/tw/card-search/', 'verified',
    '{"aliases":[],"meaningZh":"特典卡標記（PR），不代表稀有程度"}'::jsonb)
  on conflict (game_id, rarity_code) do update
  set rarity_label = excluded.rarity_label, rarity_tier = excluded.rarity_tier, source = excluded.source,
      source_url = excluded.source_url, data_status = excluded.data_status, metadata = excluded.metadata;
end
$$;
