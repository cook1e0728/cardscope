# 會員收藏功能方案（只寫方案，不實作）

日期：2026-10-15
性質：決策依據。主方案 `docs/PRODUCT_PLAN.md` 第 6 節目前寫「暫不建立人氣排行、不用 Reddit 熱度推算卡片行情，也不加入使用者追蹤」，本文件讓使用者決定是否調整。
範圍聲明：本文件沒有建立任何帳號、沒有啟用任何服務、沒有改資料庫。只做了唯讀 SQL 查詢（結果見第 4.4 節）。個資法部分是整理，不是法律意見。

## 0. 摘要與建議

**建議：不要一次改成「會員制」，分三步走，每一步都可獨立停下。**

1. **v0（免登入，建議立刻做，零成本）**：前端其實已經有收藏、數量、下載 CSV（`ui-enhancements.js` 的 `cardscope-favorites`、`cardscope-watchlist`，只存瀏覽器）。補品況／版本欄位、清單頁、用 `price_snapshots` 算「參考總值」、JSON 備份匯入匯出即可。不蒐集個資，不需改主方案。
2. **v1（Google 登入＋雲端同步）**：只有在使用者決定改方向，**且**資料庫容量有對策之後才做。登入建議只開 Google（Email magic link 需要自訂 SMTP，而 Supabase 內建寄信只寄給團隊成員、每小時 2 封，見第 3 節）。
3. **v2（價格通知、CSV 匯入、公開分享頁）**：價格通知先做「站內變動提示」，不寄信；寄信要自有網域與寄信服務（Render 免費方案封鎖 SMTP 連接埠，只能走 HTTPS API）。

**為什麼不是「直接做 v1」：** 真正的瓶頸不是 Auth 額度（免費 50,000 MAU），而是資料庫 500 MB。目前已用 319 MB，每日參考價快照每月再吃 40–80 MB（ADR 0042）。超過 500 MB 資料庫變唯讀，連快照、回報、同步都會寫入失敗。收藏資料是使用者產生、無法從外部來源重建的資料，免費方案是否有備份本次無法確認（官方價格頁只列 Pro 含 7 天每日備份），所以雲端收藏會多出「資料遺失責任」。

**對主方案的建議修改（待使用者決定）：** 把「不加入使用者追蹤」明確寫成「不做使用者行為追蹤（人氣、瀏覽軌跡、廣告、分析）；收藏是使用者主動儲存的資料，v0 免登入，v1 起可選登入」。原文語意有歧義（可以讀成「不做使用者行為追蹤」，也可以讀成「不做使用者收藏／追蹤清單」），見第 7 節決定 1。

## 1. 競品參考

只用於理解需求與 UX，不複製其 Catalog、圖片或資料（主方案固定原則）。「✓」＝官方頁或商店頁明確寫到；「?」＝沒有找到明確說明；「—」＝沒有該功能的證據。

| 功能 | Collectr | TCGplayer Collection | PriceCharting Collection | Dex（Pedro Carrasco） | 卡拍拍 |
|---|---|---|---|---|---|
| 持有清單 | ✓ 可多個 portfolio，按遊戲分組 | ✓（beta，需登入） | ✓ 免費、數量不限 | ✓ 並顯示「還缺哪些」、集換進度 | ?（交易市集，無證據有收藏清單） |
| 數量 | ✓（加入時設定，依 variant） | ? | ✓ | ✓（folder 可記重複） | ? |
| 品況／鑑定 | ✓ 加入時選品況（使用者評論稱手動新增時品況選項不足，未證實現況） | ? | ✓ 記錄 grade、condition | ? | ? |
| 版本（variant／finish） | ✓ 辨識到 normal／foil／reverse | ✓（同卡多個 variant 條目，影響價格） | ? | ✓ 「Standard folder with variant tracking」 | ? |
| 購入價／損益 | ✓ 首頁提到 cost basis、損益；輸入方式未見 | ? | ✓（賣出時算利潤） | ? | ? |
| 願望清單 | ?（首頁未提） | ✓ 「Wants」 | ? | △ 版本說明提到公開檔案可看 wishlist，商店頁沒單獨列 | ? |
| 總值 | ✓ 即時市值＋走勢，美國市場為主（第三方比較文章說明價源為 TCGplayer、eBay） | ✓ 目前價格估值，算法未說明 | ✓ 隨價格自動更新、可看歷史 | ✓ 以選定市場估值 | ? |
| 價格通知 | △ 更新說明提到可設目標價（是否付費未確認） | ? | △ 付費版有「價格變動圖示」 | ? | ?（站內有「行情」，走勢需登入，性質未明） |
| 匯出 | ✓ **PRO 功能** | ? | ?（搜尋未見 CSV） | ✓ CSV，可自訂欄位 | ? |
| 分享頁 | ✓ 公開展示頁、創作者檔案 | ✓ Haves／Wants／Trades 分享 | ✓ 可分享給任何人 | ✓ 公開檔案／資料夾／單卡連結，**檢視不需帳號** | ? |
| 收費 | 免費＋PRO US$4.99／月（年繳）；US$7.99 月繳 | 免費 | 核心免費、進階 Premium | 免費＋Dex+（US$3.99–4.99／月、US$34.99／年） | 免費 |
| 語言／日版 | 列出 Pokémon 等 25+ 遊戲；日版／繁中支援未見 | 美國市場 | 美國市場 | 資料庫含英、日、簡中；介面有繁中 | 繁中、台灣 |

### 對「繁中玩家、跨語言版本」最有價值的功能（排序）

