#!/bin/bash
# Usage: CARDSCOPE_WORK=<dir> bash scripts/import-pokemon-jp-series.sh <SET>
# Import one JP series from the pinned TCGdex archive, link TW (ADR 0003), promote status (ADR 0006). Stops on any surprise.
set -u
CODE=$1
cd "$(dirname "$0")/.."
SP="${CARDSCOPE_WORK:?set CARDSCOPE_WORK to a work folder holding cards-database/ (pinned archive checkout), existing-jp-rows.json and s-observed-at.txt}"
D="$SP/s-era/$CODE"; mkdir -p "$D"; ACTOR=${CARDSCOPE_ACTOR:-claude-code-local:aa26488931}
CODE_LC=$(echo "$CODE" | tr 'A-Z' 'a-z')
die() { echo "STOP $CODE: $*"; exit 1; }
node scripts/snapshot-pokemon-jp-from-tcgdex-archive.mjs "$SP/cards-database" --series "$CODE" --existing "$SP/existing-jp-rows.json" --observed-at "$(cat $SP/s-observed-at.txt)" > "$D/snapshot.json" || die snapshot
N=$(node -e "console.log(require('$D/snapshot.json').cards.length)")
if [ "$N" -le 100 ]; then
  node scripts/plan-pokemon-jp-import.mjs "$D/snapshot.json" --series "$CODE" > "$D/manifest.json" || die manifest
  node -e "const m=require('$D/manifest.json').summary;if(m.quarantinedCards||m.quarantinedSeries||m.jpPrintingSeedCollisions||m.hasMore)process.exit(1)" || die "manifest quarantine $(node -e "console.log(JSON.stringify(require('$D/manifest.json').summary))")"
  node scripts/build-pokemon-jp-import-plan.mjs "$D/manifest.json" > "$D/import-plan.json" || die plan
  node -e "const p=require('$D/import-plan.json');require('fs').writeFileSync('$D/batch-1.json',JSON.stringify(p))"
  BATCHES=1
else
  node scripts/build-pokemon-jp-import-batches.mjs "$D/snapshot.json" --series "$CODE" > "$D/batches.json" || die batches
  BATCHES=$(node -e "const b=require('$D/batches.json');b.forEach((p,i)=>require('fs').writeFileSync('$D/batch-'+(i+1)+'.json',JSON.stringify(p)));const p0=b[0];require('fs').writeFileSync('$D/import-plan.json',JSON.stringify({...p0,batch:undefined,cards:b.flatMap(x=>x.cards)}));console.log(b.length)")
fi
for i in $(seq 1 $BATCHES); do
  node scripts/emit-pokemon-jp-import-sql.mjs "$D/batch-$i.json" --actor $ACTOR --mode gated-import > "$D/import-$i.sql" 2>/dev/null || die "emit $i"
  r=$(node scripts/run-sql.mjs "$D/import-$i.sql" 2>&1); echo "$r" | grep -qE '"result":\{|"dry":\{[^}]*"replay":true' || die "import $i: $(echo "$r" | head -c 300)"
done
for i in $(seq 1 $BATCHES); do
  node scripts/emit-pokemon-jp-import-sql.mjs "$D/batch-$i.json" --actor $ACTOR --mode import > "$D/replay-$i.sql" 2>/dev/null
  r=$(node scripts/run-sql.mjs "$D/replay-$i.sql" 2>&1); echo "$r" | grep -q '"replay":true' || die "replay $i: $(echo "$r" | head -c 300)"
done
echo "$CODE imported $N cards in $BATCHES batch(es), replay ok"
node scripts/build-pokemon-jp-enrich-plan.mjs "$SP/cards-database" --series "$CODE" --jp-plan "$D/import-plan.json" > "$D/enrich-plan.json" || die enrich-plan
FP_TW=$(node -e "console.log(require('$D/enrich-plan.json').fingerprints.twCards)"); FP_JP=$(node -e "console.log(require('$D/enrich-plan.json').fingerprints.jpCards)"); TWN=$(node -e "console.log(require('$D/enrich-plan.json').fingerprints.twCardCount)")
DB_TW=$(node scripts/run-sql.mjs --read-only -e "select coalesce(md5(string_agg(concat_ws('|', id, provider_id, name_zh, canonical_id), E'\n' order by id collate \"C\")),'none') v, count(*) n from tcg_cards where series_id='pokemon-tcgdex-tw-$CODE_LC'" | node -e "const r=JSON.parse(require('fs').readFileSync(0))[0];console.log(r.v+' '+r.n)")
DB_JP=$(node scripts/run-sql.mjs --read-only -e "select md5(string_agg(concat_ws('|', id, provider_id, name_ja), E'\n' order by id collate \"C\")) v from tcg_cards where series_id='pokemon-tcgdex-ja-$CODE_LC'" | node -e "console.log(JSON.parse(require('fs').readFileSync(0))[0].v)")
echo "$CODE fingerprints tw plan=$FP_TW/$TWN db=$DB_TW jp plan=$FP_JP db=$DB_JP; summary $(node -e "console.log(JSON.stringify(require('$D/enrich-plan.json').summary))")"
[ "$FP_JP" = "$DB_JP" ] || die "jp fingerprint mismatch"
if [ "$TWN" != "0" ]; then [ "$FP_TW $TWN" = "$DB_TW" ] || die "tw fingerprint mismatch"; fi
node -e "process.exit(require('$D/enrich-plan.json').plan.cards.length?0:1)" || { echo "$CODE nothing to enrich"; exit 0; }
node scripts/emit-pokemon-jp-enrich-sql.mjs "$D/enrich-plan.json" "$D/enrich" --actor $ACTOR > /dev/null || die enrich-emit
for f in $(ls "$D/enrich"/enrich-*.sql | grep -v replay); do r=$(node scripts/run-sql.mjs "$f" 2>&1); echo "$r" | grep -q '"result":{' || die "enrich $(basename $f): $(echo "$r" | head -c 300)"; done
for f in "$D/enrich"/*-replay.sql; do r=$(node scripts/run-sql.mjs "$f" 2>&1); echo "$r" | grep -q '"replay":true' || die "enrich replay $(basename $f): $(echo "$r" | head -c 300)"; done
for k in $(seq 1 10); do r=$(node scripts/run-sql.mjs -e "select private.promote_pokemon_jp_data_status('$CODE','$ACTOR',false) v"); echo "$r" | grep -q '"promoted":0' && break; done
node scripts/run-sql.mjs --read-only -e "select count(*) cards, count(name_zh) zh, count(*) filter (where data_status='verified') verified from tcg_cards where series_id='pokemon-tcgdex-ja-$CODE_LC'"
