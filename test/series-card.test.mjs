import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SERIES_HIT_COUNT,bandSeries,pickSeriesHits,buildSeriesHits} from '../providers/pack-prizes.mjs';

// 首頁最新系列卡片的資料邏輯（series-card.js、providers/pack-prizes.mjs 的縮圖挑選）；系列樣本取自 2026-11 正式站目錄的實際欄位。
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const window={};vm.runInNewContext(await read('../series-card.js'),{window});
const j=value=>JSON.parse(JSON.stringify(value)),api=window.homeSeriesCard;// vm 內建立的陣列與物件原型不同，比對前先轉成純資料
const names=item=>j(api.names(item)),setFor=api.setFor,hitsOf=(set,count)=>j(api.hitsOf(set,count)),facts=(item,hits,today)=>j(api.facts(item,hits,today));
const S=over=>({id:'s1',game:'onepiece',region:'TW',officialCode:'EB-05',releaseDate:'2026-10-31',...over});
const hit=(n,over={})=>({cardId:`c${n}`,name:`卡${n}`,cardNumber:String(n),rarity:'SP卡',altArt:false,imageUrl:`https://img.test/${n}.png`,...over});

test('名稱：有中文就用中文當標題，日文／英文原名放次要文字；結尾和系列代號重複的【EB-05】拿掉',()=>{
  assert.deepEqual(names(S({nameZh:'特殊補充包 ONE PIECE Heroines Edition【EB-05】',nameEn:'EXTRA BOOSTER -ONE PIECE Heroines Edition vol.2- [EB-05]'})),{title:'特殊補充包 ONE PIECE Heroines Edition',original:'EXTRA BOOSTER -ONE PIECE Heroines Edition vol.2-'});
  assert.deepEqual(names(S({game:'weiss-schwarz',officialCode:'S136',nameZh:'葬送的芙莉蓮 Vol.2',nameJa:'葬送のフリーレン Vol.2',nameEn:"Frieren: Beyond Journey's End"})),{title:'葬送的芙莉蓮 Vol.2',original:'葬送のフリーレン Vol.2'});
});

test('名稱：「寶可夢系列｜Delta Reign」這種只有前綴是中文的，標題用原名、不重複顯示原名',()=>{
  assert.deepEqual(names(S({game:'pokemon',region:'US',officialCode:'me6',nameZh:'寶可夢系列｜Delta Reign',nameEn:'Delta Reign'})),{title:'Delta Reign',original:''});
  assert.deepEqual(names(S({game:'yugioh',officialCode:'MAMS',nameZh:'遊戲王系列｜Magnificent Maestros',nameEn:'Magnificent Maestros'})),{title:'Magnificent Maestros',original:''});
});

test('名稱：只有日文名（UNION ARENA）用日文；什麼名稱都沒有退回代號，再沒有就「名稱待補」',()=>{
  assert.deepEqual(names(S({game:'union-arena',officialCode:'EX17BT',nameZh:null,nameJa:'Re:ゼロから始める異世界生活 Vol.2'})),{title:'Re:ゼロから始める異世界生活 Vol.2',original:''});
  assert.equal(names(S({nameZh:null})).title,'EB-05');
  assert.equal(names({id:'x',game:'pokemon'}).title,'名稱待補');
});

test('縮圖資料對應：先看系列 id，沒有就借同遊戲、同代號的其他版本；別的遊戲同代號不算',()=>{
  const sets=[{game:'pokemon',region:'TW',seriesIds:['tw-m6a'],code:'M6a',hits:[hit(1)]},{game:'onepiece',region:'TW',seriesIds:['tw-eb05'],code:'EB-05',hits:[hit(2)]}];
  assert.equal(setFor(S({id:'tw-m6a',game:'pokemon',officialCode:'M6a'}),sets),sets[0]);
  assert.equal(setFor(S({id:'jp-m6a',game:'pokemon',region:'JP',officialCode:'M6a'}),sets),sets[0],'日版沒有卡時借台版同代號');
  assert.equal(setFor(S({id:'asia-eb05',officialCode:'eb-05'}),sets),sets[1],'亞洲版 id 不在清單也靠代號對上');
  assert.equal(setFor(S({id:'x',game:'yugioh',officialCode:'EB-05'}),sets),null);
  assert.equal(setFor(S(),null),null,'API 還沒回來或失敗');
  const us=[{game:'pokemon',region:'US',seriesIds:['us-me6'],code:'M6a',hits:[hit(3)]}];
  assert.equal(setFor(S({id:'jp-m6a',game:'pokemon',region:'JP',officialCode:'M6a'}),us),null,'寶可夢美版的系列切法不同，日版不借美版的縮圖');
  assert.equal(setFor(S({id:'us-x',game:'pokemon',region:'US',officialCode:'M6a'}),us),us[0]);
});

