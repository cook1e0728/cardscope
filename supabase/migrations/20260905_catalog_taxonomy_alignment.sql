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

-- This file sorts before catalog_taxonomy_seed on a fresh database. Seed the
-- approved rows here as a prerequisite so the validation below is repeatable.
insert into public.tcg_product_categories
  (id, name_zh, name_en, sort_order, description_zh)
values
  ('singles', '單卡', 'Singles', 10, '可獨立查詢、收藏與比價的單張卡片。'),
  ('sealed', '密封商品', 'Sealed', 20, '未拆封的補充包、原盒、禮盒與組合包；不包含預組牌組。'),
  ('decks', '牌組／構築商品', 'Decks', 30, '起始牌組、預組套牌、補充牌組與其他可直接遊玩的構築商品。'),
  ('promo', '特典／贈品', 'Promos', 40, '隨活動、商品或合作企劃發行的特典卡與配布品。'),
  ('event-store', '賽事／商店限定', 'Event & Store Exclusives', 50, '賽事獎品、參加獎、商店限定與店鋪活動配布。'),
  ('accessories', '周邊道具', 'Accessories', 60, '卡套、牌盒、收納用品與其他遊戲周邊。'),
  ('other', '其他', 'Other', 70, '尚未能歸入上述類別的產品或資料。')
on conflict (id) do update set
  name_zh=excluded.name_zh,
  name_en=excluded.name_en,
  sort_order=excluded.sort_order,
  description_zh=excluded.description_zh,
  updated_at=now();

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
