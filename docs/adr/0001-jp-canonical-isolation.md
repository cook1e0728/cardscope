---
status: accepted
---

# 日版寶可夢 Card 先自成 canonical，不與台版／美版連結

日版 metadata pilot 匯入的每張 Card 都使用自己專屬的 canonical（與 Card 1:1，ID 形如 `pokemon-tcgdex-ja-<系列>-<編號>`），不嘗試對到既有台版或美版的 canonical。原因有二：一是來源的 localId 尚未獨立驗證為官方印刷卡號，而 PRODUCT_PLAN 只允許官方編號或可靠 Provider ID 合併版本；二是 `tcg_cards` 的 canonical trigger 會在 canonical ID 相同時靜默合併名稱與別名，錯誤連結會汙染其他版本的搜尋與顯示，且難以乾淨拆回。代價是同一張卡的日版與台版在作品層暫時分開，跨版本導覽要等之後的連結階段。

## Consequences

- 匯入前必須預檢：任何與既有 `tcg_canonical_cards.id` 相撞的候選一律中止，不倚賴 trigger 的合併行為。
- 日後連結跨版本 canonical 需要同語言以外的獨立證據（官方卡號或可靠 Provider ID 的對應），並以可稽核的資料遷移處理，不屬於 metadata pilot。
- 唯一例外是早期手寫的 SV4a Seed（canonical `pokemon-mew-ex`，名稱式 ID）；它在另一輪核對中處理，pilot 不碰它。
