import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// docs/UA_SECOND_DB_PLAN.md 第 2 段：union-arena 的卡表在第二個 Supabase 專案；其他遊戲、價格、統計照舊在主庫。
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
const listen=async server=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port};
const close=server=>server?new Promise(resolve=>server.close(resolve)):null;

const card=(game,id,name)=>({id,canonicalId:id,game,seriesId:`${game}-s1`,officialCardNumber:'001',rarity:'SR',nameZh:null,nameJa:name,nameEn:null,nameKo:null,aliases:[],metadata:{},printings:[{id:1,cardId:id,seriesId:`${game}-s1`,region:'JP',language:'ja-JP',localSetCode:'S1',localCardNumber:'001',rarity:'SR',imageUrl:null,imageRehostRequired:false}],images:[]});
const MAIN_CARD=card('pokemon','pokemon-s1-001','テスト獣'),UA_CARD=card('union-arena','union-arena-ua01bt-001','テスト獣UA'),MAIN_SERIES={id:'pokemon-s1',game:'pokemon',officialCode:'S1',region:'JP',nameJa:'S1'};

// One mock project: records each request as [path, body]; `routes` answers by the last path segment, everything else gets [].
function mockProject(routes={}){
  const requests=[],server=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock');let body='';
    req.on('data',chunk=>body+=chunk);
    req.on('end',()=>{
      const name=url.pathname.split('/').at(-1);requests.push([url.pathname.replace('/rest/v1',''),body]);
      const answer=routes[name]?.(body?JSON.parse(body):null,url.searchParams);
      const [status,value]=Array.isArray(answer)&&typeof answer[0]==='number'?answer:[200,answer??[]];
      res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
    });
  });
  return {server,requests,paths:()=>requests.map(([path])=>path)};
}

