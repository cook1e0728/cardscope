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

test('database errors reach the log, not the response: a generic message or a code',async()=>{
  const database=(req,res)=>{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"message":"relation secret_table column secret_col does not exist"}')};
  await withServer('leak',{database},async base=>{
    for(const path of ['/api/catalog/sync-status','/api/catalog/image-status']){
      const response=await fetch(base+path),text=await response.text();
      assert.equal(response.status,502,path);
      assert.equal(JSON.parse(text).error,'資料暫時無法讀取',path);
      assert.equal(/secret|SUPABASE/i.test(text),false,path);
    }
    const catalog=await (await fetch(base+'/api/catalog')).json();
    assert.equal(catalog.meta.fallbackReason,'UPSTREAM_UNAVAILABLE');
    assert.equal(/secret|SUPABASE/i.test(JSON.stringify(catalog.meta)+catalog.data.fallbackReason),false);
  });
});

test('/api/jp-prices and /api/portfolio are gone; unknown paths are a 404 page, /api/ stays JSON',async()=>{
  await withServer('gone',{},async base=>{
    for(const path of ['/api/jp-prices?cardName=pikachu','/api/portfolio'])assert.equal((await fetch(base+path)).status,404,path);
    const page=await fetch(base+'/nonexistent');
    assert.equal(page.status,404);
    assert.match(page.headers.get('content-type'),/^text\/html/);
    assert.match(await page.text(),/href="\/"/);
    assert.match((await fetch(base+'/api/nonexistent')).headers.get('content-type'),/^application\/json/);
  });
});

test('CSP img-src lets the Fusion World card images (hotlinked from www.dbs-cardgame.com) load',async()=>{
  await withServer('csp',{},async base=>{
    const csp=(await fetch(base+'/')).headers.get('content-security-policy');
    assert.ok(/img-src [^;]*https:\/\/www\.dbs-cardgame\.com(?:[ ;]|$)/.test(csp), csp);
  });
});

test('CSP img-src lets the Japanese Yu-Gi-Oh! card images (hotlinked from www.db.yugioh-card.com) load',async()=>{
  await withServer('csp-ygo-jp',{},async base=>{
    const csp=(await fetch(base+'/')).headers.get('content-security-policy');
    assert.ok(/img-src [^;]*https:\/\/www\.db\.yugioh-card\.com(?:[ ;]|$)/.test(csp), csp);
  });
});

test('a query of only symbols finds nothing instead of listing sample cards',async()=>{
  await withServer('symbols',{},async base=>{
    for(const q of ['.','_','%25','..%20_%20','%EF%BC%8E'])assert.equal((await (await fetch(base+'/api/search?q='+q)).json()).data.length,0,q);
    const response=await fetch(base+'/api/search?q=.'),body=await response.json();
    assert.deepEqual([response.status,body.data,body.meta.total,body.meta.hasMore,body.meta.hint.kind],[200,[],0,false,'symbols-only']);
    assert.equal((await (await fetch(base+'/api/search?q=%E7%9A%AE%E5%8D%A1%E4%B8%98')).json()).meta.hint,undefined);
  });
});

test('card list, search and detail answers can be cached for a minute; errors and prices cannot',async()=>{
  await withServer('cache',{},async base=>{
    const cacheable=/^public, max-age=60, stale-while-revalidate=300$/;
    assert.match((await fetch(base+'/api/cards?game=pokemon&limit=2')).headers.get('cache-control'),cacheable);
    assert.equal((await fetch(base+'/api/cards?game=bogus')).headers.get('cache-control'),'no-store');
    assert.match((await fetch(base+'/api/search?q=SAR')).headers.get('cache-control'),cacheable);
    const list=(await (await fetch(base+'/api/cards?game=pokemon&limit=1')).json()).data;
    const detail=await fetch(base+'/api/cards/'+encodeURIComponent(list[0].id));
    assert.match(detail.headers.get('cache-control'),cacheable);
    assert.equal((await fetch(base+'/api/cards/no-such-card')).headers.get('cache-control'),'no-store');
    assert.equal((await fetch(base+'/api/cards/'+encodeURIComponent(list[0].id)+'/price-history')).headers.get('cache-control'),'no-store');
  });
});