1. **同一作品、各語言版本一起管理**：「超夢 ex：日版 ×2、台版 ×1」。這是 CardScope 資料模型（作品層＋實體卡）的獨有優勢；上列競品都以美國市場為主，Dex 有日版資料但介面是單一清單。
2. **數量＋品況＋版本（finish）**：台灣玩家交易時最常被問「幾成新、是不是反閃」。
3. **願望清單（想要哪個版本）**：想收台版與想收日版是不同需求；最適合用「作品層」或「指定實體卡」兩種粒度。
4. **參考總值（誠實標示）**：競品多顯示單一「市值」；CardScope 的差異是標明來源、換算新台幣、哪些卡沒價格。覆蓋率會低於競品，這是優點也是風險（見 2.3）。
5. **匯出（CSV／JSON）**：Collectr 放在付費版；CardScope 免費提供就是差異點，也是個資法的資料可攜／備份需要。
6. **購入價（新台幣）與損益**：台灣玩家以新台幣購入，但我們的參考價是歐美市場價，兩者落差大，損益容易誤導。建議 schema 先留欄位，介面放 v2。
7. **公開分享頁**：社群價值高（交換、炫耀），但涉及隱私與內容管理，放 v2。
8. **價格通知**：價值中等；需要寄信或推播基礎設施，放 v2，先做站內提示。

不在範圍：相機掃描辨識（Collectr、Dex 的重點，但需要影像辨識與圖片資料，與「不複製圖片、授權保守」衝突）、交易撮合（卡拍拍的本業）。

## 2. 建議的 MVP 範圍

### 2.1 與既有資料的關係（先講限制）

- **身分層級**：`tcg_cards.id` 是「實體卡」，同一作品的日版、台版、美版是不同的 id，以 `canonical_id` 相連；同號多版本（ADR 0035、0039 的 `-v<k>`）也是不同的 id。持有清單以 `tcg_cards.id` 為鍵，介面再依 `canonical_id` 聚合顯示。
- **注意既有前端 ID 可能不一致**：`/api/cards` 的瀏覽結果回傳實體卡 id，但搜尋與詳細頁經 `canonicalizeCatalog` 後 `id` 變成作品層 ID（`physicalCardIds` 另存）。現有 localStorage 收藏用 `card.id`，所以可能混有兩種 ID。這點尚未實測（見「無法確認」），v0 改版時要一併把新資料寫成「實體卡 id＋canonical_id」，v1 匯入才不會猜。
- **價格只有部分卡有**：參考價只涵蓋 `tcgdex-ja` 日版、ADR 0037 核准清單的官方日版、ADR 0038 的美版（約 31,269 張候選）；台版、韓版、其他 IP 多半沒有。`price_snapshots` 又只存 ≥0.5 EUR／USD 的卡，且每日一輪要約 8.7 小時才掃完（目前資料表只有 1,154 列，剛啟動）。所以「參考總值」一定會有「未計入」的卡，介面必須顯示「N／M 張有參考價」。
- **價格性質**：永遠標「平台參考價（Cardmarket 或 TCGplayer，換算新台幣）」，不是可售價、不是台灣行情、不是買取價（主方案原則、ADR 0036、0042）。Cardmarket `trend` 與 TCGplayer `marketPrice` 來源不同、幣別不同，**不要加成單一數字**；預設分來源顯示小計（見第 7 節決定 9）。
- **品況不調價**：我們沒有各品況的價格資料，不套任何折扣係數；品況只是紀錄。鑑定卡（slab）不計入參考總值（參考價是裸卡）。Cardmarket trend 對應哪種品況，ADR 0036 說 Cardmarket 未公開 avg 的組成，本次也無法確認 trend 的品況基準，不做斷言。

### 2.2 分階段範圍

| 階段 | 範圍 | 與既有資料的關係 |
|---|---|---|
| **v0 免登入** | 沿用並補強現有 localStorage：收藏／願望清單、數量；新增品況、版本（finish）、備註；專屬「我的收藏」清單頁；參考總值（新增批次查價端點，見 2.3）；JSON 備份匯出與匯入；CSV 匯出沿用。 | 用實體卡 id＋canonical_id。價格無資料的卡顯示「尚未取得可靠資料」。不蒐集個資，不需隱私政策變更（仍建議在頁面講清楚「只存在這台裝置」）。 |
| **v1 登入＋雲端** | Google 登入（Supabase Auth）；收藏／願望清單（實體卡 id＋finish＋品況＋數量＋購入價欄位留空）；清單頁；參考總值；v0 資料一次性匯入；匯出我的資料；刪除帳號；隱私政策與同意畫面；資料庫容量保護（使用者上限、每人列數上限）。 | 與 v0 同一套 UI，只是儲存來源從 localStorage 換成伺服器 API。 |
| **v2** | 站內價格變動提示（先不寄信）→ 之後才評估 Email 通知；CSV 匯入（自家格式優先，他家格式需要樣本檔）；公開分享頁（選擇加入、不顯示 Email、預設 noindex）；購入價與損益顯示；多清單／資料夾（`user_collections`）；作品層願望（「任何版本都可以」）。 | 價格通知依賴 `price_snapshots` 的變動；CSV 匯入要把「系列代碼＋編號＋地區」對回 `tcg_cards.id`，有歧義時要給使用者選，不猜（沿用 `/api/card-identities` 的對應規則）。 |

### 2.3 v0／v1 共用：批次參考價端點（建議做法）

