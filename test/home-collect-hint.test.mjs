import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// 柔性登入提示（使用者回報①）：沒登入、沒開同步碼的人，第 3 次收藏成功時提醒一次；其餘情況都不出現。
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const [ui,layout,v2]=await Promise.all(['ui-enhancements.js','catalog-layout.css','look-v2.css'].map(read));
const cut=ui.slice(ui.indexOf('// 柔性登入提示'),ui.indexOf('function setWatchQuantity'));

function setup({signedIn=false,failWrites=false,stored={}}={}){
  const storage=new Map(Object.entries(stored)),nodes={},timers=[],log={sync:0,toast:0};
  const mk=()=>{const handlers={};return {hidden:false,className:'',attrs:{},innerHTML:'',classList:{add(){},remove(){}},setAttribute(k,v){this.attrs[k]=v},addEventListener(t,fn){handlers[t]=fn},click(act){handlers.click({target:{closest:()=>({dataset:{syncHint:act}})}})},contains:()=>false}};
  const body={append(node){nodes[node.id]=node}};
  const sandbox=vm.createContext({
    syncState:signedIn?{google:true}:null,
    uiLocal:{get:(key,fallback)=>storage.get(key)||fallback,set:(key,value)=>{if(failWrites)return false;storage.set(key,value);return true}},
    $:id=>nodes[id]||null,document:{body,activeElement:null,createElement:()=>mk()},
    openSyncDialog:()=>{log.sync++},setTimeout:fn=>timers.push(fn)&&timers.length,clearTimeout(){},
    toastShown:0
  });
  vm.runInContext(cut.replace("let toast=$('brandCollectionToast');","let toast={classList:{add(){log.toast++},remove(){}},setAttribute(){},innerHTML:''};").replace(/if\(!toast\)\{[^}]*\}/,''),sandbox);
  Object.assign(sandbox,{log});
  return {storage,nodes,timers,log,collect:()=>vm.runInContext('showCollectionToast()',sandbox)};
}

test('第 3 次收藏才出現提示；前兩次與之後都只出一般的「已加入收藏」小卡',()=>{
  const t=setup();
  t.collect();t.collect();
  assert.equal(t.nodes.syncHint,undefined);assert.equal(t.log.toast,2);
  t.collect();
  assert.equal(t.log.toast,2,'第 3 次用提示取代小卡，兩張卡不疊在一起');
  const hint=t.nodes.syncHint;
  assert.equal(hint.hidden,false);
  assert.match(hint.innerHTML,/收藏只存在這台裝置的瀏覽器。登入 Google 可以在其他裝置同步。/);
  assert.match(hint.innerHTML,/data-sync-hint="login">登入同步<\/button>/);assert.match(hint.innerHTML,/data-sync-hint="dismiss">不用了<\/button>/);
  assert.equal(hint.attrs.role,'status');
  assert.doesNotMatch(hint.innerHTML,/\son[a-z]+=/);
  assert.equal(t.storage.get('cardscope-sync-hint-seen'),'1');
  hint.hidden=true;t.collect();t.collect();
  assert.equal(t.nodes.syncHint.hidden,true,'看過一次就不再出現');assert.equal(t.log.toast,4);
});

test('「登入同步」開雲端同步對話框、「不用了」只關掉；兩者都收起提示',()=>{
  const login=setup();for(let i=0;i<3;i++)login.collect();
  login.nodes.syncHint.click('login');
  assert.equal(login.log.sync,1);assert.equal(login.nodes.syncHint.hidden,true);
  const skip=setup();for(let i=0;i<3;i++)skip.collect();
  skip.nodes.syncHint.click('dismiss');
  assert.equal(skip.log.sync,0);assert.equal(skip.nodes.syncHint.hidden,true);
});

test('15 秒後自己收起，沒有擋住操作的遮罩',()=>{
  const t=setup();for(let i=0;i<3;i++)t.collect();
  t.timers.at(-1)();
  assert.equal(t.nodes.syncHint.hidden,true);
});

test('已登入或已開同步碼不提示；記錄已看過、或 localStorage 寫不進去也不提示',()=>{
  const signed=setup({signedIn:true});for(let i=0;i<5;i++)signed.collect();
  assert.equal(signed.nodes.syncHint,undefined);assert.equal(signed.log.toast,5);
  const seen=setup({stored:{'cardscope-sync-hint-seen':'1','cardscope-collect-adds':'2'}});seen.collect();
  assert.equal(seen.nodes.syncHint,undefined);
  const broken=setup({failWrites:true});for(let i=0;i<5;i++)broken.collect();
  assert.equal(broken.nodes.syncHint,undefined,'寫不進去就無法記住「看過」，寧可不出現');
});

test('樣式：按鈕至少 44px、固定在角落（不蓋整頁、不用遮罩）、手機停在底部導覽上方、側板開著時移到右上角',()=>{
  const block=layout.slice(layout.indexOf('.sync-hint{position:fixed'),layout.indexOf('.sync-hint button:focus-visible'));
  assert.match(block,/\.sync-hint\{position:fixed;right:22px;bottom:22px/);
  assert.match(block,/\.sync-hint\[hidden\]\{display:none\}/);
  assert.match(block,/\.sync-hint button\{min-width:44px;min-height:44px/);
  assert.doesNotMatch(block,/backdrop|inset:0|width:100(?:vw|%)/);
  assert.match(layout,/\.brand-collection-toast,\.sync-hint\{right:12px;bottom:74px\}/);
  assert.match(v2,/body:has\(#modal\.open\) \.sync-hint\{top:calc/);
  assert.match(ui,/hint\.addEventListener\('click'/);
});
