# 頁面文案：隱私說明與資料來源（可直接貼）

用途：`docs/SITE_IMPROVEMENT_PLAN.md` 的 G1（隱私說明）與 G3（資料來源）。前端 worker 把下面兩段貼進頁面（建議 `?view=privacy` 與「關於」頁，或頁尾連結的目標）。
文案已照原始碼查證，查證出處寫在每段的 HTML 註解與本文最後的「查證出處」。**標 TODO 的句子不能原樣上線。**

---

## 1. 隱私說明（貼上用）

標題：隱私說明

CardScope 不需要登入，不放 cookie，也不追蹤你。

**我們不做的事**
- 不使用 cookie。
- 不使用第三方的分析或廣告工具（沒有 Google Analytics、沒有像素、沒有指紋辨識）。
- 伺服器每天統計各類頁面（首頁、遊戲、系列、卡片、搜尋）被開啟的總次數，只留下每天的總數；不記 IP、不記搜尋字詞、不放 cookie，也無法分辨是誰開的。另外每天記錄被開啟最多次的前 50 張卡各被開了幾次，用來排「最熱」，同樣不記錄是誰開的。
- 不要求註冊，也不蒐集姓名、信箱或電話。
- 本站不把你的搜尋字詞或 IP 存進資料庫。IP 只暫存在伺服器記憶體裡，用來限制太頻繁的請求，不會寫入檔案。

**你的收藏只存在你的瀏覽器**
- 「我的收藏」（頂欄或手機底部導覽）的星號、張數、品況、版本與備註，都存在這個瀏覽器的 localStorage。
- 這些資料不會上傳到 CardScope 的伺服器，我們看不到。
- 清除瀏覽器的網站資料、換瀏覽器或換裝置，收藏就會消失，而且我們無法幫你找回。
- 無痕視窗關掉後也會消失。

**備份與還原**
1. 打開「我的收藏」，按「匯出備份」，會下載一個 `cardscope-collection-日期.json` 檔。
2. 換裝置或不小心清掉資料後，在「我的收藏」按「匯入」，選這個檔（也可以選用「下載 CSV」存下來的 CSV 清單）。
3. 匯入前會先顯示預覽，確認後才寫入。預設是合併：同一張卡取較大的數量，重複匯入不會讓數量翻倍。勾選「以匯入檔取代全部」才會取代現有收藏，而且會再問一次。
4. 檔案上限 2 MB、10,000 筆。

**瀏覽器還存了什麼**
- 一些介面偏好：是否暫停動畫、卡牆排序、最近看過的系列、是否看過導覽。只在你的瀏覽器裡。
- 離線頁用的網站外殼（程式、樣式、兔子圖）。不含卡片資料、價格，也不含第三方卡圖。

**連到別人的伺服器**
- 本站網頁字型向 Google Fonts 載入。
- 多數卡圖直接從官方網站或資料來源的伺服器載入（詳見「資料來源」）。載入時，對方的伺服器會看到你的 IP 與瀏覽器資訊，這由他們各自的政策管理，不在 CardScope 的控制內。
- 航海王的卡圖由 CardScope 的伺服器代為讀取後轉給你，所以官方網站看到的是我們的伺服器，不是你。圖片不會被儲存。
- 主機與網路服務（Render、Cloudflare）可能依一般運作留存連線紀錄，這也不在本站控制內。
- 連到外部的連結（官方卡表、商品頁等）點下去之後，就適用對方的隱私政策。

**聯絡**
- TODO（等 SITE_IMPROVEMENT_PLAN 決定 5：專用信箱）：隱私問題與刪除要求請寄到 〈信箱〉。決定前不要上線這一行，也不要用私人信箱。

最後更新：〈上線當天日期〉

> 若之後做 F4（每天各類頁面被開幾次的計數，決定 4），要在「我們不做的事」加一句，寫明只記總數、不記 IP、不放 cookie。現在不要寫，因為還沒做。

<!--
查證出處（給 lead 核對，上線時可刪）：
- 不放 cookie：server.mjs 與所有前端 .js、index.html 搜尋 Set-Cookie / document.cookie 皆無結果。
- 沒有分析工具：CSP（server.mjs 第 71 行）script-src 只有 'self' 與 inline 雜湊，connect-src 'self'；index.html 沒有第三方 script。
- 不記錄搜尋與 IP：server.mjs 只有啟動時 console.log；限流 createRateLimiter 以 cf-connecting-ip 為鍵、存在記憶體（server.mjs 約 738–744 行）。
  注意：server.mjs 約 1303 行在「請求出錯」時 console.error 會印出 req.url（含查詢字串，可能含搜尋字），不含 IP。文案已寫成「不存進資料庫」；出錯時搜尋字詞仍可能出現在 Render 日誌。lead 可決定是否改程式只記 pathname。