`POST /api/prices/reference`，body 最多 100 個 `cardId`，回傳每張卡每個 `provider＋variant` 的最新參考價、原幣、幣別、換算新台幣、快照日期。資料來源是 `price_snapshots` 每組最新一列（不即時打 TCGdex，避免一百個外部請求）。由於快照的寫入規則是「變動 ≥2% 或滿 7 天」，最新一列與當下值的差距在設計上不超過約 2%（加上輪詢延遲），可作為參考價；快照日期要顯示。低於門檻或尚未掃到的卡回「無快照」，由前端歸入「未計入」。匯率沿用 `getTwdRates()`。**這個端點不需要登入，v0 與 v1 共用**，也不改既有端點相容性（只新增）。

## 3. 登入方式比較

### 3.1 官方限制（已查，網址在文末）

- **Supabase Free 方案**：Auth 50,000 MAU；資料庫 500 MB／專案；egress 5 GB；兩個專案；「Free projects are paused after 1 week of inactivity」；社群 OAuth 含在內；自訂 SMTP 含在內。超過 MAU 額度：免費方案沒有超額單價，會收到通知並進入寬限期（細節見其 Fair Use Policy，未展開）。MAU 定義為該計費週期內登入或刷新 token 的不重複使用者，含社群登入。
- **內建寄信**：只有專案組織團隊成員的地址收得到（其他會失敗），每小時 2 封，無 SLA，官方定位是「探索、測試、示範」。**所以 Email magic link 對公開使用者等於不能用，必須先接自訂 SMTP。**設定自訂 SMTP 後起始上限每小時 30 封，可在 Rate Limits 頁調高。
- **Auth 速率限制（預設）**：登入／註冊／magic link 等每 IP 每 5 分鐘 30 次；OTP／magic link 同一使用者 60 秒 1 次；token 端點每 IP 每 5 分鐘 150 次。magic link 與 OTP 預設 1 小時過期。
- **自訂 SMTP 的實際門檻**：官方列出 Resend、AWS SES、Postmark、SendGrid、ZeptoMail、Brevo。Resend 免費方案 3,000 封／月、100 封／日、3 個網域，但**必須先新增並驗證至少一個自有網域**（文件原文）。CardScope 現在是 `cardscope.onrender.com`，沒有自己的網域，所以 Resend 路線的前置成本是「買網域」（價格本次未查）。Brevo 免費額度本次沒抓到頁面內容，無法確認。
- **Google OAuth**：要在 Google Cloud 建 Web application 類型 OAuth client，把 Supabase 的 callback URL 填進 Authorized redirect URI；只用 `openid`、`email`、`profile` 不需要額外 scope 審核。官方建議設定品牌（Branding）與自訂網域，否則同意畫面顯示 `<project-id>.supabase.co`，看起來較不可信。品牌驗證「可能要幾個工作天」。
- **Render 免費方案**：15 分鐘無流量休眠、冷啟動約 1 分鐘；每月 750 小時；本機檔案不持久；**出站 25／465／587（SMTP）被封鎖**；Render 可能隨時重啟服務。
- **CAPTCHA**：Supabase 支援 hCaptcha 與 Cloudflare Turnstile；文件明確寫到註冊、登入、重設密碼，是否涵蓋 `signInWithOtp` 與匿名登入本次無法確認。
- **匿名登入**：`signInAnonymously()` 建立無 Email 的使用者，可之後用 `updateUser`（Email）或 `linkIdentity`（OAuth）綁定，但需要啟用手動 identity linking；官方警告有人會呼叫端點灌爆資料庫，強烈建議 CAPTCHA；沒有自動清理；每 IP 每小時 30 次。匿名使用者是否計入 MAU 本次無法確認。

### 3.2 方案比較

| 方式 | 額外費用／前置 | 使用者體驗 | 主要風險 | 建議 |
|---|---|---|---|---|
| **v0 免登入（localStorage）** | 無 | 立即可用；換裝置、清瀏覽資料就沒了 | 資料遺失（用 JSON 備份降低） | **立即做** |
| **Google OAuth（Supabase）** | Google Cloud 專案（免費）、Supabase 後台設定、Render 加環境變數；建議有自有網域讓同意畫面可信 | 一鍵；台灣使用者多半有 Google 帳號 | 同意畫面網域；Google 品牌驗證（onrender.com 子網域是否可通過未確認） | **v1 唯一建議的登入方式** |
| **Email magic link** | 必須自訂 SMTP；Resend 需要自有網域；其他服務額度未確認 | 要等信、可能進垃圾信匣；信件連結可能被收件端掃描器預先消耗（本次未查證） | 寄信額度與信譽、垃圾帳號註冊、需要 CAPTCHA | v1 不做；真有需求再開 |
| **Supabase 匿名登入＋之後綁定** | 啟用 manual linking；需 CAPTCHA | 無摩擦、可跨日綁定 | 灌帳號、資料庫成長無自動清理、MAU 計算不明 | 不建議；與「匿名同步碼」同類 |
| **匿名同步碼（自製，v0.5 選項）** | 無外部服務；要寫程式與限流 | 產生一組密語，貼到另一台裝置即同步 | 密語遺失無法找回；密語就是 bearer token；垃圾寫入要自己防；是否仍屬個資需法務判斷 | 若使用者不想蒐集 Email／Google 識別，才考慮 |
| LINE Login 等 | 未研究 | 台灣普及度高 | Supabase 資料表顯示有 custom OAuth provider 結構，但本次沒有查證其可用範圍與費用 | v2 以後再評估 |