test('縮圖：最多 3 張、沒有圖的略過；沒有資料回空陣列（畫面只放系列圖）',()=>{
  assert.deepEqual(hitsOf({hits:[hit(1),hit(2,{imageUrl:null}),hit(3),hit(4),hit(5)]}).map(h=>h.cardId),['c1','c3','c4']);
  assert.deepEqual(hitsOf(null),[]);
  assert.deepEqual(hitsOf({hits:'壞資料'}),[]);
});

test('小資訊：發售日、張數、最高稀有度，知道才寫；未上市寫即將發售',()=>{
  assert.deepEqual(facts(S({metadata:{cardsCount:87}}),[hit(1,{rarityLabel:'SP 卡'})],'2026-11-19'),['10/31','87 張','最高 SP 卡'],'最高稀有度用顯示名稱');
  assert.deepEqual(facts(S(),[hit(1)],'2026-11-19'),['10/31','最高 SP卡'],'沒有顯示名稱就寫原字串');
  assert.deepEqual(facts(S({metadata:{total:141}}),[],'2026-11-19'),['10/31','141 張'],'沒有縮圖資料就不寫最高稀有度');
  assert.deepEqual(facts(S({releaseDate:'2026-12-01',metadata:{cardsCount:0}}),[],'2026-11-19'),['即將發售'],'張數 0 不寫');
  assert.deepEqual(facts(S({releaseDate:'2025-12-20'}),[],'2026-11-19'),['2025/12/20'],'不是今年就寫年份');
  assert.deepEqual(facts(S({releaseDate:null}),[],'2026-11-19'),[]);
});

// 以下用真的 data/rarity-rankings.json 排名；卡片形狀同 /api/cards。
const card=(id,rarity,over={})=>({id,nameZh:`卡${id}`,officialCardNumber:String(id).padStart(3,'0'),rarity,imageUrl:`https://img.test/${id}.png`,printings:[],...over});

test('挑縮圖：依 rarity-rankings.json 排名取前 3，不看本彈大獎資格（遊戲王美版也有）',()=>{
  const ygo={id:'yugioh-us-mams',game:'yugioh',region:'US',officialCode:'MAMS'};
  const out=pickSeriesHits(ygo,[card('1','Common'),card('2','Ultra Rare'),card('3','Secret Rare'),card('4','Rare'),card('5','Ultra Rare')]);
  assert.equal(SERIES_HIT_COUNT,3);
  assert.deepEqual(out.map(r=>r.cardId),['3','2','5']);
  assert.equal(out[0].rarity,'Secret Rare');
  assert.ok(out.every(r=>!('referencePrice' in r)&&'rarityLabel' in r));
});

test('挑縮圖：稀有度顯示名稱用詳細頁同一份（SP卡→SP 卡）；沒有圖、沒有稀有度、無標記的卡不收',()=>{
  const op={id:'onepiece-tw-eb-05',game:'onepiece',region:'TW',officialCode:'EB-05'};
  const out=pickSeriesHits(op,[card('a','SP卡'),card('b','SEC',{imageUrl:null}),card('c',''),card('d',null)]);
  assert.deepEqual(out.map(r=>[r.cardId,r.rarity,r.rarityLabel]),[['a','SP卡','SP 卡']]);
  const pk={id:'pokemon-tw-mf',game:'pokemon',region:'TW',officialCode:'MF'};
  assert.deepEqual(pickSeriesHits(pk,[card('x','NONE'),card('y','NONE')]),[],'只有「無標記」就不放縮圖');
  assert.deepEqual(pickSeriesHits(pk,[card('x',null),card('y','')]),[],'完全沒有稀有度資訊就略過');
  assert.deepEqual(pickSeriesHits(pk,null),[]);
});

