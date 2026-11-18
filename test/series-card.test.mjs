import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {seriesHitRows,SERIES_HIT_COUNT} from '../providers/pack-prizes.mjs';

// 首頁最新系列卡片的資料邏輯（series-card.js）；系列樣本取自 2026-11 正式站目錄的實際欄位。
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

test('大獎資料對應：先看系列 id（同一彈各版本），再看遊戲＋代號；別的遊戲同代號不算',()=>{
  const sets=[{game:'pokemon',seriesIds:['tw-m6a','jp-m6a'],code:'M6a',hits:[hit(1)]},{game:'onepiece',seriesIds:['tw-eb05'],code:'EB-05',hits:[hit(2)]}];
  assert.equal(setFor(S({id:'jp-m6a',game:'pokemon',officialCode:'M6a'}),sets),sets[0]);
  assert.equal(setFor(S({id:'asia-eb05',officialCode:'eb-05'}),sets),sets[1],'亞洲版 id 不在清單也靠代號對上');
  assert.equal(setFor(S({id:'x',game:'yugioh',officialCode:'EB-05'}),sets),null);
  assert.equal(setFor(S(),null),null,'API 還沒回來或失敗');
});

test('縮圖：最多 3 張、沒有圖的略過；沒有資料回空陣列（畫面只放系列圖）',()=>{
  assert.deepEqual(hitsOf({hits:[hit(1),hit(2,{imageUrl:null}),hit(3),hit(4),hit(5)]}).map(h=>h.cardId),['c1','c3','c4']);
  assert.deepEqual(hitsOf(null),[]);
  assert.deepEqual(hitsOf({hits:'壞資料'}),[]);
});

test('小資訊：發售日、張數、最高稀有度，知道才寫；未上市寫即將發售',()=>{
  assert.deepEqual(facts(S({metadata:{cardsCount:87}}),[hit(1)],'2026-11-19'),['2026/10/31','87 張','最高 SP卡']);
  assert.deepEqual(facts(S({metadata:{total:141}}),[],'2026-11-19'),['2026/10/31','141 張'],'沒有大獎資料就不寫最高稀有度');
  assert.deepEqual(facts(S({releaseDate:'2026-12-01',metadata:{cardsCount:0}}),[],'2026-11-19'),['即將發售'],'張數 0 不寫');
  assert.deepEqual(facts(S({releaseDate:null}),[],'2026-11-19'),[]);
});

test('seriesHitRows：只留有圖的前 3 張、不帶參考價',()=>{
  const row=(n,over={})=>({cardId:`c${n}`,name:`卡${n}`,cardNumber:String(n),rarity:'SAR',altArt:undefined,imageUrl:`https://img.test/${n}.png`,referencePrice:{amount:9},seriesCode:'M6a',...over});
  const out=seriesHitRows([row(1,{imageUrl:null}),row(2),row(3),row(4),row(5)]);
  assert.equal(SERIES_HIT_COUNT,3);
  assert.deepEqual(out.map(r=>r.cardId),['c2','c3','c4']);
  assert.ok(out.every(r=>!('referencePrice' in r)&&!('seriesCode' in r)&&r.altArt===false));
  assert.deepEqual(seriesHitRows(null),[]);
});

test('接線：伺服器路由、首頁腳本順序、卡片在沒有縮圖資料時照樣畫',async()=>{
  const [server,band,html]=await Promise.all(['../server.mjs','../series-band.js','../index.html'].map(read));
  assert.match(server,/url\.pathname==='\/api\/series-hits'&&req\.method==='GET'/);
  assert.match(server,/seriesHitRows\(await releasePrizeRows\(rule,release\)\)/);
  assert.ok(html.indexOf('/series-card.js')>0&&html.indexOf('/series-card.js')<html.indexOf('/series-band.js'));
  assert.match(band,/window\.homeSeriesCard\?homeCard:/,'series-card.js 沒載入時退回舊磚');
  assert.match(band,/fetch\('\/api\/series-hits'\)[^\n]*\.catch\(\(\)=>\{\}\)/,'縮圖 API 失敗不影響卡片');
});
