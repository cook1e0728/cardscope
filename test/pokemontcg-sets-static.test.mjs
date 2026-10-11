import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPokemonSeriesRows } from '../providers/catalog-sync.mjs';

// 靜態鏡像 PokemonTCG/pokemon-tcg-data sets/en.json 的縮小 fixture（依發行日升冪、日期為 YYYY/MM/DD）。
const fixture=[
  {id:'base1',name:'Base',series:'Base',printedTotal:102,total:102,ptcgoCode:'BS',releaseDate:'1999/01/09',images:{symbol:'https://images.pokemontcg.io/base1/symbol.png',logo:'https://images.pokemontcg.io/base1/logo.png'}},
  {id:'sv3pt5',name:'151',series:'Scarlet & Violet',printedTotal:165,total:207,ptcgoCode:'MEW',releaseDate:'2023/09/22',images:{symbol:'https://images.pokemontcg.io/sv3pt5/symbol.png',logo:'https://images.pokemontcg.io/sv3pt5/logo.png'}},
  {id:'me5',name:'Example Five',series:'Mega Evolution',printedTotal:90,total:100,releaseDate:'2026/07/17',images:{logo:'https://images.pokemontcg.io/me5/logo.png'}},
  {id:'me55',name:'Example Five Half',series:'Mega Evolution',printedTotal:50,total:60,ptcgoCode:'M55',releaseDate:'2026/09/16'},
  {id:'me55c',name:'Example Five Half Collection',series:'Mega Evolution',printedTotal:10,total:10,releaseDate:'2026/09/16'}
];

test('靜態系列檔轉出的列與舊 API 版本欄位一致',()=>{
  const rows=buildPokemonSeriesRows(fixture,'2026-10-11T00:00:00.000Z');
  const base=rows.find(row=>row.official_code==='base1');
  assert.deepEqual(base,{
    id:'pokemon-pokemontcg-base1',game_id:'pokemon',official_code:'base1',name_zh:null,name_ja:null,name_en:'Base',name_ko:null,
    region:'US',language:'en-US',release_date:'1999-01-09',aliases:['base1','Base','BS'],source_url:'https://www.pokemontcg.io/',
    image_url:'https://images.pokemontcg.io/base1/logo.png',image_kind:'series-logo',source:'pokemontcg',provider_id:'base1',
    metadata:{ptcgoCode:'BS',printedTotal:102,total:102,symbolUrl:'https://images.pokemontcg.io/base1/symbol.png'},updated_at:'2026-10-11T00:00:00.000Z'
  });
  const mew=rows.find(row=>row.official_code==='sv3pt5');
  assert.equal(mew.id,'pokemon-pokemontcg-sv3pt5');
  assert.equal(mew.release_date,'2023-09-22');
  assert.deepEqual(mew.aliases,['sv3pt5','Scarlet & Violet','MEW']);
  const noImages=rows.find(row=>row.official_code==='me55');
  assert.equal(noImages.image_url,null);
  assert.equal(noImages.metadata.symbolUrl,null);
});

test('系列依發行日降冪排列，同日維持檔案順序，並相容舊 API 的 {data} 外框',()=>{
  const rows=buildPokemonSeriesRows(fixture);
  assert.deepEqual(rows.map(row=>row.provider_id),['me55','me55c','me5','sv3pt5','base1']);
  assert.deepEqual(buildPokemonSeriesRows({data:fixture}).map(row=>row.provider_id),rows.map(row=>row.provider_id));
  assert.deepEqual(buildPokemonSeriesRows(null),[]);
  assert.deepEqual(buildPokemonSeriesRows([{name:'no id'}]),[]);
});
