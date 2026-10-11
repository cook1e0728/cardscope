# 日本價格來源盤點（主方案第 6 階段）

調查日期：2026-10-11
範圍：只讀規約、robots.txt、站台首頁與至多一個樣本頁；單一來源每頁僅請求一次、不登入、不繞過防護、不大量請求。
性質：純調查文件，**不代表任何來源已啟用**。依主方案原則，`listing`／`buyback`／`sale` 永遠分開；沒有可靠資料就不顯示；授權不明採保守策略。

> 方法與限制
>
> - robots.txt 以一般 HTTP GET 直接讀取（UA 為 `CardScopeResearch/1.0`），內容為原文。
> - 規約以 HTTP GET 取回後抽出純文字，再以關鍵字（クローラ、スクレイピング、ロボット、自動、転載、複製、商用、API、別の手法）搜尋；少數來源輔以 WebFetch 的摘要，已於各節標明。
> - 條文引文皆 ≤15 字；其餘為摘要。「風險等級」是工程判斷，**不是法律意見**。規約沒有明文禁止，不等於獲得授權。
> - 無法確認的項目一律標示「無法確認」並寫明原因，不猜測。

## 總表

| 來源 | 價格性質 | 涵蓋 IP（已驗證者） | 身分對應 | 規約明文禁止自動取得？ | robots.txt 對價格頁 | 官方 API／資料提供 | 風險 | 技術難度 |
|---|---|---|---|---|---|---|---|---|
| 遊々亭 yuyu-tei.jp | buyback＋listing（販售頁另計） | 寶可夢 `poc`、遊戲王 `ygo`、航海王 `opc`、WS `ws`；**無**排球少年 | 系列代碼＋卡號（現有 parser 已輸出 set_code／card_number） | 未見；但有「無斷轉載禁止」 | 無 Disallow（僅對 Slurp/bingbot/AhrefsBot/serpstatbot 設 Crawl-delay） | 無（未見） | 中 | 低（靜態 HTML，無 Cloudflare 挑戰） |
| カードラッシュ cardrush.jp | listing（販售）；買取頁無法確認 | 遊戲王為主；子站含寶可夢、航海王、MTG 等；未見 WS／排球少年 | 無法確認（未讀樣本頁） | **是**：專頁明文禁止 | 僅封 GPTBot 等 AI 爬蟲，其餘無限制 | 無；專頁表示須洽談「正式提携」 | 高 | 未測（不應測） |
| 晴れる屋2 hareruya2.com | listing（販售價）；買取在另一站 hare2buy.com | 僅寶可夢 | 標題含「卡號＋系列代碼」，如 `〈044/040〉[MF]` | 未見明文；有「無斷轉載及再配布」 | 商品頁可抓；`/search`、`/collections/*sort_by*`、過濾條件被 Disallow | 無（Shopify 店面；未見資料授權頁） | 中 | 低～中（Shopify，頁面極大 1.8MB） |
| ドラゴンスター dorasuta.jp | 買取（推測）／販售 | 無法確認 | 無法確認 | 無法確認 | 無法確認（robots.txt 本身回 403） | 無法確認 | 無法確認，視為高 | 高：Cloudflare managed challenge，**依原則不繞過** |
| magi magi.camp | C2C 平台 listing／成交（無法確認是否公開成交價） | 含卡牌；各 IP 無法確認 | 商品頁為使用者上架，身分不一致；無法確認 | **是**：第 8 條禁止事項 | `/items/search`、`/products/search` 對 Claude／GPT 等 AI 爬蟲 Disallow | 無（未見） | 高 | 中（Cloud Armor 防護，站方自述大量 bot 流量被封） |
| スニーカーダンク SNKRDUNK | 平台成交履歴＋掛單 | 含トレカ（Pokémon、遊戯王等，由 sitemap 名稱判斷；各 IP 無法確認） | 商品為平台自建頁，系列代碼／卡號是否規則化無法確認 | **是**：第 7 條明文禁止爬蟲與 scraping | `/item-histories` 等被 Disallow；`trading-card` 商品 sitemap 有列出 | 無（未見公開 API） | 高 | 中（站台 SPA 化程度與反爬無法確認） |
| メルカリ jp.mercari.com | C2C listing／成交 | 全品類 | 無（自由文字標題，非規格化） | 規約本文未見；禁止事項引用「ガイド」（未讀） | `/v1/`、`/v2/`（API 路徑）Disallow；搜尋頁未封 | 無公開價格 API（未完全確認） | 高 | 高（SPA＋私有 API；未實測） |
| ラクマ fril.jp | C2C listing | 全品類 | 無 | 規約本文未見；禁止事項引用「ラクマのルール」（未讀） | `/search/` 與多數搜尋參數 Disallow | 無法確認 | 高 | 中（未實測） |
| Yahoo!オークション auctions.yahoo.co.jp | 落札相場（成交）／現行 listing | 全品類 | 無（自由文字） | 拍賣詳細規程只禁止自動「出品」；爬取相關的 LINEヤフー共通規約未讀 → 無法確認 | **`/closedsearch/`（落札相場搜尋）被 Disallow** | 歷史上有 ヤフオク!API（2017 年仍有公告）；現況與可用範圍無法確認 | 高 | 中 |
| カードショップセラ cardshop-serra.com | listing／買取（Shopify） | **MTG 專門**，不在目標 5 IP | — | 未讀 | 一般 Shopify 規則，商品頁可抓 | 無 | 不適用 | 低 |
| トレカの洞窟 doukutsu.jp | 以公告文章形式（買取情報分類） | 無法確認 | 無結構化價格表 | 未讀 | 僅 `/wp-admin/` Disallow | 無 | 不適用（無結構化資料） | — |
| 其他比價／相場站（uridoki、price-base、hikakaku、aucfan） | 二手整理（買取比價／落札相場） | 各異 | 各異 | 未讀 | 見下節 | aucfan 有付費服務（本專案不得付費） | 高（權利鏈不明） | hikakaku 回 Cloudflare 挑戰 |