test('public API is limited per Cloudflare client IP, falls back to the socket address without the header, and exempts only admin requests',async()=>{
  await withServer('limit',{env:{API_RATE_LIMIT_PER_MINUTE:'2',SCRAPE_SECRET:'admin-secret'}},async base=>{
    const hit=(path,headers={})=>fetch(base+path,{headers}).then(res=>res.status),cf=(ip,extra={})=>({'cf-connecting-ip':ip,...extra});
    // header present: one counter per client IP
    assert.deepEqual([await hit('/api/catalog/sources',cf('198.51.100.1')),await hit('/api/catalog/sources',cf('198.51.100.1'))],[200,200]);
    assert.equal(await hit('/api/catalog/sources',cf('198.51.100.1')),429);
    assert.equal(await hit('/api/catalog/sources',cf('198.51.100.2')),200);
    // health is limited like every other API route (it used to be exempt)
    assert.equal(await hit('/api/catalog/health',cf('198.51.100.1')),429);
    // admin key: never limited
    for(let i=0;i<4;i++)assert.equal(await hit('/api/catalog/sources',cf('198.51.100.1',{'x-scrape-token':'admin-secret'})),200);
    assert.equal(await hit('/api/catalog/sources',cf('198.51.100.1',{'x-scrape-token':'wrong'})),429,'a wrong key is not admin');
    // header absent: counted by the TCP peer address, and a spoofed X-Forwarded-For does not help
    assert.deepEqual([await hit('/api/catalog/sources'),await hit('/api/catalog/sources',{'x-forwarded-for':'203.0.113.9'})],[200,200]);
    assert.equal(await hit('/api/catalog/sources',{'x-forwarded-for':'203.0.113.10'}),429);
    assert.equal(await hit('/api/catalog/health'),429);
    assert.equal(await hit('/api/catalog/sources',{'x-scrape-token':'admin-secret'}),200);
    // non-API pages are never limited
    assert.equal(await hit('/'),200);
  });
});

test('every response carries Permissions-Policy (sensors left to the site) and COOP; API answers carry CSP default-src none',async()=>{
  await withServer('headers',{},async base=>{
    for(const path of ['/','/robots.txt','/.well-known/security.txt','/no-such-file','/api/providers','/api/images/onepiece','/api/no-such-route']){
      const res=await fetch(base+path),policy=res.headers.get('permissions-policy');
      assert.equal(policy,'camera=(), microphone=(), geolocation=(), gyroscope=(self), accelerometer=(self)',path);
      assert.equal(res.headers.get('cross-origin-opener-policy'),'same-origin',path);
      const csp=res.headers.get('content-security-policy');
      assert.equal(path.startsWith('/api/')?csp==="default-src 'none'":csp.includes("script-src 'self'"),true,path+' '+csp);
    }
  });
});

test('/.well-known/security.txt is plain text with the contact mailbox, a year-out expiry and the languages',async()=>{
  await withServer('security-txt',{env:{PUBLIC_BASE_URL:'https://example.test'}},async base=>{
    const res=await fetch(base+'/.well-known/security.txt'),body=await res.text();
    assert.equal(res.status,200);
    assert.match(res.headers.get('content-type'),/^text\/plain/);
    assert.match(body,/^Contact: mailto:contact@cardseektcg.com$/m);
    assert.match(body,/^Preferred-Languages: zh-TW, en$/m);
    assert.doesNotMatch(body,/placeholder/i);
    const expires=Date.parse(body.match(/^Expires: (.+)$/m)[1]);
    assert.ok(expires>Date.now()+360*86400000&&expires<Date.now()+370*86400000);
    assert.equal((await fetch(base+'/.well-known/security.txt',{method:'HEAD'})).status,200);
    assert.equal((await fetch(base+'/.well-known/other')).status,404);
  });
});

