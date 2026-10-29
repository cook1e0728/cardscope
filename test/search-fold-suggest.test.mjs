// 搜尋：忽略空白／中點／連字號的重試、卡號寫法、稀有度單獨搜尋、錯字建議、IP 名稱的遊戲提示（用假 Supabase 的 HTTP 測試＋純函式）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { foldSearch, foldedSpan, gameHintFor, parseSearchQuery, rarityOnlyExample } from '../providers/search-query.mjs';

test('foldedSpan 從資料庫卡名切出對應原文（保留空白與中點）',()=>{
  const span=(name,query)=>foldedSpan(name,foldSearch(query));
  assert.equal(span('日向 翔陽','日向翔陽'),'日向 翔陽');
  assert.equal(span('日向翔陽','日向　翔陽'),'日向翔陽','查詢帶全形空白、資料沒有');
  assert.equal(span('蒙其・D・魯夫(異圖卡)','蒙其D魯夫'),'蒙其・D・魯夫');
  assert.equal(span('阿羅拉 喵喵','羅拉喵'),'羅拉 喵');
  assert.equal(span('OP17-118','OP-17-118'),'OP17-118');
  assert.equal(span('噴火龍','皮卡丘'),null);
});

test('稀有度單獨搜尋的範例與 IP 名稱提示',()=>{
  assert.equal(rarityOnlyExample(['SAR']),'皮卡丘 SAR');
  assert.equal(rarityOnlyExample(['SEC']),'魯夫 SEC');
  assert.equal(rarityOnlyExample([]),null);
  assert.equal(parseSearchQuery('SAR').rarityOnly,true);
  assert.deepEqual(gameHintFor('排球少年'),{gameId:'haikyuu',franchiseId:'haikyuu'});
  assert.deepEqual(gameHintFor('ハイキュー'),{gameId:'haikyuu',franchiseId:'haikyuu'});
  assert.deepEqual(gameHintFor('芙莉蓮'),{gameId:'weiss-schwarz',franchiseId:'frieren'});
  assert.deepEqual(gameHintFor('葬送のフリーレン'),{gameId:'weiss-schwarz',franchiseId:'frieren'});
  assert.deepEqual(gameHintFor('七龍珠超'),{gameId:'dragonball-fw',franchiseId:'dragonball'});
  assert.equal(gameHintFor('Re:Zero'),null,'planned 的作品還沒有資料，不導');
  for(const q of ['魯夫','噴火龍','黑魔導女孩','排球少年 日向',''])assert.equal(gameHintFor(q),null,q);
});

const BAD_PORTS=new Set([6000,6665,6666,6667,6668,6669,10080]);
async function listen(httpServer){for(;;){await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve)});const {port}=httpServer.address();if(!BAD_PORTS.has(port))return port;await close(httpServer)}}
async function close(httpServer){if(httpServer?.listening){httpServer.closeAllConnections?.();await new Promise((resolve,reject)=>httpServer.close(error=>error?reject(error):resolve()))}}
const card=(id,nameZh,over={})=>({id,canonicalId:id,game:'pokemon',seriesId:'s1',officialCardNumber:'001',rarity:'C',nameZh,nameJa:null,nameEn:null,nameKo:null,aliases:[],metadata:{},matchRank:0,printings:[{id:`p-${id}`,cardId:id,seriesId:'s1',region:'JP',language:'ja-JP',localSetCode:'S1',localCardNumber:'001',rarity:'C',rarityCode:'C',imageUrl:null,imageRehostRequired:false}],...over});
const answer=cards=>({matchedBy:cards.length?'name':null,matchedSeries:0,matchCount:cards.length,groupCount:cards.length,cards});

// handlers: {ranked(body, call)->answer, fold(body)->rows, suggest(body)->value|Error}；rpc 以外的資料表回 []。calls 依 rpc 名稱記錄 body。
async function withApp(handlers,run){
  const calls={search_cards_ranked:[],search_fold_names:[],search_name_suggestion:[]};
  const mock=createServer((req,res)=>{
    const name=new URL(req.url,'http://mock-supabase').pathname.split('/').at(-1),chunks=[];
    req.on('data',chunk=>chunks.push(chunk));
    req.on('end',()=>{
      const respond=(payload,status=200)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(payload))};
      if(!(name in calls))return respond([]);
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');calls[name].push(body);
      const key={search_cards_ranked:'ranked',search_fold_names:'fold',search_name_suggestion:'suggest'}[name],value=handlers[key]?handlers[key](body,calls[name].length):(key==='ranked'?answer([]):key==='fold'?[]:null);
      if(value instanceof Error)return respond({message:value.message},500);
      respond(value);
    });
  });
  const supabasePort=await listen(mock),probe=createServer(),appPort=await listen(probe);await close(probe);
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`server start timeout: ${output}`)),8000);
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`server exited (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    const search=async params=>{const response=await fetch(`http://127.0.0.1:${appPort}/api/search?${new URLSearchParams(typeof params==='string'?{q:params}:params)}`);return {status:response.status,body:await response.json()}};
    return await run({search,calls});
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await close(mock);
  }
}