## 各來源

### 1. 遊々亭（yuyu-tei.jp）

- 網址：`https://yuyu-tei.jp/`；買取 `https://yuyu-tei.jp/buy/<game>/...`；現有程式使用 `https://yuyu-tei.jp/buy/${game}/card/${ver}/${cid}`。遊戲代碼（首頁連結）：`poc`（寶可夢）、`ygo`（遊戲王 OCG）、`opc`（航海王）、`ws`／`wsr`（Weiß Schwarz／Rose）等 24 個；**無排球少年**。`/buy/poc` 直接請求回 404，需由首頁→遊戲→系列逐層進入，本次未深入。
- 價格性質：買取（`buy`）為現有資料；販售頁（`sell`）為 listing，未調查。幣別 JPY。
- 身分對應：現有 `scrapeYuyutei`（`server.mjs`）輸出 `set_code`、`card_number`、`rarity`、`card_name`，可與系列代碼＋卡號對應；本次未再抓卡片頁，沿用既有實作。
- 規約（`https://yuyu-tei.jp/info/rule`，2019-02-20 改定的特商法欄為最後可見日期）：
  - 「適用範圍」：規約適用於商品買賣與「情報の閲覧」等一切服務，即瀏覽網站資訊本身也在範圍內。
  - 「著作權について」：站內圖片、文章、內容的權利屬店家，「無断での転載を禁止」；沒有區分價格事實與創作性內容。
  - 「責任の制限」：網站上的商品資訊與價格不保證正確、完整。
  - 「適用範圍」另有「不得為轉賣而下單」，與資料抓取無直接關聯。
  - **沒有**出現與自動取得、爬蟲、機器人、API、商用利用直接相關的條文。規約不分條號，上述以段落標題標示。
- robots.txt（原文）：僅四組：`Slurp`（Crawl-delay 1）、`serpstatbot`（20）、`bingbot`（10）、`AhrefsBot`（10）；另有 sitemap `https://yuyu-tei.jp/ext/sitemap/yuyutei/index.xml`。對 `User-agent: *` **沒有任何 Disallow**，價格頁未禁。
- 官方 API／資料提供／affiliate：首頁與規約頁未見；聯絡 `info@yuyu-tei.jp`、營運公司為株式会社スカラプレイス（スカラ集團）。無法確認是否接受資料授權詢問。
- 風險：**中**。理由：沒有明文禁止爬取、robots 未封，但著作權段落的「無断轉載禁止」範圍寬、規約適用「情報の閲覧」，且未取得書面授權；現有 registry 也因此維持 `collectionEnabled:false`。圖片已設為 `external-only`，不轉載。
- 技術難度：低。靜態 HTML，本次請求首頁與 `/info/rule` 均為 200，無 Cloudflare 挑戰。

