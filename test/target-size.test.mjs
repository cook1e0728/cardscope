import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css=await readFile(new URL('../catalog-layout.css',import.meta.url),'utf8');

test('controls have a 44px minimum target size',()=>{
  assert.match(css,/button,select,summary,input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\),\.brand\{min-height:44px\}/);
  assert.match(css,/button\{min-width:44px\}/);
  assert.doesNotMatch(css,/min-height:(3\d|[12]?\d)px\}/,'no rule lowers a control below 44px');
});

test('the tall card filter bar does not stick over cards on phones',()=>{
  const phone=css.match(/@media\(max-width:760px\)\{\.game-context[^\n]*/)[0];
  assert.match(phone,/\.card-tools\{position:static\}/);
});
