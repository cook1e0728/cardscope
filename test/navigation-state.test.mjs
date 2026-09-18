import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [navigation,ui,html]=await Promise.all([
  readFile(new URL('../navigation-state.js',import.meta.url),'utf8'),
  readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8'),
  readFile(new URL('../index.html',import.meta.url),'utf8')
]);

test('shareable browsing URLs preserve every public catalog dimension',()=>{
  for(const key of ['game','region','series','rarity','price','sort','q','card','pages'])assert.match(navigation,new RegExp(`params\\.set\\('${key}'`),`${key} is missing from URL state`);
  assert.match(navigation,/popstate/);
  assert.match(navigation,/scrollRestoration='manual'/);
  assert.match(navigation,/scrollY/);
  assert.match(navigation,/loadCardsPage\(false\)/);
  assert.match(navigation,/分享此卡/);
  assert.match(html,/navigation-state\.js/);
});

test('primary catalog content is moved ahead of secondary coverage content',()=>{
  assert.match(navigation,/main\.insertBefore\(guidance,brand\)/);
  assert.match(navigation,/main\.insertBefore\(coverage,brand\)/);
});

test('card detail waits only for core card data',()=>{
  const coreFetch=ui.indexOf("const cr=await fetch('/api/cards/'");
  const optionalFetch=ui.indexOf('Promise.allSettled',coreFetch);
  const coreCheck=ui.indexOf('if(!cr.ok)throw Error',coreFetch);
  assert.ok(coreFetch>=0&&coreCheck>coreFetch&&optionalFetch>coreCheck,'optional market/report requests must start after the core card response succeeds');
  assert.match(ui,/行情服務暫時無法回應；卡片資料仍可正常查看/);
});
