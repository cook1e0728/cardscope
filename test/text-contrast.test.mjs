import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const files=['index.html','catalog-layout.css','ui-enhancements.js','game-switcher.js','series-navigator.js','navigation-state.js'];
const sources=await Promise.all(files.map(file=>readFile(new URL(`../${file}`,import.meta.url),'utf8')));

// Measured on the live site: #777 on white is 4.48:1 and #7966c1 on #f7f5fc is 4.33:1, both under WCAG AA 4.5:1 for small text.
test('small text colours that measured below 4.5:1 stay replaced',()=>{
  sources.forEach((source,index)=>{
    assert.doesNotMatch(source,/[{;]color:#777[;}]/,`${files[index]} uses #777 text`);
    assert.doesNotMatch(source,/[{;]color:#7966c1[;}]/,`${files[index]} uses #7966c1 text`);
  });
});
