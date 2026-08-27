# CardScope 本機服務

在 PowerShell 執行：

```powershell
& 'C:\Users\99wye\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\99wye\Documents\Codex\2026-08-25\https-yuyu-tei-jp-ebay-https\outputs\server.mjs'
```

接著開啟 `http://localhost:4173`。

## 已提供的 API

- `GET /api/cards`：三種卡牌的目錄與市場摘要
- `GET /api/search?q=關鍵字`：以卡名、卡號或卡種搜尋
- `GET /api/cards/:id`：單張卡牌資料
- `GET /api/portfolio`：收藏市值與損益摘要
- `GET /api/providers`：各資料來源的設定狀態
- `GET /api/providers/justtcg/games`：JustTCG 支援的遊戲目錄
- `GET /api/providers/justtcg/cards?cardId=...`：單張卡的品相、價格與 30 日歷史
- `GET /api/providers/ebay/search?q=關鍵字`：eBay 官方 API 的即時在售掛牌

## 啟用 JustTCG 正式資料

在啟動服務的同一個 PowerShell 視窗設定 API Key：

```powershell
$env:JUSTTCG_API_KEY = '你的 tcg_... API Key'
& 'C:\Users\99wye\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\99wye\Documents\Codex\2026-08-25\https-yuyu-tei-jp-ebay-https\outputs\server.mjs'
```

Key 只留在本機環境變數；前端網頁不會也不應該讀取它。啟動後開啟 `http://localhost:4173/api/providers/justtcg/games` 驗證。

## 啟用 eBay 正式資料

請在 [eBay Developers Program](https://developer.ebay.com/) 建立應用程式並取得 `Client ID` 和 `Client Secret`。**不要把私密金鑰貼到聊天中，也不要寫進程式碼。** 於啟動服務的同一個 PowerShell 視窗設定：

```powershell
$env:EBAY_CLIENT_ID = '你的 Client ID'
$env:EBAY_CLIENT_SECRET = '你的 Client Secret'
& 'C:\Users\99wye\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\99wye\Documents\Codex\2026-08-25\https-yuyu-tei-jp-ebay-https\outputs\server.mjs'
```

啟用後可開啟 `http://localhost:4173/api/providers/ebay/search?q=Mew%20ex` 驗證。此 API 是在售掛牌，不是全市場成交紀錄。

目前是示範資料。量產前請以來源授權、官方 API 或合作資料取代 `server.mjs` 中的範例紀錄。
