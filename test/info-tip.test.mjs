import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// ⓘ 說明（ui-actions.js 的 window.infoTip）：用 <details>，鍵盤 Enter／Space 是原生行為；這裡測標記、Esc、點外面。
const source=await readFile(new URL('../ui-actions.js',import.meta.url),'utf8');
function setup(open=[]){
  const listeners=[],window={},document={querySelectorAll:()=>open.filter(tip=>tip.open),querySelector:()=>open.find(tip=>tip.open)||null,addEventListener:(type,fn,capture)=>listeners.push({type,fn,capture:Boolean(capture)})};
  vm.runInNewContext(source,{document,window,Object,innerWidth:375});
  return {window,listeners,fire:(type,event)=>listeners.filter(l=>l.type===type).forEach(l=>l.fn(event))};
}

test('infoTip is a details/summary with a 說明 label, escaped, and an aria-hidden glyph',()=>{
  const {window}=setup();
  const html=window.infoTip('a"<b>','<p>內容</p>');
  assert.match(html,/^<details class="info-tip"><summary aria-label="說明：a&#34;&#60;b&#62;"><span aria-hidden="true">ⓘ<\/span><\/summary><div class="info-body"><p>內容<\/p><\/div><\/details>$/);
  assert.doesNotMatch(html,/\son[a-z]+=/);
});

test('Esc closes an open ⓘ first (capture phase, stops the event so a dialog behind stays open) and refocuses its button',()=>{
  const summary={focused:false,focus(){this.focused=true}},tip={open:true,querySelector:()=>summary};
  const {listeners,fire}=setup([tip]);
  assert.ok(listeners.filter(l=>l.type==='keydown').every(l=>l.capture),'must run before the dialog handlers');
  let stopped=0;
  fire('keydown',{key:'Enter',stopPropagation:()=>stopped++});assert.equal(tip.open,true);assert.equal(stopped,0);
  fire('keydown',{key:'Escape',stopPropagation:()=>stopped++});
  assert.deepEqual([tip.open,summary.focused,stopped],[false,true,1]);
  fire('keydown',{key:'Escape',stopPropagation:()=>stopped++});assert.equal(stopped,1,'with nothing open, Esc passes through');
});

test('a click outside closes an open ⓘ; a click inside does not',()=>{
  const inside={},tip={open:true,contains:node=>node===inside};
  const {fire}=setup([tip]);
  fire('click',{target:inside,closest:()=>null});assert.equal(tip.open,true);
  fire('click',{target:{},closest:()=>null});assert.equal(tip.open,false);
});

test('the rules that moved into ⓘ are still reachable: movers source/time/scope, version rules, price scope, collection storage',async()=>{
  const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
  const [movers,ui,html]=await Promise.all(['price-movers.js','ui-enhancements.js','index.html'].map(read));
  // 漲跌榜：標題下只留「不是成交價」，ⓘ 有來源與連結、觀測時間、適用範圍（PRODUCT_PLAN 第 6 節）
  assert.match(movers,/歐洲平台參考價，不是成交價/);
  assert.match(movers,/<b>來源<\/b>[^`]*https:\/\/www\.cardmarket\.com\//);
  assert.match(movers,/<b>觀測時間<\/b>/);
  assert.match(movers,/<b>適用範圍<\/b>/);
  assert.doesNotMatch(movers,/class="trend-scope-note/);
  assert.match(ui,/tipMarkup\('收錄版本的顯示規則'/);
  assert.match(ui,/tipMarkup\('我的收藏的儲存方式與總價',`<p>僅儲存在此裝置，不會送出採購或販售。<\/p>/);
  assert.match(html,/id="priceInfoBody"/);
  assert.match(html,/function setFilterSummary\(text\)\{[^}]*priceScopeNote\(\)/,'the price-scope text (and referenceSortHint side effects) still runs on every render');
  assert.doesNotMatch(html,/<span>一次搜全部遊戲；可先選日版／台版縮小範圍<\/span>/);
});
