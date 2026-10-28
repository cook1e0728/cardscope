import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// 2026-10-28 audit, server side: removed third-party proxy routes, bounded query parameters, and a coverage report that never caches a failed scan as zero.
const FETCH_BAD_PORTS=new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
async function freePort(){
  for(;;){
    const probe=createServer();
    await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve)});
    const {port}=probe.address();
    await new Promise(resolve=>probe.close(resolve));
    if(!FETCH_BAD_PORTS.has(port))return port;
  }
}
// A fresh server module per test (the caches are module state); the database, when given, is an in-process mock.
async function withServer(name,{database=null,env={}}={},run){
  const mock=database?createServer(database):null;
  if(mock)await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const keys=['PORT','CATALOG_SYNC_ON_START','CATALOG_WARM_ON_START','SUPABASE_URL','SUPABASE_SERVICE_KEY',...Object.keys(env)],previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  let app;
  try{
    Object.assign(process.env,{PORT:String(await freePort()),CATALOG_SYNC_ON_START:'false',CATALOG_WARM_ON_START:'false',...env});
    if(mock){process.env.SUPABASE_URL='http://127.0.0.1:'+mock.address().port;process.env.SUPABASE_SERVICE_KEY='test-key'}else{delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_KEY}
    ({server:app}=await import('../server.mjs?hardening-'+name));
    if(!app.listening)await new Promise(resolve=>app.once('listening',resolve));
    return await run('http://127.0.0.1:'+app.address().port);
  }finally{
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}
    if(app?.listening)await new Promise(resolve=>app.close(resolve));
    if(mock)await new Promise(resolve=>mock.close(resolve));
  }
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('third-party proxy routes, external search and report writes are gone',async()=>{
  await withServer('routes',{},async base=>{
    for(const path of ['/api/providers/justtcg/games','/api/providers/justtcg/sets?game=pokemon','/api/providers/justtcg/search?q=pikachu','/api/providers/ebay/search?q=pikachu','/api/providers/ygoprodeck/search?q=pikachu','/api/search/external?q=pikachu','/api/card-identities?q=pikachu']){
      assert.equal((await fetch(base+path)).status,404,path);
    }
    const post=await fetch(base+'/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardName:'x',platform:'其他',price:1})});
    assert.equal(post.status,404,'no unauthenticated write endpoint');
    const providers=(await (await fetch(base+'/api/providers')).json()).data;
    assert.equal('justtcg' in providers||'ebay' in providers,false);
  });
});

test('/api/cards rejects a malformed rarity and /api/search caps its offset',async()=>{
  await withServer('params',{},async base=>{
    for(const rarity of ['x'.repeat(65),'a%00b','a%0Ab'])assert.equal((await fetch(base+'/api/cards?game=pokemon&rarity='+rarity)).status,400,rarity);
    for(const rarity of ['SAR','Rare%20Holo',encodeURIComponent('超級稀有'),encodeURIComponent('UR（金）'),'all'])assert.equal((await fetch(base+'/api/cards?game=pokemon&limit=1&rarity='+rarity)).status,200,rarity);
    const search=await (await fetch(base+'/api/search?q=SAR&offset=99999999999')).json();
    assert.equal(search.meta.offset,200000);
  });
});

function coverageDatabase(state){
  const ok=(res,rows)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(rows))};
  return (req,res)=>{
    const url=new URL(req.url,'http://'+req.headers.host);
    if(url.pathname!=='/rest/v1/tcg_cards')return ok(res,[]);
    const game=url.searchParams.get('game_id');
    state.cardRequests++;
    if(game==='eq.yugioh'&&state.failYugioh){res.writeHead(500,{'Content-Type':'application/json'});return res.end('{"message":"timeout"}')}
    if(game==='eq.pokemon')return ok(res,Array.from({length:state.pokemonCards||1},(_,index)=>({id:'pokemon-'+String(index).padStart(3,'0'),game:'pokemon',nameZh:'測試',rarity:'UR',providerId:'dup-'+(index%25)})));
    if(game==='eq.yugioh')return ok(res,[{id:'yugioh-1',game:'yugioh',nameZh:'測試',providerId:'ygo-1'}]);
    return ok(res,[]);
  };
}

test('coverage: a failed or timed-out game is unknown (null), not zero, and the failed report is not cached',async()=>{
  const state={failYugioh:true,cardRequests:0};
  await withServer('degraded',{database:coverageDatabase(state)},async base=>{
    const first=(await (await fetch(base+'/api/catalog/coverage')).json()).data;
    assert.equal(first.complete,false);
    assert.equal(first.metricStatus.cards,'partial');
    assert.equal(first.games.yugioh.cards,null);
    assert.equal(first.games.yugioh.metricStatus.cards,'unknown');
    assert.equal(first.games.pokemon.cards,1);
    assert.equal(first.errors.cards.yugioh.length>0,true);
    assert.equal(first.cache.status,'degraded');
    const requests=state.cardRequests;
    state.failYugioh=false;
    const second=(await (await fetch(base+'/api/catalog/coverage')).json()).data;
    assert.equal(second.cache.status,'degraded','one retry window: no new full scan while the previous one just failed');
    assert.equal(state.cardRequests,requests);
  });
});

test('coverage: after a good report, a failing refresh keeps serving the last good values',async()=>{
  const state={failYugioh:false,cardRequests:0};
  await withServer('stale',{database:coverageDatabase(state),env:{CATALOG_SNAPSHOT_CACHE_MS:'1000'}},async base=>{
    const good=(await (await fetch(base+'/api/catalog/coverage')).json()).data;
    assert.equal(good.complete,true);
    assert.equal(good.games.yugioh.cards,1);
    await sleep(1100);
    state.failYugioh=true;
    const stale=(await (await fetch(base+'/api/catalog/coverage')).json()).data;
    assert.equal(stale.games.yugioh.cards,1);
    assert.equal(stale.cache.stale,true);
    const before=state.cardRequests;
    await sleep(400);
    assert.ok(state.cardRequests>before,'the background refresh ran (and failed)');
    const after=(await (await fetch(base+'/api/catalog/coverage')).json()).data;
    assert.equal(after.complete,true,'the failed refresh never replaced the last good report');
    assert.equal(after.games.yugioh.cards,1);
  });
});

test('coverage: the public report carries counts, not the provider id list',async()=>{
  const state={failYugioh:false,cardRequests:0,pokemonCards:50};
  await withServer('slim',{database:coverageDatabase(state)},async base=>{
    const game=(await (await fetch(base+'/api/catalog/coverage')).json()).data.games.pokemon;
    assert.equal(game.cards,50);
    assert.equal('sources' in game,false);
    assert.equal(game.sourceCount>=25,true);
    assert.equal(game.linkAudit.duplicateProviderKeyCount,25);
    assert.equal(game.linkAudit.duplicateProviderKeys.length,20);
    for(const field of ['chineseNames','rarities','displayableImages','coverage','fields','metricStatus','baseline','linkAudit'])assert.ok(field in game,field);
  });
});