test('/api/graded-prices: an upstream failure is a generic 502 with no upstream text, and bad identifiers never reach the upstream',async()=>{
  // The server takes global fetch at import, so wrap it first: the price provider and the FX source answer here, everything else (the test's own requests) passes through.
  const realFetch=globalThis.fetch,seen=[];
  globalThis.fetch=(input,init)=>{const target=String(input?.url||input);if(target.startsWith('https://www.pokemonpricetracker.com/')){seen.push(target);return Promise.resolve(new Response('{"error":"upstream secret detail","key":"leaky-key"}',{status:500}))}if(target.startsWith('https://open.er-api.com/'))return Promise.resolve(new Response('{}',{status:503}));return realFetch(input,init)};
  try{
    await withServer('graded-leak',{env:{POKEMONPRICETRACKER_API_KEY:'leaky-key'}},async base=>{
      const response=await fetch(base+'/api/graded-prices?set=SV2a&number=201'),text=await response.text();
      assert.equal(response.status,502);
      assert.equal(JSON.parse(text).error,'資料暫時無法讀取');
      assert.equal(/secret|leaky|GRADED_|pokemonpricetracker/i.test(text),false,text);
      assert.equal(seen.length,1);
      const rejected=await (await fetch(base+'/api/graded-prices?set=%3Cimg%3E&number=1%2F2')).json();
      assert.equal(rejected.data.status,'unsupported');
      assert.equal(seen.length,1,'an identifier that fails the whitelist makes no upstream request');
    });
  }finally{globalThis.fetch=realFetch}
});

test('admin scrape route refuses GET, and a wrong token gets 401',async()=>{
  await withServer('admin',{env:{SCRAPE_SECRET:'admin-secret'}},async base=>{
    assert.equal((await fetch(base+'/api/admin/scrape/yuyutei',{headers:{'x-scrape-token':'admin-secret'}})).status,404);
    assert.equal((await fetch(base+'/api/admin/scrape/yuyutei',{method:'POST',headers:{'x-scrape-token':'wrong'}})).status,401);
  });
});

test('legacy onrender host 301s to the canonical domain only when CANONICAL_REDIRECT is on',async()=>{
  const {request}=await import('node:http');
  const get=(base,host,path)=>new Promise((resolve,reject)=>{const u=new URL(base);request({host:u.hostname,port:u.port,path,headers:{host}},res=>{res.resume();resolve({status:res.statusCode,location:res.headers.location})}).on('error',reject).end()});
  await withServer('redirect-on',{env:{CANONICAL_REDIRECT:'true',PUBLIC_BASE_URL:'https://cardseektcg.com'}},async base=>{
    assert.deepEqual(await get(base,'cardscope.onrender.com','/?game=pokemon&card=a'),{status:301,location:'https://cardseektcg.com/?game=pokemon&card=a'});
    assert.equal((await get(base,'cardseektcg.com','/robots.txt')).status,200);
  });
  await withServer('redirect-off',{env:{CANONICAL_REDIRECT:'false'}},async base=>{
    assert.equal((await get(base,'cardscope.onrender.com','/robots.txt')).status,200);
  });
});

test('ORIGIN_VERIFY_SECRET guards cf-connecting-ip against spoofing',async()=>{
  await withServer('origin-verify',{env:{API_RATE_LIMIT_PER_MINUTE:'2',ORIGIN_VERIFY_SECRET:'edge-shared-secret'}},async base=>{
    const hit=(headers={})=>fetch(base+'/api/catalog/sources',{headers}).then(res=>res.status);
    // Without x-origin-verify (or with wrong value), rotating cf-connecting-ip falls back to socket remoteAddress and still hits 429.
    assert.equal(await hit({'cf-connecting-ip':'198.51.100.1'}),200);
    assert.equal(await hit({'cf-connecting-ip':'198.51.100.2','x-origin-verify':'wrong-secret'}),200);
    assert.equal(await hit({'cf-connecting-ip':'198.51.100.3'}),429);
    // With matching x-origin-verify, cf-connecting-ip is trusted per client IP.
    assert.equal(await hit({'cf-connecting-ip':'198.51.100.10','x-origin-verify':'edge-shared-secret'}),200);
    assert.equal(await hit({'cf-connecting-ip':'198.51.100.10','x-origin-verify':'edge-shared-secret'}),200);
    assert.equal(await hit({'cf-connecting-ip':'198.51.100.10','x-origin-verify':'edge-shared-secret'}),429);
    assert.equal(await hit({'cf-connecting-ip':'198.51.100.11','x-origin-verify':'edge-shared-secret'}),200);
  });
});