### 2. カードラッシュ（cardrush.jp 及子站）

- 網址：遊戲王為 `https://www.cardrush.jp/`；寶可夢 `https://www.cardrush-pokemon.jp/`、航海王 `https://www.cardrush-op.jp/`、其他子站見資料政策頁。未見 WS、排球少年。
- 價格性質：販售（listing）。首頁頁面內容未見買取價格頁連結 → 買取價格頁是否存在：無法確認。幣別 JPY。
- 身分對應：無法確認（因政策原因未讀樣本頁）。
- 規約：首頁頁尾有「當サイトの價格データ等の利用について」專頁 `https://cardrush.media/data_policy`（最終改定 2023/11/20），適用其營運的所有網站：
  - 「價格情報等」：想利用價格資訊者須經客服窗口聯絡，由店方檢討「正式提携」。
  - 禁止事項（除非已正式提携）包含：以非其提供介面之外的方式存取服務；以「スクレイピングを目的として」透過程式自動存取並取得價格或內容；為取得販售價／買取價而手動大量存取；對伺服器或網路造成負擔。
  - 「コンテンツの取り扱い」：獨自內容禁止擅自使用與轉載。
  - 一般「利用規約」連結未在首頁找到；未另讀。
- robots.txt（原文）：僅對 GPTBot、Bytespider、TikTokSpider、meta-externalagent 設 `Disallow: /`；其餘無限制。**注意：robots 寬鬆不代表可抓，專頁明文禁止。**
- 官方 API／資料提供：無公開 API；有「洽談正式提携」的書面管道（見上）。
- 風險：**高**。理由：明文禁止自動化取得價格與大量手動存取。本專案除非取得其書面授權，不應抓取，也不必再測技術難度。
- 技術難度：未測。

### 3. 晴れる屋2（hareruya2.com）

- 網址：`https://www.hareruya2.com/`（Shopify）；買取站 `https://www.hare2buy.com/`（「晴れる屋2ネット買取」）。涵蓋僅寶可夢卡牌遊戲，首頁無遊戲王／航海王／WS／排球少年。
- 價格性質：本站為販售價（listing，店家掛價）；買取價在 hare2buy.com（buyback），兩者須分開。幣別 JPY。
- 身分對應：樣本商品頁（`/products/10265832259904`）標題為 `ブラッキーex(-){悪}〈044/040〉[MF] ｜ポケカ販売‧買取｜ 晴れる屋2`，含卡名、卡號 `044/040`、系列代碼 `MF`、稀有度標記，能與「系列代碼＋卡號」對應；商品 URL 為 Shopify 數字 ID。JSON-LD 存在，價格欄位格式（`13000` 與 `1300000` 並存，疑似單位不同）需先釐清，**不可直接取值**。
- 規約（`https://www.hareruya2.com/pages/terms-of-use`，編號依頁面順序）：
  - 第 4 條「知的財産権」：站內內容不得用於本站使用目的以外的複製與利用，也不得以提供第三者為目的複製、散布。
  - 第 6 條「禁止行為」：禁止「無断転載及び再配布」，並禁止妨礙營運或造成伺服器顯著負擔的行為。
  - 沒有自動取得、爬蟲、機器人或商用利用的專門條文（WebFetch 摘要與原文逐條核對一致）。
- robots.txt（原文，Shopify 標準）：`User-agent: *` Disallow 包含 `/admin`、`/cart`、`/checkout`、`/account`、`/search`、`/policies/`、`/recommendations/products`、各種 `sort_by`／多重 filter／preview 的 `collections` 路徑；**`/products/*` 與單純 `/collections/<id>` 未禁**。無 Crawl-delay（僅對 AhrefsBot 10 秒、MJ12bot 10 秒、Pinterest 1 秒設定）；`Nutch` 全封。hare2buy.com 的 robots.txt 只封 GPTBot／Bytespider／TikTokSpider／meta-externalagent。
- 官方 API：未見資料授權頁。Shopify 店面的公開 `/products.json` 是否啟用及是否適合使用：無法確認（未測，也不應因技術可行而視為許可）。
- 風險：**中**。理由：規約有「無斷轉載及再配布」與智財條款，且為商業站；但無明文爬蟲禁令、robots 對商品頁未禁。僅涵蓋寶可夢，且是店家掛價而非成交價。
- 技術難度：低～中。Shopify 店面；首頁 HTML 達 1.8MB，不應整頁掃描。

