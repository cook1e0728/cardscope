-- 台版 SV-P「56」→「056」（ADR 0041 列為另案）：TCGdex 封存的卡號少了補零，台灣官方詳細頁 9024 為「摩托蜥 056/SV-P」、
-- 稀有度篩選在「無標記」。ID、provider_id 是 TCGdex 身分，保持不變；只改卡號、搜尋字串與稀有度，舊值記在 metadata。
-- 修改前快照：sv-p-56-before.json。任一檢查不符就整筆回滾。
do $fix$
declare n integer;
begin
  perform 1 from public.tcg_cards c
  where c.id = 'pokemon-tcgdex-tw-sv-p-56' and c.official_card_number = '56' and c.name_zh = '摩托蜥'
    and c.rarity is null and c.series_id = 'pokemon-tcgdex-tw-sv-p';
  if not found then raise exception 'SV-P 56 card is not in the expected state'; end if;
  if exists (select 1 from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id
             where c.series_id = 'pokemon-tcgdex-tw-sv-p' and p.local_card_number = '056') then
    raise exception 'SV-P already has a printing numbered 056';
  end if;

  update public.tcg_printings p
  set local_card_number = '056', rarity = 'NONE', rarity_code = 'NONE', rarity_label = 'NONE',
      data_status = 'verified',
      metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
        'localCardNumberBefore', '56', 'rarityBasis', 'asia-pokemon-card-official-tw',
        'officialDetailIds', jsonb_build_array('9024'), 'numberFix', 'zero-pad-20261014'),
      updated_at = now()
  where p.id = 120196 and p.card_id = 'pokemon-tcgdex-tw-sv-p-56' and p.local_card_number = '56' and p.rarity_code is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected 1 printing, got %', n; end if;

  update public.tcg_cards c
  set official_card_number = '056', rarity = 'NONE',
      search_text = '摩托蜥 056 SV-P-056 svp056 56 SV-P-56',
      metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('officialCardNumberBefore', '56', 'numberFix', 'zero-pad-20261014'),
      updated_at = now()
  where c.id = 'pokemon-tcgdex-tw-sv-p-56' and c.official_card_number = '56';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected 1 card, got %', n; end if;
end
$fix$;
select c.official_card_number, c.rarity, c.data_status, p.local_card_number, p.rarity_code, p.data_status printing_status
from public.tcg_cards c join public.tcg_printings p on p.card_id = c.id where c.id = 'pokemon-tcgdex-tw-sv-p-56';
