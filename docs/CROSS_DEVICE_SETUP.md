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
