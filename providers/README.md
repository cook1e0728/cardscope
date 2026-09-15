# CardScope Provider Adapters

CardScope 將市場資料來源拆成獨立 provider adapter。API 與公開頁面擷取最後都應輸出相同的 normalized market record，避免前端依賴特定網站格式。

## 原則

1. 官方／可負擔 API 優先。
2. 沒有實用 API 時，才對公開、無需登入的頁面做低頻擷取。
3. 不繞過登入、CAPTCHA、Cloudflare、付費牆或其他技術限制。
4. 預設完整更新頻率為 24 小時；搜尋缺資料時可補抓，但同來源／同卡 24 小時內不重抓。
5. listing、sale、buyback、retail、market estimate、user report 必須分開保存。
6. 所有來源失敗都要隔離，單一 provider 失效不得拖垮 CardScope。

## Normalized market record

```js
{
  provider: 'yuyutei',
  market: 'JP',
  cardId: null,
  providerCardId: null,
  cardName: 'ミュウex',
  cardNumber: '347/190',
  setCode: 'SV4a',
  rarity: 'SSR',
  language: 'ja-JP',
  priceType: 'buyback',
  amount: 12000,
  currency: 'JPY',
  shippingAmount: null,
  priceTwd: null,
  shippingTwd: null,
  landedPriceTwd: null,
  condition: null,
  imageUrl: null,
  sourceUrl: null,
  observedAt: 'ISO timestamp'
}
```

TWD 換算由中央 FX 層處理，provider 不自行寫死匯率。

## 來源規劃

- `ebay`: 官方 Browse API，多國 marketplace，掛牌資料。
- `justtcg`: 官方 API，TCG 目錄／市場資料。
- `yuyutei`: 日本公開買取頁，現有低頻 scraper。
- `kapaipai`: 台灣卡拍拍；先保留 adapter，確認公開頁面與允許方式後啟用。
- `snkrdunk`: 日本；先保留 adapter，確認公開頁面與允許方式後啟用。
- `amazon`: 優先官方／合作方式；不繞過 Amazon 的存取限制。

## Card identity

Provider 資料應依序用 provider stable ID、遊戲 + 系列 + 卡號 + 語言／版本對到 `card_identities`。名稱／aliases 只作 fallback，避免同名卡與復刻版本誤配。

## 增量補全流程

下一階段的補全模組先產生 dry-run 計畫，不直接改正式卡片資料：

- `pokemon-gap-sync.mjs`：只以 provider ID 或精確系列代碼＋卡號補名稱、稀有度與印刷版本圖片；歧義資料留待審核。
- `yugioh-zh-enrichment.mjs`：只接受已核准、帶穩定識別碼的繁中來源；不以翻譯或相似卡名自動配對。
- `price-history.mjs`：建立可重複執行的價格觀測計畫；不同來源、價格類型、幣別與卡片身份不混算。

### Pokémon phase-2A gap planner

`createPokemonGapPlan` 永遠只產生 dry-run patch，不會自行爬蟲、呼叫網路或寫入資料庫。可用 `gapKinds` 將一批來源限制在指定缺口：

```js
gapKinds: [
  'traditional-chinese-name',
  'rarity',
  'same-printing-image'
],
batchSize: 100,
cursor: previous.cursor.next
```

這三個 wire value 是穩定的機器可讀值；`name_zh`、`printing_image` 等舊欄位別名也會正規化。指定 `gapKinds`（或 `onlyMissing: true`）時，完整資料列會被跳過，`batchSize` 只限制實際選入的缺口來源；`sourceRecords.scanned` 與 `sourceRecords.skippedRecords` 仍保留掃描稽核。未指定時維持來源列分頁相容性，但只會產生三種 phase-2A 欄位的補全 patch（既有英文名補全僅在相容模式保留）。

回傳的 `summary` 與 `gapCounts` 可直接供排程器或報表使用，區分來源列層級的 `scanned`、`matched`、`changed`、`heldForReview`、`skipped`；欄位層級另提供 `fieldsChanged`、`fieldsHeldForReview`、`fieldsSkipped`、`summary.fieldCounts`，`summary.fields` 保留每個缺口的 target 與原因。已有值、`verified`／`reviewed` 標記或 metadata reviewed 標記的資料不會被覆寫；provider ID 或精確系列代碼＋卡號無法唯一匹配時會進入 `heldForReview`。

`cursor.next` 內含排序後來源快照的 SHA-256 checksum。來源內容改變（即使只是來源欄位值改變）會讓舊 cursor 拒絕；同一快照重新執行則 checksum 與排序穩定，沒有新的 patch 時可安全視為 idempotent。

候選資料寫入私有 `catalog_enrichment_candidates`，確認來源政策與精確配對後才晉升正式表。價格則以 append-only `price_observations` 保存；內容未變時以 checksum 跳過，至少兩個相同比較維度的觀測點才計算漲跌。

目前遊々亭仍是 `permission-pending`，因此不會排程重新抓取；既有驗證資料也不代表完整市場。圖片 URL 與公開可存取不等同授權，顯示狀態仍依來源政策判定。
