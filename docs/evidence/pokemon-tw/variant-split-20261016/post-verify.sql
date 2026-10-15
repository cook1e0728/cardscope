select p.local_set_code code,
  count(*) filter (where c.metadata->>'variantIndex' = '1') bases,
  count(*) filter (where c.metadata->>'variantIndex' <> '1') new_cards,
  count(*) filter (where c.metadata->>'variantIndex' <> '1' and exists (select 1 from card_images i where i.card_id = c.id and i.rights_note = 'ADR 0031' and i.source = 'pokemon-tw-official' and i.image_url = 'https://asia.pokemon-card.com/tw/card-img/tw' || lpad(c.provider_id, 8, '0') || '.png' and i.is_primary)) new_with_own_image,
  count(*) filter (where c.metadata->>'variantIndex' = '1' and exists (select 1 from card_images i where i.card_id = c.id and i.rights_note = 'ADR 0031' and i.source = 'pokemon-tw-official')) bases_with_image,
  count(*) filter (where c.metadata->>'variantIndex' <> '1' and c.canonical_id = (c.metadata->>'variantOf')) same_canonical,
  count(*) filter (where c.metadata->>'variantIndex' <> '1' and p.image_url is null and p.provider_id = c.provider_id and p.source = 'asia-pokemon-card-official-tw') printing_ok
from tcg_cards c join tcg_printings p on p.card_id = c.id and p.region = 'TW'
where c.metadata->>'variantRule' = 'adr-0043' group by 1 order by 1
