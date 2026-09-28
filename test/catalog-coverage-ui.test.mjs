import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const root=new URL('..',import.meta.url);
const [html,css]=await Promise.all([
  readFile(new URL('index.html',root),'utf8'),
  readFile(new URL('catalog-layout.css',root),'utf8')
]);

test('coverage status surface renders five IPs from the public coverage response',()=>{
  assert.match(html,/id="coverageStatus"/);
  assert.match(html,/id="coverageStatusGrid"/);
  assert.match(html,/id="coverageStatusSource"/);
  for(const label of ['寶可夢','航海王','遊戲王','葬送的芙莉蓮','排球少年'])assert.match(html,new RegExp(label));
  assert.match(html,/games\[id\]\|\|\{\}/);
  assert.match(html,/目前觀測/);
  assert.match(html,/中文名/);
  assert.match(html,/稀有度/);
  assert.match(html,/可顯示圖片/);
  assert.match(html,/缺口/);
});

test('inline page scripts remain syntactically valid',()=>{
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(([,source])=>source).filter(source=>source.trim());
  assert.ok(scripts.length>0);
  for(const [index,source] of scripts.entries())assert.doesNotThrow(()=>new vm.Script(source),`inline script ${index+1}`);
});

test('coverage status keeps unknown denominators honest and supports future baselines',()=>{
  assert.match(html,/baseline/);
  assert.match(html,/baseline\.kind/);
  assert.match(html,/baseline\.source/);
  assert.match(html,/sourceVerified/);
  assert.match(html,/sourceStatus/);
  assert.match(html,/scope\?\.complete/);
  assert.match(html,/expectedTotal/);
  assert.match(html,/expectedCards/);
  assert.match(html,/officialTotal/);
  assert.match(html,/完整分母未核定/);
  assert.match(html,/來源回報基準（局部）/);
  assert.match(html,/已核定範圍/);
  assert.match(html,/allowPercentage/);
  assert.match(html,/status\.allowPercentage&&status\.value!==null&&cards!==null/);
  assert.match(html,/完整分母未核定的 IP 不顯示完成百分比/);
  assert.doesNotMatch(html,/官方基準/);
  assert.doesNotMatch(html,/官方總數未核定/);
});

test('coverage status layout is responsive and keeps card content shrinkable',()=>{
  assert.match(css,/\.coverage-status-grid\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)/);
  assert.match(css,/\.coverage-status-card\{[^}]*min-width:0/);
  assert.match(css,/\.coverage-status-metrics\{[^}]*min-width:0|\.coverage-status-metrics>div\{[^}]*min-width:0/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.coverage-status-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)/);
  assert.match(css,/@media\(max-width:420px\)[\s\S]*\.coverage-status-grid\{grid-template-columns:1fr/);
});

test('coverage status keeps the existing beta and browsing surfaces intact',()=>{
  assert.match(html,/公開 BETA/);
  assert.match(html,/id="channels"/);
  assert.match(html,/id="browseRegion"/);
  assert.match(html,/id="cards"/);
});

