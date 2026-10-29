-- 七龍珠超 Fusion World（ADR 0052 Q7）：新增遊戲列，系列、卡片與版本由 dbs-fw-official 定時同步寫入（insert-only）。已於 2026-10-30 套用到正式庫。
-- 可重複執行；已存在的列只補空欄位，不覆蓋人工整理的值。
insert into public.tcg_games (id, name_zh, name_ja, name_en, product_line, catalog_status)
values (
  'dragonball-fw',
  '七龍珠超 Fusion World',
  'ドラゴンボールスーパーカードゲーム フュージョンワールド',
  'Dragon Ball Super Card Game Fusion World',
  'DRAGON BALL SUPER CARD GAME FUSION WORLD',
  'active'
)
on conflict (id) do update set
  name_zh = coalesce(public.tcg_games.name_zh, excluded.name_zh),
  name_ja = coalesce(public.tcg_games.name_ja, excluded.name_ja),
  product_line = coalesce(public.tcg_games.product_line, excluded.product_line),
  updated_at = now();
