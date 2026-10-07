---
status: accepted
---

# 遊戲導覽使用官方 Logo：使用者接受未取得授權的風險

**狀態：已採用（2026-10-08，使用者明確同意「五個都用」）。目前只在預覽分支 `claude/binder-theme-preview`，合併時一併上線。**

主方案第 3 節要求「五個 IP 導覽統一使用可靠官方 Logo」，但同一節也要求展示官方圖要有權利依據，否則只用非官方中性圖。因此一直用 CardScope 自繪的分類圖（`assets/ip-*.svg`），之後的預覽又改成 Logo 配色漸層加自繪剪影。使用者認為這樣不直覺、圖案陽春、顏色對不上各遊戲，要求直接使用官方 Logo，並接受未取得授權的商標／著作權風險。

決定：

- **用途限縮**：官方 Logo 只用於辨識遊戲的導覽（首頁分類格、遊戲頁分頁籤、遊戲頁色帶右側），不用於宣傳主視覺、不與 CardScope 圖形合成、不改色不變形，一律放在白色底板上原樣顯示。
- **來源**（2026-10-08 取自各官方網站，存於 `assets/ip-logos/`，來源網址記在 `data/game-taxonomy.json` 與 `game-switcher.js` 的 `categoryVisual.source`）：
  - 寶可夢：`https://www.pokemon-card.com/assets/images/logo_b.svg`（日本官網的網站 Logo，含「トレーナーズウェブサイト」字樣；台灣與英文官網未找到獨立的卡牌遊戲 Logo）。
  - 航海王：`https://www.onepiece-cardgame.com/renewal/images/common/logo_op.png`。
  - 遊戲王：`https://www.yugioh-card.com/japan/assets/images/logo-ocg.png`。
  - 葬送的芙莉蓮：Weiß Schwarz 遊戲 Logo `https://ws-tcg.com/wordpress/wp-content/themes/ws-tcg_re/assets/img/common/logo.png`（商品頁沒有單獨的作品標題 Logo）。
  - 排球少年：`https://www.takaratomy.co.jp/products/haikyuvobacabreak/assets/img/logo.svg`。
  SVG 已確認不含腳本。
- **配色**：遊戲頁色帶與選取色改為取自官方 Logo 的實際顏色（寶可夢紅 `#E50012`、航海王黑、遊戲王紅、Weiß Schwarz 深藍、排球少年橘），取代先前推測的配色與自繪剪影。
- **聲明**：頁尾既有的商標聲明補上「遊戲導覽中的官方 Logo 僅用於辨識遊戲，權利人要求時將立即移除」。
- **撤回**：把 `categoryVisual` 改回 `assets/ip-*.svg`（`official:false`）即可恢復非官方圖；圖檔保留與否不影響網站。

卡圖、商品封面等其他圖片的政策不變（仍依 `data/source-registry.json` 的來源別圖片政策）。
