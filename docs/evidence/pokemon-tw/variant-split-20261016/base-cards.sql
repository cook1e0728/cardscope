select c.id, c.canonical_id, c.source, c.provider_id, p.local_set_code as code, p.local_card_number as num, c.official_card_number, c.name_zh,
  p.metadata->'officialDetailIds' as ids, c.metadata->'officialDetailIds' as card_ids,
  exists (select 1 from card_images i where i.card_id = c.id) as has_image,
  (p.image_url is not null and p.image_url <> '') as printing_image
from tcg_cards c join tcg_printings p on p.card_id = c.id and p.region = 'TW'
where c.game_id = 'pokemon' and p.local_set_code in ('M2a','MC','SV11B','SV11W','SV2a','SVI','M-P','SV-P')
  and jsonb_array_length(coalesce(p.metadata->'officialDetailIds', '[]'::jsonb)) > 1
  and not exists (select 1 from card_images i where i.card_id = c.id)
  and not (p.image_url is not null and p.image_url <> '')
order by p.local_set_code, c.id