### 4. ドラゴンスター（dorasuta.jp）

- 網址：`https://dorasuta.jp/`。位於大阪府（第三方介紹），有網路「買取センター」。涵蓋 IP、價格性質、身分對應：無法確認。
- robots.txt 與首頁皆回 HTTP 403，內容是 Cloudflare 的「Just a moment...」managed challenge（需執行 JavaScript）。依主方案「不繞過 Cloudflare」原則，**到此停止**，規約、robots、API 均無法確認。
- 風險：無法確認，保守視為**高**。技術難度：高（Cloudflare 挑戰）。

### 5. magi（magi.camp）

- 網址：`https://magi.camp/`。C2C 卡牌市集（含官方店舖）。價格性質：使用者上架價（listing）與成交資訊是否公開：無法確認。
- 身分對應：商品由賣家上架，標題非規格化；`/products/...` 之類的商品統整頁是否存在及結構：無法確認（搜尋頁被 robots 對 AI 爬蟲封鎖，未測）。
- 規約（`https://magi.camp/terms/use`）第 8 條「禁止事項」：
  - 項目 v：禁止未經書面同意，在服務外以「商業目的」利用其服務、內容、資訊等。
  - 項目 bb：禁止對連接服務的伺服器或網路造成不良影響。
  - 項目 dd：禁止以非其提供介面之外的方式存取服務。
  - 未見獨立的「爬蟲」字樣，但 dd 與 v 合併後等同禁止自動取得並商用。
- robots.txt（原文，含站方註解）：一般代理僅 Disallow 註冊、`/mypage/`、交易建立頁；對 ClaudeBot、Claude-User、GPTBot、CCBot、PerplexityBot 等 AI 爬蟲額外 Disallow `/items/search`、`/products/search`；`MJ12bot`、`dotbot`、`AhrefsBot` 全封。站方註解說明搜尋請求為高成本路徑，並曾因大量 bot 觸發 Cloud Armor 規則封鎖。
- 官方 API：未見。
- 風險：**高**。理由：規約有 dd、v；站方明示反感大量 bot。技術難度：中。

### 6. スニーカーダンク（SNKRDUNK，snkrdunk.com）

- 網址：`https://snkrdunk.com/`。有成交履歴（`/item-histories` 為 robots Disallow 路徑），並有 `trading-card`、`trading-card-single` 商品 sitemap（`https://snkrdunk.com/en/sitemap/sitemap-index-en-product-trading-card-single.xml`）。價格性質：平台成交（sale）＋現行最低掛價／買價（平台參考價），須分開。幣別 JPY。涵蓋 IP：卡牌（sitemap 名稱判斷）；各 IP：無法確認。
- 身分對應：商品為平台自建，卡號／系列代碼是否規則化：無法確認（未讀樣本頁）。
- 規約（`https://snkrdunk.com/terms`）第 7 條「禁止事項等」：
  - 明文禁止以「クローリング、スクレイピング」或類似手段存取服務或取得服務相關資訊。
  - 另禁止未經同意以營利為目的利用服務、妨礙營運、收集他人資訊超過必要範圍。
- robots.txt（原文）：`User-agent: *` Disallow 大量帳號、交易、`/buy`、`/listings`、`/item-histories`、`/orders` 等路徑；商品 sitemap 公開。
- 官方 API／affiliate：未見公開 API；是否有 affiliate：無法確認。
- 風險：**高**（明文禁止）。技術難度：無法確認（未測）。

### 7. メルカリ（jp.mercari.com）

- 網址：`https://jp.mercari.com/`。價格性質：C2C 上架價（listing）與成交（售完商品）；兩者須分開。涵蓋全品類；身分對應：無（自由文字標題）。
- 規約（`https://static.jp.mercari.com/tos`）：
  - 第 8 條「禁止事項」：禁止「ガイド」記載的禁止行為，具體清單在 ガイド，本次**未讀**（無法確認是否含自動取得）。
  - 第 21 條「知的財産權及びコンテンツ」第 1 項：服務構成素材的權利歸店家或第三者，使用者不得取得任何權利；第 2 項：賣家投稿的內容可由店家與其指定者自由利用。
  - 本文未見爬蟲、scraping 專條。