test('/api/catalog/health hides v2 RPC error text and stale snapshot errors behind safe fixed strings',async()=>{
  let failBoth=false;
  const database=(req,res)=>{
    const url=new URL(req.url,'http://'+req.headers.host);
    res.setHeader('Content-Type','application/json');
    if(url.pathname==='/rest/v1/rpc/catalog_health_snapshot_v2'){
      res.writeHead(500);
      return res.end('{"message":"SUPABASE_SECRET_TABLE_LEAK"}');
    }
    if(url.pathname==='/rest/v1/rpc/catalog_health_snapshot'){
      if(failBoth){res.writeHead(500);return res.end('{"message":"LEGACY_SECRET_LEAK"}')}
      res.writeHead(200);
      return res.end(JSON.stringify({totals:{cards:1},metricStatus:{}}));
    }
    res.writeHead(200);res.end('[]');
  };
  await withServer('health-sanitize',{database,env:{CATALOG_SNAPSHOT_CACHE_MS:'1000'}},async base=>{
    const first=await (await fetch(base+'/api/catalog/health')).json();
    assert.equal(first.data.healthCompatibilityWarning,'v2 snapshot unavailable');
    assert.equal(/SUPABASE_SECRET_TABLE_LEAK/i.test(JSON.stringify(first)),false);
    await sleep(1100);
    failBoth=true;
    const stale=await (await fetch(base+'/api/catalog/health')).json();
    assert.equal(stale.data.cache.stale,true);
    assert.equal(/SECRET_LEAK/i.test(JSON.stringify(stale)),false);
    // Let the stale-while-revalidate background refresh finish before closing the mock DB.
    await sleep(200);
  });
});

test('SEO card/series routes validate IDs against whitelist and enforce per-IP rate limiting while / stays unlimited',async()=>{
  const seen=[];
  const database=(req,res)=>{
    const url=new URL(req.url,'http://'+req.headers.host);
    seen.push(url.pathname+url.search);
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(url.pathname.endsWith('get_card_detail')?JSON.stringify({cards:[],series:[],games:[]}):'[]');
  };
  await withServer('seo-guard',{database,env:{SEO_RATE_LIMIT_PER_MINUTE:'2'}},async base=>{
    const mod=await import('../server.mjs?hardening-seo-guard');
    assert.deepEqual(mod.seoRequestTarget(new URL('https://x/?card=weiss-sfn/s108-001:sp.1_a')),{kind:'card',id:'weiss-sfn/s108-001:sp.1_a'});
    for(const bad of ['bad id','a"b','a<script>','a;drop','x'.repeat(129)])assert.equal(mod.seoRequestTarget(new URL('https://x/?card='+encodeURIComponent(bad))),null,bad);
    // Invalid SEO ID never queries Supabase.
    const invalidRes=await fetch(base+'/?card='+encodeURIComponent('bad id;drop'),{headers:{'cf-connecting-ip':'198.51.100.20'}});
    assert.equal(invalidRes.status,200);
    assert.equal(seen.length,0,'invalid SEO ID must not trigger database lookup');
    // Valid SEO requests are rate limited at SEO_RATE_LIMIT_PER_MINUTE (2/min); plain / is not limited.
    assert.equal((await fetch(base+'/?card=pokemon-a',{headers:{'cf-connecting-ip':'198.51.100.21'}})).status,404);
    assert.equal((await fetch(base+'/?series=pokemon-s1',{headers:{'cf-connecting-ip':'198.51.100.21'}})).status,404);
    assert.equal((await fetch(base+'/?card=pokemon-b',{headers:{'cf-connecting-ip':'198.51.100.21'}})).status,429);
    assert.equal((await fetch(base+'/',{headers:{'cf-connecting-ip':'198.51.100.21'}})).status,200,'plain home page stays unlimited');
  });
});

