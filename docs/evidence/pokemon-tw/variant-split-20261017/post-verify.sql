with b as (
  select c.id, c.metadata, p.metadata pm, p.image_url, c.canonical_id
  from public.tcg_cards c join public.tcg_printings p on p.card_id = c.id and p.region = 'TW'
  where c.id ~ '^pokemon-tcgdex-tw-sv(2a|8a)-[0-9]+$' and c.metadata->>'variantRule' = 'adr-0043'
    and c.id in (select (metadata->>'variantOf') from public.tcg_cards where metadata->>'variantRule' = 'adr-0043' and source = 'asia-pokemon-card-official-tw' and (metadata->>'variantOf') ~ '^pokemon-tcgdex-tw-sv(2a|8a)-')
), v as (
  select c.id, c.canonical_id, c.metadata, c.provider_id, c.metadata->>'variantOf' base_id
  from public.tcg_cards c where c.source = 'asia-pokemon-card-official-tw' and (c.metadata->>'variantOf') ~ '^pokemon-tcgdex-tw-sv(2a|8a)-'
)
select
  (select count(*) from b) bases,
  (select count(*) from b where image_url like 'https://assets.tcgdex.net/zh-tw/SV/%' and not exists (select 1 from public.card_images i where i.card_id = b.id)) bases_keep_tcgdex_image_only,
  (select count(*) from b where (metadata->>'variantIndex')::int = 1) bases_v1,
  (select count(*) from b where (metadata->>'variantIndex')::int = 2) bases_v2,
  (select count(*) from b where metadata->>'variantOfficialDetailId' is null) bases_without_detail_id,
  (select count(*) from v) new_cards,
  (select count(*) from v join b on b.id = v.base_id where v.canonical_id = b.canonical_id) new_same_canonical,
  (select count(*) from v where v.id = v.base_id || '-v' || (v.metadata->>'variantIndex')) new_id_matches_index,
  (select count(*) from v join public.card_images i on i.card_id = v.id and i.source = 'pokemon-tw-official' and i.image_url = 'https://asia.pokemon-card.com/tw/card-img/tw' || lpad(v.provider_id, 8, '0') || '.png') new_with_own_official_image,
  (select count(*) from v where exists (select 1 from public.tcg_printings p where p.card_id = v.id and p.region = 'TW' and p.image_url is null and p.metadata->>'variantKey' = 'v' || (v.metadata->>'variantIndex'))) new_printings_ok,
  (select count(*) from v join b on b.id = v.base_id where v.metadata->>'variantIndex' = b.metadata->>'variantIndex') index_collisions,
  (select count(*) from v join b on b.id = v.base_id where b.metadata->>'variantOfficialDetailId' = v.provider_id) detail_collisions,
  (select count(*) from public.card_images i join b on b.id = i.card_id) base_card_images_added
