import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// F4 page-open counts and C3 database size, through the real server module with an in-process mock database.
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
async function withServer(name,{database=null,env={}}={},run){
  const mock=database?createServer(database):null;
  if(mock)await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const keys=['PORT','CATALOG_SYNC_ON_START','CATALOG_WARM_ON_START','SUPABASE_URL','SUPABASE_SERVICE_KEY','SCRAPE_SECRET','PAGE_STATS_FLUSH_MS',...Object.keys(env)],previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  let app;
  try{
    for(const key of ['SCRAPE_SECRET','PAGE_STATS_FLUSH_MS'])delete process.env[key];
    Object.assign(process.env,{PORT:String(await freePort()),CATALOG_SYNC_ON_START:'false',CATALOG_WARM_ON_START:'false',...env});
    if(mock){process.env.SUPABASE_URL='http://127.0.0.1:'+mock.address().port;process.env.SUPABASE_SERVICE_KEY='test-key'}else{delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_KEY}
    ({server:app}=await import('../server.mjs?page-stats-'+name));
    if(!app.listening)await new Promise(resolve=>app.once('listening',resolve));
    return await run('http://127.0.0.1:'+app.address().port);
  }finally{
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}
    if(app?.listening)await new Promise(resolve=>app.close(resolve));
    if(mock)await new Promise(resolve=>mock.close(resolve));
  }
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const BROWSER='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const page=(base,path,headers={})=>fetch(base+path,{headers:{'user-agent':BROWSER,...headers}}).then(async response=>{await response.arrayBuffer();return response});
const sumDays=pending=>Object.values(pending).reduce((total,row)=>{for(const [kind,count] of Object.entries(row))total[kind]=(total[kind]||0)+count;return total},{});

// Records every request; answers the routes the page-stats and health code use and [] for everything else.
function mockDatabase(state={}){
  state.requests=[];
  return (req,res)=>{
    const url=new URL(req.url,'http://'+req.headers.host);
    let body='';
    req.on('data',chunk=>body+=chunk);
    req.on('end',()=>{
      state.requests.push({method:req.method,path:url.pathname,search:url.search,body});
      const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(typeof value==='string'?value:JSON.stringify(value))};
      if(url.pathname==='/rest/v1/rpc/page_stats_add'){if(state.rpcMissing)return reply(404,'{"message":"function not found"}');res.writeHead(204);return res.end()}
      if(url.pathname==='/rest/v1/rpc/get_card_detail')return reply(200,JSON.parse(body||'{}').p_id===HOT_CARD.id?{cards:[HOT_CARD],series:[],games:[{id:'pokemon',nameZh:'寶可夢'}]}:{cards:[],series:[],games:[]});
      if(url.pathname==='/rest/v1/rpc/card_hot_add'){if(state.hotMissing)return reply(404,'{"message":"function not found"}');res.writeHead(204);return res.end()}
      if(url.pathname==='/rest/v1/rpc/card_hot_top'){state.hotTopCalls=(state.hotTopCalls||0)+1;if(state.hotTopFails)return reply(500,'{"message":"secret db detail"}');return reply(200,state.hotRows||[])}
      if(url.pathname==='/rest/v1/card_hot_daily')return reply(200,state.hotDays||[]);
      if(url.pathname==='/rest/v1/rpc/db_size_report'){state.sizeCalls=(state.sizeCalls||0)+1;if(state.sizeFails)return reply(500,'{"message":"boom"}');return reply(200,{databaseBytes:state.databaseBytes,tables:state.tables||[]})}
      if(url.pathname==='/rest/v1/rpc/catalog_health_snapshot_v2')return reply(200,{totals:{cards:1}});
      if(url.pathname==='/rest/v1/page_stats_daily')return reply(200,state.rows||[]);
      return reply(200,[]);
    });
  };
}
const MB=1024*1024;
const HOT_CARD={id:'pokemon-hot-001',canonicalId:'pokemon-hot-001',game:'pokemon',seriesId:'pokemon-s1',officialCardNumber:'001',rarity:'C',nameZh:'熱門卡',nameJa:null,nameEn:'Hot card',nameKo:null,aliases:[],metadata:{},printings:[{id:'p-hot-001',cardId:'pokemon-hot-001',seriesId:'pokemon-s1',region:'JP',language:'ja-JP',localSetCode:'S1',localCardNumber:'001',rarity:'C',imageUrl:null,imageRehostRequired:false}],images:[]};

