# SV8a Taiwan rarity source resume — 2026-09-28

This is a bounded metadata repair, not a claim of complete SV8a coverage.

## Promoted packet: 074–098

- Source: `https://api.tcgdex.net/v2/zh-tw/cards/SV8a-{number}`; 25 sequential ordinary GETs returned HTTP 200.
- Exact provider ID, set `SV8a`, local number, existing official Traditional Chinese name and one TW `zh-Hant-TW` printing were checked for every record.
- Five source records explicitly report `Double rare`: `074`, `078`, `088`, `091`, `093`. The existing rarity mapper produces `RR`.
- The other 20 source records report literal `None`; no rarity was inferred or written for them.
- Reviewed candidate IDs: `1813`–`1822`; five card rarity and five printing rarity candidates. Images, names and prices are excluded.
- Atomic promotion batch: `pokemon-tw-sv8a-074-098-rarity-20260928`.
- Candidate checksum: `79be3a06ee66c3ed4e7414c782f3f29d`.
- Promotion returned five changed card rarities, five changed printing rarities, five verified existing names, zero changed names/images.
- Before snapshots and reviewed evidence are retained in the private-access enrichment candidate and promotion audit tables.

Source and snapshot working artifacts are local under `temp/sv8a-source-resume/range-074-098/`; they are not public card-art assets and are not required for laptop runtime. The database audit is the durable write record.

## Promoted packet: 099–148

- Two 25-record source packets returned 50/50 HTTP 200, with the same exact provider/set/number/TW printing/official-name checks.
- Eleven explicit `Double rare` records: `101`, `102`, `103`, `104`, `105`, `117`, `120`, `124`, `126`, `134`, `136`; the other 39 report `None` and remain unknown.
- Reviewed candidates `1823`–`1844`; batch `pokemon-tw-sv8a-099-148-rarity-20260928`, checksum `41177007c17d8759b7e005c84e26010c`.
- Promotion changed 11 card and 11 printing rarity values; zero names/images changed. Immediate exact replay changed zero fields. The earlier 074–098 packet also passed zero-change exact replay.
- Read-only final check at this checkpoint: SV8a has 237 matched TW cards/printings, 35 known rarities, 202 unknown, and zero card/printing rarity mismatch.

## Verified without candidates: 149–173

All 25 ordinary requests returned HTTP 200 and matched existing identities; all source rarity values were literal `None`. No candidates or formal writes were made.

## Verified without candidates: 174–237

The remaining 64 source records returned HTTP 200 in three bounded packets (174–198, 199–223, 224–237). Exact provider/set/local number, TW printing and verified official-name matches passed for all 64. All raw rarity values were literal `None`: zero candidates, zero writes, no image requests.

## Final scope and limitations

The interrupted 074–237 range is now fully checked: 164 successful source requests, 16 explicitly supported RR cards/printings promoted, and 148 unknown records left unchanged. Together with the earlier 19 reviewed records, SV8a remains **35 known / 237 observed; 202 unknown**, not complete rarity coverage. All current card/printing rarities agree. Both new promotion batches passed immediate zero-change replay.

A successful source request alone does not authorize a value: exact target matching, blank-only checks, review, checksum and atomic promotion remain required. Source `None` is a real source-data blocker, not a remaining fetch task. Another permitted, same-edition source is needed before filling those 202 values. No foreign-version or image-based inference is allowed.
