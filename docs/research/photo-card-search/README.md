# 「拍照查卡」功能評估報告

> **使用者決定（2026-10-15）：目前不花費額外金錢。** 不申請付費 Gemini API；若要做拍照查卡，只做瀏覽器端 OCR（照片不離開手機、零費用）的版本。

查詢日期：2026-10-15（所有「官方現況」皆為當天讀取之頁面；頁面自標更新日期另列）
性質：研究報告，未實作、未申請任何金鑰、未建立帳號、未把任何圖片或資料送到外部 AI 服務。
可信度標記：【已查證】＝官方頁面當天讀到；【二手】＝第三方／論壇／新聞，需自行複核；【推測】＝本報告的判斷或估計，尚無實測。

## 0. 結論摘要

1. **你的理解正確。** Google AI Plus 不含 Gemini API 額度。官方「Google AI plans」頁（自標 2026-10-13 更新）只列 Free／AI Pro／AI Ultra，沒有 AI Plus；頁面明寫訂閱權益只適用於 AI Studio 網頁介面，直接用 API（API 金鑰、外部應用）「另外計費與管理」；Google One AI 點數是獨立系統，AI Studio 不支援。Pro／Ultra 才可能經 Google Developer Program 領每月 Cloud 點數，且須開 Cloud Billing；AI Plus 是否有，官方頁面沒寫，無法確認。
2. **免費層不能拿來做公開網站。** 免費層的內容可被 Google 用於改進產品、可能被人工審閱，條款要求不要送個人／敏感資訊；歐盟／英國／瑞士使用者只能走付費。**另有一條要特別注意：服務條款「年齡」段要求使用者 18 歲以上，且不得用於「針對或可能被 18 歲以下者使用」的 API Client**（該段不分付費／免費，但我是透過摘要讀到，原文須自行複核）。TCG 網站很可能有未成年玩家，這是比費用更大的風險。
3. **付費 Gemini 與 `docs/PRODUCT_PLAN.md` 的全站固定原則衝突。** 該原則第一條是「不使用付費服務」，且「自主決策邊界」規定新增費用要停下回報。所以任何付費 API 都需要你明確改寫或豁免這條原則；這不是 worker 或實作者能自行決定的事。
4. **費用其實很低。** 以 Flash-Lite 級模型、每次一張圖，每 1,000 次約 0.2–1.3 美元（見 1.4）；用 5 美元預付餘額、不開自動儲值，等於有硬上限（餘額歸零 API 回 HTTP 402）。風險不在單價，在 (a) 模型 ID 快速汰換、(b) 思考 token 會悄悄放大費用、(c) 上述條款問題。
5. **建議路線：混合，且預設不傳照片。** 第一層：瀏覽器端導引框＋Tesseract.js 只讀「系列代碼＋卡號」這類 ASCII 欄位（英文語言包即可，約 4 MB），再用我們資料庫精確比對；第二層：使用者主動按「AI 協助辨識」才把縮圖送伺服器呼叫 Gemini（需你先決策 3 的原則問題與條款問題）；第三層：預填搜尋框讓人手動確認。影像相似度比對（向量）對「哪個印刷版本」幫助有限，且要下載官方卡圖，與 ADR 0007／0031「只存網址、不下載」精神衝突，不建議列入試行。
6. **同號多版本（ADR 0035「版本 k」）、異圖卡、日／台／美同卡號，OCR 與 Gemini 都分不出來，一律讓使用者在候選縮圖中點選，不可自動猜。**
7. **所有準確度數字目前都是假設。** 我找不到任何針對本站資料與玩家實拍條件的公開基準；第 4 節的試行就是為了量出來。

## 1. Gemini API 現況

### 1.1 可用於圖片理解的模型【已查證】

來源：<https://ai.google.dev/gemini-api/docs/models>（自標 2026-10-13 更新）、<https://ai.google.dev/gemini-api/docs/image-understanding>

