import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [server,workflow]=await Promise.all([
  readFile(new URL('../server.mjs',import.meta.url),'utf8'),
  readFile(new URL('../.github/workflows/background-jobs.yml',import.meta.url),'utf8')
]);

test('the catalog freshness check repeats while the instance stays up',()=>{
  assert.match(server,/setTimeout\(runScheduledCatalogSync,process\.env\.CATALOG_WARM_ON_START!=='false'\?45000:3000\)/,'the first look waits for the heavy warm-ups');
  assert.match(server,/if\(startup\)\{await Promise\.allSettled\(\[sitemapWarm,coverageWarm\]\);/,'the first sync never peaks together with the sitemap and coverage warm-ups');
  assert.match(server,/await closeInterruptedCatalogRuns\(supabaseFetch,bootedAt\)\.catch\(/,'first scheduled sync closes runs a restart interrupted, so they do not block for 6 hours');
  assert.match(server,/CATALOG_SYNC_INTERVAL_MINUTES\?\?60/);
  assert.match(server,/setInterval\(runScheduledCatalogSync,intervalMinutes\*60000\)\.unref\(\)/);
  assert.match(server,/if\(syncRunning\)return;/,'runs never overlap');
  assert.match(server,/\(startup&&cacheSetting==='true'\)/,'a forced image cache only runs at start-up');
});

test('background jobs left Render: one GitHub Actions workflow schedules every job the server used to run on timers',()=>{
  for(const [cron,job] of [['40 * * * *','catalog-sync'],['5 */6 * * *','price-snapshot'],['20 19 * * *','price-archive'],['50 18 * * *','tcgapi-pricing']]){
    assert.ok(workflow.includes(`- cron: '${cron}'`),cron);
    assert.ok(workflow.includes(`'${cron}') job=${job} ;;`),job);
  }
  assert.match(workflow,/group: background-\$\{\{ startsWith\(needs\.pick\.outputs\.job, 'price-'\) && 'price'/,'snapshot and archive never run together');
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/timeout-minutes: 350/);
  assert.match(workflow,/--budget-minutes=330/,'the snapshot stops well before the 6-hour job limit');
  assert.doesNotMatch(workflow,/onrender\.com/);
});

test('One Piece writes each shared card once, Traditional Chinese row first',async()=>{
  const sync=await readFile(new URL('../providers/catalog-sync.mjs',import.meta.url),'utf8');
  const body=sync.slice(sync.indexOf('async function syncOnePiece'),sync.indexOf('\n}',sync.indexOf('async function syncOnePiece')));
  const tw=body.indexOf("upsert(db,'/tcg_cards',twCardRows)"),english=body.indexOf("upsert(db,'/tcg_cards',cardRows.filter(card=>!twCardIds.has(card.id)))"),printings=body.indexOf("upsert(db,'/tcg_printings',printingRows");
  assert.ok(tw>0&&english>tw&&printings>english,'English-only cards and their printings are written after the Traditional Chinese cards');
  assert.equal(body.split("upsert(db,'/tcg_cards',").length-1,2,'no unfiltered English card upsert remains');
  assert.match(body,/ONEPIECE_PAGE_DELAY_MS|politePause\(\)/);
});
