# Japanese Pokémon metadata preflight

Status: zero-write adapter validated; not a production Japanese catalog import.

`providers/pokemon-jp-manifest.mjs` and `scripts/plan-pokemon-jp-import.mjs` read a saved snapshot only. They never fetch, contact a database, enable startup synchronization, or enter `provider=all`. Each manifest processes at most 100 source card records. Source identity is fixed to `tcgdex-ja / JP / ja-JP` and isolated lossless IDs; source/seed hashes bind the cursor. Exact provider ID, set ID and local ID must agree. Existing JP series keys and printings are quarantined, including `SV4a` and the `347` versus `347/190` seed. TW/US records are not matched or changed.

Only Japanese names, source-local numbers, dates and supported rarity metadata are proposed. No Chinese name is guessed; no products, logos, images or prices are proposed. Derived API URLs are labelled `derived-provider-endpoint`, not claimed as a successful image fetch. Global expected totals remain unknown.

Snapshot shape: `observedAt` (valid ISO timestamp), `sourceIdentity`, `sets`, `cards`, `existingJpRows: {series, cards, printings}`. The saved card must carry `id`, `localId`, `set.id`; all source fields are hashed even if not proposed.

```powershell
node scripts/plan-pokemon-jp-import.mjs snapshot.json --series PMCG1 --limit 100
node --test test/pokemon-jp-manifest.test.mjs
```

## Archive source when the API is down (ADR 0002)

When `api.tcgdex.net` is unreachable, read the same data from a clean checkout of `github.com/tcgdex/cards-database` pinned to one commit. Data files are parsed as literals, never executed. The snapshot adds `sourceArchive` and per-card `sourceFile`; the rest of the pipeline is unchanged.

```powershell
git clone --depth 1 --filter=blob:none --sparse https://github.com/tcgdex/cards-database.git $env:TEMP\tcgdex-ja
git -C $env:TEMP\tcgdex-ja sparse-checkout set data-asia/SV
node scripts/snapshot-pokemon-jp-from-tcgdex-archive.mjs $env:TEMP\tcgdex-ja --series SV6a --existing existing-jp-rows.json > SV6a-snapshot.json
node scripts/plan-pokemon-jp-import.mjs SV6a-snapshot.json --series SV6a > SV6a-manifest.json
node scripts/build-pokemon-jp-import-plan.mjs SV6a-manifest.json > SV6a-import-plan.json
```

`existing-jp-rows.json` is `{series, cards, printings}` of the live JP Pokémon rows, read just before planning.

## Real-source canary (2026-09-28)

Two ordinary metadata GETs at `2026-09-28T15:34:23.4821772Z` verified `https://api.tcgdex.net/v2/ja/sets/PMCG1` and `https://api.tcgdex.net/v2/ja/cards/PMCG1-001`. One saved card produced three proposed manifest records (series/card/printing), zero quarantines, zero writes. Source name `フシギダネ`, local ID `001`, source rarity `Common` mapped to `C`. This source-local ID is not independently verified as an official printed card number.

- Source hash: `de07120d7c62de76565107708eb7a2f9c5cf192af392d8aa98ab90f95e7a53d1`.
- Seed hash: `923fc27dabc4c3ff5679488b7249ee3e7970975233a8ce098a51b1d97c187ed6`.
- Manifest hash: `3f64166d5015aba31d5ce9d0852b271538156648914ea3f42489362e75920a2f`.
- Local working snapshot: `temp/pokemon-jp-preflight/PMCG1-one-card.json`; not needed by production runtime.

The source reports 184 Japanese series and 18,031 cards; these are unverified source observations, not a complete official denominator. A separate source query returned an anomalous `SV4a` title compared with the existing seed and its reported cards did not cover seed number 347. `PMCG1` variant counts also exceed its reported total. Do not promote either source totals or seed associations without reconciliation.

## Production gates still required

The pilot design was settled on 2026-10-01; see `docs/PRODUCT_PLAN.md` Phase 2C and `docs/adr/0001-jp-canonical-isolation.md`.

Decided:

- A read-only live check on 2026-10-01 confirmed that the only Japanese Pokémon rows are the hand-written SV4a seed (1 series, 1 card, 1 printing, null source/provider ID). The constraints are valid, and the canonical trigger merges names/aliases on a canonical ID collision.
- The pilot covers one clean series of at most 100 cards, imported as one manifest in one transaction.
- Writes are insert-only. Card and printing IDs are readable (`pokemon-tcgdex-ja-<set>-<local>`), each card gets its own 1:1 canonical, and `data_status` is `pending`. No Chinese name or image is written.
- The import runs through a private append-only audit table and a `service_role`-only import function. Replaying the same hash makes zero changes; a different hash for an already-imported series is rejected.

Still blocking:

- The pilot series is SVLN (22 cards, zero quarantine); evidence is in `docs/evidence/pokemon-jp/`.
- Readable IDs, the migration (production version `20261001095010`) and local PostgreSQL scenario tests are done; the SVLN production dry-run and import have not been run. See `docs/HANDOFF.md`.
- Immediately before the pilot, live constraints, triggers, seeds and natural keys must be re-read.

Do not use the generic TW upsert: it can synthesize Chinese series/product labels and perform non-atomic cross-table writes. No production Japanese import is authorized by dry-run output alone. Image rights and cross-edition canonical mapping require independent evidence.

References: [TCGdex documentation](https://tcgdex.dev/faq), [database licensing](https://github.com/tcgdex/cards-database#licenses). Metadata licensing does not grant Pokémon card-art display rights.
