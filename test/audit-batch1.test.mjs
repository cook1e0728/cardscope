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

test('SEC-01：Worker 對未知 /api 路徑回 404、方法不對回 405（含 HEAD），不再轉給 Render；/api/admin/* 照舊代理',async()=>{
  const {createWorkerHandler}=await import('../worker/index.mjs');
  const {API_CSP}=await import('../providers/http-security.mjs');
  const seen=[];
  const handler=createWorkerHandler({fetchFn:async req=>{seen.push(new URL(req.url||req).pathname);throw new Error('origin down')}});
  const env={ORIGIN_URL:'https://origin.example.test',ASSETS:{async fetch(){return new Response('<!doctype html><title>x</title>',{status:200})}}};
  const call=(path,method='GET')=>handler.fetch(new Request('https://cardseektcg.com'+path,{method}),env);

  const unknown=await call('/api/does-not-exist');
  assert.equal(unknown.status,404);
  assert.equal(unknown.headers.get('content-security-policy'),API_CSP);
  assert.equal(unknown.headers.get('cache-control'),'no-store');
  assert.deepEqual(await unknown.json(),{error:'找不到這個 API'});

  const headGet=await call('/api/hot-cards','HEAD');
  assert.equal(headGet.status,405);
  assert.equal(headGet.headers.get('allow'),'GET');
  assert.equal(await headGet.text(),'','HEAD 不帶內容');

  const getPost=await call('/api/sync/push');
  assert.equal(getPost.status,405);
  assert.equal(getPost.headers.get('allow'),'POST');

  const postGet=await call('/api/cards/pokemon-x','POST');
  assert.equal(postGet.status,405);
  assert.equal(postGet.headers.get('allow'),'GET');

  assert.equal((await call('/api/catalog/health','HEAD')).status,200,'健康檢查的 HEAD 照舊');
  assert.deepEqual(seen,[],'以上都不碰 Render');

  const admin=await call('/api/admin/catalog/health');
  assert.equal(admin.status,502,'管理端點仍代理給 Render（源站停用時降級成 502）');
  assert.deepEqual(seen,['/api/admin/catalog/health']);
});
