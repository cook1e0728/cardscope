-- CardScope: shared catalog taxonomy and current product-line status.
-- Idempotent seed data only; this does not insert demo cards or image assets.

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
  name_zh = excluded.name_zh,
  name_en = excluded.name_en,
  sort_order = excluded.sort_order,
  description_zh = excluded.description_zh,
  updated_at = now();

update public.tcg_games
set product_line = case id
    when 'pokemon' then 'Pokémon Trading Card Game'
    when 'onepiece' then 'ONE PIECE Card Game'
    when 'yugioh' then 'Yu-Gi-Oh! OCG'
    when 'weiss-schwarz' then 'Weiß Schwarz'
    when 'haikyuu' then 'バボカ!! BREAK'
    else product_line
  end,
  catalog_status = case
    when id in ('weiss-schwarz', 'haikyuu') then 'catalog-only'
    else 'active'
  end,
  updated_at = now()
where id in ('pokemon', 'onepiece', 'yugioh', 'weiss-schwarz', 'haikyuu');
