// 自然語句搜尋、排序、真實總數與載入更多（ADR 0044 Q6/Q7）：解析純函式＋用假 Supabase 的 HTTP 測試。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { parseSearchQuery, printingMatchesRarity, rarityMatchValues } from '../providers/search-query.mjs';

test('parseSearchQuery 拆出稀有度與版本詞，其餘當卡名',()=>{
  const parse=q=>{const {q:original,...rest}=parseSearchQuery(q);assert.equal(original,q.trim());return rest};
  assert.deepEqual(parse('桃歹郎ex SAR'),{name:'桃歹郎ex',rarities:['SAR'],region:null});
  assert.deepEqual(parse('魯夫 台版'),{name:'魯夫',rarities:[],region:'TW'});
  assert.deepEqual(parse('モモワロウex SAR'),{name:'モモワロウex',rarities:['SAR'],region:null});
  assert.deepEqual(parse('UR 噴火龍 日版'),{name:'噴火龍',rarities:['UR'],region:'JP'});
  assert.deepEqual(parse('sar 桃歹郎ex　日文版'),{name:'桃歹郎ex',rarities:['SAR'],region:'JP'},'大小寫不分、全形空白也算分隔');
  assert.deepEqual(parse('pikachu jp sar ur'),{name:'pikachu',rarities:['SAR','UR'],region:'JP'});
  assert.deepEqual(parse('Pikachu Special Illustration Rare'),{name:'Pikachu',rarities:['SAR'],region:null},'多字別名也認');
  assert.deepEqual(parse('Secret Rare Blue-Eyes'),{name:'Blue-Eyes',rarities:['Secret Rare'],region:null},'同一個詞在別的遊戲是正式代碼時對應到它自己');
  // 整串只有稀有度代碼（可帶版本詞）：標成 rarityOnly，卡名留空
  assert.deepEqual(parse('SAR'),{name:'',rarities:['SAR'],region:null,rarityOnly:true});
  assert.deepEqual(parse('ur 日版'),{name:'',rarities:['UR'],region:'JP',rarityOnly:true});
  assert.deepEqual(parse('SEC　SAR'),{name:'',rarities:['SEC','SAR'],region:null,rarityOnly:true});
  // 不解析：只有版本詞、卡號、字母夾在字裡、容易誤判的單字母／常見名字
  for(const plain of ['日版','SV6a 090','Pikachu','Charizard','Ace Sabo','R 噴火龍','none 皮卡丘','SARX','桃歹郎SAR','','  '])assert.deepEqual(parse(plain),{name:plain.trim(),rarities:[],region:null},`不解析：${plain}`);
});

test('稀有度拼法展開與 printing 比對',()=>{
  const values=rarityMatchValues(['SAR']);
  assert.ok(['sar','special art rare','special illustration rare'].every(v=>values.includes(v)));
  assert.equal(printingMatchesRarity({rarityCode:'SAR',rarity:'Special Illustration Rare'},values),true);
  assert.equal(printingMatchesRarity({rarityCode:null,rarity:'sar'},values),true);
  assert.equal(printingMatchesRarity({rarityCode:'AR',rarity:'AR'},values),false);
  assert.equal(printingMatchesRarity({rarityCode:'AR'},[]),true,'沒有稀有度條件就不篩');
});

const BAD_PORTS=new Set([6000,6665,6666,6667,6668,6669,10080]);
async function listen(httpServer){for(;;){await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve)});const {port}=httpServer.address();if(!BAD_PORTS.has(port))return port;await close(httpServer)}}
async function close(httpServer){if(httpServer?.listening){httpServer.closeAllConnections?.();await new Promise((resolve,reject)=>httpServer.close(error=>error?reject(error):resolve()))}}

const printing=(cardId,over={})=>({id:`p-${cardId}-${over.rarityCode||'x'}`,cardId,seriesId:'s1',region:'JP',language:'ja-JP',localSetCode:'SV6a',localCardNumber:'090',rarity:'SAR',rarityCode:'SAR',imageUrl:null,imageRehostRequired:false,...over});
const card=(id,over={})=>({id,canonicalId:id,game:'pokemon',seriesId:'s1',officialCardNumber:'090',rarity:'SAR',nameZh:'測試獸ex',nameJa:null,nameEn:'Testmon ex',nameKo:null,aliases:[],metadata:{},printings:[printing(id)],matchRank:1,...over});
const answer=(cards,groupCount=cards.length)=>({matchedBy:'name',matchedSeries:0,matchCount:groupCount,groupCount,cards});

