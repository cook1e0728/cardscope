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
