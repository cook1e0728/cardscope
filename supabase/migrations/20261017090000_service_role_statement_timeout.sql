-- 伺服器（service_role）跑的圖鑑分頁 RPC 每次掃整個遊戲：暖快取 1–3 s，資料庫冷快取時 9–15 s，
-- 沿用 authenticator 的 8 s 上限會被中斷（57014，正式站寶可夢稀有度篩選／名稱排序回 502，2026-10-16）。
-- 只放寬 service_role（瀏覽器端 anon 3 s、authenticated 8 s 不變）；伺服器端同時最多 2 個重查詢、等待 25 s。
alter role service_role set statement_timeout = '20s';
notify pgrst, 'reload config';
