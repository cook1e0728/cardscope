import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

let port,server;

// fetch refuses the Fetch standard's "bad ports", which the OS may hand out; ask again until the port is usable.
const FETCH_BAD_PORTS=new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
async function freePort(){
  for(;;){
    const probe=createServer();
    const free=await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>resolve(probe.address().port))});
    await new Promise(resolve=>probe.close(resolve));
    if(!FETCH_BAD_PORTS.has(free))return free;
  }
}

test.before(async()=>{
  port=await freePort();
  server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),SUPABASE_URL:'',SUPABASE_SERVICE_KEY:''},stdio:['ignore','pipe','pipe']});
  let stderr='';server.stderr.on('data',chunk=>{stderr+=String(chunk)});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`server start timeout: ${stderr}`)),5000);server.once('error',reject);server.stdout.on('data',chunk=>{if(String(chunk).includes('CardScope is running')){clearTimeout(timer);resolve()}})});
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
  for(const gameId of ['pokemon','onepiece','yugioh','haikyuu','weiss-schwarz','dragonball-fw']){
    const game=body.data.games[gameId];
    assert.ok(game,`${gameId} coverage is missing`);
    assert.ok(game.baseline,`${gameId} baseline status is missing`);
    assert.equal(game.baseline.value,null);
    assert.equal(typeof game.cards,'number');
    for(const field of ['cards','images','chineseNames','rarity','printings','versions']){
      assert.ok(game.coverage[field],`${gameId}.${field} coverage is missing`);
      assert.ok(Object.hasOwn(game.coverage[field],'denominator'),`${gameId}.${field} denominator is missing`);
      assert.ok(Object.hasOwn(game.coverage[field],'status'),`${gameId}.${field} status is missing`);
    }
    assert.ok(Object.hasOwn(game.coverage.sourceTimestamp,'status'));
    assert.ok(Object.hasOwn(game,'totalPrintings'));
  }
  assert.equal(body.data.baselineRegistry.status,'unknown');
  assert.equal(body.data.baselineRegistry.error,null);
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
  assert.equal(body.meta.disabled,true,'Yuyu-tei declined reuse: the trends section is switched off');
  assert.equal(body.meta.disabledReason,'source-denied');
});

test('trend source query has no silent 500-row cap',async()=>{
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  assert.match(source,/supabaseFetchAll\(`\/jp_buyback_prices\?\$\{params\}`,1000\)/);
  assert.match(source,/rowsScanned,totalMatchingRecords:rowsScanned/);
});
