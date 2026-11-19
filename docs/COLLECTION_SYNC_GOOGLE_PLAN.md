# 收藏雲端同步：加「用 Google 登入」自動同步

## Context
使用者覺得手抄同步碼太費心，問「不能存進網站就好嗎」。網站要認得兩台是同一人，一定要有東西連起來；使用者選了 **Google 帳號登入**。
- 最愛本來就會同步（收藏每筆的 `favorite` 在雲端 items 裡），這次不用為它改程式。
- 「傳連結加入」方案作廢（worker 還沒動程式，分支停在 8197e75，乾淨）。
- 已做好的同步碼路線（Y1–Y5）保留當「不想登入」的備案；Google 登入成為主要方式。兩者共用同一張 `collection_sync` 表、同一套合併規則與驗證。

## 做法
### 使用者要先做的（Claude 不能代填金鑰）
1. Google Cloud Console 建 OAuth 用戶端（網頁應用程式），同意畫面名稱「好卡在 CardSeek」、授權網域 cardseektcg.com；重新導向 URI 填第二庫的 `https://kcqtmmurmggitbivonll.supabase.co/auth/v1/callback`。
2. Supabase 第二庫（cardscope-ip2）→ Authentication → Providers → Google：貼上 Client ID／Secret 並開啟；URL Configuration 的 Site URL 設 `https://cardseektcg.com`，Redirect URLs 加 `https://cardseektcg.com/?view=collection` 與本機測試用 `http://localhost:*`。
3. Render 環境變數加 `SUPABASE2_ANON_KEY`（第二庫的 anon／publishable key，給伺服器做登入交換用）。
Claude 會在使用者的瀏覽器旁一步步帶，但 Client Secret 與金鑰由使用者自己貼。

### 程式（分支 claude/collection-sync，交給 sonnet-worker）
- **登入流程（PKCE，全部經過自家伺服器，CSP 不用開放 supabase.co、不用 cookie）**
  - 前端「用 Google 登入」：瀏覽器產生 code_verifier（存 sessionStorage）與 challenge，導向 `<ip2>/auth/v1/authorize?provider=google&redirect_to=<origin>/?view=collection&code_challenge=...&code_challenge_method=s256`。
  - 回到網站帶 `?code=`：前端立刻 `history.replaceState` 拿掉 code，POST `/api/auth/exchange {code, verifier}`；伺服器用 anon key 打 `<ip2>/auth/v1/token?grant_type=pkce`，回 access／refresh token 與顯示用的信箱。
  - token 存 localStorage；`/api/auth/refresh` 換新 token；「登出」清本機並呼叫 Supabase logout。
- **同步端點沿用**：`/api/sync/pull|push|delete` 多接受 `Authorization: Bearer <access token>`（body 不帶 code）。伺服器用 `<ip2>/auth/v1/user` 驗 token（結果快取 1–5 分鐘），鍵 = `sha256('google:' + user.id)`，表結構不變。其餘驗證、409、限流、no-store、錯誤不回雜湊都照舊。
- **前端**：收藏頁「管理 → 雲端同步」對話框最上方放「用 Google 登入，自動同步」主按鈕；登入後顯示「已用 xxx@gmail.com 登入・已同步（時間）」、「登出」「刪除雲端資料」。同步碼區塊收進「不想登入？改用同步碼」摺疊。同步時機、離線處理、合併沿用 Y4 引擎。
  - 本機已有收藏、第一次登入：與雲端合併（`mergeSync`），不覆蓋。
  - 已用同步碼同步的裝置登入 Google：把同步碼那份合併進 Google 那份，之後停用同步碼。
  - 頁首「我的收藏」旁或收藏頁標題列加一個小狀態（已同步／未登入），方便看出有沒有在同步。
- **隱私與文件**：隱私說明改成：用 Google 登入時，Supabase 會存你的 Google 信箱與帳號 ID（用來認人），CardSeek 不另外存、不寄信、不做其他用途；登出、刪除雲端資料的方式；Google 同意畫面只要求基本資料（email）。「我們不做的事」裡「不要求註冊／不蒐集信箱」改成「不強制登入；選擇用 Google 登入同步時才會有信箱」。ADR 0059 補登入一節；PRODUCT_PLAN 若有「不做帳號」改註明。
- **測試**：exchange／refresh 參數驗證與錯誤不外洩、Bearer 驗證失敗回 401、Google 與同步碼的鍵互不相通、回應不含 token 或雜湊；前端：code 從網址清掉、verifier 用過即刪、登出清 token。

### 一起上線的事（之前已等待同意）
- 180 天清理排程（`supabase/ip2/20261119180000_collection_sync_cleanup.sql`）：上線前問使用者同意再套用。

## 驗證
- `npm test`、`npm run check`。
- 本機實測（使用者完成 Google／Supabase 設定後）：Edge 設定檔 A、B 各用使用者的 Google 帳號登入（登入由使用者自己按），A 加最愛 → B 切回分頁後出現；登出後本機收藏還在、不再同步；「刪除雲端資料」後雲端列消失（以 SQL 查 `collection_sync` 確認）。測完刪測試列，依 user-data-dir 名稱以 PID 收掉 msedge。
- 1440／375 截圖（未登入、已登入、同步碼摺疊）給使用者看，同意後合併 main；正式站再用使用者的帳號實測一次登入與同步。