### 3.3 v0 → v1 遷移路徑

1. 使用者首次登入後，前端偵測 `cardscope-favorites`、`cardscope-watchlist`、`cardscope-watchlist-meta`，顯示「要把這台裝置的收藏加入帳號嗎？（N 張）」。
2. 呼叫 `POST /api/me/collection/import`（一次最多 500 筆、可分批、冪等）。合併規則用 `max(伺服器數量, 本機數量)`，重複匯入不會加倍；本機沒有品況／finish 的項目以空字串寫入。
3. ID 解析：已是實體卡 id 的直接用；是作品層 ID（`canonical_id`）的，若該作品只有一張實體卡就用它，有多張（日／台／美版）就**不猜**，回傳「需要選擇版本」清單，由使用者選，或改存為願望（作品層）。
4. 匯入成功後本機資料保留（不自動清空），在設定頁提供「清除本機收藏」按鈕；登出時詢問是否保留本機副本（共用電腦情境）。
5. 反向：任何時候都可「匯出我的資料（JSON）」，所以使用者可以離開。

## 4. 資料設計草案

### 4.1 與「前端不直連 Supabase」的配合

目前所有資料庫存取都由 `server.mjs` 以 `SUPABASE_SERVICE_KEY` 完成；前端沒有 Supabase 金鑰。引進登入後有兩條路：

- **路線 A+（建議）：瀏覽器只對 Supabase Auth 登入，資料一律走我們的 Node API，伺服器把使用者的 JWT 轉給 PostgREST，讓 RLS 真正生效。**
  - 前端：登入畫面載入 `supabase-js`（鎖定版本、只在使用者按「登入」時載入；專案目前 `package.json` 無任何相依套件，伺服器端維持零相依），取得 access token，呼叫 `/api/me/*` 時帶 `Authorization: Bearer <token>`。
  - 伺服器：新增一個小函式（類似現有 `supabaseFetch`，但 `apikey` 用 publishable key、`Authorization` 用使用者的 token）。PostgREST 自己驗證 JWT 與套用 RLS，使用者資料表**完全不用 service role 讀寫**，即使伺服器程式有漏洞也不會跨使用者。需要驗證身分做限流時，可用 JWKS 本地驗簽（`node:crypto` 可處理，不必加套件），或對 `auth/v1/user` 做一次遠端驗證（較慢）。
  - 需要的新設定：Render 環境變數 `SUPABASE_PUBLISHABLE_KEY`（可公開，但必須由使用者設定）；Supabase 後台啟用 Google、設定 Site URL 與 Redirect allow list。
  - 優點：維持「資料入口只有我們的 API」、可在伺服器做欄位驗證、列數上限、限流、批次查價與參考總值計算；缺點：收藏操作依賴 Render 存活（見 6.3）。
- **路線 B：前端直連 Supabase＋RLS。** 反應較快、不受 Render 冷啟動影響，但違反目前架構原則，並且必須公開 publishable key、引入 supabase-js 到所有頁面、欄位驗證與上限只能靠資料庫約束與觸發器。不建議。

**目前的安全底子（唯讀查詢，2026-10-15）**：`public` 底下 19 張表全部啟用 RLS，且**沒有任何 policy**，因此即使 `anon`／`authenticated` 對 12 張目錄表有 SELECT 與 INSERT 的表級授權，實際上全部被擋。引進 Auth 後建議同一支 migration 順手 `revoke insert, update, delete` 於這些目錄表的 `anon`、`authenticated`（縱深防禦，不改現有伺服器行為，因為伺服器用 service role）。`public.tcg_search_fold` 函式對 `anon`／`authenticated` 可執行，內容為純轉換，風險低，但引進前應再檢視一次。

### 4.2 資料表（草案，不是已套用的 migration）

```sql
-- v1：單一擁有清單＋願望清單，用 list_type 區分，不先建多清單表
create table public.user_collection_items (
  user_id    uuid not null references auth.users(id) on delete cascade,
  list_type  text not null check (list_type in ('owned','wish')),
  card_id    text not null references public.tcg_cards(id) on delete restrict on update cascade,
  finish     text not null default '',   -- 沿用 price_snapshots.variant 詞彙（TCGdex variant／finish），空字串＝未指定
  condition  text not null default '' check (condition in ('','NM','LP','MP','HP','DMG')),
  quantity   integer not null default 1 check (quantity between 1 and 999),
  purchase_price_twd integer check (purchase_price_twd between 0 and 100000000), -- v1 不顯示，v2 才用
  grade_label text check (char_length(grade_label) <= 20),                        -- 例如 'PSA 10'；僅紀錄，不估價
  note       text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, list_type, card_id, finish, condition)
);
-- 不建 card_id 索引；只有需要「這張卡有多少人收藏」時才加，v1 不需要

create table public.user_profiles (          -- 同意紀錄與刪除流程
  user_id uuid primary key references auth.users(id) on delete cascade,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- RLS：每個操作一條 policy，用 (select auth.uid()) 讓 Postgres 每條語句只算一次
alter table public.user_collection_items enable row level security;
revoke all on public.user_collection_items from anon, authenticated;
grant select, insert, update, delete on public.user_collection_items to authenticated;
grant all on public.user_collection_items to service_role;

create policy items_select on public.user_collection_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy items_insert on public.user_collection_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy items_update on public.user_collection_items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy items_delete on public.user_collection_items for delete to authenticated
  using ((select auth.uid()) = user_id);
-- user_profiles 同樣四條（或 select／insert／update 三條）
-- 另加觸發器：每位使用者最多 3,000 列（後盾；伺服器 API 也會檢查）
```