- 收藏存 localStorage：collection-store.js 第 1 行註解「資料只存在這台裝置」；實際鍵 cardscope-watchlist、cardscope-watchlist-meta、cardscope-favorites（ui-enhancements.js 第 5–6、143 行）。
- 收藏畫面的字樣、按鈕名稱：ui-enhancements.js 第 1041 行（「匯出備份」「匯入」「下載 CSV」「只存在這台裝置」）；匯入預覽與「以匯入檔取代全部」第 1035 行；取代前再問一次第 1105 行；檔名 cardscope-collection-<日期>.json 第 1132 行。
- 限制 2 MB、10,000 筆：collection-store.js LIMITS（itemsMax 10000、fileMaxChars 2097152）。
- 其他 localStorage 偏好：cardscope-motion-paused（look-motion.js）、cardscope-series-sort／cardscope-recent-series／cardscope-band-recent（series-*.js）、cs-tour-done（look-showcase.js 第 4 行）、cardscope-favorites-only。
- 離線外殼：sw.js 第 1–6 行（只存同源靜態檔，不存 /api/*、不存第三方卡圖）。
- Google Fonts：index.html 第 5–6 行的 fonts.googleapis.com；CSP style-src／font-src 列出 fonts.googleapis.com、fonts.gstatic.com。
- 卡圖直連第三方：CSP img-src 清單（server.mjs 第 71 行）。
- 航海王圖片代理：server.mjs 第 80–103 行 proxyOnePieceImage（白名單主機、5 MB 上限、不寫檔，只回傳並設 Cache-Control）；providers/seo.mjs 第 69 行、look-showcase.js 第 34 行把官方圖網址改寫成 /api/images/onepiece。
- 沒驗證：Render／Cloudflare 的平台日誌實際保留多久與內容（程式碼註解說正式站在 Cloudflare 後面，我沒有登入查）。
-->

### 貼上用的標記草稿

語意標記、沒有 inline 事件屬性、沒有新顏色（沿用既有 CSS 變數與 class；只在需要時由前端 worker 補最小的版面樣式）。

```html
<section class="section" id="privacy" aria-labelledby="privacyTitle">
  <div class="title"><div><h2 id="privacyTitle">隱私說明</h2><span class="meta">最後更新：〈日期〉</span></div></div>
  <p>CardScope 不需要登入，不放 cookie，也不追蹤你。</p>

  <h3>我們不做的事</h3>
  <ul>
    <li>不使用 cookie。</li>
    <li>不使用第三方的分析或廣告工具（沒有 Google Analytics、沒有像素、沒有指紋辨識）。</li>
    <li>伺服器每天統計各類頁面（首頁、遊戲、系列、卡片、搜尋）被開啟的總次數，只留下每天的總數；不記 IP、不記搜尋字詞、不放 cookie，也無法分辨是誰開的。另外每天記錄被開啟最多次的前 50 張卡各被開了幾次，用來排「最熱」，同樣不記錄是誰開的。</li>
    <li>不要求註冊，也不蒐集姓名、信箱或電話。</li>
    <li>本站不把你的搜尋字詞或 IP 存進資料庫。IP 只暫存在伺服器記憶體裡，用來限制太頻繁的請求，不會寫入檔案。</li>
  </ul>

  <h3>你的收藏只存在你的瀏覽器</h3>
  <ul>
    <li>「我的收藏」的星號、張數、品況、版本與備註，都存在這個瀏覽器的 localStorage。</li>
    <li>這些資料不會上傳到 CardScope 的伺服器，我們看不到。</li>
    <li>清除瀏覽器的網站資料、換瀏覽器或換裝置，收藏就會消失，而且我們無法幫你找回。</li>
  </ul>

  <h3>備份與還原</h3>
  <ol>
    <li>打開「我的收藏」，按「匯出備份」，會下載一個 <code>cardscope-collection-日期.json</code> 檔。</li>
    <li>換裝置或不小心清掉資料後，在「我的收藏」按「匯入」，選這個檔（也可以選「下載 CSV」存下來的清單）。</li>
    <li>匯入前會先顯示預覽，確認後才寫入。預設是合併：同一張卡取較大的數量，重複匯入不會讓數量翻倍。勾選「以匯入檔取代全部」才會取代現有收藏，而且會再問一次。</li>
    <li>檔案上限 2 MB、10,000 筆。</li>
  </ol>

  <h3>瀏覽器還存了什麼</h3>
  <p>一些介面偏好（是否暫停動畫、卡牆排序、最近看過的系列、是否看過導覽），以及離線頁用的網站外殼。不含卡片資料、價格，也不含第三方卡圖。</p>

  <h3>連到別人的伺服器</h3>
  <ul>
    <li>網頁字型向 Google Fonts 載入。</li>
    <li>多數卡圖直接從官方網站或資料來源的伺服器載入（見<a href="#sources">資料來源</a>）。載入時對方會看到你的 IP 與瀏覽器資訊，這由他們各自的政策管理。</li>
    <li>航海王的卡圖由 CardScope 的伺服器代為讀取後轉給你，圖片不會被儲存。</li>
    <li>主機與網路服務（Render、Cloudflare）可能依一般運作留存連線紀錄，不在本站控制內。</li>
    <li>點到外部連結之後，就適用對方的隱私政策。</li>
  </ul>

  <h3>聯絡</h3>
  <!-- TODO 決定 5：換成專用信箱後再上線；不要用私人信箱 -->
  <p>隱私問題與刪除要求請寄到 <a href="mailto:TODO@example.invalid">TODO</a>。</p>
</section>
```

---

## 2. 資料來源（貼上用）

標題：資料來源

開頭兩句（放在表格上方）：
「這裡列出每個遊戲的資料從哪裡來。卡圖的著作權屬於各權利人，CardScope 沒有取得授權，只依各來源的使用條件顯示。價格都是參考價，不是成交價，也不是台灣店家的價格。」

> 上面「沒有取得授權」是照 `data/source-registry.json` 的 `risk-accepted` 與各 ADR 寫的事實（使用者接受風險，不是已獲授權）。這句是否要在公開頁面寫得這麼直接，請 lead 決定；刪掉會讓頁面和 ADR 對不上，建議保留。

### 表格

| 遊戲 | 卡片資料來源 | 卡圖來源 | 價格 |
|---|---|---|---|
| 寶可夢 | 日版：日本官方卡片搜尋（pokemon-card.com）與 TCGdex。台版：台灣官方卡片搜尋（asia.pokemon-card.com/tw）與 TCGdex 繁中資料。美版：Pokémon TCG API。 | 日版、台版：多數外連官方卡片搜尋的圖，不轉存。部分用 TCGdex 的圖；日版少數缺圖的卡用 TCGplayer 的圖（卡圖標「TCGplayer 卡圖」）。美版：Pokémon TCG API 提供的圖。少數日版舊卡借用同一張卡的英文版圖，畫面上會標「暫用英文版」。 | 有，僅部分卡。Cardmarket 歐洲市場「平台參考價」（歐元）與 TCGplayer 美國市場參考價（美元），經 TCGdex 或 TCG API 取得，再用每日匯率換算新台幣。不是成交價，也不是台灣行情。台版沒有價格。詳細頁另有「鑑定卡成交價」（PSA、BGS、CGC 等，來自 PokemonPriceTracker 彙整的 eBay 等成交紀錄），開卡時才查，不儲存，不是每張卡都有。 |
| 航海王 | 台灣、亞洲英文、美國英文三份官方卡表（onepiece-cardgame.com）。 | 官方卡表的圖，由 CardScope 伺服器代為讀取後轉給你，不儲存。美版圖有官方 SAMPLE 浮水印，保留不去除。 | 沒有。 |
| 遊戲王 | 卡片基本資料：YGOPRODeck。日版版本與日文卡名：官方卡片資料庫（日文版 db.yugioh-card.com）。 | YGOPRODeck 的圖（CardScope 會轉存一份到自己的儲存空間以免一直連線對方）；日版圖外連官方卡片資料庫，不轉存。 | 有，僅美版／英文版。YGOPRODeck 的「參考價」（美元，該站未標示平台），換算新台幣。找不到該版本價格時，改顯示跨版本最低參考價並標明。日版沒有價格。 |
| 黑白雙翼（Weiß Schwarz） | 官方卡表：日版（ws-tcg.com）與英文版（en.ws-tcg.com），只收芙莉蓮系列。 | 官方卡表的圖，外連不轉存，保留官方 SAMPLE 浮水印。 | 沒有。 |
| 排球少年 | 官方卡表（Takara Tomy，Vobaca!! BREAK）。 | 官方卡表的圖，外連不轉存。 | 沒有。 |
| 七龍珠超 Fusion World | 官方繁體中文卡表（dbs-cardgame.com/fw/asia-tc），加官方日文與英文卡表補名稱與英文版。 | 官方卡表的圖，外連不轉存。台版卡圖是日文印刷版。 | 沒有。 |

表格下方的固定說明（照貼）：
- 「沒有」＝我們沒有可靠、允許使用的價格來源，所以不顯示價格，也不推測。
- 價格的新鮮度：參考價超過 7 天沒更新就不顯示。匯率來自 ExchangeRate-API（每日更新），畫面上有原幣金額與匯率日期。
- 掛牌價、店家買取價、成交價是不同東西，CardScope 不會混在一起，也不會把平台參考價標成成交價。
- TODO（等決定 5）：發現錯誤請寄到〈信箱〉或填〈勘誤表單〉。決定前不要上線這一行。

### 貼上用的標記草稿

```html
<section class="section" id="sources" aria-labelledby="sourcesTitle">
  <div class="title"><div><h2 id="sourcesTitle">資料來源</h2></div></div>
  <p>這裡列出每個遊戲的資料從哪裡來。卡圖的著作權屬於各權利人，CardScope 沒有取得授權，只依各來源的使用條件顯示。價格都是參考價，不是成交價，也不是台灣店家的價格。</p>
  <div class="source-table-wrap"><!-- 窄螢幕橫向捲動；樣式由前端 worker 用既有顏色變數補 -->
    <table class="source-table">
      <caption class="meta">各遊戲的卡片資料、卡圖與價格來源</caption>
      <thead><tr><th scope="col">遊戲</th><th scope="col">卡片資料</th><th scope="col">卡圖</th><th scope="col">價格（參考價）</th></tr></thead>
      <tbody>
        <tr><th scope="row">寶可夢</th><td>…</td><td>…</td><td>…</td></tr>
        <tr><th scope="row">航海王</th><td>…</td><td>…</td><td>沒有</td></tr>
        <tr><th scope="row">遊戲王</th><td>…</td><td>…</td><td>…</td></tr>
        <tr><th scope="row">黑白雙翼（Weiß Schwarz）</th><td>…</td><td>…</td><td>沒有</td></tr>
        <tr><th scope="row">排球少年</th><td>…</td><td>…</td><td>沒有</td></tr>
        <tr><th scope="row">七龍珠超 Fusion World</th><td>…</td><td>…</td><td>沒有</td></tr>
      </tbody>
    </table>
  </div>
  <ul>
    <li>「沒有」＝我們沒有可靠、允許使用的價格來源，所以不顯示價格，也不推測。</li>
    <li>參考價超過 7 天沒更新就不顯示。匯率來自 <a href="https://www.exchangerate-api.com" rel="noopener">ExchangeRate-API</a>（每日更新），畫面上有原幣金額與匯率日期。</li>
    <li>掛牌價、店家買取價、成交價是不同東西，CardScope 不會混在一起。</li>
  </ul>
</section>
```

`<td>…</td>` 用上表對應格的文字取代。外部連結要用 `rel="noopener"`；ExchangeRate-API 的連結是它的免費條款要求（`data/source-registry.json` 的 `exchangerate-api.attributionRequired: true`）。
CSP 不必改：頁面只有文字與連結，沒有新圖片或腳本。

<!--
查證出處（給 lead 核對，上線時可刪）：

六個遊戲：providers/catalog-baseline.mjs 的 REQUIRED_GAME_IDS（pokemon、onepiece、yugioh、weiss-schwarz、haikyuu、dragonball-fw）；中文名取 data/catalog.json 的 games 與 index.html 第 309 行 labels（'葬送的芙莉蓮'、'七龍珠超 Fusion World'）。

來源登記：data/source-registry.json（version 3，reviewedAt 2026-10-11）。啟用的 runtime 來源：pokemontcg、tcgdex-zh-tw、tcgdex-pricing、ygoprodeck、onepiece-official-runtime、weiss-schwarz-official、haikyu-official、dbs-fw-official、yugioh-neuron、ebay、exchangerate-api。
  - 註冊表沒有 pokemon-card-official-jp、pokemon-tw-official、yugioh-official-us、optcg-api 的 sources 列，只在 imageDisplayPolicies 與 ui-enhancements.js 第 544 行 DETAIL_SOURCE_NAMES 出現；這四個的事實取自下列 ADR，不是註冊表。lead 若要嚴格以註冊表為準，這是一個缺口。
  - optcg-api：只出現在 data/catalog.json、註冊表政策與前端名稱表，原始碼沒有現行 provider；表格沒列。
  - ebay：註冊表為啟用，但 server.mjs 的 unifiedMarket 只組 yuyutei（被 metadataCollection:'denied' 擋掉）、ygoprodeck、tcgdex 三個任務，沒有 eBay；providerStatus 也沒列 eBay。表格沒列 eBay 價格。
  - 遊々亭（yuyutei）：2026-10-12 回信拒絕任何重用，collectionEnabled false；表格沒列。

寶可夢：
  - 卡片資料：data/source-registry.json（pokemontcg、tcgdex-zh-tw）、docs/adr/0031（日版 pokemon-card-official-jp、台版 pokemon-tw-official）、ui-enhancements.js 第 544 行來源名稱表。
  - 卡圖：docs/adr/0031（日台外連官方、不轉存）、docs/AGENT_BATON.md 11-03「TCG API 補圖」與「借用英文版同一張卡的圖」兩條（card_images source tcgplayer／pokemontcg）、ui-enhancements.js 第 200 行的「TCGplayer 卡圖」「暫用英文版」標示；CSP img-src 含 product-images.tcgplayer.com、images.pokemontcg.io、assets.tcgdex.net。
  - 價格：docs/adr/0036（日版 tcgdex-ja）、0037（官方日版核准系列）、0038（美版對照表）、0042（每日快照）；providers/tcgapi-pricing.mjs 檔頭（TCGplayer 美元、補 Cardmarket 沒有的日版系列）；providers/graded-prices.mjs 與 AGENT_BATON 11-03「鑑定卡成交價」（PokemonPriceTracker、eBay／Fanatics 成交彙整、不存資料庫、24 小時記憶體快取）；ADR 0036 的「台版不顯示」、7 天新鮮度。匯率：ExchangeRate-API（ADR 0036 Consequences）。
  - 「台版沒有價格」依 ADR 0036／0042（「台版、韓版不查」）。但 AGENT_BATON 11-03 寫「台版卡若沒有日版版本就不會顯示」鑑定價，暗示有日版對應的台版卡可能顯示鑑定價；我沒有實測，表格寫「台版沒有價格」可能略過這個例外。

航海王：providers/catalog-sync.mjs（asia-tc、asia-en、en.onepiece-cardgame.com）、註冊表 onepiece-official-runtime 備註（2026-10-06 ADR 0027；11-05 擴大到美版 ADR 0055）、AGENT_BATON 11-05。價格：AGENT_BATON 約第 116 行「航海王、排球少年、芙莉蓮、遊戲王日版維持無價格」。圖片代理：server.mjs 第 80–103 行。美版 SAMPLE 浮水印：AGENT_BATON 11-05 第 35 行。

遊戲王：註冊表 ygoprodeck（attributionRequired true）、yugioh-neuron 備註；providers/image-cache.mjs（從 images.ygoprodeck.com 下載、存進 Supabase bucket card-images，source cardscope-yugioh-cache）；yugioh-neuron 圖外連不轉存（備註 "hotlinked, not rehosted"）；價格 server.mjs 第 1042–1050 行（set_price 精確配對、日版 JP 一律不配、退回跨版本最低價並標明、YGOPRODeck 文件只寫 "$ value" 所以標「YGOPRODeck 參考價」）。

葬送的芙莉蓮：註冊表 weiss-schwarz-official 備註（ADR 0034、2026-11-04 英文版）、data/catalog.json（imagePolicy、「4 個系列」）；SAMPLE 浮水印：docs/PRODUCT_PLAN.md「官方 SAMPLE 圖；浮水印必須保留」。
排球少年：註冊表 haikyu-official、ADR 0034。
七龍珠：註冊表 dbs-fw-official 備註（ADR 0052 Q7；「Card images are the Japanese printings, hotlinked」；2026-11-04 英文卡表）。

「沒有取得授權」：註冊表 imageDisplayPolicies 全為 risk-accepted／external-only；各 ADR 的「使用者接受風險」；docs/PRODUCT_PLAN.md「來源授權不明時採保守策略」。

沒驗證：沒有查正式資料庫的實際 card_images 來源分布（沒有資料庫憑證，也沒有跑任何寫入或查詢）；各遊戲「現在」實際顯示的圖片來源比例以 ADR／接力棒記載為準，可能與現況有差。
-->

---

## 給 lead 的決定點

1. 隱私頁寫「不存進資料庫」，但 server.mjs 約 1303 行的錯誤日誌會印出 `req.url`（含搜尋字），要不要改程式只記 pathname（見第 1 節註解）。
2. 資料來源頁是否直接寫「沒有取得授權」（見第 2 節開頭備註）。
3. 註冊表缺 `pokemon-card-official-jp`、`pokemon-tw-official`、`yugioh-official-us` 的 sources 列，要不要補（不在這個工作包範圍）。
4. 聯絡信箱（決定 5）出來前，隱私頁與資料來源頁各有一處 TODO 不能上線。