test('catalog status labels bootstrap rows as a sample until a complete database total is verified',()=>{
  const start=html.indexOf('function verifiedCatalogCardTotal('),end=html.indexOf('\nasync function init(',start);
  assert.ok(start>=0&&end>start,'catalog summary helpers must precede init');
  const context=vm.createContext({});
  vm.runInContext(html.slice(start,end),context);
  const summarize=input=>{context.input=input;return vm.runInContext('catalogStatusSummary(input)',context)};
  const sample=summarize({catalog:{cards:Array.from({length:156},()=>({}))},catalogState:'ready',coverage:null,coverageState:'loading',productsState:'ready',productsCount:12});
  assert.match(sample.status,/目前載入樣本：156 張卡片/);
  assert.match(sample.status,/資料庫總數查核中/);
  assert.doesNotMatch(sample.status,/資料庫收錄：156/);
  assert.match(sample.betaStatus,/目前載入樣本 · 156 張收錄/);

  const verified=summarize({catalog:{cards:Array.from({length:156},()=>({}))},catalogState:'ready',coverage:{source:'supabase-current-rows',sample:false,totalCards:48244,metricStatus:{cards:'complete'}},coverageState:'ready',productsState:'ready',productsCount:12});
  assert.match(verified.status,/資料庫目前觀測 48,244 張卡片/);
  assert.doesNotMatch(verified.status,/156 張卡片/);
  assert.match(verified.betaStatus,/48,244 張收錄/);

  const partial=summarize({catalog:{cards:Array.from({length:156},()=>({}))},catalogState:'ready',coverage:{source:'supabase-current-rows',sample:false,totalCards:48244,metricStatus:{cards:'partial'}},coverageState:'ready',productsState:'loading'});
  assert.match(partial.status,/目前載入樣本：156 張卡片/);
  assert.match(partial.status,/資料庫卡片查詢未完成/);
  assert.doesNotMatch(partial.status,/48,244/);

  const fallback=summarize({catalog:{source:'catalog.json',cards:Array.from({length:156},()=>({}))},catalogState:'ready',coverage:{source:'catalog.json',sample:true,totalCards:156,metricStatus:{cards:'catalog-file'}},coverageState:'ready',productsState:'error'});
  assert.match(fallback.status,/本機備援樣本：156 張卡片/);
  assert.match(fallback.status,/資料庫完整總數未核定/);

  const failed=summarize({catalog:{cards:Array.from({length:156},()=>({}))},catalogState:'ready',coverage:null,coverageState:'error',productsState:'ready'});
  assert.match(failed.status,/目前載入樣本：156 張卡片/);
  assert.match(failed.status,/資料庫總數暫時無法查核/);
  const loading=summarize({catalog:{cards:[]},catalogState:'loading',coverage:null,coverageState:'loading',productsState:'loading'});
  assert.match(loading.status,/卡片資料載入中/);
  assert.doesNotMatch(loading.status,/0 張卡片/);
});