| 模型 | 端點 ID | 狀態 |
|---|---|---|
| Gemini 3.8 Flash | `gemini-3.8-flash` | Stable |
| Gemini 3.6 Flash | `gemini-3.6-flash` | Stable |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` | Stable |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | Stable |
| Gemini 3 Flash | `gemini-3-flash-preview` | Preview |
| Gemini 2.5 Flash／Flash-Lite | `gemini-2.5-flash`／`-flash-lite` | 未棄用，但「僅限過去使用者」 |

- 圖片理解頁說「所有 Gemini 模型皆為多模態」，範例用 `gemini-3.8-flash`；模型頁沒逐模型列輸入模態。輸入格式：PNG、JPEG、WEBP、HEIC、HEIF；inline base64 整個請求上限 20 MB；較大或重複使用的圖用 File API。
- **模型汰換很快**：2.5 系列自 2026-09-18 起限制只有過去用過的人能用（官方模型頁寫「access limited to past users」；細節與日期來自二手報導【二手】），Gemini 3.1 Flash-Lite Preview、2.0 Flash 已關閉。實作時模型 ID 必須是環境變數，且要有「模型 404／不可用」的降級處理與告警。
- API 介面本身也在變：結構化輸出頁現在示範 Interactions API（`response_format` 帶 JSON Schema），而不是舊的 `response_schema`。實作前以當時官方文件為準。

### 1.2 每張圖片的 token 數【部分已查證，兩頁數字不一致】

- 圖片理解頁：兩邊長都 ≤ 384 px 為 258 token；較大者切成 768×768 方塊、每塊 258 token（960×540 約 6 塊）。
- Media resolution 頁（<https://ai.google.dev/gemini-api/docs/media-resolution>）：**Gemini 3／4 系列**每張圖預設 1,120 token（`low` 280、`medium` 560、`high` 1,120、`ultra_high` 2,240），並明說預設值在 Gemini 3／4 與舊模型間差異很大；該頁建議 OCR／密集文字用 `medium`（560），`high` 對一般文件 OCR 很少再改善。
- 結論：用 3.x 系列時，估 560–1,120 token／張；實作時一定要看回應的 `usageMetadata` 實測，不要靠估算。**我們讀的是卡號小字，卡號在圖中很小，`medium` 是否足夠必須用試行資料決定。**【推測】

### 1.3 價格（USD／百萬 token，付費標準層）【已查證】

來源：<https://ai.google.dev/gemini-api/docs/pricing>（自標 2026-10-14 更新）

| 模型 | 輸入（文字／圖片／影片） | 輸出（含思考） | Batch 輸入／輸出 | 備註 |
|---|---|---|---|---|
| 3.1 Flash-Lite | 0.25 | 1.50 | 0.125／0.75 | |
| 3.5 Flash-Lite | 0.30 | 2.50 | 0.15／1.25 | |
| 3.8 Flash | 0.75（至 2026-12-31），之後 1.50 | 3.75，之後 7.50 | 0.375／1.875，之後加倍 | **2027-01-01 起價格加倍** |
| 3.6 Flash | 同 3.8 Flash | 同 | 同 | 同上 |

- 圖片輸入與文字同價（頁面：Flash-Lite 系列與 2.5 Flash 明確寫圖片與文字同價；3.8／3.6 Flash 只列單一輸入價）。
- **思考 token 計入輸出費用。** 思考頁（<https://ai.google.dev/gemini-api/docs/thinking>）：3.5 Flash-Lite 預設思考「minimal」；3.8 Flash 預設 medium、最低只能設 low；頁面未說明 3.x 能否完全關閉思考（只有 2.5 Flash-Lite 列「Off」）。所以 Flash 級模型做辨識這種不需推理的工作，會被思考 token 拉高成本，必須實測 `usageMetadata`。

### 1.4 每次辨識費用與每 1,000 次估算（USD）【推測：依上表自行試算】

假設：提示文字約 150 token、輸出 JSON 約 100 token；「含思考」指額外 500 token 思考；最壞指圖 2,240 token＋思考 2,000 token。

| 情境 | 3.1 Flash-Lite | 3.5 Flash-Lite | 3.8 Flash（至 2026 年底） | 3.8 Flash（2027 起） |
|---|---|---|---|---|
| `low` 280 token，輸出 60 | 0.20 | 0.28 | 0.55 | 1.09 |
| `medium` 560，輸出 100 | 0.33 | 0.46 | 0.91 | 1.81 |
| 預設／`high` 1,120，輸出 100 | 0.47 | 0.63 | 1.33 | 2.65 |
| 1,120＋思考 500（輸出 600） | 1.22 | 1.88 | 3.20 | 6.41 |
| 最壞（2,240＋思考 2,000） | 3.75 | 5.97 | 9.67 | 19.34 |

解讀：每 1,000 次大約 0.3–0.6 美元（Flash-Lite、不思考）到 1–3 美元（Flash 級）。5 美元預付餘額約可辨識 8,000–15,000 次（Flash-Lite、不思考）或約 1,300 次（最壞情境）。若走 Batch（非即時）可再省一半，但拍照查卡需要即時，用不上。

### 1.5 免費額度與速率限制

- 免費層：Flash／Flash-Lite 各模型在價格頁都標示「Free of charge」，但頁面**沒有列每分鐘／每日請求數**。【已查證】
- 速率限制頁（<https://ai.google.dev/gemini-api/docs/rate-limits>，自標 2026-10-13 更新）：限制以專案為單位（非金鑰），分 RPM／TPM／RPD，RPD 於太平洋時間午夜重置；**各模型的實際數字不公開在該頁，要到 AI Studio 看，且「不保證」**。【已查證】
- 層級：Free；Tier 1＝連結有效 Cloud Billing 帳戶（月上限 250 美元、每 10 分鐘花費上限 10 美元）；Tier 2＝累計付費 100 美元＋首次付款後 3 天；Tier 3＝累計 1,000 美元＋30 天。【已查證】
- 舊版官方快照曾列 2.5 Flash-Lite 免費層 15 RPM／1,000 RPD；2026 年的第三方文章數字互相矛盾，3.5 Flash-Lite 的免費層 RPD **無法確認**。【二手】
- 對本功能的意義：免費層只適合你自己離線評測，不適合公開流量（除了數字不明，更因為 1.6 的資料條款）。

### 1.6 免費與付費的資料使用條款差異【已查證，摘要自官方頁】

來源：<https://ai.google.dev/gemini-api/terms>（Additional Terms，生效 2026-03-23，自標 2026-04-28 更新）。我是用工具讀取後摘要，**送出使用者照片前請你或法務自行讀原文**。

| 項目 | 免費層（Unpaid Services） | 付費層（Paid Services） |
|---|---|---|
| 用於改進 Google 產品與機器學習 | 是 | 否（提示、系統指示、快取內容、檔案、回應皆不用） |
| 人工審閱 | 可能；審閱前會與帳號、金鑰、專案脫鉤 | 條款該段未提及 |
| 保存期間 | 條款未給一般保存期間 | 為偵測違規與安全、法遵目的限期記錄提示與回應，頁面**未寫期限** |
| 個人／敏感資訊 | 明寫「不要送」 | 依資料處理附錄（DPA）處理 |
| 歐盟／英國／瑞士 | 若 API Client 對這些地區使用者開放，只能用付費服務 | 同左，且付費資料條款適用於該地區所有服務 |
| 18 歲 | 使用者須 18 歲以上；不得用於針對或可能被 18 歲以下者存取的 API Client（此段在兩種服務之前，似乎都適用） | 同左 |

付費層的「付費」定義：Gemini API 須透過有有效 Cloud Billing 的 Cloud 專案；AI Studio 可經 Billing 專案或 Workspace 企業帳戶。

### 1.7 地區限制【已查證，但範圍不確定】

- 可用地區頁（<https://ai.google.dev/gemini-api/docs/available-regions>，自標 2026-04-28 更新）列出 Gemini API 與 AI Studio 可用的國家／地區，**含台灣**；未說免費與付費有地區差異。
- 未確認的是：這份清單判斷的是「帳戶／帳單國家」還是「呼叫來源 IP」。CardScope 後端在 Render（HANDOFF 提及可能在美國），使用者在台灣，正常不會踩到，但要在 AI Studio 實際建專案時確認沒有地區錯誤。

### 1.8 AI Plus 是否含 API 額度【已查證：沒有任何記載】

見 0-1。補充：官方 billing 頁（<https://ai.google.dev/gemini-api/docs/billing>，自標 2026-09-28 更新）只說明預付（最低 5 美元、最高 5,000 美元；餘額為 0 時金鑰停用並回 HTTP 402）、自動儲值（可設每月上限）、層級月上限；**未提及任何 Google AI 訂閱含 API 用量**。論壇有 AI Pro 用戶回報月度 10 美元開發者點數在 Cloud Billing 顯示有效、但 AI Studio 顯示「No available credits」【二手】，連 Pro 都不一定好用，AI Plus 更不要預期有。

### 1.9 費用護欄（官方能提供的）

- **預付、不開自動儲值＝硬上限**：餘額歸零，請求回 HTTP 402（billing 頁）。這是最簡單可靠的預算上限。
- 專案層級花費上限在 AI Studio 的 Spend 頁，但標示為「實驗性」，且有約 10 分鐘的計費延遲（billing 頁）。不能當唯一防線。
- billing 頁沒提預算警示（budget alerts）；若用 Cloud Billing 後付，需另外在 Cloud Console 設定，這裡**無法確認**。

## 2. 替代方案比較

下表的「準確度預期」都是【推測】，我沒有找到針對本站資料的公開基準；欄位是為了排序方案，不是承諾。

| 方案 | 準確度預期（待試行驗證） | 費用 | 隱私 | 實作難度 | 與專案原則的相容性 |
|---|---|---|---|---|---|
| A. 瀏覽器端 Tesseract.js（導引框＋ROI＋白名單） | 理想拍攝（正對、光線足、無套）下卡號類 ASCII 欄位可能不錯；斜拍、反光、卡套、小字下明顯下降。日／中文卡名更差 | 0 | 最佳：照片不離開裝置 | 中（需做裁切、放大、二值化、字元白名單、重試） | 相容（免費、不用外部服務） |
| B. 雲端 Vision OCR（Cloud Vision Text／Document Text Detection） | 通用 OCR 通常優於 Tesseract，特別是日／繁中；但仍只回文字，要自行解析版面 | 1,000 次／月免費，之後每 1,000 次 1.50 美元【已查證】，**比 Gemini Flash-Lite 貴** | 官方稱線上請求不寫入磁碟、不用於訓練、僅暫存請求中繼資料【已查證】；仍是把照片送 Google | 低（單一 API＋我們寫解析） | 付費，需原則豁免 |
| C. Gemini（Flash-Lite 級，結構化 JSON 輸出） | 對傾斜／反光／卡套容忍度最好，能同時讀系列碼、卡號、卡名、語言，並回報信心；弱點是會「合理地編造」卡號，必須用資料庫驗證 | 每 1,000 次約 0.3–1.3 美元，視解析度與思考 | 照片送 Google；免費層不可用（1.6）；付費層不用於訓練、限期記錄 | 低到中（API 簡單；難在提示、驗證、防濫用、條款） | 付費，需原則豁免；未成年條款待確認 |
| D. 影像相似度（嵌入向量＋最近鄰） | 對「是哪張插圖」可行；對「哪個印刷版本」弱（同圖重印、日／台／美同圖、稀有度版本差異只在文字或浮水印）。公開專案多以美版卡圖做、無嚴謹基準 | 0（自建）；但需模型下載、向量儲存 | 可全在裝置端比對（模型約數十 MB，【推測】），或把向量送伺服器 | **高**（見 2.4） | **與 ADR 0007／0031 衝突**，需先決策 |
| E. 混合：A 先、失敗再 C | 預期整體最高，且多數情境不傳照片 | 只有走 C 的比例付費 | 預設不傳照片；使用者主動才傳 | 中高（兩條路徑＋驗證層） | 預設路徑相容；C 路徑需豁免 |

### 2.1 純 OCR（Tesseract.js）細節

- Tesseract.js 為 Apache-2.0，瀏覽器內以 WebAssembly 執行，v7 為最新主版（<https://github.com/naptha/tesseract.js>，查詢日 2026-10-15）；README 建議建立單一 worker 重複使用。
- 語言包大小（我用 HEAD 請求於 2026-10-15 讀到 `Content-Length`，未下載檔案）：tessdata_fast 的 `eng` 4.1 MB、`jpn` 2.5 MB、`chi_tra` 2.4 MB；tessdata_best 約 13–15 MB 一個。**系列代碼與卡號都是 ASCII，只載 `eng`＋字元白名單（`A-Za-z0-9/-`）就夠**；卡名若也要讀才需額外載 `jpn`／`chi_tra`。
- 預設語言資料從外部 CDN 載入，若要避免第三方請求，需自行託管語言包與 wasm 核心。核心 wasm 大小我沒有查到，列為未確認。
- 實作要點：導引框固定 ROI（寶可夢左下、遊戲王右側等，見第 3 節）、擷取後放大／灰階／對比、`psm` 單行或稀疏文字、O／0、I／1／l、S／5 在「數字位」做混淆修正、以「分母」（如 `039/064` 的 064）與資料庫系列總數交叉驗證。

### 2.2 雲端 OCR 與 Gemini 的成本比較

Cloud Vision 每 1,000 次 1.50 美元（月前 1,000 次免費），是 Gemini 3.1／3.5 Flash-Lite（不思考約 0.3–0.6 美元）的 2–5 倍，且 Gemini 一次呼叫就能回結構化結果。除非實測 Gemini 的卡號準確度明顯不夠，否則沒有選 Cloud Vision 的理由。Cloud Vision 的優點只有條款較單純（不訓練、線上請求不落地）。

### 2.3 Gemini 的失敗型態

- 看不清楚時**補出「看起來合理」的卡號**，而不是回報不確定。對策：永遠不信任模型輸出；只顯示「在資料庫存在」的候選；同時要模型輸出它讀到的卡名，與資料庫該卡號的名稱（`name_ja`／`name_zh`／`name_en`）比對，不一致就降為「請確認」。
- 無法分辨同號多版本（只看卡面文字時）、無法可靠判斷稀有度版本。
- 會有汰換與價格變動風險（1.1、1.3）。

### 2.4 影像相似度比對：需要什麼、為何不建議先做

公開參考：jslok/card-scanner（偵測＋透視校正＋感知雜湊，宣稱可辨識約 2 萬張英文卡、不用 OCR，<https://github.com/jslok/card-scanner>）、cardexx（以 Pokémon TCG API 約 1.9 萬張卡圖建嵌入庫，只有 t-SNE 質性檢查，<https://github.com/LMilazzo/cardexx>）。查不到嚴謹準確度基準【二手】；廠商（CardSight AI）宣稱雜湊／kNN 要求卡片平整、置中、光線均勻，屬行銷說法。

要做的話需要：
1. **下載卡圖**：寶可夢日／台是外連官方、`image_rights_status = 'not-provided'`（ADR 0031 明寫「外連不轉存，不下載」）；遊戲王圖已有 Supabase 快取（`providers/image-cache.mjs`，來源 YGOPRODeck）。要為約 8–10 萬個 printing 算向量，必須抓官方圖，與 ADR 0007／0031 的「只收文字事實／不下載」精神衝突，需先決策；向量雖不是圖片，是否構成衍生物我不下判斷。
2. 嵌入模型（例如 CLIP 類）與向量資料庫：Supabase 的 pgvector＋HNSW 索引可行（官方文件<https://supabase.com/docs/guides/database/extensions/pgvector>），但 512 維 float32 約 8 萬筆就是約 160 MB 以上，你的資料庫規格與容量上限我無法確認，且 HANDOFF 已記錄小型實例 CPU 吃緊。
3. 瀏覽器端跑 CLIP 需下載模型（Transformers.js v3 支援 WebGPU，但當時全球支援率約 70%，需 WASM 備援【二手】），手機流量與耗電都不理想。
4. 根本限制：同一張插圖在日／台／美版、不同系列重印、不同稀有度（普通 vs. SAR）幾乎一樣，向量找得到「這張圖」，找不到「這個印刷」。最後仍要靠 OCR 取系列代碼＋卡號。
5. 唯一合理的小用途：已被 OCR／Gemini 縮小到 2–4 個同號版本時，用來排序候選；但那要在使用者裝置抓官方圖算向量，而官方圖多半不允許跨網域讀像素（CORS），【推測】。結論：不列入最小試行。

### 2.5 混合方案的流程（建議）

```
拍照／選圖（瀏覽器，縮到長邊 ≤ 1024，重新編碼以移除 EXIF）
  ├─ 第一層：Tesseract.js 讀 ROI（系列碼＋卡號）→ 正規化 → 資料庫精確比對
  │     └─ 命中且唯一 → 直接開詳細頁（頂端有「不是這張？」）
  │     └─ 命中多個（同號多版本／日台並存）→ 候選縮圖讓使用者點選
  ├─ 第二層（使用者主動按「AI 協助辨識」，需先同意告知文字）
  │     → POST /api/photo-match → Gemini 結構化輸出 → 驗證層 → 候選
  └─ 第三層：都失敗 → 預填搜尋框（卡名／卡號），顯示「尚未取得可靠資料」
