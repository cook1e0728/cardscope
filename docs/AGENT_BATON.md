# Agent 接力棒（Claude Code ↔ Antigravity）

> 這是「目前正在做的事」的短版狀態，隨時覆寫，不累積歷史。長期決策看 `PRODUCT_PLAN.md`，歷史紀錄看 `HANDOFF.md`。
> 上次更新：2026-10-30（台灣）｜更新者：Claude Code（桌電）

## 角色
- 規劃／驗收：Claude Code（Opus 帶領，Sonnet worker 分頭執行）
- 執行：Antigravity

## 目前狀態
- 2026-10-29：10-28 盤點除需使用者同意的項目外全部修完並上線（main `9181691`），處理狀態見 `docs/AUDIT_20261028.md`。`npm test` 621/621，煙霧測試通過，正式站驗收 36 項通過。
- 資料清理：空系列與 8-31 示範卡（migration `20261029090000`）、遊戲王 88 筆殘留 unspecified 與 596 張無 TCG 系列的卡（`20261029100000`），備份在 `docs/evidence/cleanup-20261029/`；遊戲王 14,117 張、系列 1,396 個。
- 資料庫約 384 MB；`browse-keys-publish` 每小時 :25；價格快照每日恢復（10-28 寫入 13,562 筆）。

- 2026-10-30：CSP 改為強制（仍允許 inline，擋外部腳本與未列出的圖片主機；轉強制前正式站各遊戲／地區頁與詳細頁實測 0 違規）。首頁副標改為「寶可夢同一張卡的日版與台版並列對照」（#15）。Render 區域照建議維持現狀（搬遷要重建服務，目前延遲可接受）。
- 2026-10-30：收錄七龍珠超 Fusion World（`dragonball-fw`，ADR 0052 Q7 使用者同意 risk-accepted）。官方繁中站 27 個系列由 `dbs-fw-official` 定時同步（insert-only）；正式庫 3,167 張卡／3,167 筆版本（平行版各自一張卡、canonical 指回基本卡，與航海王一致）。正式站驗收：遊戲頁、系列頁、詳細頁桌機與手機皆通過，CLS ≤ 0.03、CSP 0 違規。

## 下次要確認
- 七龍珠超（10-30 已補）：系列發售日與包裝圖取自官方商品頁（同步時一併取；推廣卡 PR 沒有發售日）；能量標記（E-、E01-）另列「能量標記」稀有度分組；系列分組為補充包／特別補充包／起始牌組／推廣卡。仍待：能量標記沒有日文名；官方卡圖帶 SAMPLE 浮水印（未放進首頁展示卡）；手機快速入口 11 格（3 排）。稀有度順序 SCR＞SR＞L＞R＞UC＞C＞PR＞能量標記為自訂，在 `data/rarity-rankings.json`。
- 七龍珠超同步是 insert-only：之後官方補了既有系列的發售日或圖，不會自動更新，要手動回填。
- CSP 已強制：新增卡圖來源主機時要加進 `server.mjs` 的 `CSP` img-src，否則圖片會被擋。之後若要拿掉 'unsafe-inline'，需把 index.html 的 inline 事件改事件委派並加 nonce。
- 參考價只收 8 天內快照，每日價格排程若停跑超過一天會掉；桌機卡格最小字級 11px。
- admin 端點仍回 e.message（需管理密鑰，保留診斷）；`yuyuteiMarket` 的 esc 反斜線跳脫未修（低）。
- 首頁 <title>／description 在 `providers/seo.mjs` 的 homeSeo 有一份，改 index.html 文案要同步；Chiron Hei HK 用 text= 子集化，改首頁大標或導覽小卡標題要同步 text=。

## 卡住的地方／需要規劃方決策
- （無）#3 Render 舊金鑰已由使用者於 10-30 刪除。帳號內另有暫停中的新加坡服務 `cardscope-1`（10-02 建立，接同一 repo），不用的話可在後台刪除。

## 本機檔案（不在 git，換電腦不會帶過去）
- `.env.local`：`SUPABASE_ACCESS_TOKEN`（`scripts/run-sql.mjs` 用），每台電腦各自建立。
- `docs/design-previews/`：10-22 首頁 5 版預覽截圖（已加入 `.git/info/exclude`），可不用。
- 這台的 Claude Code 工作階段在 `cardscope` 上一層開啟時，讀不到 `cardscope/.claude/agents/sonnet-worker.md`；改用通用 agent＋`model: sonnet`、`effort: high`，並把 sonnet-worker 規則貼進封包。

## 開始前必須重新核對
- `git pull` 後 `git log -1` 應為本檔提交或更新；`npm test` 基準 631。
- 之後要等的事：排球少年 HV-P04／HV-D04 卡圖（10-23 時 0 張有圖）；皇巢／晴れる屋2 價格詢問（約 10-27 若未回覆要問使用者）；約 11-14 第一次刪除封存快照（ADR 0046）。使用者決定目前不花額外金錢。
