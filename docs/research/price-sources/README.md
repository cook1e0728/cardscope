# 價格來源盤點彙整（2026-10-11）

主方案第 6 階段的前置調查。細節見同目錄 `jp.md`（日本 12 個來源）、`global.md`（全球 API 15 個）、`tw.md`（台灣與香港 13 個）。風險等級是工程判斷，不是法律意見；本輪沒有啟用任何來源、沒有寫資料庫。

## 結論

- **沒有任何來源能證實是可合法取得的成交價（sale）**。成交資料（SNKRDUNK、ヤフオク落札、eBay Marketplace Insights）全部明文禁止或受限，所以介面繼續不顯示成交價與交易量。
- **台灣新台幣行情沒有風險可接受的來源**：卡拍拍、蝦皮、Yahoo 拍賣、Carousell 明文禁止自動擷取；露天的 robots.txt 擋商品頁，條款也要求書面同意。要取得台灣行情，只能取得店家書面同意。
- **航海王、芙莉蓮（WS）、排球少年沒有免費的全球來源**；排球少年連日本來源都沒有。

## 候選（依建議順序）

| # | 來源 | 價格性質 | 涵蓋 | 身分對應 | 主要風險 | 需要的決定 |
|---|---|---|---|---|---|---|
| A | TCGdex `pricing.cardmarket`／`tcgplayer` | market（平台參考價），EUR／USD | 寶可夢日版（TCGdex 匯入的卡）、美版需對照表 | 日版 `provider_id` 就是 TCGdex ID | 註冊表只核准 TCGdex 的 metadata 用途；價格來自 Cardmarket、TCGplayer，授權鏈不明 | 是否把 TCGdex 的用途擴大到價格（ADR） |
| B | 遊々亭買取 | buyback，JPY | 寶可夢、遊戲王、航海王、WS | 系列代碼＋卡號；解析器已有 | 規約禁止無斷轉載，沒有明文禁止自動取得；robots 不擋 | 寄信詢問 `info@yuyu-tei.jp`，或接受風險（ADR） |
| C | 晴れる屋2 販售價 | listing，JPY | 寶可夢 | 清楚 | 第 6 條禁止無斷轉載與再配布 | 書面詢問 |
| D | 皇巢 Beehive（香港）買取 | buyback，HKD | 寶可夢等 | 繁中系列碼＋卡號 | 條款限個人、非商業使用 | 書面詢問；只能標成香港價格 |

不建議：pokemontcg.io 價格（API 已宣告停用）、Scrydex／JustTCG／PriceCharting（付費，或免費方案禁止公開顯示）、TCGCSV 與 Cardmarket 公開價格檔（授權不明）、所有 C2C 平台（明文禁止或涉及個資）。

## 附帶發現（與價格無關，需處理）

- **pokemontcg.io API 已宣告停用**：新註冊關閉，現有金鑰到 2027-03-01，官方要遷移到付費的 Scrydex。`providers/catalog-sync.mjs` 抓 `/v2/sets` 仍依賴它，2026-10-11 實測回 500。卡片資料來自 GitHub 靜態檔，不受影響。美版系列同步要在 2027-03 前改讀靜態檔的系列清單。
- 遊戲王 `/api/cards/:id/market` 的 YGOPRODeck 參考價是跨版本最低價，不是指定 printing 的價格；比對名稱時找不到完全同名就取第一筆，可能配錯卡。應改成找不到同名時不顯示，並把標籤改成「跨版本最低參考價」。
