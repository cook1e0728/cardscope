-- CardScope: preserve the established game/product-line taxonomy.
-- Revert only the exact values written by catalog_taxonomy_seed; concurrent edits
-- with different values are intentionally left untouched.

update public.tcg_games
set product_line = null,
    catalog_status = 'active',
    updated_at = now()
where (id, product_line, catalog_status) in (
  ('pokemon', 'Pokémon Trading Card Game', 'active'),
  ('onepiece', 'ONE PIECE Card Game', 'active'),
  ('yugioh', 'Yu-Gi-Oh! OCG', 'active'),
  ('weiss-schwarz', 'Weiß Schwarz', 'catalog-only'),
  ('haikyuu', 'バボカ!! BREAK', 'catalog-only')
);

do $$
declare
  matching_categories integer;
begin
  select count(*) into matching_categories
  from public.tcg_product_categories
  where (id, name_zh, name_en, sort_order) in (
    ('singles', '單卡', 'Singles', 10),
    ('sealed', '密封商品', 'Sealed', 20),
    ('decks', '牌組／構築商品', 'Decks', 30),
    ('promo', '特典／贈品', 'Promos', 40),
    ('event-store', '賽事／商店限定', 'Event & Store Exclusives', 50),
    ('accessories', '周邊道具', 'Accessories', 60),
    ('other', '其他', 'Other', 70)
  );

  if matching_categories <> 7 then
    raise exception 'CardScope product taxonomy does not match the seven approved categories';
  end if;
end
$$;
