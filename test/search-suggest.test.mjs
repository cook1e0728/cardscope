// 搜尋框即時建議（ui-enhancements.js 的 installSearchSuggest）：讀檔檢查可及性與誤開卡修正的關鍵程式片段。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const ui=await readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8');
const start=ui.indexOf('(function installSearchSuggest(){');
assert.ok(start>0,'找得到 installSearchSuggest');
const block=ui.slice(start);

test('新查詢與新結果會清掉舊 items，Enter／點擊只開目前清單裡存在的列',()=>{
  assert.match(block,/items=\[\];active=-1;input\.removeAttribute\('aria-activedescendant'\)/,'查詢改變時清 items 與 active');
  assert.match(block,/items=\[\];const rows=\[\]/,'render 開頭清 items');
  assert.match(block,/const choose=index=>\{const item=list\.querySelector\(`li\[data-index="\$\{index\}"\]`\)&&items\[index\];if\(!item\)return/,'choose 要有 data-index 的 li 且 items 存在');
  assert.match(block,/ss-stale/,'舊結果在新結果回來前淡化且不可點');
});

test('從建議開卡前先清空輸入框，網址不會帶沒執行過的 q',()=>{
  assert.match(block,/\(\)=>\{input\.value='';openCard\(cardOpenId\(c\)\)\}/);
});

test('輸入法組字中不查，compositionend 再查一次',()=>{
  assert.match(block,/input\.addEventListener\('input',event=>\{if\(event\.isComposing\)clearTimeout\(timer\);else schedule\(\)\}\)/);
  assert.match(block,/input\.addEventListener\('compositionend',schedule\)/);
});

test('render 與關閉都清 aria-activedescendant，並有 role=status 即時播報',()=>{
  const render=block.slice(block.indexOf('const render='),block.indexOf('const fetchSuggest='));
  assert.match(render,/input\.removeAttribute\('aria-activedescendant'\)/);
  const close=block.slice(block.indexOf('const close='),block.indexOf('const runSearch='));
  assert.match(close,/removeAttribute\('aria-activedescendant'\)/);
  assert.match(block,/live\.setAttribute\('role','status'\);live\.setAttribute\('aria-live','polite'\);document\.body\.appendChild\(live\)/);
  assert.match(block,/live\.textContent=items\.length\?`\$\{items\.length\} 筆建議`:'找不到符合的卡'/);
  assert.match(block,/live\.textContent='搜尋中'/);
  assert.match(block,/\.ss-live\{position:absolute;width:1px;height:1px/);
});

test('搜尋中／找不到列是 aria-disabled 的 option，沒有 data-index，不再用 role=presentation',()=>{
  assert.doesNotMatch(block,/role="presentation"/);
  assert.equal([...block.matchAll(/class="ss-state" role="option" aria-disabled="true"/g)].length,2,'搜尋中與找不到各一處');
});

test('選中列有左側 3px 深色條，請求帶 fields=suggest',()=>{
  assert.match(block,/li\[aria-selected=true\]\{box-shadow:inset 3px 0 0 #211C17\}/);
  assert.match(block,/\/api\/search\?limit=6&fields=suggest&q=/);
});
