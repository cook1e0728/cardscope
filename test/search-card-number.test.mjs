// 搜尋卡號：「SV6a 090」（空格）也查資料裡的「SV6a-090」寫法。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// 搜尋延遲（docs/evidence/search-perf-20261015.md）：對沖請求、單飛、過期先回、不分大小寫快取鍵、卡號寫法。
// 每個測試各起一個假 Supabase 與一個 server.mjs 子行程，環境變數只影響該子行程。

const BAD_PORTS=new Set([6000,6665,6666,6667,6668,6669,10080]);
async function listen(httpServer){for(;;){await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve)});const {port}=httpServer.address();if(!BAD_PORTS.has(port))return port;await close(httpServer)}}
async function close(httpServer){if(httpServer?.listening){httpServer.closeAllConnections?.();await new Promise((resolve,reject)=>httpServer.close(error=>error?reject(error):resolve()))}}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const card={id:'pokemon-tcgdex-tw-sv2a-006',canonicalId:'pokemon-tcgdex-tw-sv2a-006',game:'pokemon',seriesId:'pokemon-tcgdex-tw-sv2a',officialCardNumber:'006',rarity:'RR',nameZh:'測試獸ex',nameJa:null,nameEn:'Testmon ex',nameKo:null,aliases:[],metadata:{}};
const printing={id:'p-006',cardId:card.id,seriesId:card.seriesId,region:'TW',language:'zh-TW',localSetCode:'SV2a',localCardNumber:'006',rarity:'RR',imageUrl:null,imageRehostRequired:false};
const rankedAnswer=(name='測試獸ex')=>({matchedBy:'name',matchedSeries:0,matchCount:1,groupCount:1,cards:[{...card,nameZh:name,printings:[printing],hit:true}]});

// handler(call, respond, body) answers search_cards_ranked; call counts from 1. Other tables answer [].
async function withApp(env,handler,run){
  const calls={ranked:0,all:[]};
  const mock=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock-supabase'),table=url.pathname.split('/').at(-1),chunks=[];
    req.on('data',chunk=>chunks.push(chunk));
    req.on('end',()=>{
      const body=Buffer.concat(chunks).toString('utf8'),respond=(payload,status=200)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(payload))};
      calls.all.push(table);
      if(table==='search_cards_ranked'){calls.ranked++;return handler(calls.ranked,respond,body)}
      respond([]);
    });
  });
  const supabasePort=await listen(mock),probe=createServer(),appPort=await listen(probe);await close(probe);
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false',...env},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`search-perf server start timeout: ${output}`)),8000);
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`search-perf server exited (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    const search=async(q,region='')=>{const started=performance.now(),response=await fetch(`http://127.0.0.1:${appPort}/api/search?q=${encodeURIComponent(q)}${region?`&region=${region}`:''}`);return {status:response.status,body:await response.json(),timing:response.headers.get('server-timing')||'',ms:performance.now()-started}};
    return await run({search,calls});
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await close(mock);
  }
}

test('a card number typed with a space also searches the stored spelling (SV6a 090 -> SV6a-090)',async()=>{
  const bodies=[];
  await withApp({SEARCH_HEDGE_MS:'0'},(call,respond,body)=>{bodies.push(JSON.parse(body));respond({matchedBy:null,matchedSeries:0,matchCount:0,groupCount:0,cards:[]})},async({search})=>{
    const spaced=await search('SV6a 090');
    assert.deepEqual(bodies[0].p_patterns,['%SV6a 090%','%SV6a-090%']);
    assert.deepEqual(spaced.body.meta.queryTerms,['SV6a 090','SV6a-090']);
    const short=await search('sv6a 90');
    assert.deepEqual(bodies[1].p_patterns,['%sv6a 90%','%sv6a-90%','%sv6a-090%']);
    assert.equal(short.status,200);
    for(const plain of ['Pikachu ex','luffy','30th','三十周年','SV6a-090']){await search(plain)}
    assert.ok(bodies.slice(2).every(b=>!b.p_patterns.some(p=>/^%[a-z0-9]{1,4}-\d+%$/i.test(p)&&p.toLowerCase()!=='%sv6a-090%'&&p.toLowerCase()!=='%30th%')),'other queries get no extra card-number spelling');
  });
});