async function withApp(name,{main,second=null,secondUrl=null},run){
  const keys=['PORT','CATALOG_SYNC_ON_START','CATALOG_WARM_ON_START','CARD_IMAGE_CACHE_ON_START','SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE2_URL','SUPABASE2_SERVICE_KEY','SUPABASE2_TIMEOUT_MS'],previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  let app;
  try{
    Object.assign(process.env,{PORT:String(await freePort()),CATALOG_SYNC_ON_START:'false',CATALOG_WARM_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false',SUPABASE_URL:await listen(main.server),SUPABASE_SERVICE_KEY:'main-key',SUPABASE2_TIMEOUT_MS:'1500'});
    if(second)process.env.SUPABASE2_URL=await listen(second.server);else if(secondUrl)process.env.SUPABASE2_URL=secondUrl;else delete process.env.SUPABASE2_URL;
    if(second||secondUrl)process.env.SUPABASE2_SERVICE_KEY='second-key';else delete process.env.SUPABASE2_SERVICE_KEY;
    ({server:app}=await import('../server.mjs?second-db-'+name));
    if(!app.listening)await new Promise(resolve=>app.once('listening',resolve));
    const base='http://127.0.0.1:'+app.address().port;
    return await run(path=>fetch(base+path).then(async response=>{const text=await response.text();let body=null;try{body=JSON.parse(text)}catch{}return {status:response.status,body,text}}));
  }finally{
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}
    if(app?.listening)await new Promise(resolve=>app.close(resolve));
    await close(main.server);await close(second?.server);
  }
}

const ranked=cards=>()=>({matchedBy:'name',matchCount:cards.length,groupCount:cards.length,cards:cards.map(c=>({...c,hit:true}))});
const detail=cards=>body=>({cards:cards.filter(c=>c.id===body.p_id),series:[],games:[]});

test('without SUPABASE2_* nothing changes: UA is not a game, UA ids are not found, nothing is asked of a second project',async()=>{
  const main=mockProject({search_cards_ranked:ranked([MAIN_CARD]),get_card_detail:detail([MAIN_CARD])});
  await withApp('off',{main},async get=>{
    assert.equal((await get('/api/cards?game=union-arena')).status,400,'union-arena stays an unknown game');
    const search=await get('/api/search?q=テスト獣');
    assert.deepEqual(search.body.data.map(c=>c.id),[MAIN_CARD.id]);
    assert.equal((await get('/api/cards/'+UA_CARD.id)).status,404);
    assert.ok(!main.requests.some(([path,body])=>path==='/rpc/get_card_detail'&&body.includes('union-arena')),'a UA id is never looked up in the main project');
    const health=await get('/api/catalog/health');
    assert.equal(health.body.data.secondStorage,undefined);
  });
});

test('a UA game page, card and series go only to the second project; other games and prices stay on the main one',async()=>{
  const main=mockProject({browse_cards_page:()=>({total:1,cards:[MAIN_CARD]}),tcg_series:()=>[MAIN_SERIES]});
  const second=mockProject({browse_cards_page:()=>({total:1,cards:[UA_CARD]}),get_card_detail:detail([UA_CARD]),tcg_games:()=>[{id:'union-arena',nameEn:'UNION ARENA'}],tcg_series:(_,query)=>query.get('select').startsWith('id,game_id')?[{id:'union-arena-s1',game_id:'union-arena',region:'JP',official_code:'UA01BT'}]:[{id:'union-arena-s1',game:'union-arena',officialCode:'UA01BT',region:'JP',nameJa:'UA 1 弾'}],sitemap_card_groups:()=>[[UA_CARD.id,'union-arena',null]],db_size_report:()=>({databaseBytes:12*1024*1024,tables:[]})});
  await withApp('on',{main,second},async get=>{
    const ua=await get('/api/cards?game=union-arena&limit=10');
    assert.equal(ua.status,200);assert.deepEqual(ua.body.data.map(c=>c.id),[UA_CARD.id]);
    const pokemon=await get('/api/cards?game=pokemon&limit=10');
    assert.deepEqual(pokemon.body.data.map(c=>c.id),[MAIN_CARD.id]);
    assert.equal(main.requests.filter(([path,body])=>path==='/rpc/browse_cards_page'&&body.includes('union-arena')).length,0);
    assert.equal(second.requests.filter(([path,body])=>path==='/rpc/browse_cards_page'&&body.includes('pokemon')).length,0);
    const detailResponse=await get('/api/cards/'+UA_CARD.id);
    assert.equal(detailResponse.status,200);assert.equal(detailResponse.body.data.id,UA_CARD.id);
    assert.ok(second.paths().includes('/rpc/get_card_detail'));
    assert.ok(!second.paths().some(path=>/^\/(rpc\/)?(price_|jp_buyback|exchange_rates|reports|page_stats|card_hot)/.test(path)),'prices and stats never go to the second project');
    const catalog=await get('/api/catalog');
    assert.ok(catalog.body.data.series.some(s=>s.id==='union-arena-s1'),'second-project series join the catalog');
    assert.ok(catalog.body.data.series.some(s=>s.id==='pokemon-s1'),'main series are still there');
    const health=await get('/api/catalog/health');
    assert.equal(health.body.data.secondStorage.status,'ok');
    const sitemapSeries=await get('/sitemaps/series.xml');
    assert.match(sitemapSeries.text,/series=union-arena-s1/,'second-project series are in the sitemap');
    assert.ok(second.paths().includes('/rpc/sitemap_card_groups'),'second-project cards are grouped for the sitemap too');
  });
});

test('search: a full main page never asks the second project; a short one is filled from it after the main hits',async()=>{
  const many=Array.from({length:40},(_,i)=>card('pokemon',`pokemon-s1-${String(i).padStart(3,'0')}`,`テスト獣${i}`));
  let mainCards=many;
  const main=mockProject({search_cards_ranked:()=>ranked(mainCards)()});
  const second=mockProject({search_cards_ranked:ranked([UA_CARD])});
  await withApp('search',{main,second},async get=>{
    const full=await get('/api/search?q=テスト獣');
    assert.equal(full.body.data.length,40);
    assert.equal(second.paths().filter(path=>path==='/rpc/search_cards_ranked').length,0,'a full main page costs nothing extra');
    mainCards=[MAIN_CARD];
    const short=await get('/api/search?q=テスト獣x');
    assert.deepEqual(short.body.data.map(c=>c.id),[MAIN_CARD.id,UA_CARD.id],'main first, then the second project');
    assert.equal(short.body.meta.total,2);
    const sent=JSON.parse(second.requests.find(([path])=>path==='/rpc/search_cards_ranked')[1]);
    assert.equal(sent.p_offset,0);assert.equal(sent.p_limit,39,'asks only for the rest of the page');
  });
});

test('a failing or unreachable second project only blanks UA: search, catalog and other games keep working',async()=>{
  for(const [label,second,secondUrl] of [['error',mockProject({search_cards_ranked:()=>[500,{message:'boom'}],browse_cards_page:()=>[500,{message:'boom'}],tcg_games:()=>[500,{message:'boom'}],tcg_series:()=>[500,{message:'boom'}],db_size_report:()=>[500,{message:'boom'}]}),null],['down',null,'http://127.0.0.1:9']]){
    const main=mockProject({search_cards_ranked:ranked([MAIN_CARD]),browse_cards_page:()=>({total:1,cards:[MAIN_CARD]}),tcg_series:()=>[MAIN_SERIES]});
    await withApp('fail-'+label,{main,second,secondUrl},async get=>{
      const search=await get('/api/search?q=テスト獣');
      assert.equal(search.status,200);assert.deepEqual(search.body.data.map(c=>c.id),[MAIN_CARD.id]);
      assert.deepEqual((await get('/api/cards?game=pokemon')).body.data.map(c=>c.id),[MAIN_CARD.id]);
      const catalog=await get('/api/catalog');
      assert.equal(catalog.status,200);assert.deepEqual(catalog.body.data.series.map(s=>s.id),['pokemon-s1']);
      const ua=await get('/api/cards?game=union-arena');
      assert.ok(ua.status!==200||ua.body.data.length===0,'UA is blank or reports the failure');
      const health=await get('/api/catalog/health');
      assert.equal(health.body.data.secondStorage.status,'unknown');
    });
  }
});

test('a search with no hit anywhere can take its typo suggestion from the second project',async()=>{
  const none=()=>({matchedBy:null,matchCount:0,groupCount:0,cards:[]});
  const main=mockProject({search_cards_ranked:none,search_name_suggestion:()=>null});
  const second=mockProject({search_cards_ranked:none,search_name_suggestion:()=>'テスト獣UA'});
  await withApp('suggest',{main,second},async get=>{
    const result=await get('/api/search?q=テスト獣UB');
    assert.equal(result.body.data.length,0);
    assert.equal(result.body.meta.suggestion?.q,'テスト獣UA');
  });
});