test('挑縮圖：同卡號、同名同稀有度（平行版）只留一張；重印用這一彈的稀有度',()=>{
  const pk={id:'pokemon-jp-m6a',game:'pokemon',region:'JP',officialCode:'M6a'};
  const out=pickSeriesHits(pk,[card('1','SAR',{nameZh:'同名'}),card('2','SAR',{nameZh:'同名',officialCardNumber:'002'}),card('3','SAR',{officialCardNumber:'001'}),
    card('4','SAR',{nameZh:'另一張',printings:[{seriesId:'pokemon-jp-m6a',rarity:'UR',localCardNumber:'004'}]})]);
  assert.deepEqual(out.map(r=>[r.cardId,r.rarity]),[['4','UR'],['1','SAR']]);
});

test('首頁會顯示的系列：每個遊戲已發售的最新 N 個、任何版本，未發售與沒日期的不算',()=>{
  const row=(id,game,region,releaseDate)=>({id,game,region,officialCode:id,releaseDate});
  const list=bandSeries([row('us1','yugioh','US','2026-11-12'),row('us2','yugioh','US','2026-11-05'),row('us3','yugioh','US','2026-10-08'),row('us','pokemon','US','2026-09-16'),row('tw','pokemon','TW','2026-09-16'),row('jp','pokemon','JP','2026-09-16'),row('next','pokemon','JP','2026-12-01'),row('none','pokemon','JP',null)],'2026-11-19',2);
  assert.deepEqual(list.map(s=>s.id),['us1','us2','jp','tw'],'每個遊戲 2 個；同日依 日→台→美');
});

test('buildSeriesHits：沒有稀有度資訊的系列不放縮圖；單一系列查詢失敗只略過它；全部失敗才丟錯；同時查詢數有上限',async()=>{
  const series=['a','b','c','d','e'].map((id,n)=>({id,game:'yugioh',region:'US',officialCode:id.toUpperCase(),releaseDate:`2026-11-0${9-n}`}));
  let running=0,peak=0;
  const sets=await buildSeriesHits({series,today:'2026-11-19',perGame:5,concurrency:2,fetchCards:async s=>{
    running++;peak=Math.max(peak,running);await new Promise(resolve=>setTimeout(resolve,2));running--;
    if(s.id==='b')throw new Error('db');
    return s.id==='c'?[card('1',null)]:[card(s.id,'Secret Rare')];
  }});
  assert.deepEqual(sets.map(s=>s.seriesIds[0]),['a','d','e'],'b 失敗、c 沒稀有度都略過，順序保持新到舊');
  assert.deepEqual(j({...sets[0],hits:0}),{game:'yugioh',region:'US',seriesIds:['a'],code:'A',hits:0});
  assert.ok(peak<=2);
  await assert.rejects(buildSeriesHits({series,today:'2026-11-19',fetchCards:async()=>{throw new Error('db')}}),/every lookup failed/);
  assert.deepEqual(await buildSeriesHits({series:[],today:'2026-11-19',fetchCards:async()=>[]}),[]);
});

test('接線：伺服器路由不經過本彈大獎資格、首頁腳本順序、卡片在沒有縮圖資料時照樣畫',async()=>{
  const [server,band,html]=await Promise.all(['../server.mjs','../series-band.js','../index.html'].map(read));
  const hitsLoader=server.slice(server.indexOf('async function loadSeriesHits'),server.indexOf('async function priceHistoryResponse'));
  assert.match(server,/url\.pathname==='\/api\/series-hits'&&req\.method==='GET'/);
  assert.match(hitsLoader,/buildSeriesHits\(\{series:catalog\.series/);
  assert.doesNotMatch(hitsLoader,/PACK_PRIZE_GAMES|prizeSeriesCandidates/,'縮圖不受本彈大獎資格限制');
  assert.match(server,/sort:'rarity-desc',limit:BROWSE_PAGE_MAX/,'/api/pack-prizes 的查詢維持原樣');
  assert.ok(html.indexOf('/series-card.js')>0&&html.indexOf('/series-card.js')<html.indexOf('/series-band.js'));
  assert.match(band,/window\.homeSeriesCard\?homeCard:/,'series-card.js 沒載入時退回舊磚');
  assert.match(band,/fetch\('\/api\/series-hits'\)[^\n]*\.catch\(\(\)=>\{\}\)/,'縮圖 API 失敗不影響卡片');
});