test('零結果時用資料庫自己的寫法重試：日向翔陽 -> 日向 翔陽，其餘條件與分頁照舊',async()=>{
  const spaced=card('c1','日向 翔陽',{game:'haikyuu'});
  await withApp({
    ranked:body=>answer(body.p_patterns.includes('%日向 翔陽%')?[spaced]:[]),
    fold:body=>body.p_fold==='日向翔陽'?[{name:'日向 翔陽',hits:66},{name:'日向 翔陽(異圖卡)',hits:3}]:[]
  },async({search,calls})=>{
    const result=await search('日向翔陽');
    assert.equal(result.status,200);
    assert.deepEqual(calls.search_fold_names.map(b=>[b.p_fold,b.p_limit]),[['日向翔陽',5]],'傳折疊後的查詢');
    assert.equal(calls.search_cards_ranked.length,2,'先查原本的寫法，零結果再用資料庫的寫法查一次');
    assert.deepEqual(calls.search_cards_ranked[1].p_patterns,['%日向 翔陽%']);
    assert.deepEqual(result.body.data.map(c=>c.id),['c1']);
    assert.equal(result.body.meta.total,1);
    assert.deepEqual(result.body.meta.matchedAs,['日向 翔陽']);
    assert.equal(result.body.meta.suggestion,null);
    assert.equal(calls.search_name_suggestion.length,0,'重試有結果就不再問錯字建議');
    // 版本條件一起帶到重試
    await search('日向翔陽 台版');
    assert.deepEqual(calls.search_cards_ranked.slice(2,4).map(b=>[b.p_patterns[0],b.p_region]),[['%日向翔陽%','TW'],['%日向 翔陽%','TW']]);
    // 資料庫就是這個寫法時不重試
    calls.search_fold_names.length=0;
    await search('日向 翔陽');
    assert.equal(calls.search_fold_names.length,0);
  });
});

test('折疊後少於 3 個字不重試；重試函式出錯或沒有結果時照舊回 0 筆',async()=>{
  await withApp({fold:()=>new Error('fold down'),suggest:()=>new Error('suggest down')},async({search,calls})=>{
    const short=await search('魯非');
    assert.equal(short.status,200);
    assert.deepEqual([short.body.meta.total,short.body.meta.suggestion],[0,null]);
    assert.equal(calls.search_fold_names.length,0,'兩個字沒有 trigram 可用');
    assert.equal(calls.search_name_suggestion.length,0,'建議也要三個字以上');
    const broken=await search('日向翔陽');
    assert.equal(broken.status,200);
    assert.deepEqual([broken.body.data.length,broken.body.meta.total,broken.body.meta.suggestion],[0,0,null],'兩個 RPC 都壞也不影響搜尋回應');
    assert.equal(calls.search_fold_names.length,1);
    assert.equal(calls.search_name_suggestion.length,1);
  });
});

test('卡號分隔符號：OP-17-118、BETB EN060、SV6a 090、sv6a-090 都查資料裡的寫法',async()=>{
  await withApp({ranked:()=>answer([card('c1','洛克斯')])},async({search,calls})=>{
    const patterns=async q=>{const before=calls.search_cards_ranked.length;await search(q);return calls.search_cards_ranked[before].p_patterns};
    assert.deepEqual(await patterns('OP-17-118'),['%OP-17-118%','%OP17-118%']);
    assert.deepEqual(await patterns('op 17 118'),['%op 17 118%','%op17-118%']);
    assert.deepEqual(await patterns('BETB EN060'),['%BETB EN060%','%BETB-EN060%']);
    assert.deepEqual(await patterns('BETB-EN060'),['%BETB-EN060%'],'已經是資料裡的寫法就不加');
    assert.deepEqual(await patterns('SV6a 090'),['%SV6a 090%','%SV6a-090%']);
    assert.deepEqual(await patterns('sv6a-090'),['%sv6a-090%']);
    assert.deepEqual(await patterns('sv6a-90'),['%sv6a-90%','%sv6a-090%']);
    assert.deepEqual(await patterns('Pikachu 25'),['%Pikachu 25%'],'卡名加數字不當卡號');
    assert.deepEqual(await patterns('Pikachu ex'),['%Pikachu ex%']);
  });
});

