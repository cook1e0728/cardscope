---
status: accepted
---

# ADR 0059：收藏雲端同步（Google 登入自動同步＋同步碼備案）

**狀態：已採用（2026-11-19，2026-11-20 新增 Google 登入）。依據：使用者 2026-11-17 決定的 `docs/NEXT_PHASE_PLAN.md` Y 節（Y1–Y5 同步碼版）與 2026-11-20 `docs/COLLECTION_SYNC_GOOGLE_PLAN.md`。部分取代 ADR 0045。**

## 背景

ADR 0045 把收藏固定為「只存在這台裝置、不上傳」。代價是換手機、換瀏覽器或清掉網站資料就全部消失，要靠手動匯出匯入。使用者要的是「幾台裝置共用同一份收藏」，但不想做帳號、也不想收信箱或任何個資。

## 取代 ADR 0045 的哪部分

- **取代**：「資料只在這台裝置」「伺服器不蒐集、不儲存任何收藏內容」。現在使用者主動開啟雲端同步後，收藏會存到雲端。
- **不變**：預設仍只存在瀏覽器；不開啟就不會上傳任何東西。localStorage 鍵、欄位、驗證規則、備份格式、參考總值、不登入、不追蹤，全部照舊。ADR 0045 其餘部分繼續有效。

## 決定

### Google 帳號登入（主要方式）與同步碼（備案）

- Y1–Y5 先做完免帳號的同步碼，但使用者看過介面後覺得跨裝置手抄 28 碼太費心，因此 2026-11-20 決定以 **Google 帳號登入自動同步**為主要方式，同步碼收進「不想登入？改用同步碼」摺疊當備案。兩者共用同一張 `collection_sync` 表與同一套合併引擎。
- **PKCE 全程經自家伺服器**：前端產生 `code_verifier`（暫存 `sessionStorage`，換完即刪）與 S256 `code_challenge`，向 `GET /api/auth/config` 取得副庫的公開 origin 後導向 `<ip2>/auth/v1/authorize?provider=google`。回到網站帶 `?code=` 時立刻 `history.replaceState` 清掉網址上的 code，再 `POST /api/auth/exchange {code, verifier}` 由伺服器以 `SUPABASE2_ANON_KEY` 代打 `<ip2>/auth/v1/token?grant_type=pkce`；換新走 `POST /api/auth/refresh`；登出走 `POST /api/auth/logout`。因此 CSP 的 `connect-src` 維持 `'self'`、不用開放 `*.supabase.co`，也不用 cookie（token 存 `localStorage` 的 `cardscope-auth`）。
- **同步端點共用**：`/api/sync/pull`、`/api/sync/push`、`/api/sync/delete` 多接受 `Authorization: Bearer <accessToken>`（此時 body 不帶 `code`）。伺服器向 `<ip2>/auth/v1/user` 驗證 token（成功結果以 token 的 SHA-256 為鍵快取在記憶體 1–5 分鐘，上限 2000 筆，且不超過 JWT 的 `exp`），同步鍵 = `sha256('google:' + user.id)`。因為同步碼只含 26–64 個 `0-9A-Z`，而 `'google:'` 含小寫與冒號，兩者的雜湊前字串絕不重疊，鍵空間互不相通。
- **合併與升級**：第一次登入 Google 時，本機既有收藏與雲端以 `mergeSync` 合併，不覆蓋；若該裝置原本已用同步碼同步，會先把同步碼雲端那份拉下合併進 Google 帳號的收藏，再停用本機同步碼。

### 同步碼（不想登入時的備案）

- 瀏覽器用 `crypto.getRandomValues` 產生 28 碼 0-9A-Z（約 145 bit；伺服器接受 26–64 碼），顯示成四碼一組。產生時略過會造成偏差的位元組。
- 只存在該瀏覽器的 localStorage `cardscope-sync`；只放在 POST body，不進網址、不進 header、不進任何紀錄。
- 另一台輸入同步碼就加入。加入時雲端必須真的有資料；兩邊有衝突時雲端版本優先，這台獨有的卡會保留。