- robots.txt（原文）：`User-agent: *` Disallow `/mypage/`、`/purchase/`、`/sell/`、`/transaction/`、`/v1/`、`/v2/` 及其 `/en/` 版本；搜尋路徑未封。對 Twitterbot、facebookexternalhit 開放。
- 官方 API：未見公開價格 API（未完全確認）。
- 風險：**高**。理由：C2C 資料無規格化身分，賣家內容的權利歸屬複雜，且 API 路徑被 robots 禁止。技術難度：高（SPA；未實測）。

### 8. ラクマ（fril.jp／rakuma.rakuten.co.jp）

- 網址：`https://fril.jp/`。價格性質：C2C 上架價（listing）；身分對應：無。
- 規約（`https://fril.jp/info/policy`，2025-12 起條號重編）：
  - 第 17 條「知的財産権」：服務內容的權利歸店家或原權利人，使用者投稿的權利與授權另有規定。
  - 第 19 條「禁止事項」：禁止「ラクマのルール」所載行為，具體清單在利用指南，本次**未讀**（無法確認是否含自動取得）。
  - 本文未見爬蟲、scraping 專條。
- robots.txt（原文）：Disallow `/search/`（僅 `Allow: /search/$`）、大量搜尋參數（`sort`、`status`、`min`、`max`、`category_id` 等）。價格查詢的主要入口被禁。
- 官方 API：無法確認（未見公開價格 API）。
- 風險：**高**（搜尋入口被禁、無身分對應）。技術難度：中（未實測）。

### 9. Yahoo!オークション（auctions.yahoo.co.jp）

- 網址：落札相場搜尋 `https://auctions.yahoo.co.jp/closedsearch/`。價格性質：成交（落札價，最近約 90 天）與現行 listing；須分開。身分對應：無（自由文字）。
- 規約：已讀「ヤフオク！詳細規程」（`https://guide-ec.yahoo.co.jp/notice/rules/auc/detailed_regulations.html`）。其中只見「自動的に出品するツール」的使用限制（針對出品），圖片授權段落是賣家授權 Yahoo 的使用。與瀏覽器之外的資料取得直接相關的 LINEヤフー共通利用規約本次**未讀**，結論：無法確認。
- robots.txt（原文）：`User-agent: *` Disallow `/closedsearch/`、`/closeduser/`、`/closedwatchlist/`、`/members/`、`/user/`、`/show/` 等。**落札相場搜尋明文禁止**。
- 官方 API：歷史上有 ヤフオク!API（2017 年有修正公告）；現況、可用範圍、是否含落札相場：無法確認。
- 風險：**高**。技術難度：中。

### 10. カードショップセラ（cardshop-serra.com）

- 網址：`https://cardshop-serra.com/`（Shopify）。首頁標題為「MtG通販・買取ならカードショップセラ」，**MTG 專門**，不在本專案 5 個 IP 內。另有同名實體店（靜岡縣沼津市，第三方資訊）。
- robots.txt：Shopify 標準規則（`Disallow` 排序／過濾路徑），商品頁可抓。檔頭註解提供 Shopify UCP／MCP 端點供購物代理使用，僅限購買流程，與價格資料授權無關；本調查未使用。
- 規約未讀；價格性質、API：不適用。
- 風險／難度：不適用（無涵蓋 IP）。

### 11. トレカの洞窟（doukutsu.jp）

- 網址：`https://doukutsu.jp/`。WordPress 站，內容為新彈、預約、活動與「買取情報」等分類的公告文章；未找到結構化價格表或商品資料庫。舊網址 `e-mulan.com/toreca/` 現為 404。
- robots.txt（原文）：僅 Disallow `/wp-admin/`（允許 `admin-ajax.php`）。
- 規約、涵蓋 IP、價格性質、API：無法確認／未見。若買取價只以公告文章（可能為圖片）發布，則難以規格化、身分對應不可靠。
- 風險／難度：不適用（無結構化資料）。

### 12. 其他主要店家與比價／相場站

