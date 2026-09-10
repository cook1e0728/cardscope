import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';

const port=4198;
let server;

test.before(async()=>{
  server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),SUPABASE_URL:'',SUPABASE_SERVICE_KEY:''},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server start timeout')),5000);server.once('error',reject);server.stdout.on('data',chunk=>{if(String(chunk).includes('CardScope is running')){clearTimeout(timer);resolve()}})});
});

test.after(()=>server?.kill());

async function api(path){const response=await fetch(`http://127.0.0.1:${port}${path}`);return {response,body:await response.json()}}

test('public coverage reports explicit field denominators for all five IPs without a database',async()=>{
  const {response,body}=await api('/api/catalog/coverage');
  assert.equal(response.status,200);
  assert.equal(body.data.sample,true);
  assert.equal(body.data.scope.sample,true);
  assert.equal(body.data.complete,false);
  assert.equal(body.data.totalMatchingRecords,body.data.totalCards);
  assert.equal(body.data.expectedTotals.status,'unknown');
  assert.deepEqual(body.data.coveredGames.sort(),['onepiece','pokemon','yugioh']);
  assert.ok(Object.hasOwn(body.data,'freshness'));
  for(const gameId of ['pokemon','onepiece','yugioh','haikyuu','weiss-schwarz']){
    const game=body.data.games[gameId];
    assert.ok(game,`${gameId} coverage is missing`);
    assert.equal(typeof game.cards,'number');
    for(const field of ['cards','images','chineseNames','rarity','printings','versions']){
      assert.ok(game.coverage[field],`${gameId}.${field} coverage is missing`);
      assert.ok(Object.hasOwn(game.coverage[field],'denominator'),`${gameId}.${field} denominator is missing`);
      assert.ok(Object.hasOwn(game.coverage[field],'status'),`${gameId}.${field} status is missing`);
    }
    assert.ok(Object.hasOwn(game.coverage.sourceTimestamp,'status'));
    assert.ok(Object.hasOwn(game,'totalPrintings'));
  }
});

test('trends fallback discloses unavailable source scope and does not create a ranking',async()=>{
  const {response,body}=await api('/api/trends?limit=2');
  assert.equal(response.status,200);
  assert.deepEqual(body.data,[]);
  assert.equal(body.meta.priceType,'buyback');
  assert.equal(body.meta.scope.sample,false);
  assert.equal(body.meta.scope.complete,false);
  assert.equal(body.meta.scope.totalMatchingRecords,0);
  assert.equal(body.meta.totalMatchingRecords,0);
  assert.deepEqual(body.meta.scope.coveredGames,[]);
  assert.ok(Object.hasOwn(body.meta.scope,'freshness'));
  assert.match(body.meta.warning,/不代表全市場/);
});

test('trend source query has no silent 500-row cap',async()=>{
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  assert.match(source,/supabaseFetchAll\(`\/jp_buyback_prices\?\$\{params\}`,1000\)/);
  assert.match(source,/rowsScanned,totalMatchingRecords:rowsScanned/);
});