```

## 3. CardScope 的特殊情況

以下卡面位置來自一般卡牌知識與專案文件，**我沒有看實體卡，每個遊戲的 ROI 位置、字型、浮水印位置都要在試行中用實拍確認**【推測】。

### 3.1 資料規模與身分

依 `docs/HANDOFF.md` 與 `docs/PRODUCT_PLAN.md`：寶可夢日版約 1.8 萬以上 printing（持續增加）、台版約 1.36 萬、美版約 2.06 萬；遊戲王約 1.47 萬；航海王約 4.3 千；芙莉蓮約 750；排球少年約 530。卡片身分是「官方編號（系列代碼＋卡號）」，printing 以「卡片＋地區＋語言＋系列代碼＋卡號」為自然鍵（ADR 0035），資料庫有 `local_set_code`、`local_card_number`、`official_card_number`。

### 3.2 各遊戲該讀什麼

| 遊戲 | 要讀的欄位 | 資料庫比對鍵 | 注意 |
|---|---|---|---|
| 寶可夢（日／台） | 左下的系列標記＋卡號（形如 `039/064`，分母是系列印刷總數），稀有度記號在附近 | `local_set_code`＋`local_card_number`；分母可對照系列 `printedTotal` 交叉驗證 | 特典卡卡號形如 `001/SV-P`（斜線後是系列，HANDOFF 已記載）、基本能量官方無卡號（無法用卡號查）、V-UNION 分片編號、DP 世代無卡號（ADR 0026）；日版系列標記是否清楚可讀必須實拍確認 |
| 寶可夢（美） | 卡號＋分母，系列代碼縮寫位置與日版不同 | 同上 | 美版系列代碼格式（如 `PAL EN`）與資料庫的 `provider_id` 命名需對映，待確認 |
| 遊戲王 | 卡面的版別碼（如 `LOB-EN001`）；另有 8 位數密碼（passcode）在左下 | 版別碼對 printing 的 `local_set_code`／系列代碼；密碼對 `official_card_number`（YGOPRODeck 來源以 id 當 `official_card_number`，`catalog-sync.mjs` 可見） | 同版別碼不同稀有度是不同 printing，單張照片通常分不出稀有度；亞洲版／繁中版語言碼與資料庫覆蓋需另查（HANDOFF 記載遊戲王目前只有美版，14,655 張中文名極少） |
| 航海王 | 卡號（形如 `OP05-119`） | `official_card_number`，canonical 為 `onepiece-<卡號>` | 異圖卡（資料庫名稱帶「(異圖卡)」）與原圖同卡號；P- 推廣卡、台版與亞洲英文版同卡號 |
| 芙莉蓮（Weiß Schwarz） | 卡號（形如系列／編號 `…-001`） | `official_card_number` | 平行版本、SAMPLE 浮水印（PRODUCT_PLAN 要求保留）會干擾 OCR；卡號位置待確認 |
| 排球少年 Vobaca!! BREAK | 卡號（形如 `HV-P02-077`） | `official_card_number` | S／極／極P 同卡號多張卡，同作品層（HANDOFF 已記錄曾因此顯示錯圖） |

### 3.3 同號多版本與異圖卡（ADR 0035「版本 k」）

- 同系列、同卡號的多個官方頁面被拆成多張卡，ID 為 `<原卡 ID>`、`<原卡 ID>-v2`…，名稱用中性「版本 1／版本 2」，**官方文字資料並沒寫差異在哪，差異只在卡圖**（ADR 0035）。因此 OCR 讀到相同卡號時，系統本質上不可能靠文字決定是哪一版。
- 決策：候選超過一個時，**一律顯示候選縮圖（官方外連圖，ADR 0031）讓使用者點選**，不自動挑「版本 1」；詳細頁已有「收錄版本」切換卡圖。單一命中才直接導向。
- 日／台／美同系列同卡號：卡面語言能決定地區版本。ADR 0003／0012 之後日版與台版有的連結到同一作品層、有的不連結；導向目標卡的詳細頁會並列其他版本。語言／地區判斷可由 Gemini 一併輸出，或由 OCR 到的字元集推測；兩者不一致時顯示候選。
- 稀有度版本（普通 vs. SAR、Parallel）通常同卡號不同系列代碼或不同卡號，不在此問題內，但閃卡反光會干擾 OCR。

### 3.4 日文／繁中／英文卡面差異

- 系列代碼與卡號是 ASCII，各語言版一致，Tesseract `eng` 即可。
- 卡名是日文漢字假名／繁中／英文；Tesseract 需額外語言包且辨識較差；Gemini 讀卡名較穩，可作為卡號查詢結果的交叉驗證。
- 有些卡面把版權年份、插畫家名、規則文字放在卡號附近（寶可夢左下通常有插畫家字樣），ROI 要避開以免混入。

### 3.5 低光、反光、卡套

- 卡套（尤其硬套、雙層）會造成雙重邊框、反光與小幅偏移；閃卡本身就反光，常剛好蓋住左下的卡號。
- 對策（低成本）：導引框＋提示「平放、避開燈光反射」；用瀏覽器原生相機（`<input type="file" accept="image/*" capture="environment">`）取得高解析度並由系統處理對焦，比自己做 `getUserMedia` 預覽更穩（iOS 傳回 HEIC 時瀏覽器多半已轉 JPEG，但要實測；Gemini 本身接受 HEIC）；偵測 ROI 內過曝像素比例，過高就提示「換個角度」；允許連拍 2–3 張取一致結果。
- 這些都是試行中要量的項目，不是結論。

## 4. 建議的最小試行

### 4.1 範圍與原則

1. **離線評測先行，不上線、不收使用者照片**：寫一個離線腳本（建議路徑 `scripts/photo-card-eval/`，本次未建立）對測試集跑各方案，輸出 CSV。
2. 評測只用兩類圖：（a）公開的官方卡圖（網址取自資料庫，只當輸入、不另存）；（b）**你自己拍的卡片實拍**，拍之前確認背景、手、桌面沒有個資。**把官方卡圖或實拍送 Gemini 屬「把資料送外部 AI」，你需先同意**（見第 5 節）。離線評測用免費層可以，但同一條款說免費層可能用於改進產品、人工審閱，所以實拍裡不要有任何個資。
3. 功能旗標 `PHOTO_MATCH_ENABLED` 預設關閉；試行成功前不開放公開端點。

### 4.2 測試集

**A 組：官方卡圖 100 張（各系列分層取樣）**，用來測「理想條件」的上限與解析度設定。

| 遊戲 | 張數 | 取樣要求 |
|---|---|---|
| 寶可夢日版 | 25 | 至少 10 個系列，涵蓋 DPt／BW／XY／SM／SWSH／SV／MEGA 世代；含 SAR／UR 類閃卡、ACE SPEC、特典（`/SV-P`）、基本能量、同號多版本（`-v2` 以上）至少 5 張 |
| 寶可夢台版 | 15 | 含無標記（NONE）卡、特典 |
| 寶可夢美版 | 15 | 至少 8 個系列 |
| 遊戲王 | 20 | 不同年代版別碼、同卡多版別碼 |
| 航海王 | 12 | 含異圖卡 4 張、P- 推廣卡 |
| 芙莉蓮 | 5 | 含平行版本、SAMPLE |
| 排球少年 | 8 | 含 S／極／極P 同卡號 |

官方圖是乾淨數位圖，會高估準確度；可在離線腳本加合成擾動（透視、模糊、反光、亮度）擴成約 3 倍，但擾動只是輔助，**不能取代實拍**。

**B 組：使用者實拍至少 20 張，若試行繼續建議擴到 60 張**。條件分層：無套正拍、軟套、硬套、斜拍、暗光、閃卡反光各至少 3 張。標註檔為 CSV：`檔名, 正確卡片 ID, 備註(條件)`，由你手動填，作為唯一真值。誠實提醒：只有 20 張時，觀察到 85% 的 95% 信賴區間約 64–95%，只能做「有沒有明顯不行」的判斷，不能宣稱準確度；要宣稱需要至少 60–100 張。

### 4.3 比較的方案

1. Tesseract.js（ROI＋白名單）。
2. `gemini-3.1-flash-lite`、`gemini-3.5-flash-lite`、`gemini-3.8-flash` 各跑 `medium` 與 `high` 兩種解析度，思考設最低。
3. （選配）Cloud Vision Text Detection 作為「純 OCR 上限」對照，需要開 Cloud 專案，除非前兩者都不夠，否則跳過。
4. 混合策略的整體數字，用 1 與 2 的逐張結果離線模擬（不必另跑）。

### 4.4 指標與成功標準（提案，可由你調整）

量測：
- top-1 正確（直接命中正確卡 ID 或在同號多版本中候選含正確版）、top-3 正確。
- 「系列代碼＋卡號」欄位本身是否讀對（獨立於版本）。
- **高信心卻錯**的比例（比拒答更糟）；拒答（要求重拍）比例。
- 延遲 p50／p95、每次實際 token 與費用（取 `usageMetadata`）。
- 依條件分層的失敗清單（反光、卡套、暗光、閃卡、特定遊戲）。

成功標準：
- A 組（官方圖）：系列代碼＋卡號正確率 ≥ 95%。
- B 組（實拍）：混合策略 top-1 ≥ 80%、top-3 ≥ 90%；高信心卻錯 ≤ 2%；同號多版本候選必須 100% 含正確版（因由使用者點選）。
- 延遲：Gemini 路徑 p95 ≤ 6 秒；Tesseract 路徑 p95 ≤ 4 秒（中階手機，首次載入語言包除外）。
- 費用：Gemini 路徑實測 ≤ 1 美元／1,000 次。
- 達不到時的決策：若 Tesseract 路徑在 B 組 top-1 ≥ 70%，保留免費路徑、不開 Gemini；若兩者都低於 60%，這個功能暫緩，不硬上線。

### 4.5 隱私設計（若之後上線）

- **預設路徑（Tesseract）照片不離開裝置**，頁面明寫「辨識在你的手機上完成，照片不會上傳」。
- **AI 協助路徑要使用者主動按並二次確認**，告知文字草案：
  > 使用「AI 協助辨識」時，這張照片會傳送到 Google 的 Gemini API 進行文字辨識。CardScope 不會保存這張照片，也不會在日誌中記錄照片內容；Google 依其付費 API 條款處理資料，可能為偵測濫用而短期記錄請求內容。請避免拍到人臉、證件或其他個人資訊。
  （「付費條款」「短期記錄」措辭須依你最終採用的方案與條款原文校對。）
- 客戶端先縮圖（長邊 ≤ 1024）並重新編碼（canvas 輸出會去掉 EXIF，包括 GPS）。
- 伺服器端：不寫檔、不入資料庫、不記錄 base64 或圖片；只記錄「時間、遊戲、是否成功、耗費 token、雜湊後 IP」；回應 `Cache-Control: no-store`；請求大小上限（例如 1.5 MB）與 MIME 檢查；金鑰只在伺服器環境變數。
- PRODUCT_PLAN 沒有隱私條款，網站目前也沒有隱私說明頁（我只讀了文件，**未逐頁檢查網站**）；上傳功能上線前至少要有一頁隱私說明。涉及台灣個資法等法遵問題我不下判斷，請自行諮詢。
- 未成年問題：見第 5 節 D4。

### 4.6 預估成本上限與防濫用

- 硬上限：預付最低額度（5 美元）、**不開自動儲值**；餘額歸零即 HTTP 402，功能自動降級為第一層與手動搜尋。
- 單一請求上限：輸出 token 上限 256、思考設最低、圖片解析度明確指定（不要用預設）、提示詞固定。
- 每 IP：沿用 `server.mjs` 既有的 `hashIp`＋滑動視窗做法（現有回報功能是每小時 5 次、記憶體內），建議 AI 路徑每 IP 每小時 10 次、每日 30 次。
- 全站每日上限：例如每日 300 次，達到即停用 AI 路徑到隔日（Render 重啟會重置記憶體計數，所以仍需要預付硬上限當最後防線；或在資料庫放一個每日計數表）。
- 預算算例：每日 300 次 × 約 0.5 美元／1,000 次 ≈ 每日 0.15 美元、每月不到 5 美元；最壞情境（含思考）每日 300 次約 1.1 美元。
- 機器人防護（如 Turnstile）是額外外部服務，且屬 CAPTCHA 類，列為選項，非必要；PRODUCT_PLAN 禁止繞過他站驗證碼，但自己站放驗證碼不衝突。需你決定要不要。

## 5. 需要使用者決定的事項

D1 到 D7 都要你決定，我（與一般 worker）不會代為處理。

- **D1 是否允許付費服務（最關鍵）。** PRODUCT_PLAN 全站固定原則寫「不使用付費服務」。若要走 Gemini（C）或 Cloud Vision（B），需要你明確豁免或修訂這條原則，並訂下範圍（例如：只限拍照辨識功能、預算上限 X 美元）。若不豁免，則只做方案 A（純瀏覽器 Tesseract，免費），也可行但準確度較低。
- **D2 申請哪一種金鑰與帳戶。**
  - 離線評測：AI Studio 免費層金鑰即可（只送公開官方圖與你自己無個資的實拍）。
  - 公開上線：必須是付費層，即建立 Cloud 專案並連結 Cloud Billing（AI Studio 設定頁的 Set up billing；預付最低 5 美元，付款資料須你自己輸入，我不會代填）。**不要用 AI Plus 當作 API 額度來源，它不含。**
  - 不要把金鑰放進 repo；放在 Render 環境變數與本機 `.env.local`（已被 gitignore）。
- **D3 預算上限。** 建議：預付 5–10 美元、不開自動儲值、每日 300 次軟上限；每月上限請你給一個數字（例如 5 或 10 美元）。
- **D4 是否接受資料條款，尤其：（a）付費層仍限期記錄請求內容；（b）年齡條款（API Client 不得針對或可能被 18 歲以下者存取）。** 你要先確認自己能接受 (a)，並自行讀官方原文判斷 (b) 是否使 CardScope 無法使用 Gemini；若無法接受，則停在方案 A。
- **D5 是否同意把公開官方卡圖與你自己的實拍送 Gemini 做離線評測。** 官方卡圖有著作權風險（ADR 0031 已選擇外連而不轉存）；這次只是當輸入、不存、不再發布，但仍是把圖送到外部 AI，需要你明確說可以。
- **D6 是否接受「下載官方卡圖算向量」。** 與 ADR 0007／0031 衝突。建議不做，除非日後有授權依據；若要做，需新增 ADR。
- **D7 防機器人與告知方式。** 是否加入 Turnstile 類驗證；告知文字（4.5）是否採用；隱私說明頁由誰撰寫。

## 6. 無法確認的點

1. AI Plus 是否有任何 API 點數：官方頁完全沒提到 AI Plus，只能說「沒有記載」，無法證明為零。可請你到 Google Developer Program 的「My Benefits」頁自行查看。
2. 免費層與 Tier 1 的每分鐘／每日請求數：官方頁不公開，需到 AI Studio 的專案配額頁查；3.5 Flash-Lite 尤其沒有可靠數字。
3. 付費層的記錄保存期限：條款未寫天數。
4. 年齡條款原文與其對 TCG 網站的適用性（我只有摘要）。
5. 可用地區清單判斷的是帳戶、帳單還是呼叫來源；Render 服務所在區域。
6. 3.x 模型能否把思考完全關閉（影響成本下限）；實際 `usageMetadata`；圖片 token 在不同模型的實際值（兩個官方頁數字不一致）。
7. Tesseract.js wasm 核心大小、手機上實際速度與準確度；Cloud Vision 日文／繁中 OCR 對卡面小字的實際表現。
8. 各遊戲、各語言卡面實際的卡號位置與字型（本報告靠常識與專案文件，未看實體卡）。
9. Supabase 實例的向量擴充與容量上限（只有在 D6 允許影像比對才相關）。
10. 部分事實（2.5 系列限制日期、免費層限制歷史）來自二手來源，需對照官方 release notes。
11. 我讀取官方頁面的工具會先做摘要，個別數字（尤其價格與條款）在採用前，請你再點進原頁面核對一次。

## 7. 來源（皆於 2026-10-15 讀取）

官方（括號為頁面自標更新日期）：
- Gemini API 價格：<https://ai.google.dev/gemini-api/docs/pricing>（2026-10-14）
- 模型清單：<https://ai.google.dev/gemini-api/docs/models>（2026-10-13）
- 圖片理解：<https://ai.google.dev/gemini-api/docs/image-understanding>
- Media resolution：<https://ai.google.dev/gemini-api/docs/media-resolution>
- 思考：<https://ai.google.dev/gemini-api/docs/thinking>
- 結構化輸出：<https://ai.google.dev/gemini-api/docs/structured-output>
- 速率限制：<https://ai.google.dev/gemini-api/docs/rate-limits>（2026-10-13）
- 計費：<https://ai.google.dev/gemini-api/docs/billing>（2026-09-28）
- Google AI plans：<https://ai.google.dev/gemini-api/docs/google-ai-plans>（2026-10-13）
- Additional Terms：<https://ai.google.dev/gemini-api/terms>（2026-04-28）
- 可用地區：<https://ai.google.dev/gemini-api/docs/available-regions>（2026-04-28）
- Cloud Vision 價格：<https://cloud.google.com/vision/pricing>（無日期）
- Cloud Vision 資料使用：<https://docs.cloud.google.com/vision/docs/data-usage>（2026-10-13）
- Tesseract.js：<https://github.com/naptha/tesseract.js>；語言包大小：`tesseract-ocr/tessdata_fast`、`tessdata_best`（HEAD 請求讀 Content-Length）
- Supabase pgvector：<https://supabase.com/docs/guides/database/extensions/pgvector>

二手／參考（需自行複核）：
- 開源與廠商卡牌辨識：<https://github.com/jslok/card-scanner>、<https://github.com/LMilazzo/cardexx>、<https://github.com/rhizonymph/pokemon-card-scanner>
- Gemini 2.5 系列限制討論：<https://discuss.ai.google.dev/t/gemini-2-5-flash-deprecated-without-warning-earlier-than-shutdown-date/174217>
- AI Pro 點數問題論壇串：<https://discuss.ai.google.dev/t/ai-studio-api-key-issue-shows-no-available-credits-despite-having-10-developer-premium-300-free-credits/143122>
- Transformers.js v3 WebGPU：<https://www.huggingface.co/blog/transformersjs-v3>

專案內部依據：`docs/PRODUCT_PLAN.md`（全站固定原則、自主決策邊界、第 5 節視覺與無障礙）、`docs/HANDOFF.md`（資料規模）、`docs/adr/0007`、`0031`（圖片外連不下載）、`0035`（同號多版本）、`server.mjs`（`hashIp` 與回報功能的速率限制作法）、`providers/image-cache.mjs`。