test('GET / is counted by kind; bots, HEAD and non-document fetches are handled as specified; 304 counts',async()=>{
  const state={};
  await withServer('kinds',{database:mockDatabase(state),env:{SCRAPE_SECRET:'admin-secret'}},async base=>{
    const first=await page(base,'/');
    const etag=first.headers.get('etag');
    assert.ok(etag);
    assert.equal((await page(base,'/',{'if-none-match':etag})).status,304,'a 304 is a real page open');
    await page(base,'/?game=pokemon&utm_source=private');
    await page(base,'/?series=sv2a');
    await page(base,'/?card=pokemon-sv2a-201');
    await page(base,'/?q=pikachu');
    await page(base,'/?view=privacy');
    await page(base,'/',{'user-agent':'Googlebot/2.1'});
    await page(base,'/?card=pokemon-sv2a-201',{'user-agent':'curl/8.4'});
    await fetch(base+'/',{method:'HEAD',headers:{'user-agent':BROWSER}});
    await page(base,'/',{'sec-fetch-dest':'empty'});
    await page(base,'/index.html');
    await page(base,'/api/catalog/health');
    const admin=await (await fetch(base+'/api/admin/page-stats',{headers:{authorization:'Bearer admin-secret'}})).json();
    assert.deepEqual(sumDays(admin.data.pending),{home:2,game:1,series:1,card:1,search:1,other:1,bot:2});
    const stored=JSON.stringify(admin);
    for(const secret of ['utm_source','private','pikachu','sv2a','Mozilla','Googlebot','curl','127.0.0.1'])assert.equal(stored.includes(secret),false,secret);
  });
});

