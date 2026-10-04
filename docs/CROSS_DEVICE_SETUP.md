# CardScope 桌電／筆電同步

## 同步內容

方案、模型分工、來源政策與驗收標準都存放在 GitHub 儲存庫，不依賴本機對話記憶：

- `AGENTS.md`：Codex 每次進入專案都會讀取的執行規則。
- `docs/PRODUCT_PLAN.md`：唯一產品與技術方案來源。
- `docs/HANDOFF.md`：目前里程碑的短版交接；換電腦或開新對話時先讀這份，不需重播完整聊天。
- `.codex/config.toml`、`.codex/agents/*`：Luna Max 與 Sol advisor 的專案設定。
- `docs/codex-skills-lock.json`：兩台電腦應安裝的相同官方技能基準。

## 筆電首次準備

1. 在 Codex 中開啟或複製 `https://github.com/cook1e0728/cardscope`。
2. 切換到 `main` 並拉取最新版本。
3. 確認 Codex 信任並讀取儲存庫內的 `.codex/config.toml` 與 `AGENTS.md`。
4. 透過 Codex 官方 skill installer，依 `docs/codex-skills-lock.json` 安裝缺少的官方技能。安裝前仍須閱讀每個技能的 `SKILL.md`、manifest、scripts 與 dependencies；不得僅因名稱相同就執行未知程式。
5. 重新啟動 Codex，讓新安裝的技能載入。
6. 在專案內要求「讀取 `docs/PRODUCT_PLAN.md` 與 `docs/HANDOFF.md`，從下一個未完成階段接續」，不要另建一份本機方案。

## Claude Code 筆電準備

Claude Code（桌面 App 的 Code 分頁或 CLI）不讀 `.codex/`，但同樣以 `AGENTS.md`、`docs/PRODUCT_PLAN.md`、`docs/HANDOFF.md` 為準。

1. 取得程式碼並切到工作分支：`git clone https://github.com/cook1e0728/cardscope.git`（已 clone 則 `git pull`），再 `git checkout <HANDOFF 記載的工作分支>`。
2. 安裝 Node.js（桌電使用 v24），執行 `npm test` 確認全數通過。
3. 在 repo 根目錄建立 `.env.local`，內容一行 `SUPABASE_ACCESS_TOKEN=sbp_…`。這是 Supabase 個人存取權杖，每台電腦在 Supabase 後台各自產生，不從另一台複製、不提交（已被 .gitignore 排除）。沒有它仍可改程式與跑測試，但 `scripts/run-sql.mjs` 無法讀寫正式庫。
4. 對話偏好不在 repo：Claude 的記憶存在每台電腦的 `~/.claude/projects/<專案路徑>/memory/`（目前有「回覆用繁中」「決策照建議自動執行」兩則）。可把桌電該資料夾的 `.md` 複製到筆電對應專案的 memory 資料夾，或在第一次對話時直接說明。
5. 只有要從 Source archive 匯入新系列時，才需另外 clone `https://github.com/tcgdex/cards-database` 並切到 ADR 0002 記載的固定 commit（`c5c0a8a`），以 `CARDSCOPE_WORK` 指向含該 checkout 的工作夾（Windows 需用 `C:/Users/...` 形式路徑）。官方卡片搜尋的抓取快取與證據已提交在 `docs/evidence/`，暫存資料夾的檔案不需搬移。
6. `.claude/settings.local.json` 的指令許可不在 repo，筆電第一次執行 git、node 等指令時會重新詢問。
7. 開始時在專案內說「讀 docs/HANDOFF.md 繼續」。

注意：兩台電腦不要同時對正式庫寫入（匯入、同步、migration）；推送到 `main` 會觸發 Render 部署，筆電上同樣適用。

## 每次換裝置

開始工作前先拉取 GitHub 最新 `main`；結束前完成測試、提交並推送。若桌電或筆電存在未提交變更，不可強制拉取、重設或覆蓋，應先保留變更並在獨立分支整合。

Supabase 與 Render 的密鑰維持在各服務或裝置的安全儲存區，不提交到 GitHub。若筆電尚未登入服務，方案仍可進行本地開發與 fixture 測試，但不得宣稱正式 migration 或部署已完成。

## 對話與里程碑整理

- 每個 PR 合併、正式資料批次完成或發布驗收完成後，更新 `docs/HANDOFF.md`，只保留目前狀態與下一步。
- 新對話以 GitHub `main`、`docs/PRODUCT_PLAN.md`、`docs/HANDOFF.md` 與已合併 PR 為準；舊聊天只作背景，不作部署證據。
- 交接必須分開記錄「程式已合併」「migration 已套用」「資料已寫入」「Render 已驗證」，不得把其中一項當成全部完成。
- 對話過長時直接從最新 checkpoint 開新任務；不需要複製整段歷史，只需附 repo、main commit 與 handoff 的下一步。

## 快速驗證

- `git status` 顯示目前分支與遠端同步狀態。
- `npm test` 與 `npm run check` 全部通過。
- Codex 可辨識 `luna_worker` 與 `sol_advisor`；Sol 保持唯讀且只在升級門檻觸發。
- 本機不需要複製桌電的對話紀錄即可讀到同一份產品方案。

## 安全限制

- 不把 Supabase service role、Render token、eBay secret 或管理端 scrape secret 寫入儲存庫。
- 不自動安裝未列入鎖定清單的 GitHub／Reddit 第三方工具。
- 新技能須先驗證來源、授權、版本、權限與實際必要性，再更新鎖定清單。
