// Stop hook：把目前 git 狀態寫入 docs/AGENT_BATON.auto.md，供另一個 agent 接手參考。
// 永遠 exit 0，不影響 Claude Code 正常結束。
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim() || "（無）";
  } catch {
    return "（無法取得）";
  }
};

const text = [
  `# 自動快照 ${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}`,
  "",
  "此檔由 Stop hook 自動產生並覆寫，不要手動編輯。人工交接內容在 AGENT_BATON.md。",
  "",
  "## 目前分支",
  git("branch", "--show-current"),
  "",
  "## 未提交的變更",
  git("status", "--short"),
  "",
  "## 最近 5 次 commit",
  git("log", "--oneline", "-5"),
  "",
].join("\n");

try {
  writeFileSync(join(root, "docs", "AGENT_BATON.auto.md"), text);
} catch {}
process.exit(0);
