-- 30th CELEBRATION（M6a）R／G／B 夢幻借用英文版同一張卡的圖（2026-11-26）：日本官方、TCGdex 都還沒有卡圖，
-- 英文版 30C 的 R/RGB、G/RGB、B/RGB 在 pokemontcg.io 有圖（新系列圖檔放在 images.scrydex.com）。
-- 沿用 2026-11-03「借用英文版同一張卡的圖」的做法：語言 en-US、source pokemontcg、外連不轉存，畫面標「英文版卡圖」。
-- 只在這三張還沒有圖時新增，重跑不改變任何資料；日版官方圖日後補上時，由官方圖排程另外處理。
insert into public.card_images (card_id, canonical_id, language, source, image_url, source_url, is_primary, fetched_at, image_rights_status, rights_note)
select v.card_id, v.card_id, 'en-US', 'pokemontcg', v.image_url, v.source_url, true, now(), 'not-provided', v.note
from (values
  ('pokemon-tcgdex-ja-m6a-r', 'https://images.scrydex.com/pokemon/me55-R/large', 'https://api.pokemontcg.io/v2/cards/me55-R', '英文版代用圖：me55-R（30th Celebration R/RGB，同卡號同稀有度）'),
  ('pokemon-tcgdex-ja-m6a-g', 'https://images.scrydex.com/pokemon/me55-G/large', 'https://api.pokemontcg.io/v2/cards/me55-G', '英文版代用圖：me55-G（30th Celebration G/RGB，同卡號同稀有度）'),
  ('pokemon-tcgdex-ja-m6a-b', 'https://images.scrydex.com/pokemon/me55-B/large', 'https://api.pokemontcg.io/v2/cards/me55-B', '英文版代用圖：me55-B（30th Celebration B/RGB，同卡號同稀有度）')
) as v(card_id, image_url, source_url, note)
where exists (select 1 from public.tcg_cards c where c.id = v.card_id)
  and not exists (select 1 from public.card_images i where i.card_id = v.card_id);
