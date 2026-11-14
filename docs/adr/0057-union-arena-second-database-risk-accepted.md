---
status: accepted
---

# UNION ARENA 日文官方卡表：使用者接受未確認條款的風險，資料放第二個 Supabase 專案

**狀態：已採用（2026-11-14 使用者回覆「兩項都同意」：接受條款風險、建立第二個 Supabase 專案）。計畫書：`docs/UA_SECOND_DB_PLAN.md`。**

## 背景

朋友回饋希望先以寶可夢、航海王、Weiß Schwarz、UNION ARENA 為主。UA 日文官方卡表 `www.unionarena-tcg.com/jp/cardlist/`（2026-11-14 盤點）有 119 個商品、11,170 張（含平行卡 2,419）。主資料庫 426 MB，UA 全量估 40–45 MB，超過 450 MB 紅線與 ADR 0052「每個新 IP ≤30 MB」；瘦身空間很小，也不升級 Pro。

## 決定

- **來源**：UA 日文官方卡表。沒有書面許可或明確條款，robots.txt 回 404；`metadataCollection` 記為 `risk-accepted`，不表示已取得授權。
- **範圍**：只收文字事實（卡號、名稱、稀有度、收錄商品、發售日）與官方圖片網址；圖片只外連，不轉存。
- **頻率與禮貌**：與既有官方同步相同：單一連線、請求間隔至少 1.1 秒、非 200 重試兩次後停止，解析到 0 張即整輪不寫入。
- **儲存**：UA 放第二個免費 Supabase 專案（同組織，用掉免費方案的第 2 個專案名額）。之後的新 IP 也放這裡。金鑰只放 Render 環境變數 `SUPABASE2_URL`、`SUPABASE2_SERVICE_KEY`。
- **撤回**：`collectionEnabled` 改回 `false` 即停止同步；已寫入的資料保留。

## Consequences

- 伺服器要依遊戲（或 `union-arena-` 開頭的 id）分流到兩個資料庫；跨遊戲的查詢（系列清單、搜尋、sitemap）兩庫並行再合併，第二庫失敗時只少 UA。
- 卡表結構改動要套兩個資料庫。
- 免費專案 7 天沒有活動會暫停；靠伺服器例行查詢與 UptimeRobot 保持活動。
- 組織已用滿 2 個免費專案，再要新專案就得刪舊的或升級。
