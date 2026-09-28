# Japanese Pokémon metadata preflight

Status: zero-write adapter validated; not a production Japanese catalog import.

`providers/pokemon-jp-manifest.mjs` and `scripts/plan-pokemon-jp-import.mjs` read a saved snapshot only. They never fetch, contact a database, enable startup synchronization, or enter `provider=all`. Each manifest processes at most 100 source card records. Source identity is fixed to `tcgdex-ja / JP / ja-JP` and isolated lossless IDs; source/seed hashes bind the cursor. Exact provider ID, set ID and local ID must agree. Existing JP series keys and printings are quarantined, including `SV4a` and the `347` versus `347/190` seed. TW/US records are not matched or changed.

Only Japanese names, source-local numbers, dates and supported rarity metadata are proposed. No Chinese name is guessed; no products, logos, images or prices are proposed. Derived API URLs are labelled `derived-provider-endpoint`, not claimed as a successful image fetch. Global expected totals remain unknown.

Snapshot shape: `observedAt` (valid ISO timestamp), `sourceIdentity`, `sets`, `cards`, `existingJpRows: {series, cards, printings}`. The saved card must carry `id`, `localId`, `set.id`; all source fields are hashed even if not proposed.

```powershell
node scripts/plan-pokemon-jp-import.mjs snapshot.json --series PMCG1 --limit 100
node --test test/pokemon-jp-manifest.test.mjs
```

## Real-source canary (2026-09-28)

Two ordinary metadata GETs at `2026-09-28T15:34:23.4821772Z` verified `https://api.tcgdex.net/v2/ja/sets/PMCG1` and `https://api.tcgdex.net/v2/ja/cards/PMCG1-001`. One saved card produced three proposed manifest records (series/card/printing), zero quarantines, zero writes. Source name `フシギダネ`, local ID `001`, source rarity `Common` mapped to `C`. This source-local ID is not independently verified as an official printed card number.

- Source hash: `de07120d7c62de76565107708eb7a2f9c5cf192af392d8aa98ab90f95e7a53d1`.
- Seed hash: `923fc27dabc4c3ff5679488b7249ee3e7970975233a8ce098a51b1d97c187ed6`.
- Manifest hash: `3f64166d5015aba31d5ce9d0852b271538156648914ea3f42489362e75920a2f`.
- Local working snapshot: `temp/pokemon-jp-preflight/PMCG1-one-card.json`; not needed by production runtime.

The source reports 184 Japanese series and 18,031 cards; these are unverified source observations, not a complete official denominator. A separate source query returned an anomalous `SV4a` title compared with the existing seed and its reported cards did not cover seed number 347. `PMCG1` variant counts also exceed its reported total. Do not promote either source totals or seed associations without reconciliation.

## Production gates still required

Re-read live constraints, triggers, seeds and natural keys immediately before any pilot. Prepare an additive single-transaction importer, explicit idempotent replay test, exact relationships and before/after evidence. Do not use the generic TW upsert: it can synthesize Chinese series/product labels and perform non-atomic cross-table writes. No production Japanese import is authorized by this dry-run output alone. Image rights and cross-edition canonical mapping require independent evidence.

References: [TCGdex documentation](https://tcgdex.dev/faq), [database licensing](https://github.com/tcgdex/cards-database#licenses). Metadata licensing does not grant Pokémon card-art display rights.