test('counts are flushed through page_stats_add with totals only, and a missing function keeps the deltas for the next flush',async()=>{
  const state={rpcMissing:true};
  await withServer('flush',{database:mockDatabase(state),env:{PAGE_STATS_FLUSH_MS:'60',SCRAPE_SECRET:'admin-secret'}},async base=>{
    await page(base,'/');
    await page(base,'/?game=onepiece');
    await sleep(250);
    const failedCalls=state.requests.filter(r=>r.path==='/rest/v1/rpc/page_stats_add');
    assert.ok(failedCalls.length>=2,'retried on every flush while the migration is missing');
    const during=await (await fetch(base+'/api/admin/page-stats',{headers:{authorization:'Bearer admin-secret'}})).json();
    assert.deepEqual(sumDays(during.data.pending),{home:1,game:1},'nothing dropped');
    state.rpcMissing=false;
    await sleep(250);
    const after=await (await fetch(base+'/api/admin/page-stats',{headers:{authorization:'Bearer admin-secret'}})).json();
    assert.deepEqual(after.data.pending,{});
    const last=state.requests.filter(r=>r.path==='/rest/v1/rpc/page_stats_add').at(-1),body=JSON.parse(last.body);
    assert.deepEqual(Object.keys(body).sort(),['p_counts','p_day']);
    assert.match(body.p_day,/^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(body.p_counts,{home:1,game:1});
    assert.equal(/Mozilla|127\.0\.0\.1|onepiece/.test(last.body),false);
  });
});

test('/api/admin/page-stats: 401 without the admin key, 503 without a database, rows newest first plus pending when allowed',async()=>{
  await withServer('admin-nodb',{env:{SCRAPE_SECRET:'admin-secret'}},async base=>{
    assert.equal((await fetch(base+'/api/admin/page-stats')).status,401);
    assert.equal((await fetch(base+'/api/admin/page-stats',{headers:{authorization:'Bearer wrong'}})).status,401);
    assert.equal((await fetch(base+'/api/admin/page-stats?token=admin-secret')).status,401,'the key never goes in the URL');
    assert.equal((await fetch(base+'/api/admin/page-stats',{headers:{authorization:'Bearer admin-secret'}})).status,503);
  });
  const state={rows:[{day:'2026-11-12',counts:{home:5},updatedAt:'2026-11-12T10:00:00Z'},{day:'2026-11-11',counts:{home:3,bot:1},updatedAt:'2026-11-11T23:50:00Z'}]};
  await withServer('admin',{database:mockDatabase(state),env:{SCRAPE_SECRET:'admin-secret'}},async base=>{
    assert.equal((await fetch(base+'/api/admin/page-stats')).status,401);
    await page(base,'/?game=pokemon');
    const ok=await fetch(base+'/api/admin/page-stats?days=7',{headers:{'x-scrape-token':'admin-secret'}});
    assert.equal(ok.status,200);
    const { data }=await ok.json();
    assert.deepEqual(data.days.map(row=>row.day),['2026-11-12','2026-11-11']);
    assert.deepEqual(sumDays(data.pending),{game:1});
    const query=new URLSearchParams(state.requests.filter(r=>r.path==='/rest/v1/page_stats_daily').at(-1).search);
    assert.equal(query.get('order'),'day.desc');
    assert.equal(query.get('limit'),'7');
    for(const [asked,limit] of [['0','30'],['abc','30'],['-5','1'],['9999','366'],['2.9','2']]){
      await fetch(base+'/api/admin/page-stats?days='+asked,{headers:{authorization:'Bearer admin-secret'}});
      assert.equal(new URLSearchParams(state.requests.filter(r=>r.path==='/rest/v1/page_stats_daily').at(-1).search).get('limit'),limit,'days='+asked);
    }
  });
});

test('public /api/catalog/health only says ok, near-limit or unknown for storage, never a byte count',async()=>{
  const cases=[[100*MB,'ok'],[429*MB,'ok'],[430*MB-1,'ok'],[430*MB,'near-limit'],[445*MB,'near-limit']];
  for(const [bytes,status] of cases){
    await withServer('health-'+bytes,{database:mockDatabase({databaseBytes:bytes,tables:[{name:'public.tcg_cards',bytes:1}]})},async base=>{
      const body=await (await fetch(base+'/api/catalog/health')).json();
      assert.deepEqual(body.data.storage,{status},String(bytes));
      assert.equal(JSON.stringify(body).includes(String(bytes)),false,'no byte numbers in the public payload');
      assert.equal(JSON.stringify(body).includes('public.tcg_cards'),false);
    });
  }
  await withServer('health-fails',{database:mockDatabase({sizeFails:true})},async base=>{
    const response=await fetch(base+'/api/catalog/health');
    assert.equal(response.status,200,'the rest of the health payload still works');
    assert.deepEqual((await response.json()).data.storage,{status:'unknown'});
  });
  await withServer('health-nodb',{},async base=>{
    assert.deepEqual((await (await fetch(base+'/api/catalog/health')).json()).data.storage,{status:'unknown'});
  });
});

test('the size report is cached for an hour and a failure is retried only after a minute',async()=>{
  const state={databaseBytes:100*MB};
  await withServer('health-cache',{database:mockDatabase(state)},async base=>{
    for(let i=0;i<3;i++)await fetch(base+'/api/catalog/health');
    assert.equal(state.sizeCalls,1);
  });
  const failing={sizeFails:true};
  await withServer('health-retry',{database:mockDatabase(failing)},async base=>{
    for(let i=0;i<3;i++)await fetch(base+'/api/catalog/health');
    assert.equal(failing.sizeCalls,1,'no hammering while the report is failing');
  });
});

test('/api/admin/catalog/health carries the size report, or storage.error without breaking the rest',async()=>{
  const state={databaseBytes:431*MB,tables:[{name:'public.price_snapshots',bytes:200*MB,liveTuples:1000,lastVacuum:null,lastAutovacuum:'2026-11-12T00:00:00Z'}]};
  await withServer('admin-health',{database:mockDatabase(state),env:{SCRAPE_SECRET:'admin-secret'}},async base=>{
    assert.equal((await fetch(base+'/api/admin/catalog/health')).status,401);
    const { data }=await (await fetch(base+'/api/admin/catalog/health',{headers:{authorization:'Bearer admin-secret'}})).json();
    assert.equal(data.storage.databaseBytes,431*MB);
    assert.equal(data.storage.tables[0].name,'public.price_snapshots');
    assert.ok(data.summary&&data.sources,'the existing fields are still there');
  });
  await withServer('admin-health-down',{database:mockDatabase({sizeFails:true}),env:{SCRAPE_SECRET:'admin-secret'}},async base=>{
    const response=await fetch(base+'/api/admin/catalog/health',{headers:{authorization:'Bearer admin-secret'}});
    assert.equal(response.status,200);
    const { data }=await response.json();
    assert.deepEqual(data.storage,{error:'unavailable'});
    assert.ok(data.summary&&data.sources&&data.missing&&data.rightsReview);
  });
});

// Per-card opens: the front end asks for /api/cards/:id?open=1 when a card detail is opened; only that counts.
const adminHeaders={authorization:'Bearer admin-secret'};
const hotPending=async base=>(await (await fetch(base+'/api/admin/page-stats',{headers:adminHeaders})).json()).data.cardHot.pending;
const firstCardId=async()=>HOT_CARD.id;

test('/api/cards/:id counts a card open only with open=1, only for 200s and not for bots',async()=>{
  const state={};
  await withServer('hot-open',{database:mockDatabase(state),env:{SCRAPE_SECRET:'admin-secret'}},async base=>{
    const id=await firstCardId(base),path='/api/cards/'+encodeURIComponent(id);
    assert.equal((await fetch(base+path)).status,200);
    assert.equal((await fetch(base+path+'?open=0')).status,200);
    await (await fetch(base+path+'/price-history?open=1')).arrayBuffer();
    assert.deepEqual(await hotPending(base),{},'no open=1 on a card detail, nothing counted');
    assert.equal((await fetch(base+path+'?open=1',{headers:{'user-agent':BROWSER}})).status,200);
    assert.equal((await fetch(base+path+'?open=1',{headers:{'user-agent':BROWSER}})).status,200);
    assert.equal((await fetch(base+path+'?open=1',{headers:{'user-agent':'Googlebot/2.1'}})).status,200);
    assert.equal((await fetch(base+path+'?open=1',{headers:{'user-agent':'curl/8.4'}})).status,200);
    assert.equal((await fetch(base+'/api/cards/no-such-card?open=1',{headers:{'user-agent':BROWSER}})).status,404);
    const pending=await hotPending(base),days=Object.values(pending);
    assert.equal(days.length,1);
    assert.deepEqual(days[0],{[id]:2});
    assert.equal(JSON.stringify(pending).includes('no-such-card'),false);
  });
});

test('card opens are flushed through card_hot_add with ids and counts only, a missing function keeps them for the next flush',async()=>{
  const state={hotMissing:true};
  await withServer('hot-flush',{database:mockDatabase(state),env:{PAGE_STATS_FLUSH_MS:'60',SCRAPE_SECRET:'admin-secret'}},async base=>{
    const id=await firstCardId(base);
    await fetch(base+'/api/cards/'+encodeURIComponent(id)+'?open=1',{headers:{'user-agent':BROWSER}});
    await sleep(250);
    assert.ok(state.requests.filter(r=>r.path==='/rest/v1/rpc/card_hot_add').length>=2,'retried while the migration is missing');
    assert.deepEqual(Object.values(await hotPending(base))[0],{[id]:1},'nothing dropped');
    state.hotMissing=false;
    await sleep(250);
    assert.deepEqual(await hotPending(base),{});
    const calls=state.requests.filter(r=>r.path==='/rest/v1/rpc/card_hot_add'),last=calls.at(-1),body=JSON.parse(last.body);
    assert.deepEqual(Object.keys(body).sort(),['p_counts','p_day']);
    assert.deepEqual(body.p_counts,{[id]:1});
    assert.equal(/Mozilla|127\.0\.0\.1/.test(last.body),false);
    await sleep(200);
    assert.equal(state.requests.filter(r=>r.path==='/rest/v1/rpc/card_hot_add').length,calls.length,'sent once, not again');
  });
});

test('/api/admin/page-stats carries cardHot rows and pending next to the page counts',async()=>{
  const state={hotDays:[{day:'2026-11-12',counts:{'pokemon-x':4},updatedAt:'2026-11-12T10:00:00Z'}]};
  await withServer('hot-admin',{database:mockDatabase(state),env:{SCRAPE_SECRET:'admin-secret'}},async base=>{
    assert.equal((await fetch(base+'/api/admin/page-stats')).status,401);
    const { data }=await (await fetch(base+'/api/admin/page-stats?days=5',{headers:adminHeaders})).json();
    assert.deepEqual(data.cardHot.days,state.hotDays);
    assert.deepEqual(data.cardHot.pending,{});
    assert.ok(data.days&&data.pending);
    const query=new URLSearchParams(state.requests.filter(r=>r.path==='/rest/v1/card_hot_daily').at(-1).search);
    assert.equal(query.get('order'),'day.desc');
    assert.equal(query.get('limit'),'5');
  });
});

test('/api/hot-cards: not-configured answer, row shape without open counts, one-hour cache, 502 without details',async()=>{
  await withServer('hot-nodb',{},async base=>{
    const response=await fetch(base+'/api/hot-cards');
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{data:[],meta:{unavailable:'not-configured'}});
  });
  const state={hotRows:[
    {card_id:'pokemon-a',name_zh:'皮卡丘',name_ja:'ピカチュウ',name_en:'Pikachu',card_number:'025/165',series_code:'sv2a',series_name:'151',game:'pokemon',image_url:'https://img.example/a.png',opens:99},
    {card_id:'pokemon-b',name_zh:null,name_ja:null,name_en:'Eevee',card_number:null,series_code:null,series_name:null,game:'pokemon',image_url:null}
  ]};
  await withServer('hot-api',{database:mockDatabase(state)},async base=>{
    const response=await fetch(base+'/api/hot-cards');
    assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control'),/max-age=60/);
    const body=await response.json();
    assert.deepEqual(body.data,[
      {cardId:'pokemon-a',name:'皮卡丘',nameJa:'ピカチュウ',cardNumber:'025/165',seriesCode:'sv2a',seriesName:'151',game:'pokemon',imageUrl:'https://img.example/a.png'},
      {cardId:'pokemon-b',name:'Eevee',nameJa:null,cardNumber:null,seriesCode:null,seriesName:null,game:'pokemon',imageUrl:null}
    ]);
    assert.deepEqual(Object.keys(body.meta).sort(),['generatedAt','minOpens','windowDays']);
    assert.equal(body.meta.windowDays,7);
    assert.equal(body.meta.minOpens,3);
    assert.ok(!Number.isNaN(Date.parse(body.meta.generatedAt)));
    assert.equal(JSON.stringify(body).includes('99'),false,'no open counts');
    assert.deepEqual(JSON.parse(state.requests.find(r=>r.path==='/rest/v1/rpc/card_hot_top').body),{p_days:7,p_limit:12,p_min:3});
    for(let i=0;i<3;i++)await fetch(base+'/api/hot-cards');
    assert.equal(state.hotTopCalls,1,'cached for an hour');
  });
  await withServer('hot-fail',{database:mockDatabase({hotTopFails:true})},async base=>{
    const response=await fetch(base+'/api/hot-cards');
    assert.equal(response.status,502);
    const text=await response.text();
    assert.equal(text.includes('secret db detail'),false);
    assert.equal(text.includes('SUPABASE'),false);
  });
});
