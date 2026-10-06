import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [server,workflow]=await Promise.all([
  readFile(new URL('../server.mjs',import.meta.url),'utf8'),
  readFile(new URL('../.github/workflows/keep-warm.yml',import.meta.url),'utf8')
]);

test('the catalog freshness check repeats while the instance stays up',()=>{
  assert.match(server,/setTimeout\(runScheduledCatalogSync,3000\)/);
  assert.match(server,/CATALOG_SYNC_INTERVAL_MINUTES\?\?60/);
  assert.match(server,/setInterval\(runScheduledCatalogSync,intervalMinutes\*60000\)\.unref\(\)/);
  assert.match(server,/if\(syncRunning\)return;/,'runs never overlap');
  assert.match(server,/\(startup&&cacheSetting==='true'\)/,'a forced image cache only runs at start-up');
});

test('production is pinged often enough to stay inside the 15-minute sleep window',()=>{
  assert.match(workflow,/cron: '\*\/10 \* \* \* \*'/);
  assert.match(workflow,/https:\/\/cardscope\.onrender\.com\/\)/);
  assert.doesNotMatch(workflow.match(/^.*curl .*$/m)[0],/\/api\//,'the ping must not trigger database work');
});

test('One Piece writes each shared card once, Traditional Chinese row first',async()=>{
  const sync=await readFile(new URL('../providers/catalog-sync.mjs',import.meta.url),'utf8');
  const body=sync.slice(sync.indexOf('async function syncOnePiece'),sync.indexOf('\n}',sync.indexOf('async function syncOnePiece')));
  const tw=body.indexOf("upsert(db,'/tcg_cards',twCardRows)"),english=body.indexOf("upsert(db,'/tcg_cards',cardRows.filter(card=>!twCardIds.has(card.id)))"),printings=body.indexOf("upsert(db,'/tcg_printings',printingRows");
  assert.ok(tw>0&&english>tw&&printings>english,'English-only cards and their printings are written after the Traditional Chinese cards');
  assert.equal(body.split("upsert(db,'/tcg_cards',").length-1,2,'no unfiltered English card upsert remains');
  assert.match(body,/ONEPIECE_PAGE_DELAY_MS|politePause\(\)/);
});
