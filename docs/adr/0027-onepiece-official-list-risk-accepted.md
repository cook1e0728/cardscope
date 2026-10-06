---
status: accepted
---

# 航海王官方卡表：使用者接受未確認條款的風險，恢復自動同步

**狀態：已採用（2026-10-06，使用者明確同意「同意開航海王」）。**

航海王資料自 2026-09-07 之後沒有更新：`data/source-registry.json` 的 `onepiece-official-runtime` 為 `permission-pending`、`collectionEnabled: false`，伺服器的定時同步因此一直略過它。主方案規定，啟用條款不明的來源屬於「必須接受新的法律／授權風險」，需由使用者決定；本次使用者已明確同意。

決定：

- **範圍**：只恢復既有的 `onepiece` 同步（亞洲英文版 `asia-en.onepiece-cardgame.com` 與繁體中文版 `asia-tc.onepiece-cardgame.com` 的卡表與商品頁），只收文字事實（卡號、名稱、稀有度、卡片類型、系列與商品名）。不新增網域，不改其他來源。
- **條款依據**：仍沒有書面許可或明確條款；三個網域的 `robots.txt` 皆回 404（2026-10-06 查），沒有爬取限制。`metadataCollection` 記為 `risk-accepted`，不表示已取得授權。
- **頻率與禮貌**：每 72 小時最多一次（`refreshHours: 72`，由每小時的新鮮度檢查觸發）；卡表頁一次一個請求、間隔至少 1 秒（原為 4 個並行、間隔 150 ms）；沿用既有 User-Agent 與「非 200 重試兩次後停止」。
- **圖片**：顯示政策不變（`imageDisplayPolicies` 中航海王來源本來就是 `risk-accepted`，圖片仍只外連官方網址，不重新託管）。
- **台灣站連結項目** `onepiece-tw` 維持 `link-only`；繁中卡表是由同一個 runtime 來源讀取。
- **撤回**：把 `collectionEnabled` 改回 `false` 即停止；已寫入的資料保留（不做破壞性回滾）。

排球少年、芙莉蓮仍為 `permission-pending`，需要另外決定。