test('catalog health labels only verified totals as database counts',async()=>{
  const enhancements=await readFile(new URL('ui-enhancements.js',root),'utf8');
  const helperStart=enhancements.indexOf('function verifiedEnhancementCardTotal('),helperEnd=enhancements.indexOf('\nfunction healthPercent(',helperStart);
  assert.ok(helperStart>=0&&helperEnd>helperStart,'enhancement coverage label helpers must precede healthPercent');
  const context=vm.createContext({betaNumber:value=>value===null||value===undefined?null:Number(value)});
  const healthNumber=enhancements.split('\n').find(line=>line.startsWith('function healthNumber('));
  assert.ok(healthNumber);
  vm.runInContext(healthNumber,context);
  vm.runInContext(enhancements.slice(helperStart,helperEnd),context);
  const label=input=>{context.input=input;return vm.runInContext('enhancementCoverageLabel(input.data,input.loadedCount)',context)};
  assert.equal(label({data:{source:'supabase-current-rows',sample:false,totalCards:48244,metricStatus:{cards:'complete'}},loadedCount:156}),'資料庫目前觀測 48,244 張');
  assert.equal(label({data:{source:'supabase-current-rows',sample:false,totalCards:48244,metricStatus:{cards:'partial'}},loadedCount:156}),'目前載入樣本 156 張；資料庫總數待核');
  assert.equal(label({data:{source:'catalog.json',sample:true,totalCards:156,metricStatus:{cards:'catalog-file'}},loadedCount:156}),'本機備援樣本 156 張；資料庫總數未核定');
  assert.equal(label({data:null,loadedCount:null}),'資料庫總數查核中；尚無載入樣本');
  assert.doesNotMatch(enhancements,/資料庫收錄：\$\{healthTotal/);
});

test('coverage image gaps use the rights-policy displayable count, not the link audit',async()=>{
  const nodes={coverageStatusGrid:{},coverageStatusSource:{},coverageStatusIntro:{},coverageStatusNote:{}};
  const context=vm.createContext({document:{getElementById:id=>nodes[id]||null}});
  for(const prefix of ['const labels=','const escapeValue=','const read=','const number=','const first=','const metric=','const baselineDetails=','const count=','const gap=','const render=']){
    let definition;
    if(prefix==='const metric='){
      const start=html.indexOf('  const metric='),end=html.indexOf('\n  const baselineDetails=',start);
      definition=start>=0&&end>start?html.slice(start,end).trim():null;
    }else definition=html.split('\n').find(line=>line.trim().startsWith(prefix));
    assert.ok(definition,`missing renderer definition: ${prefix}`);
    vm.runInContext(definition,context);
  }
  const render=row=>{
    context.payload={data:{source:'test fixture',games:{yugioh:row}}};
    vm.runInContext('render(payload)',context);
    return nodes.coverageStatusGrid.innerHTML;
  };

  const apiMarkup=render({cards:14609,displayableImages:14556,cardsWithImageUrls:14556,coverage:{images:{covered:14556,status:'complete'},missingImages:{missing:14574}}});
  assert.match(apiMarkup,/<span>可顯示圖片<\/span><b>14,556<\/b><small>缺口 53 張<\/small>/);
  assert.doesNotMatch(apiMarkup,/缺口 14,574 張/);

  const fallbackMarkup=render({cards:14609,displayableImages:35,cardsWithImageUrls:14556,coverage:{images:{covered:null,status:'complete'},missingImages:{missing:14574}}});
  assert.match(fallbackMarkup,/<span>可顯示圖片<\/span><b>35<\/b><small>缺口 14,574 張<\/small>/);

  const urlOnlyMarkup=render({cards:14609,cardsWithImageUrls:14556,coverage:{images:{status:'complete'},missingImages:{missing:0}}});
  assert.match(urlOnlyMarkup,/<span>可顯示圖片<\/span><b>待補<\/b><small>缺口 待核<\/small>/);
});

test('catalog health keeps image URLs separate and reports the displayable gap',async()=>{
  const enhancements=await readFile(new URL('ui-enhancements.js',root),'utf8');
  const healthContext=vm.createContext({
    betaNumber:value=>value===null||value===undefined?null:Number(value),
    e:value=>String(value??''),
    row:{cards:14609,displayableImages:35,cardsWithImageUrls:14556,metricStatus:{images:'catalog-file'}}
  });
  for(const prefix of ['function healthNumber(','function healthPercent(','function healthMetric(']){
    const definition=enhancements.split('\n').find(line=>line.startsWith(prefix));
    assert.ok(definition,`missing health renderer definition: ${prefix}`);
    vm.runInContext(definition,healthContext);
  }
  assert.equal(vm.runInContext("healthNumber(row,['displayableImages','displayable_images'])",healthContext),35);
  assert.equal(vm.runInContext("healthNumber(row,['cardsWithImageUrls','cards_with_image_urls'])",healthContext),14556);
  const displayMarkup=vm.runInContext("healthMetric('可顯示圖片',healthNumber(row,['displayableImages','displayable_images']),row.cards,{showGap:true})",healthContext);
  assert.match(displayMarkup,/>35<\/b>/);
  assert.match(displayMarkup,/缺口 14,574/);
  const urlMarkup=vm.runInContext("healthMetric('已有圖片網址',healthNumber(row,['cardsWithImageUrls','cards_with_image_urls']),row.cards)",healthContext);
  assert.match(urlMarkup,/14,556/);
  assert.doesNotMatch(urlMarkup,/缺口/);
  healthContext.row.metricStatus.images='unknown';
  assert.equal(vm.runInContext("healthNumber(row,['displayableImages','displayable_images'])",healthContext),null);
  healthContext.row.rarities=0;
  healthContext.row.metricStatus.rarities='unknown';
  assert.equal(vm.runInContext("healthNumber(row,['rarities'])",healthContext),null);
});