test('只輸入稀有度代碼：不比對卡名，回提示與查得到結果的範例；加上卡名照舊搜尋',async()=>{
  // 範例要真的查得到：假資料庫只在 p_rarities 含 sar／sec 時回卡
  const hit=body=>(body.p_rarities||[]).some(v=>['sar','sec'].includes(v));
  const cardOf=body=>card('c1','範例卡',{printings:[{id:'p1',cardId:'c1',seriesId:'s1',region:'JP',language:'ja-JP',localSetCode:'S1',localCardNumber:'001',rarity:body.p_rarities[0],rarityCode:body.p_rarities[0].toUpperCase(),imageUrl:null,imageRehostRequired:false}]});
  await withApp({ranked:body=>answer(hit(body)?[cardOf(body)]:[])},async({search,calls})=>{
    for(const [q,example] of [['SAR','皮卡丘 SAR'],['sar 日版','皮卡丘 SAR'],['SEC','魯夫 SEC']]){
      const result=await search(q);
      assert.equal(result.status,200);
      assert.deepEqual([result.body.data,result.body.meta.total,result.body.meta.hasMore],[[],0,false],q);
      assert.equal(result.body.meta.parsed.rarityOnly,true);
      assert.deepEqual(result.body.meta.suggestion,{q:example,reason:'稀有度請搭配卡名一起搜'},q);
      assert.match(result.body.meta.hint.message,/請加上卡名/);
      assert.ok(result.body.meta.hint.message.includes(example));
    }
    assert.ok(calls.search_cards_ranked.every(body=>body.p_limit===1&&!body.p_patterns.some(p=>/sar|sec/i.test(p))),'只查範例（一筆），沒有拿代碼去比對卡名');
    const ur=await search('UR');
    assert.equal(ur.body.meta.suggestion,null,'範例查不到結果就不給');
    assert.equal(ur.body.meta.hint.kind,'rarity-only');
    assert.doesNotMatch(ur.body.meta.hint.message,/例如/);
    const named=await search('皮卡丘 SAR');
    assert.equal(named.body.meta.parsed.rarityOnly,undefined);
    assert.equal(named.body.data.length,1);
  });
});

test('零結果的錯字建議：meta.suggestion 帶最相似的卡名，只在零結果時才問，並帶版本條件',async()=>{
  await withApp({ranked:body=>answer(body.p_patterns.includes('%噴火龍%')?[card('c1','噴火龍')]:[]),suggest:body=>body.p_q==='噴火籠'?'噴火龍':null},async({search,calls})=>{
    const typo=await search('噴火籠');
    assert.deepEqual(typo.body.meta.suggestion,{q:'噴火龍',reason:'相近的卡名'});
    assert.deepEqual([typo.body.meta.total,calls.search_name_suggestion[0].p_q,calls.search_name_suggestion[0].p_region],[0,'噴火籠',null]);
    await search('噴火籠 台版');
    assert.equal(calls.search_name_suggestion.at(-1).p_region,'TW');
    const before=calls.search_name_suggestion.length;
    const hit=await search('噴火龍');
    assert.equal(hit.body.meta.suggestion,null);
    assert.equal(calls.search_name_suggestion.length,before,'有結果不問建議');
    assert.equal(calls.search_fold_names.length,2,'只有零結果的兩次查過折疊');
    const nothing=await search('完全不存在的卡片名稱');
    assert.equal(nothing.body.meta.suggestion,null,'沒有相近的就不建議');
  });
  // 建議不能是查詢本身
  await withApp({suggest:()=>'噴火籠'},async({search})=>{assert.equal((await search('噴火籠')).body.meta.suggestion,null)});
});

test('IP 名稱帶 meta.gameHint；一般卡名沒有；IP 名稱零結果不當錯字',async()=>{
  await withApp({suggest:()=>'亂湊'},async({search,calls})=>{
    const ip=await search('排球少年');
    assert.equal(ip.body.meta.gameHint,'haikyuu');
    assert.equal(ip.body.meta.franchiseHint,'haikyuu');
    assert.equal(ip.body.meta.suggestion,null);
    assert.equal(calls.search_name_suggestion.length,0);
    const frieren=await search('芙莉蓮');
    assert.deepEqual([frieren.body.meta.gameHint,frieren.body.meta.franchiseHint],['weiss-schwarz','frieren']);
    assert.equal('gameHint' in (await search('魯夫')).body.meta,false);
  });
});

test('固定驗收詞有結果時不多打 RPC，meta 欄位與原本一致',async()=>{
  await withApp({ranked:()=>answer([card('c1','驗收卡')])},async({search,calls})=>{
    for(const q of ['luffy','魯夫','噴火龍','Charizard','リザードン','超夢','夢幻','黑魔導女孩']){
      const result=await search(q);
      assert.equal(result.body.meta.total,1,q);
      assert.equal(result.body.meta.suggestion,null,q);
      assert.equal('matchedAs' in result.body.meta,false,q);
    }
    assert.equal(calls.search_fold_names.length+calls.search_name_suggestion.length,0);
    assert.equal(calls.search_cards_ranked.length,8);
  });
});
