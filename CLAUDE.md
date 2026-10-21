# CardScope — Claude Code 指引

先讀 `AGENTS.md` 的「CardScope source of truth」一節與 `docs/PRODUCT_PLAN.md`。
`AGENTS.md` 中的 Luna／Sol 模型路由是 Codex 專用，Claude Code 不適用，略過即可。

## 跨工具協作（Claude Code ↔ Antigravity）

完整規則見 `AGENTS.md` 最後一節「跨工具協作」，兩個工具共用同一份。重點：

- 開始工作前先讀 `docs/AGENT_BATON.md`（短版接力棒），不要整份讀 `docs/HANDOFF.md`（1000 行以上，只在需要查歷史時讀）。
- 每完成一個可獨立驗證的段落，更新 `docs/AGENT_BATON.md`，再 commit 並 push（沿用 `docs/HANDOFF.md`「更新規則」）。
- 用量剩餘 5% 以下：不開始新步驟，先更新 `docs/AGENT_BATON.md` 並 commit，再停手。
- Stop hook 會自動把 git 狀態寫入 `docs/AGENT_BATON.auto.md`（已 gitignore），接手方可一併參考。