設計理由：

- **主鍵就是索引**：`(user_id, list_type, card_id, finish, condition)` 同時防重複並支援「列出我的清單」，不需要額外索引。
- **FK 用 `restrict`，不用 `cascade`**：目錄資料會被 migration 重切（例如 ADR 0035、0039 的版本拆分），若像 `price_snapshots` 那樣 `on delete cascade`，使用者的收藏會被資料整理悄悄刪掉。`restrict` 會讓有人收藏的卡片無法被刪除、migration 直接失敗，逼資料整理時先處理（見 6.3 風險 5）。
- **`finish` 沿用 `price_snapshots.variant`**：這樣參考價可以對上使用者選的版本；未指定 finish 且該卡有多個 variant 價格時，參考總值不計入並提示「請選擇版本」，不自行挑一個。
- **v2 新增**（現在不建）：`user_collections`（id, user_id, name, kind，供多清單／資料夾）、`user_collection_shares`（slug, user_id, list_type, show_prices, created_at）、`user_price_alerts`（id, user_id, card_id, finish, provider, direction, threshold_twd, last_notified_at）。
- **帳號刪除**：伺服器先呼叫 `auth.admin.deleteUser()`（預設硬刪除並使 refresh token 失效），`on delete cascade` 帶走 `user_collection_items`、`user_profiles`。官方提醒：刪除不會讓既有 access token 立即失效，要等 `exp`；因為 FK 指向 `auth.users`，已刪除帳號不能再寫入新列，風險可接受，另可縮短 token 有效期。

### 4.3 新增 API（v1，皆需登入，皆為新增，不影響既有端點）

`GET /api/me/collection?list=owned|wish&cursor=`、`PUT /api/me/collection/items`、`DELETE /api/me/collection/items`、`POST /api/me/collection/import`、`GET /api/me/collection/summary`（參考總值、分來源小計、覆蓋率）、`GET /api/me/export`（JSON／CSV）、`DELETE /api/me`（刪除帳號）、`GET /api/auth/config`（回傳 Supabase URL 與 publishable key、已啟用的登入方式，讓前端不寫死）。現有 `/api/portfolio` 目前回 `not_implemented`，v1 時改為導向或移除，需在 ADR 說明。

### 4.4 容量估算

**實測（唯讀，2026-10-15）**：資料庫 319 MB；`auth.users` 0 列，整個 `auth` schema 空殼約 1.15 MB；`tcg_cards` 75,662 列、94 MB，`id` 平均長度 26.2 字元；`price_snapshots` 1,154 列、288 kB（剛開始跑）。

**每列大小估算**：heap 約 108 B（24 B tuple 標頭＋uuid 16＋card_id 約 27＋其餘欄位與對齊＋4 B 行指標）、主鍵索引約 70–80 B，合計約 180 B；加上更新留下的死元組與膨脹，規劃用 **250 B／列**。
**每位使用者 Auth 開銷**：`auth.users`＋identities＋sessions＋refresh tokens 預計約 5 KB（**估計值**，上線前用 10 個測試帳號實測；目前 0 使用者，無法推算）。

| 使用者型態 | 清單列數 | 每人佔用 |
|---|---|---|
| 輕度 | 30 | 約 12.5 KB |
| 一般 | 150 | 約 42.5 KB |
| 重度 | 1,000 | 約 255 KB |
| 上限（建議 3,000 列） | 3,000 | 約 755 KB |

假設使用者分布為輕度 70%、一般 25%、重度 5%，加權平均約 32 KB／人。

| 預留給收藏的空間 | 可撐使用者數（加權平均） | 全為一般使用者 |
|---|---|---|
| 10 MB | 約 320 | 約 240 |
| 50 MB | 約 1,600 | 約 1,200 |
| 100 MB | 約 3,200 | 約 2,400 |

**結論**：MAU 50,000 不會是瓶頸，資料庫才是。目前剩餘 181 MB，而快照每月就吃 40–80 MB，也就是**一個月快照等於約 1,200–2,500 位使用者的收藏量**。因此 v1 必須搭配：(a) 使用者總數上限（伺服器端環境變數，例如先 500 人，達到後新帳號只能用 v0）；(b) 每人列數上限；(c) 容量停止線與快照修剪策略（ADR 0042 已有 450 MB 停止線，需決定先停快照還是先停註冊）；(d) 每週查 `pg_total_relation_size`。若要放寬，選項是縮小快照範圍或升級 Pro（官方價格頁：US$25／月起、8 GB 磁碟、含 7 天每日備份；先前使用者已決定不升級，見 `docs/HANDOFF.md`）。

## 5. 隱私與法規（台灣個資法整理，非法律意見）

依全國法規資料庫頁面（最新修正顯示為民國 114 年 11 月 11 日；頁面同時註明部分條文施行日未定，現行效力請以官方現行條文為準）。

**什麼算個資**：Email、Google 帳號識別碼、顯示名稱，以及「綁在帳號上的收藏清單」（可識別特定人的財物與興趣資訊）。v0 資料只在使用者自己的瀏覽器、伺服器不蒐集，通常不涉及蒐集；v1 起 CardScope 成為蒐集者。

**要點**