// handler(call, respond, body, tableName) 回答 search_cards_ranked（call 從 1 起算）；其他資料表回 []。
async function withApp(handler,run){
  const calls=[];
  const mock=createServer((req,res)=>{
    const table=new URL(req.url,'http://mock-supabase').pathname.split('/').at(-1),chunks=[];
    req.on('data',chunk=>chunks.push(chunk));
    req.on('end',()=>{
      const body=Buffer.concat(chunks).toString('utf8'),respond=(payload,status=200)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(payload))};
      if(table==='search_cards_ranked'){const parsed=JSON.parse(body);calls.push(parsed);return handler(calls.length,respond,parsed)}
      respond([]);
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
    const search=async params=>{const response=await fetch(`http://127.0.0.1:${appPort}/api/search?${new URLSearchParams(params)}`);return {status:response.status,body:await response.json()}};
    return await run({search,calls});
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await close(mock);
  }
}

test('meta 帶真實總數、offset、limit、hasMore；每頁用 p_offset，快取依頁分開；順序與 matchRank 照資料庫',async()=>{
  const page=(offset)=>answer(Array.from({length:offset>=80?15:40},(_,i)=>card(`c${offset+i}`,{matchRank:offset+i<3?0:(offset+i<40?1:3)})),95);
  await withApp((call,respond,body)=>respond(page(body.p_offset)),async({search,calls})=>{
    const first=await search({q:'測試獸'});
    assert.equal(first.status,200);
    assert.deepEqual(Object.keys(calls[0]).sort(),['p_limit','p_needles','p_offset','p_patterns','p_rarities','p_region'],'六個參數都具名送出（null 也送）');
    assert.deepEqual([calls[0].p_limit,calls[0].p_offset,calls[0].p_rarities,calls[0].p_region],[40,0,null,null]);
    const meta=first.body.meta;
    assert.deepEqual([meta.total,meta.offset,meta.limit,meta.hasMore,meta.suggestion],[95,0,40,true,null]);
    assert.deepEqual(meta.parsed,{q:'測試獸',name:'測試獸',rarities:[],region:null});
    assert.equal(first.body.data.length,40);
    assert.deepEqual(first.body.data.slice(0,4).map(c=>[c.id,c.matchRank]),[['c0',0],['c1',0],['c2',0],['c3',1]],'順序與 matchRank 沿用資料庫');
    assert.equal(first.body.data.at(-1).id,'c39');
    const second=await search({q:'測試獸',offset:'40'});
    assert.equal(calls[1].p_offset,40);
    assert.deepEqual([second.body.meta.offset,second.body.meta.hasMore,second.body.data[0].id],[40,true,'c40']);
    assert.equal(second.body.data[0].matchRank,3);
    const last=await search({q:'測試獸',offset:'80',limit:'40'});
    assert.deepEqual([last.body.meta.hasMore,last.body.data.length,last.body.meta.total],[false,15,95]);
    const again=await search({q:'測試獸',offset:'40'});
    assert.equal(calls.length,3,'同一頁走快取，不同頁各自查');
    assert.deepEqual(again.body,second.body);
    await search({q:'測試獸',limit:'500'});
    assert.equal(calls[3].p_limit,100,'limit 上限 100');
  });
});

test('「桃歹郎ex SAR」拆成卡名＋稀有度篩選，只留 SAR 的 printing；region 參數優先於版本詞',async()=>{
  const sar=printing('c1',{rarity:'Special Illustration Rare',rarityCode:'SAR'}),ar=printing('c1',{rarity:'AR',rarityCode:'AR',localCardNumber:'070'}),tw=printing('c1',{id:'p-c1-tw',region:'TW',language:'zh-TW'});
  await withApp((call,respond)=>respond(answer([card('c1',{nameZh:'桃歹郎ex',printings:[ar,sar,tw]})],1)),async({search,calls})=>{
    const result=await search({q:'桃歹郎ex SAR'});
    assert.deepEqual(calls[0].p_patterns,['%桃歹郎ex%']);
    assert.ok(calls[0].p_rarities.includes('sar')&&calls[0].p_rarities.includes('special illustration rare'));
    assert.equal(calls[0].p_region,null);
    assert.deepEqual(result.body.meta.parsed,{q:'桃歹郎ex SAR',name:'桃歹郎ex',rarities:['SAR'],region:null});
    assert.deepEqual(result.body.meta.queryTerms,['桃歹郎ex']);
    assert.deepEqual(result.body.data[0].printings.map(p=>[p.region,p.rarityCode]),[['JP','SAR'],['TW','SAR']],'只留符合稀有度的 printing（AR 被拿掉）');
    assert.equal(result.body.meta.total,1);
    await search({q:'魯夫 台版'});
    assert.deepEqual([calls[1].p_patterns[0],calls[1].p_region,calls[1].p_rarities],['%魯夫%','TW',null]);
    const withParam=await search({q:'魯夫 台版',region:'JP'});
    assert.equal(calls[2].p_region,'JP','region 參數優先');
    assert.deepEqual(withParam.body.meta.parsed,{q:'魯夫 台版',name:'魯夫',rarities:[],region:null});
    const bare=await search({q:'SAR'});
    assert.deepEqual([calls.length,calls[3].p_patterns[0],calls[3].p_limit],[4,'%皮卡丘%',1],'只有稀有度代碼時不拿代碼比對卡名，只查一筆範例是否有結果');
    assert.deepEqual([bare.body.data,bare.body.meta.total,bare.body.meta.parsed.rarityOnly,bare.body.meta.hint.kind],[[],0,true,'rarity-only']);
  });
});

test('套用條件後零結果：只有名稱查得到時給 suggestion，否則為 null',async()=>{
  await withApp((call,respond,body)=>respond(body.p_rarities?answer([],0):answer([card('c1',{nameZh:'桃歹郎ex'})],1)),async({search,calls})=>{
    const none=await search({q:'桃歹郎ex SAR 韓版'});
    assert.deepEqual(none.body.data,[]);
    assert.equal(none.body.meta.total,0);
    assert.deepEqual(none.body.meta.suggestion,{q:'桃歹郎ex',reason:'name-only'});
    assert.equal(calls.at(-1).p_rarities,null,'建議用拿掉條件後的名稱查');
    const found=await search({q:'桃歹郎ex'});
    assert.equal(found.body.meta.suggestion,null);
  });
  await withApp((call,respond)=>respond(answer([],0)),async({search})=>{
    const none=await search({q:'不存在的卡 SAR'});
    assert.equal(none.body.meta.total,0);
    assert.equal(none.body.meta.suggestion,null,'名稱本身也沒有結果就不建議');
    assert.equal((await search({q:'不存在的卡'})).body.meta.suggestion,null,'沒有解析出條件不建議');
  });
});

test('新函式不存在時退回四參數版本：第一頁照舊、matchRank 由伺服器算、不再每次重試新函式',async()=>{
  await withApp((call,respond,body)=>{
    if('p_offset' in body)return respond({code:'PGRST202',message:'Could not find the function'},404);
    respond(answer([card('c1',{nameZh:'魯夫',aliases:['luffy'],matchRank:undefined}),card('c2',{nameZh:'魯夫太郎',aliases:[],matchRank:undefined}),card('c3',{nameZh:'海賊',nameEn:null,aliases:['魯夫'],matchRank:undefined})],3));
  },async({search,calls})=>{
    const result=await search({q:'魯夫'});
    assert.equal(result.status,200);
    assert.deepEqual(Object.keys(calls.at(-1)).sort(),['p_limit','p_needles','p_patterns','p_region'],'舊簽章只送四個參數');
    assert.deepEqual(result.body.data.map(c=>[c.id,c.matchRank]),[['c1',0],['c2',1],['c3',3]]);
    assert.deepEqual([result.body.meta.total,result.body.meta.hasMore,result.body.meta.offset],[3,false,0]);
    const before=calls.length;
    await search({q:'魯夫',offset:'1'});
    assert.equal(calls.slice(before).filter(body=>'p_offset' in body).length,0,'新函式缺席一段時間內不再重試');
  });
});
