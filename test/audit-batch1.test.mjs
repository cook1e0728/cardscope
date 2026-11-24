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