- **第 8 條 蒐集時告知**：蒐集當下就要明確告知：機關（營運者）名稱、蒐集目的、個資類別、利用的期間／地區／對象／方式、當事人權利與行使方式、不提供的影響。告知方式不限書面；可以在登入前的同意畫面加連結到隱私政策。
- **第 19 條 合法依據**：需有特定目的且符合法定情形之一（例如當事人同意，或契約關係且採取安全措施）。建議以「使用者主動註冊、勾選同意」為依據，並記錄同意版本與時間（`user_profiles.consent_version`）。
- **第 3 條 當事人權利**：查詢閱覽、複製、補充更正、停止蒐集處理利用、刪除，**不得預先拋棄或以特約限制**。所以 v1 的「匯出我的資料」與「刪除帳號」是必備功能，不是加分項。
- **第 11 條**：請求刪除或停止利用，或目的消失時，應刪除；違法蒐集應主動刪除。
- **第 12 條 外洩通知**：個資遭竊取、洩漏等應通知當事人，符合通報範圍者另需向主管機關通報，要保留應變紀錄。
- **第 20 條**：利用限於蒐集目的必要範圍；若寄行銷信，當事人拒絕後須停止、首次行銷要附拒絕方式。**服務通知（登入信、價格變動通知）與行銷信分開**，v2 的通知預設只在使用者主動設定提醒時寄出。
- **第 48 條 罰則**：非公務機關違反第 8、11、12 條第 1 項、第 20 條等，限期改正，屆期未改正按次處新臺幣 2 萬至 20 萬元罰鍰；情節重大另有更高級距。
- **跨境與處理者**：Supabase 專案在 `ap-northeast-1`（東京）；Render 服務區域 HANDOFF 記為「使用者尚未在後台確認」；Google 負責登入。隱私政策要如實列出這些處理者與資料所在地區。
- **未成年人**：TCG 玩家有不少未成年人。是否需要法定代理人同意、服務條款是否限制年齡，需由政策撰寫者判斷（本文件無法確認）。

**隱私權政策應包含**：營運者與聯絡方式（需要一個信箱接收權利請求）；蒐集項目（登入識別、Email、收藏清單、同意紀錄；是否記 IP；目前限流只存 IP 雜湊）；蒐集目的（提供雲端收藏、同步）；利用期間（帳號存續期間；刪除後多久清除備份）；利用地區與對象（Supabase、Render、Google，及其所在地）；是否使用 cookie／localStorage（supabase-js 會把登入工作階段存在 localStorage，必須揭露）；當事人權利與行使方式（頁內按鈕＋信箱）；不提供資料的影響（只能用免登入的本機收藏）；外洩通知流程；政策版本與修改紀錄；價格資料免責聲明（參考價、非可售價、非台灣行情）。

**資料匯出／刪除功能規格**：匯出＝登入後一鍵下載 JSON（完整）與 CSV（可讀）；刪除＝設定頁「刪除帳號與所有收藏」，二次確認、立即硬刪除（Auth 使用者＋cascade），完成後顯示確認；備份中的殘留保存期限要在政策中寫明（免費方案備份情況本次無法確認，需使用者核對後據實撰寫）。另建議無活動超過 12 個月的帳號先寄通知再清除，需寫入政策。

## 6. 工作量估計與風險

### 6.1 各階段工作量（以 Opus 規劃＋Sonnet worker 並行估計，工作日為粗估）

**v0（約 1–2 工作日，無 migration、無新服務）**

- 前端：`ui-enhancements.js`（第 4–7、81–200 行的收藏／清單邏輯；檔案已很大，建議新清單頁拆成新檔 `collection-view.js`）、`index.html`（新檔案載入、「我的收藏」入口）、`price-history-chart.js` 不動。
- 後端：`server.mjs` 新增 `POST /api/prices/reference`，純計算邏輯放新檔 `providers/collection-valuation.mjs`（便於測試）。
- 測試：新增 `test/collection-valuation.test.mjs`（分來源小計、無快照、鑑定卡不計、多 variant 未選 finish、匯率退回預設值標示）；`scripts/beta-browser-smoke.mjs` 補收藏流程（手機與桌面、鍵盤、無障礙）。
- 補強項目：既有清單的「已驗證總價」目前依賴遊々亭買取價，而遊々亭已婉拒引用（HANDOFF 依序執行 77），那段總價實際上多半是空的，改用參考價。

**v1（約 5–8 工作日，另加使用者要做的設定）**

- 使用者必須做（worker 不可代辦）：Supabase 後台啟用 Google provider、設定 Site URL 與 Redirect URL；Google Cloud 建立 OAuth client；Render 加 `SUPABASE_PUBLISHABLE_KEY`；決定隱私政策與服務條款內容。
- migration：新增 `user_collection_items`、`user_profiles`、觸發器、RLS policy、對目錄表 revoke 寫入授權（僅新增式，符合主方案 migration 規則）。
- 後端：`server.mjs`（新路由；`supabaseFetch` 旁新增帶使用者 token 的版本）、新檔 `providers/user-collection.mjs`（驗證、上限、匯入合併、匯出、刪除帳號）、限流擴充（既有 `isRateLimited` 是以 IP 雜湊為鍵，要加以使用者為鍵）。
- 前端：新檔 `auth-client.js`（登入／登出／token 提供）、`collection-view.js`（接 API，離線快取與樂觀更新）、`index.html`、新靜態頁 `privacy.html`、`terms.html`（內容由使用者決定撰寫者）。
- 測試：單元測試（驗證、上限、冪等匯入、ID 歧義不猜）；本機 PostgreSQL 16 SQL 情境測試（沿用專案既有做法）：使用者 A 讀不到／寫不到 B 的列、RLS 對 anon 全拒、cascade 刪除、`restrict` 擋住卡片刪除、列數上限觸發器；Playwright 用注入假 session 驗 UI；真實 Google 登入由使用者手動驗收一次。
- 文件：ADR（改主方案方向、登入方式、個資處理、容量策略）、更新 `docs/PRODUCT_PLAN.md` 第 6 節與「公開介面相容性」、`docs/HANDOFF.md`。

