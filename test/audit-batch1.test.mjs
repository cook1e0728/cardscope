import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// 全站體檢第 1 批（docs/SITE_AUDIT_SPEC_20261124.md）的回歸檢查。
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('HCI-04：使用者在導覽跳出前已經打字或點擊，首次導覽就不自動開，不搶焦點',async()=>{
  const src=await read('look-showcase.js');
  const auto=src.slice(src.indexOf('function maybeAutoStart'),src.indexOf('/* ---------- 5.'));
  assert.match(auto,/\['keydown','pointerdown'\]/,'要記錄使用者的鍵盤與指標動作');
  assert.match(auto,/busy\|\|doc\.activeElement\?\.matches\?\.\('input,textarea,select,\[contenteditable\]'\)/,'正在操作或焦點在輸入框時不開');
});

test('UI-03：首頁寬螢幕深紫頁首上，帳號鈕焦點框改成米白',async()=>{
  const css=await read('look-v2.css');
  assert.match(css,/@media \(min-width:761px\)\{body\[data-view="landing"\] \.top \.account-btn:focus-visible\{outline-color:#F6F1E6\}\}/);
});