- **カードラボ（c-labo.jp）**：WordPress 站，robots 僅封 `/wordpress/wp-admin/`；規約與價格資料形式未深入，無法確認。
- **トレカキャンプ（torecacamp-pokemon.com）**：Shopify，robots 與セラ相同；規約未讀，無法確認。
- **買取比價站（uridoki.net、price-base.com、hikakaku.com）**：彙整多家店的買取價。uridoki 的 robots 封 `/jump*`、搜尋與排序分頁；price-base 封 `/weiss-schwarz/` 與卡片搜尋參數頁；hikakaku 的 robots.txt 本身回 Cloudflare 挑戰（403），依原則不繞過。其資料源自各店，權利鏈不明，且是二手彙整，不建議作為來源。
- **オークファン（aucfan.com）**：落札相場彙整站；robots 對 `/search1/`、`/yahoo/` 等 Disallow，並對 ClaudeBot、GPTBot 等 AI 爬蟲額外限制。其資料為 Yahoo 等平台的二手彙整，付費服務不得使用。規約與 API 方案未讀。

## 建議最小一條

**遊々亭買取（單一來源，`jp_buyback_prices`），而且在啟用前先取得書面確認。**

排序依據：權利風險優先，其次涵蓋，再其次身分對應。

1. 在已調查的來源裡，**只有遊々亭**同時符合「規約與 robots 都沒有明文禁止自動取得」、涵蓋寶可夢＋遊戲王＋航海王＋Weiß Schwarz 四個 IP、且已有 `set_code`＋`card_number` 的身分對應與解析器。其餘多數不是明文禁止（カードラッシュ、magi、SNKRDUNK），就是 robots 禁止價格入口（ラクマ、Yahoo!オークション）、或無身分對應（メルカリ、ラクマ、Yahoo）、或被 Cloudflare 擋住（ドラゴンスター）。
2. 價格性質明確為 `buyback`，符合主方案「若資料只有遊々亭買取，介面名稱使用『單一來源買取漲幅』」。
3. 風險仍是**中**，不是低。規約有「無断での転載を禁止」且適用於「情報の閲覧」，沒有授權依據。因此建議：
   - 啟用前，由站主以書面（`info@yuyu-tei.jp`）詢問是否同意以低頻率、僅取買取價格事實、顯示來源與連結的方式使用；取得答覆後，把證據連結寫入 `data/source-registry.json` 的 `evidenceUrl`／`notes`，再決定是否把 `collectionEnabled` 改為 `true`。本工作未做此詢問，也未改任何設定。
   - 若無法取得答覆，維持現狀（`collectionEnabled:false`、只管理員手動）；這是站主的風險接受決策，需另走 ADR 流程。
   - 即使啟用，仍維持：一次一個請求、至少 1 秒間隔、不抓圖片（圖片政策 `external-only`）、只存價格事實與卡片連結、前後觀測至少相隔 24 小時才比較。
4. 備選（第二順位，若要補「寶可夢販售價」且站主接受風險）：**晴れる屋2** 的販售價（listing）。身分對應最清楚（標題含卡號＋系列代碼），robots 對商品頁未禁，但有「無斷轉載及再配布」，涵蓋僅寶可夢，且為店家掛價，需先釐清 JSON-LD 價格欄位單位。

排球少年沒有任何已驗證的日本價格來源；對該 IP 維持「尚未取得可靠資料」。

## 無法確認的點

- ドラゴンスター：robots.txt／首頁皆被 Cloudflare 挑戰擋下（HTTP 403），依原則停止，所有欄位無法確認。
- メルカリ「ガイド」、ラクマ「ラクマのルール」中的禁止行為清單，以及 LINEヤフー共通利用規約：未讀，是否含自動取得條文無法確認。
- 遊々亭販售頁（`sell`）的價格、各系列頁面結構與請求頻率上限：未抓取樣本頁，沿用 `scrapeYuyutei` 的既有實作。
- カードラッシュ買取頁是否存在、卡片頁是否含系列代碼：因資料政策明文禁止，未讀樣本頁。
- 晴れる屋2 JSON-LD 的價格欄位單位與 `/products.json` 是否適用：未測。
- SNKRDUNK、magi、メルカリ、ラクマ、Yahoo 的身分對應細節與技術難度：未讀樣本頁、未實測。
- ヤフオク!API 的現況，以及任何來源是否提供 affiliate 或資料授權方案：無公開資訊，須以書面詢問才能確認。
- 規約條號：遊々亭、晴れる屋2 的條款以頁面標題／順序標示（原文無或部分無條號）；其餘以原文條號為準。