### 雲端存什麼、存在哪

- 存在第二個資料庫（`cardscope-ip2`，Supabase，ap-northeast-1 東京；ADR 0057），不放主庫。表 `public.collection_sync`（migration `20261119170000_collection_sync.sql`）。
- 一個同步碼一列：`sync_key_hash`（同步碼的 SHA-256，主鍵）、`items`（jsonb）、`revision`、`updated_at`。
- `items` 是驗證過的收藏項目：卡片 id、作品層 id、數量、品況、版本、備註、系列／遊戲／地區提示，加上每筆的 `updatedAt`；已刪除的卡只留 `id`、`deleted`、`updatedAt`（墓碑）。不存圖片、價格、姓名、信箱、IP。

### 怎麼保護

- 伺服器只存同步碼的雜湊；回應與錯誤訊息不含同步碼、雜湊或別人的資料；副庫的錯誤文字不轉給訪客（一律 502 泛用訊息）。
- 表開 RLS 且沒有任何 policy；撤銷 `public`、`anon`、`authenticated`，只給 `service_role`。只有伺服器用 service key 讀寫。
- 端點 `POST /api/sync/pull`、`/api/sync/push`、`/api/sync/delete`：同步碼格式不對、欄位不符、資料驗證不過一律 400 且不查庫；每筆收藏走 `collection-store.js` 的同一套驗證，任何一筆不合格就整份拒絕；回應 `no-store`；沒設 `SUPABASE2_*` 回 503。
- 限流：三個端點共用，同一個 IP 每分鐘 6 次（`SYNC_RATE_LIMIT_PER_MINUTE`），格式錯的請求也算。IP 的判斷沿用全站寫法：先看 `cf-connecting-ip`，沒有才用連線對端位址，不信 `X-Forwarded-For`；IP 只放在伺服器記憶體。
- 寫入用 `revision` 樂觀鎖：版本不符回 409，前端先拉、合併再寫。
- 合併（`CollectionStore.mergeSync`）：同一張卡取 `updatedAt` 較新的，時間相同墓碑勝；裝置時間超前一天以上的，伺服器當成現在。
- 使用者可「停止同步」（只清這台的同步碼）或「刪除雲端資料」（確認後整列刪除）。

## Consequences（已知限制）

- **同步碼弄丟就找不回**：伺服器只有雜湊，沒有任何方式還原。沒有其他裝置還留著碼時，只能重新開始。
- **知道同步碼的人都能讀寫這份收藏**；備註裡不要寫個人資料。收藏內容在雲端沒有另外加密。
- **墓碑 30 天後清掉**：停用超過 30 天的裝置回來時，它沒改過的舊項目可能把已刪的卡帶回來。要避免就得保留更久或改用版本向量。
- **180 天清理**：副庫的 pg_cron 每天刪 `updated_at` 超過 180 天的列（migration `20261119180000_collection_sync_cleanup.sql`）。只有寫入會更新 `updated_at`，只拉不寫的裝置不算使用中。清理排程要另外套用到副庫才生效。
- **沒有 QR 碼**：專案內沒有現成的 QR 套件，不為此新增依賴；另一台用輸入同步碼加入。
- **限流以 IP 計**：同一個出口 IP 後面的多人共用額度；Cloudflare 以外直連源站時用連線對端位址。
- 雲端被另一台裝置刪除時，其他裝置下次同步會發現並自動停止同步，不會重建。
- 同一個瀏覽器同時開兩個分頁修改收藏沒有特別處理。
- 使用 Google 登入時，Supabase Auth（副庫 `auth.users`）會保存使用者的 Google 信箱與帳號 ID，僅供辨識同一人的收藏；`collection_sync` 表本身只存 `sha256('google:' + user.id)`，不存信箱，CardSeek 也不寄信或做其他用途。