test('/api/graded-prices and /api/ebay-listings enforce dedicated per-IP rate limits',async()=>{
  await withServer('price-limits',{env:{API_RATE_LIMIT_PER_MINUTE:'20',GRADED_RATE_LIMIT_PER_MINUTE:'2',EBAY_RATE_LIMIT_PER_MINUTE:'2'}},async base=>{
    const ip={'cf-connecting-ip':'198.51.100.30'};
    assert.equal((await fetch(base+'/api/graded-prices?set=SV2a&number=1',{headers:ip})).status,200);
    assert.equal((await fetch(base+'/api/graded-prices?set=SV2a&number=2',{headers:ip})).status,200);
    assert.equal((await fetch(base+'/api/graded-prices?set=SV2a&number=3',{headers:ip})).status,429);
    assert.equal((await fetch(base+'/api/ebay-listings?name=Pikachu&number=1',{headers:ip})).status,200);
    assert.equal((await fetch(base+'/api/ebay-listings?name=Pikachu&number=2',{headers:ip})).status,200);
    assert.equal((await fetch(base+'/api/ebay-listings?name=Pikachu&number=3',{headers:ip})).status,429);
    assert.equal((await fetch(base+'/api/providers',{headers:ip})).status,200,'other API routes still have their own quota');
  });
});

test('/api/sync pull/delete cap body at 1024 B and Google push verifies token before reading large bodies',async()=>{
  let authCalls=0,dbCalls=0;
  const mockIp2=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock');
    if(url.pathname==='/auth/v1/user'){authCalls++;res.writeHead(401,{'Content-Type':'application/json'});return res.end('{"msg":"invalid"}')}
    dbCalls++;res.writeHead(200,{'Content-Type':'application/json'});res.end('[]');
  });
  await new Promise(resolve=>mockIp2.listen(0,'127.0.0.1',resolve));
  const ip2Url='http://127.0.0.1:'+mockIp2.address().port;
  try{
    await withServer('sync-hardening',{env:{SUPABASE2_URL:ip2Url,SUPABASE2_SERVICE_KEY:'svc',SUPABASE2_ANON_KEY:'anon',SYNC_RATE_LIMIT_PER_MINUTE:'50'}},async base=>{
      const over1k=JSON.stringify({code:'K3M9T7Q2XB4V8ZD6N1HW5RPJ0C',pad:'x'.repeat(1100)});
      for(const action of ['pull','delete']){
        const r=await fetch(base+'/api/sync/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:over1k}).catch(()=>({status:413}));
        assert.equal(r.status,413,action+' rejects >1024 B body');
      }
      // Large Google push with invalid Bearer rejects with 401 via auth pre-check without parsing huge invalid JSON body.
      const badBig='{'+' '.repeat(8192)+'not-json';
      const preAuth=await fetch(base+'/api/sync/push',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer invalid.jwt.token'},body:badBig});
      assert.equal(preAuth.status,401,'Google push rejects invalid token before parsing >4 KB body');
      assert.equal(authCalls,1);
      assert.equal(dbCalls,0);
    });
  }finally{await new Promise(resolve=>mockIp2.close(resolve))}
});

test('query parameter boundaries: /api/search region, /api/reports limits, /api/cards/:id length and PostgREST escaping',async()=>{
  const seen={reports:[],cards:[]};
  const database=(req,res)=>{
    const url=new URL(req.url,'http://'+req.headers.host);
    if(url.pathname==='/rest/v1/reports')seen.reports.push(url.searchParams.toString());
    if(url.pathname==='/rest/v1/rpc/get_card_detail'){res.writeHead(404,{'Content-Type':'application/json'});return res.end('{"code":"PGRST202"}')}
    if(url.pathname==='/rest/v1/tcg_cards'&&url.searchParams.has('or'))seen.cards.push(url.searchParams.get('or'));
    res.writeHead(200,{'Content-Type':'application/json'});res.end('[]');
  };
  await withServer('query-bounds',{database},async base=>{
    assert.equal((await fetch(base+'/api/search?q=pikachu&region=INVALID')).status,400);
    assert.equal((await fetch(base+'/api/search?q=pikachu&region=jp')).status,200);
    assert.equal((await fetch(base+'/api/cards?game=pokemon&series='+'s'.repeat(129))).status,400);
    assert.equal((await fetch(base+'/api/cards/'+'a'.repeat(129))).status,400);
    assert.equal((await fetch(base+'/api/cards/'+'a'.repeat(129)+'/market')).status,400);
    assert.equal((await fetch(base+'/api/cards/'+'a'.repeat(129)+'/price-history')).status,400);
    assert.equal((await fetch(base+'/api/reports?cardId='+'c'.repeat(129))).status,400);
    assert.equal((await fetch(base+'/api/reports?cardName='+'n'.repeat(101))).status,400);
    assert.equal((await fetch(base+'/api/reports?cardName=pikachu&game=bogus')).status,400);
    assert.equal((await fetch(base+'/api/reports?cardName=pikachu&limit=-5')).status,200);
    assert.ok(seen.reports.some(q=>q.includes('limit=1')&&q.includes('order=traded_at.desc')),'negative limit clamps to 1');
    assert.ok(seen.reports.some(q=>q.includes('select=currency%2Cprice')&&q.includes('limit=1000')),'stats query is bounded');
    // Fallback PostgREST or=(...) strips ", \, (, ), and ,
    assert.equal((await fetch(base+'/api/cards/'+encodeURIComponent('abc"def\\ghi(j),k'))).status,404);
    assert.equal(seen.cards.at(-1),'(id.eq.abcdefghijk,canonical_id.eq.abcdefghijk)');
  });
});

