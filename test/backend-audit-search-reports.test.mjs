import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

// Spawns server.mjs against a mock Supabase on ephemeral ports (fetch refuses a few "bad ports", so retry those).
const BAD=new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
async function listen(httpServer){for(;;){await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve)});const {port}=httpServer.address();if(!BAD.has(port))return port;await new Promise(resolve=>httpServer.close(resolve))}}
async function withApp(handler,run){
  const mock=createServer(handler),mockPort=await listen(mock),probe=createServer(),appPort=await listen(probe);await new Promise(resolve=>probe.close(resolve));
  let app,output='';
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${mockPort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`server start timeout: ${output}`)),5000);
      app.once('error',error=>{clearTimeout(timer);reject(error)});
      app.stderr.on('data',chunk=>{output+=String(chunk)});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    await run(path=>fetch(`http://127.0.0.1:${appPort}${path}`).then(async response=>({response,body:await response.json()})));
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await new Promise(resolve=>mock.close(resolve));
  }
}

const card={id:'onepiece-luffy-fixture',canonicalId:'onepiece-luffy-fixture',game:'onepiece',seriesId:'onepiece-op05-jp',officialCardNumber:'OP05-119',rarity:'SEC',nameZh:'魯夫',nameJa:null,nameEn:'Monkey.D.Luffy',nameKo:null,aliases:[],metadata:{}};
const printing=(n,region,imageUrl)=>({id:`p${n}`,cardId:card.id,seriesId:card.seriesId,region,language:region==='JP'?'ja-JP':'en-US',localSetCode:'OP05',localCardNumber:`OP05-11${n}`,rarity:'SEC',imageUrl,imageRightsStatus:'not-provided',source:'onepiece-official',imageRehostRequired:false});
const printings=[printing(1,'JP',null),printing(2,'JP','https://example.test/jp.png'),printing(3,'US',null),printing(4,'US','https://example.test/us.png'),printing(5,'TW','https://example.test/tw.png')];

test('/api/search fields=suggest keeps one printing per card and leaves the default response alone',async()=>{
  const mock=(req,res)=>{
    const url=new URL(req.url,'http://mock'),table=url.pathname.split('/').at(-1),respond=body=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body))};
    if(table==='tcg_cards'&&url.searchParams.has('or'))return respond([card]);
    if(table==='tcg_printings')return respond(printings);
    return respond([]);
  };
  await withApp(mock,async api=>{
    const full=await api(`/api/search?q=${encodeURIComponent('魯夫')}`);
    const target=full.body.data.find(c=>c.id===card.id);
    assert.equal(target.printings.length,5,'default response keeps every printing');
    const slim=await api(`/api/search?q=${encodeURIComponent('魯夫')}&fields=suggest`);
    const slimCard=slim.body.data.find(c=>c.id===card.id);
    assert.equal(slimCard.printings.length,1);
    assert.equal(slimCard.printings[0].id,'p1');
    assert.deepEqual({...slimCard,printings:null},{...target,printings:null},'other card fields are untouched');
    assert.equal(slim.body.meta.total,full.body.meta.total);
    const tw=await api(`/api/search?q=${encodeURIComponent('魯夫')}&fields=suggest&region=TW`);
    assert.equal(tw.body.data.find(c=>c.id===card.id).printings[0].id,'p5','prefers the current region');
    const again=await api(`/api/search?q=${encodeURIComponent('魯夫')}`);
    assert.equal(again.body.data.find(c=>c.id===card.id).printings.length,5,'suggest responses never poison the search cache');
  });
});

test('/api/reports escapes ilike wildcards in cardName',async()=>{
  const seen=[];
  const mock=(req,res)=>{const url=new URL(req.url,'http://mock');if(url.pathname.endsWith('/reports'))seen.push(url.searchParams.get('card_name'));res.writeHead(200,{'content-type':'application/json'});res.end('[]')};
  await withApp(mock,async api=>{
    const {response}=await api(`/api/reports?cardName=${encodeURIComponent('a%b_c\\d*e')}`);
    assert.equal(response.status,200);
    assert.ok(seen.length>0);
    for(const value of seen)assert.equal(value,'ilike.*a\\%b\\_c\\\\d_e*');
  });
});
