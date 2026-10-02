#!/bin/bash
# Usage: CARDSCOPE_WORK=<dir> bash scripts/import-pokemon-jp-official-series.sh <cache.json> <series-meta.json> <SET>
# ADR 0012: import one JP series from the whole-series official card search cache, replay it, then fill
# Chinese names from the Taiwanese official card of the same number (ADR 0011). Stops on any surprise.
# Rerunnable: an imported batch fails its gated dry run, so it is accepted when its replay changes nothing.
set -u
CACHE=$1; META=$2; CODE=$3
cd "$(dirname "$0")/.."
SP="${CARDSCOPE_WORK:?set CARDSCOPE_WORK to a work folder}"
D="$SP/official-series/$CODE"; mkdir -p "$D"; ACTOR=${CARDSCOPE_ACTOR:-claude-code-local:aa26488931}
TW_CACHE=${CARDSCOPE_TW_CACHE:-docs/evidence/pokemon-tw/official-rarity-20261002.json}
die() { echo "STOP $CODE: $*"; exit 1; }
node scripts/build-pokemon-jp-official-series-plan.mjs "$CACHE" "$META" "$D" --series "$CODE" --actor "$ACTOR" > "$D/summary.json" || die plan
cat "$D/summary.json"
BATCHES=$(node -e "console.log(require(process.argv[1]).batches)" "$D/summary.json")
for i in $(seq 1 "$BATCHES"); do
  r=$(node scripts/run-sql.mjs "$D/$CODE-$i.sql" 2>&1)
  if ! echo "$r" | grep -q '"replay":false'; then
    node scripts/run-sql.mjs "$D/$CODE-$i-replay.sql" 2>&1 | grep -q '"replay":true' || die "import $i: $(echo "$r" | head -c 300)"
    echo "$CODE batch $i already imported"
  fi
done
for i in $(seq 1 "$BATCHES"); do
  r=$(node scripts/run-sql.mjs "$D/$CODE-$i-replay.sql" 2>&1); echo "$r" | grep -q '"replay":true' || die "replay $i: $(echo "$r" | head -c 300)"
done
echo "$CODE imported in $BATCHES batch(es), replay ok"
node scripts/run-sql.mjs --read-only -e "select p.local_set_code code, p.local_card_number num, p.id printing_id, c.id card_id, c.name_ja, c.name_zh, p.rarity_code rarity, c.series_id from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where p.source = 'pokemon-card-official-jp' and p.local_set_code = '$CODE' order by 2" > "$D/jp-printings.json" || die printings
node scripts/build-pokemon-jp-from-tw-official-plan.mjs "$D/jp-printings.json" "$TW_CACHE" "$D/zh" --series "$CODE" --actor "$ACTOR" ${CARDSCOPE_NAME_DICTIONARY:+--name-dictionary "$CARDSCOPE_NAME_DICTIONARY"} || die zh-plan
for f in $(ls "$D/zh"/jp-tw-same-number-*.sql 2>/dev/null | grep -v replay); do
  r=$(node scripts/run-sql.mjs "$f" 2>&1); echo "$r" | grep -q '"replay":false' || die "zh $(basename "$f"): $(echo "$r" | head -c 300)"
done
for f in $(ls "$D/zh"/*-replay.sql 2>/dev/null); do
  r=$(node scripts/run-sql.mjs "$f" 2>&1); echo "$r" | grep -q '"replay":true' || die "zh replay $(basename "$f"): $(echo "$r" | head -c 300)"
done
node scripts/run-sql.mjs --read-only -e "select count(*) cards, count(c.name_zh) zh, count(*) filter (where c.data_status = 'verified') verified, count(*) filter (where p.rarity_code is null) no_rarity from public.tcg_cards c join public.tcg_printings p on p.card_id = c.id where c.series_id = 'pokemon-official-ja-$(echo "$CODE" | tr 'A-Z' 'a-z')'"