test('One Piece image proxy rejects port/credentials, blocks SVG MIME, and aborts streams exceeding 5 MB',async()=>{
  const realFetch=globalThis.fetch;
  let mode='svg',chunksRead=0;
  globalThis.fetch=(input,init)=>{
    const target=String(input?.url||input);
    if(target.startsWith('https://asia-tc.onepiece-cardgame.com/')){
      if(mode==='svg')return Promise.resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg"/>',{status:200,headers:{'content-type':'image/svg+xml'}}));
      if(mode==='png')return Promise.resolve(new Response(Buffer.from([0x89,0x50,0x4e,0x47]),{status:200,headers:{'content-type':'image/png'}}));
      if(mode==='huge'){
        const stream=new ReadableStream({pull(controller){chunksRead++;controller.enqueue(new Uint8Array(1024*1024))}});
        return Promise.resolve(new Response(stream,{status:200,headers:{'content-type':'image/png'}}));
      }
    }
    return realFetch(input,init);
  };
  try{
    await withServer('op-image',{},async base=>{
      const mod=await import('../server.mjs?hardening-op-image');
      assert.equal(mod.onePieceImageTarget('https://asia-tc.onepiece-cardgame.com:8443/images/cardlist/card/OP01-001.png'),null);
      assert.equal(mod.onePieceImageTarget('https://user@asia-tc.onepiece-cardgame.com/images/cardlist/card/OP01-001.png'),null);
      assert.equal(mod.onePieceImageTarget('https://user:pass@asia-tc.onepiece-cardgame.com/images/cardlist/card/OP01-001.png'),null);
      assert.ok(mod.onePieceImageTarget('https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP01-001.png'));
      const validUrl='https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP01-001.png';
      assert.equal((await fetch(base+'/api/images/onepiece?url='+encodeURIComponent('https://asia-tc.onepiece-cardgame.com:8443/images/cardlist/card/OP01-001.png'))).status,400);
      mode='svg';
      assert.equal((await fetch(base+'/api/images/onepiece?url='+encodeURIComponent(validUrl))).status,502,'SVG MIME is rejected');
      mode='png';
      const ok=await fetch(base+'/api/images/onepiece?url='+encodeURIComponent(validUrl));
      assert.equal(ok.status,200);
      assert.equal(ok.headers.get('content-type'),'image/png');
      mode='huge';chunksRead=0;
      const huge=await fetch(base+'/api/images/onepiece?url='+encodeURIComponent(validUrl));
      assert.equal(huge.status,502,'stream exceeding 5 MB is aborted');
      assert.ok(chunksRead<=7,'aborted immediately after passing 5 MB');
    });
  }finally{globalThis.fetch=realFetch}
});

test('redactInflightSearch masks OAuth code parameters without mangling other query params',async()=>{
  await withServer('redact',{},async()=>{
    const mod=await import('../server.mjs?hardening-redact');
    assert.equal(mod.redactInflightSearch('?view=collection&code=secret-oauth-123&state=ok'),'?view=collection&code=[REDACTED]&state=ok');
    assert.equal(mod.redactInflightSearch('?CODE=topsecret'),'?CODE=[REDACTED]');
    assert.equal(mod.redactInflightSearch('?view=collection&decode=keepme'),'?view=collection&decode=keepme');
    assert.equal(mod.redactInflightSearch('?code=a&code=b'),'?code=[REDACTED]&code=[REDACTED]');
    assert.equal(mod.redactInflightSearch(''),'');
  });
});
