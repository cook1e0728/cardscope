import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { groupRowsByShape } from '../providers/catalog-sync.mjs';

test('bulk catalog writes group records by identical PostgREST key shape',()=>{
  const groups=groupRowsByShape([
    {id:'a',name_en:'Alpha',name_zh:'阿爾法'},
    {id:'b',name_en:'Beta'},
    {name_en:'Gamma',id:'c'},
    null
  ]);
  assert.equal(groups.length,2);
  assert.deepEqual(groups.map(group=>group.map(row=>row.id)),[['a'],['b','c']]);
  for(const group of groups){
    const signature=Object.keys(group[0]).sort().join(',');
    assert.ok(group.every(row=>Object.keys(row).sort().join(',')===signature));
  }
});

test('grouping preserves omitted protected fields instead of adding nulls',()=>{
  const [withoutZh,withZh]=groupRowsByShape([
    {id:'missing',name_en:'Existing'},
    {id:'translated',name_en:'Named',name_zh:'名稱'}
  ]).sort((a,b)=>Object.keys(a[0]).length-Object.keys(b[0]).length);
  assert.equal(Object.hasOwn(withoutZh[0],'name_zh'),false);
  assert.equal(withZh[0].name_zh,'名稱');
});

test('catalog sync guards empty enrichment evidence and uses physical Yu-Gi-Oh printing identity',async()=>{
  const source=await readFile(new URL('../providers/catalog-sync.mjs',import.meta.url),'utf8');
  assert.match(source,/names=\(names\|\|\[\]\)\.filter\(Boolean\)/);
  assert.match(source,/rarities=\(rarities\|\|\[\]\)\.filter\(Boolean\)/);
  assert.match(source,/upsert\(db,'\/tcg_printings',printings,'card_id,region,language,local_set_code,local_card_number'\)/);
});