**v2（約 6–12 工作日，視項目取捨）**

- 站內價格變動提示（約 1–2 日）：登入時用 `price_snapshots` 比較「上次登入時」與現在，沿用快照的 2% 與 7 天規則，不新增寄信。
- Email 通知（約 3–5 日，且需自有網域與寄信服務）：Render 免費方案封鎖 SMTP，必須用 HTTPS 寄信 API；要新增 `user_price_alerts` 與在快照輪次後評估；退訂連結與行銷／服務通知分離。
- CSV 匯入（約 2–4 日）：自家格式簡單；他家格式要樣本檔，且對卡的歧義處理介面佔大部分工時。
- 公開分享頁（約 3–5 日）：選擇加入、隨機 slug、預設 `noindex` 並排除在 sitemap、可關閉、可檢舉／下架、不顯示 Email、可隱藏購入價與總值；公開路由要限流與快取。
- 每項都需再補 migration、測試與隱私政策更新。

### 6.2 新增 API 與檔案一覽

| 階段 | 新增 API | 主要檔案 |
|---|---|---|
| v0 | `POST /api/prices/reference` | `server.mjs`、`providers/collection-valuation.mjs`、`ui-enhancements.js`、`collection-view.js`、`index.html`、測試 |
| v1 | `/api/me/*`（collection、items、import、summary、export、刪帳號）、`/api/auth/config` | 上列加 `providers/user-collection.mjs`、`auth-client.js`、`privacy.html`、`terms.html`、1 支 migration |
| v2 | `/api/me/alerts`、`/api/me/import/csv`、`/api/me/shares`、公開 `/c/:slug` | 再加 migration、寄信模組（若做）、sitemap／robots 調整 |

### 6.3 風險

1. **資料庫容量與唯讀模式**：Free 方案超過 500 MB 即唯讀，插入失敗；新帳號登入也要寫 `auth.sessions`，所以會連登入一起壞。對策：使用者上限、列數上限、450 MB 停止線、每週查大小、快照修剪或升級決策（第 4.4 節）。
2. **備份與資料遺失**：收藏無法從外部來源重建。Free 備份情況無法確認。對策：匯出功能、定期把 `user_collection_items` 匯出到本機（管理端點）、在服務條款說明。
3. **Render 免費方案冷啟動與重啟**：休眠後約 1 分鐘冷啟動；目前靠 UptimeRobot 保溫（`/api/catalog/health` HEAD，不查資料庫），部署與 Render 隨時重啟仍會中斷。登入本身（PKCE 授權碼）是瀏覽器與 Supabase 之間交換，不依賴我們的伺服器；但頁面載入與所有 `/api/me/*` 依賴它。對策：收藏路由不依賴目錄暖機快取；前端先顯示本機快取副本、背景同步（stale-while-revalidate）、寫入失敗時排隊重試並顯示「尚未同步」；登入流程加載入狀態而非空白。
4. **垃圾帳號與濫用**：只開 Google 登入可大幅降低；若開 magic link 一定要 CAPTCHA 與自訂 SMTP 額度保護。對策：使用者總數上限、每人列數上限、以使用者與 IP 雙重限流、匿名登入不開。
5. **卡片 ID 變動讓收藏失效**：HANDOFF 顯示目錄 migration 會拆分或合併版本（例如 `pokemon_jp_official_variant_split`、`pokemon_jp_archive_variant_split`）。FK 用 `restrict`；每次這類 migration 的檢查表加一項「搬移或標記受影響的 `user_collection_items`」；被拆分的卡搬到第一個版本並在清單標「版本待確認」，不猜使用者持有哪一版。
6. **跨使用者資料外洩**：路線 A+ 讓 RLS 在伺服器路徑上仍生效；測試必須包含兩個使用者互相存取。
7. **「參考總值」被誤解為估價或損益**：每個總值旁固定標示來源、換算匯率日期、覆蓋率與「不是可售價、不是台灣行情」；不顯示「賺／賠」字樣，v2 才有購入價比較且用中性措辭（「購入價與參考價差」）。
8. **維運與法遵負擔**：一人專案要接 Email 權利請求、處理刪除、更新政策；若未準備好就不要開 v1。
9. **Google 同意畫面可信度**：預設顯示 `*.supabase.co`；自訂網域是否收費本次未確認。
10. **工作階段存在 localStorage**：XSS 會洩漏 token；既有前端大量字串組 HTML，v1 前應檢視輸出跳脫（`e()` 等）並考慮 CSP。

## 7. 需要使用者決定的事

