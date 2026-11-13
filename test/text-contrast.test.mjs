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

// 重新設計 v2 階段 1（ADR 0056）：look-v2.css 是最後載入的覆蓋層，負責字級下限 12px 與色對比。
const v2=await readFile(new URL('../look-v2.css',import.meta.url),'utf8');
const lum=hex=>{const [r,g,b]=hex.match(/[0-9a-f]{2}/gi).map(x=>parseInt(x,16)/255).map(c=>c<=.03928?c/12.92:((c+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b};
const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05)};
const token=name=>v2.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))[1];

test('look-v2.css text colours keep 4.5:1 on all three layers (WCAG 2.2 AA)',()=>{
  for(const ink of ['v2-ink','v2-ink-2'])for(const layer of ['v2-page','v2-surface','v2-well'])
    assert.ok(ratio(token(ink),token(layer))>=4.5,`${ink} on ${layer}: ${ratio(token(ink),token(layer)).toFixed(2)}`);
  assert.deepEqual(['v2-page','v2-surface','v2-well','v2-line'].map(token).map(c=>c.toUpperCase()),['#F8F5EE','#FFFFFF','#EFEAE0','#E7E1D4'],'the three layers and the line colour from REDESIGN_PLAN section 3');
});

test('no text smaller than 12px: look-v2.css sets none and its floor covers every smaller rule in the other styles',async()=>{
  assert.doesNotMatch(v2,/font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px/,'look-v2.css itself never goes below 12px');
  const floor=v2.slice(v2.indexOf('/* ===== 6.'),v2.indexOf('/* ===== 7.'));
  assert.match(floor,/\)\{font-size:var\(--fs-note\)!important\}/);
  assert.match(v2,/--fs-note:12px/);
  const names=['index.html','catalog-layout.css','look-clean.css','theme-binder.css','look-showcase.css','look-effects.css','look-motion.css','ui-enhancements.js','series-band.js','series-navigator.js','game-switcher.js','price-timeline.js','price-movers.js','look-showcase.js'];
  const uncovered=[];
  for(const [index,source] of (await Promise.all(names.map(file=>readFile(new URL(`../${file}`,import.meta.url),'utf8')))).entries()){
    for(const rule of source.matchAll(/([^{}]+)\{([^{}]*font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px[^{}]*)\}/g))
      for(const selector of rule[1].split(',')){
        const last=[...selector.replace(/:not\([^)]*\)/g,'').matchAll(/\.([\w-]+)/g)].map(match=>match[1]).at(-1);
        if(last&&!floor.includes(`.${last}`))uncovered.push(`${names[index]}: ${selector.trim().slice(-80)}`);
      }
  }
  assert.deepEqual(uncovered,[],'add these selectors to the 12px floor in look-v2.css');
});
