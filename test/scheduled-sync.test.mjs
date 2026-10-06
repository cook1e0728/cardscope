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
  assert.match(workflow,/https:\/\/cardscope\.onrender\.com\/api\/catalog\/health/);
});