| # | 決定 | 我的建議（預設） |
|---|---|---|
| 1 | **是否改主方案方向**。原文「也不加入使用者追蹤」是指行為追蹤，還是不做使用者收藏／追蹤清單？ | 解讀為行為追蹤；改寫成「不做使用者行為追蹤；收藏是使用者主動儲存的資料，v0 免登入，v1 起可選登入」，並寫 ADR。 |
| 2 | 是否先做 v0（免登入強化）？ | 是，立即可做，不花錢、不需新來源。 |
| 3 | v1 要不要做？前提是資料庫容量對策。 | 等快照上線一週的真實列數出來再決定；做的話先限定使用者上限（例如 500）。 |
| 4 | **登入方式** | 只開 Google；Email magic link 暫不開。 |
| 5 | **是否需要 Email 寄送服務** | v1 不需要；v2 的 Email 價格通知才需要，且要自有網域；先做站內提示。 |
| 6 | **是否購買自有網域**（Resend 驗證、Google 同意畫面可信度、`PUBLIC_BASE_URL`、信任感） | v1 前建議買；價格本次未查。 |
| 7 | **隱私政策與服務條款由誰撰寫** | 由使用者（或其選定的專業人士）定稿；Claude 可先出草稿與欄位對照表，但不是法律意見。需同時指定權利請求的聯絡信箱與未成年人處理方式。 |
| 8 | **資料庫容量策略**：停止線誰先（快照或註冊）、是否縮小快照範圍、是否升級 Pro（US$25／月起） | 先停註冊、再停快照；不升級（維持先前決定），但要有修剪快照方案。 |
| 9 | 參考總值呈現：分來源小計，或單一合併數字？ | 分來源小計（Cardmarket、TCGplayer 各自換算新台幣），不合併。 |
| 10 | 購入價欄位：v1 就顯示損益，還是只先存欄位？ | 只先存欄位，v2 再顯示。 |
| 11 | 是否授權修改 Supabase 後台、Google Cloud、Render 設定（這些會啟用外部服務，需使用者本人或明確授權） | 由使用者操作，worker 只提供步驟清單。 |

## 8. 無法確認的點

- 卡拍拍、貓罐子是否有收藏功能：卡拍拍是交易市集（SPA、條款禁止自動化擷取，見 `docs/research/price-sources/tw.md`），本次沒有存取其站內功能；貓罐子網頁只取得標題。
- Collectr 是否有願望清單、價格通知是否免費、匯出格式、日版與繁中支援；PriceCharting 官方頁以 WebFetch 讀取失敗（403），其功能描述來自搜尋結果對官方頁的摘錄，CSV 匯出未見證據；TCGplayer Collection 的品況選項與估值算法官方頁未寫。
- Supabase：匿名使用者是否計入 MAU；CAPTCHA 是否涵蓋 `signInWithOtp`；Free 方案是否有備份；自訂網域是否收費；Google OAuth 在 `onrender.com` 子網域下品牌驗證是否有限制；Supabase 自訂 OIDC（如 LINE）的可用範圍；access token 預設有效期（文件頁未寫）。
- Resend 免費方案能否用其測試寄件地址寄給任意收件者（文件頁沒寫）；Brevo 免費額度未取得。
- 個資法現行施行狀況（修正日期與未施行條文）、特定目的與個資類別代號、未成年人同意規則：需由撰寫者對照官方現行條文確認。
- 每位 Auth 使用者實際佔用量為估計值，需以測試帳號實測。
- 既有 localStorage 收藏的 ID 是實體卡 id 還是作品層 ID：由程式碼推論，未在瀏覽器實測。
- `price_snapshots` 目前僅 1,154 列，參考總值的實際覆蓋率尚無法估計；Cardmarket trend 的品況基準未確認。
- Render 服務區域（HANDOFF 記為待使用者確認）。

## 附：本次唯讀查詢摘要（2026-10-15，Supabase 專案 `ubiaftrvmywwmifqzmik`）

- 資料庫總大小 319 MB；`auth.users` 0 列；`auth` schema 約 1.15 MB。
- `tcg_cards` 75,662 列（94 MB）；`price_snapshots` 1,154 列（288 kB）。
- `public` 19 張表全部啟用 RLS，pg_policies 沒有任何 policy；12 張目錄表對 `anon`／`authenticated` 有表級 SELECT／INSERT 授權（被 RLS 擋住）；7 張表（含 `price_snapshots`）完全無授權。
- 已啟用擴充：plpgsql、pg_stat_statements、uuid-ossp、pgcrypto、supabase_vault、pg_trgm。

## 參考網址

競品
- Collectr：https://getcollectr.com/ 、https://getcollectr.com/pro 、https://getcollectr.com/scan 、https://apps.apple.com/us/app/collectr-tcg-collector-app/id1603892248
- TCGplayer Collection Tracker：https://shop.tcgplayer.com/collection
- PriceCharting Collection Tracker：https://www.pricecharting.com/page/collection-tracker （WebFetch 403，內容取自搜尋摘錄）
- Dex - for TCG Collectors：https://apps.apple.com/app/id1555489854
- 卡拍拍：trade.kapaipai.tw（見 `docs/research/price-sources/tw.md`）；貓罐子：https://bottleneko.app/

Supabase／Render／寄信
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users
- https://supabase.com/docs/guides/platform/database-size
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/rate-limits
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/auth-anonymous
- https://supabase.com/docs/guides/auth/auth-captcha
- https://supabase.com/docs/guides/auth/row-level-security
- https://supabase.com/docs/guides/auth/jwts
- https://supabase.com/docs/guides/auth/managing-user-data
- https://render.com/docs/free
- https://resend.com/pricing 、https://resend.com/docs/dashboard/domains/introduction

法規
- 個人資料保護法（全國法規資料庫）：https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021

內部文件
- `docs/PRODUCT_PLAN.md`、`docs/HANDOFF.md`（依序執行 95、96）、`docs/adr/0036-tcgdex-pricing-twd-reference.md`、`docs/adr/0042-daily-reference-price-snapshots.md`、`supabase/migrations/20261015090000_price_snapshots.sql`
