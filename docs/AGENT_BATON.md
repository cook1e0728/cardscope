# Agent 接力棒（Claude Code ↔ Antigravity）

> 這是「目前正在做的事」的短版狀態，隨時覆寫，不累積歷史。長期決策看 `PRODUCT_PLAN.md`，歷史紀錄看 `HANDOFF.md`。
> 上次更新：2026-10-21 約 15:00（台灣）｜更新者：Claude Code（用量到上限，交給 Antigravity）

## 角色
- 規劃／驗收：Claude Code（用量用完，暫停）
- 執行：Antigravity（接手）

## 目前任務
首頁第一屏加入吉祥物兔子插畫（使用者已同意：右側卡套框、周圍紙色、手機縮成標題上方小圖、緩慢漂浮）。

## 任務清單
- [ ] 1. 首頁兔子插畫的樣式
  - 現況：`index.html` 已在 `<section class="hero" id="hero">` 開頭加入 `<figure class="hero-art" aria-hidden="true"><img src="/assets/brand/web/rabbit-explore.webp" width="480" height="1041" ...></figure>`，**尚未提交**；沒有樣式時圖片會很大，**不可單獨部署**。
  - 可寫檔案：`look-clean.css`（以 `html.look-clean` 為前綴；只在 `body[data-view="landing"]` 生效，其他頁隱藏 `.hero-art`）、`index.html`（只限 hero 區）。
  - 做法：桌面（>760px）`.hero` 用兩欄 grid，`.hero-intro`、`.home-search`、`.home-examples` 在左欄第 1–3 列，`.hero-art` 在右欄跨 1–3 列，其餘（`#channels` 等）跨全寬；`.hero-art` 寬約 240px、`aspect-ratio:63/88`、`object-fit:cover`（`object-position` 讓兔子在框內）、圓角 12px、3px 槍鐵灰卡套框（沿用卡片格的卡套色）。手機（≤760px）縮成標題上方約 96px 寬小圖。漂浮：`transform: translateY` 4px、約 6 秒循環、ease-in-out；`@media (prefers-reduced-motion: reduce)` 與 `html[data-cs-paused]`（暫停動態開關）時停止。
  - 驗收：`npm test` 全數通過（基準 521）；用 `node scripts/preview-proxy.mjs 4300`（本機前端＋正式站唯讀 API）看桌面 1440、手機 390／320 的首頁，搜尋框維持在第一屏、無橫向捲動；文字對比 AA。
- [ ] 2. 新增 ADR 0048（首頁吉祥物與持續漂浮動畫，延伸 ADR 0047），主方案第 5 節註明。

## 已完成（本輪 Claude Code）
- UI 收尾已部署（`d12aea8`）：手機詳細頁緊湊排列與 320px 修正、分享改用系統分享＋網址欄備援（`navigation-state.js` 的 `copyCurrentUrl`）、原始頁面 44px、系列分頁籤附數量、手機稀有度膠囊列、補台灣官方來源名稱。
- 視覺改版 ADR 0047（乾淨卡冊＋適度動態）、記憶體警戒日誌（Render OOM 後，日誌搜尋 `memory high`）均已上線。

## 下一步（唯一，具體到檔案與指令）
- 做任務 1：改 `look-clean.css`，以 `scripts/preview-proxy.mjs` 預覽並截圖給使用者確認，`npm test` 通過後提交 `index.html`＋`look-clean.css`，推 `claude/binder-theme-preview` 並快轉 `main`（Render 會部署），再看正式站首頁。

## 卡住的地方／需要規劃方決策
- 無。

## 未提交的變更與暫存檔位置
- `index.html`：hero 插畫標記（見任務 1）。
- 本接力棒相關的協作設定檔（`CLAUDE.md`、`AGENTS.md`、`.gitignore`、`scripts/baton-snapshot.mjs`）已由 Claude Code 一併提交。

## 開始前必須重新核對
- `git status`、目前分支（`claude/binder-theme-preview`）、`npm test` 基準線 521。
- 之後要等的事：10-24 後確認排球少年 HV-P04／HV-D04 自動同步；約 10-27 皇巢／晴れる屋2 價格詢問若仍未回覆要問使用者；約 11-14 第一次刪除封存快照（ADR 0046）。使用者決定目前不花額外金錢。
