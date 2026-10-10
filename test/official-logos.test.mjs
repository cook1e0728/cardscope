import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';

const taxonomy=JSON.parse(await readFile(new URL('../data/game-taxonomy.json',import.meta.url),'utf8'));
const visuals=[];
(function walk(node){if(Array.isArray(node))node.forEach(walk);else if(node&&typeof node==='object'){if(node.categoryVisual&&node.id!=='all')visuals.push([node.id,node.categoryVisual]);Object.values(node).forEach(walk)}})(taxonomy);

test('ADR 0028: each game navigates with its official logo, kept locally with its source recorded',async()=>{
  assert.deepEqual(visuals.map(([id])=>id).sort(),['frieren','haikyuu','onepiece','pokemon','yugioh']);
  for(const [id,visual] of visuals){
    assert.equal(visual.kind,'official-logo',id);
    assert.equal(visual.official,true,id);
    assert.match(visual.path,/^\/assets\/ip-logos\/[a-z-]+\.(svg|png)$/,id);
    assert.match(visual.source,/^https:\/\//,id);
    assert.ok((await stat(new URL(`..${visual.path}`,import.meta.url))).size>0,`${id} logo file exists`);
  }
});

test('official SVG logos carry no script and the footer states how logos are used',async()=>{
  for(const name of ['pokemon.svg','haikyuu.svg'])assert.doesNotMatch(await readFile(new URL(`../assets/ip-logos/${name}`,import.meta.url),'utf8'),/<script|javascript:|\son[a-z]+=/i,name);
  assert.match(await readFile(new URL('../index.html',import.meta.url),'utf8'),/官方 Logo 僅用於辨識遊戲，權利人要求時將立即移除/);
});

// Below 760px the tabs overflow the row; without flex:none the logo box shrank to 0–3px and showed as a white line.
test('game-page tab logos keep their box when the tab row overflows',async()=>{
  const css=await readFile(new URL('../theme-binder.css',import.meta.url),'utf8');
  assert.match(css,/body\[data-view="game"\] \.channel\[data-ip\]\{[^}]*flex:none/);
  assert.match(css,/body\[data-view="game"\] \.channel\[data-ip\] \.channel-art\{[^}]*flex:none/);
});
