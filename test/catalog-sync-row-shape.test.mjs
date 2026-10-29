import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { groupRowsByShape, omitEmptyPrintingRarity, syncCatalog } from '../providers/catalog-sync.mjs';

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

test('printing upsert omits each blank rarity field while preserving supplied evidence',()=>{
  const partial=omitEmptyPrintingRarity({provider_id:'partial',rarity:'Rare Holo',rarity_code:null,rarity_label:'  ',source:'tcgdex-zh-tw'});
  assert.deepEqual(partial,{provider_id:'partial',rarity:'Rare Holo',source:'tcgdex-zh-tw'});
  const prior={rarity:'Common',rarity_code:'C',rarity_label:'C'};
  const sparseMerged={...prior,...partial};
  assert.deepEqual(sparseMerged,{provider_id:'partial',rarity:'Rare Holo',rarity_code:'C',rarity_label:'C',source:'tcgdex-zh-tw'});
  const groups=groupRowsByShape([
    partial,
    omitEmptyPrintingRarity({provider_id:'missing',rarity:null,rarity_code:null,rarity_label:null}),
    omitEmptyPrintingRarity({provider_id:'known',rarity:'Double rare',rarity_code:'RR',rarity_label:'RR'})
  ]);
  assert.equal(groups.length,3);
  for(const group of groups){
    const shape=Object.keys(group[0]).sort().join(',');
    assert.ok(group.every(row=>Object.keys(row).sort().join(',')===shape));
  }
});

test('catalog sync omits missing printing rarity and preserves prior values on sparse merge',async()=>{
  const originalFetch=globalThis.fetch;
  const apiCards=[
    {id:'S10a-001',localId:'001',name:'Card One',image:'https://assets.tcgdex.net/zh-tw/S/S10a/001'},
    {id:'S10a-002',localId:'002',name:'Card Two',image:'https://assets.tcgdex.net/zh-tw/S/S10a/002',rarity:'Double rare'},
    {id:'S10a-003',localId:'003',name:'Card Three',image:'https://assets.tcgdex.net/zh-tw/S/S10a/003',rarity:'   '}
  ];
  const apiSets=[{id:'S10a',name:'Dark Phantasma',cardCount:{total:3}}];
  const stored=new Map([
    ['S10a-001',{provider_id:'S10a-001',rarity:'Secret rare',rarity_code:'SSR',rarity_label:'Secret rare'}],
    ['S10a-002',{provider_id:'S10a-002',rarity:'Common',rarity_code:'C',rarity_label:'C'}]
  ]);
  const submittedBatches=[];
  globalThis.fetch=async input=>{
    const {pathname}=new URL(typeof input==='string'?input:input.url);
    const body=pathname.endsWith('/cards')?apiCards:pathname.endsWith('/sets')?apiSets:null;
    if(!body)throw new Error(`Unexpected provider request: ${pathname}`);
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const result=await syncCatalog(async(path,options={})=>{
      if(path==='/catalog_sync_runs'&&options.method==='POST')return[{id:'sync-test'}];
      if(path.startsWith('/tcg_printings?')){
        const rows=JSON.parse(options.body);
        submittedBatches.push(rows);
        for(const row of rows){
          const previous=stored.get(row.provider_id)||{provider_id:row.provider_id,rarity:null,rarity_code:null,rarity_label:null};
          stored.set(row.provider_id,{...previous,...row});
        }
      }
      return[];
    },{providers:['pokemonZhTw']});

    assert.equal(result.pokemonZhTw.seen,3,JSON.stringify(result.pokemonZhTw));
    assert.equal(submittedBatches.length,2);
    for(const batch of submittedBatches){
      const shape=Object.keys(batch[0]).sort().join(',');
      assert.ok(batch.every(row=>Object.keys(row).sort().join(',')===shape));
    }
    const submitted=submittedBatches.flat();
    const submittedById=new Map(submitted.map(row=>[row.provider_id,row]));
    for(const field of ['rarity','rarity_code','rarity_label']){
      assert.equal(Object.hasOwn(submittedById.get('S10a-001'),field),false);
      assert.equal(Object.hasOwn(submittedById.get('S10a-003'),field),false);
    }
    assert.equal(submittedById.get('S10a-002').rarity,'Double rare');
    assert.equal(submittedById.get('S10a-002').rarity_code,'RR');
    assert.equal(stored.get('S10a-001').rarity,'Secret rare');
    assert.equal(stored.get('S10a-001').rarity_code,'SSR');
    assert.equal(stored.get('S10a-001').rarity_label,'Secret rare');
    assert.equal(stored.get('S10a-002').rarity_label,'RR');
    assert.equal(stored.get('S10a-002').rarity_code,'RR');
    assert.equal(stored.get('S10a-003').rarity,null);
    assert.equal(stored.get('S10a-003').rarity_code,null);
    assert.equal(stored.get('S10a-003').rarity_label,null);
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test('sync upserts skip rows that already hold the same values',async()=>{
  const { onlyChangedRows } = await import('../providers/catalog-sync.mjs');
  const stored=[{id:'a',name_en:'Alpha',metadata:{y:2,x:1},aliases:['A']},{id:'b',name_en:'Beta',metadata:{},aliases:[]}];
  let requested=null;
  const db=async path=>{requested=path;return stored};
  const rows=[
    {id:'a',name_en:'Alpha',metadata:{x:1,y:2},aliases:['A'],updated_at:'now'},
    {id:'b',name_en:'Beta 2',metadata:{},aliases:[],updated_at:'now'},
    {id:'c',name_en:'Gamma',metadata:{},aliases:[],updated_at:'now'}
  ];
  assert.deepEqual((await onlyChangedRows(db,'/tcg_cards',rows,['id'])).map(row=>row.id),['b','c']);
  assert.match(requested,/^\/tcg_cards\?select=id,name_en,metadata,aliases&id=in\.\(/);
  assert.ok(!requested.includes('updated_at'));
  assert.equal(decodeURIComponent(requested.split('id=in.(')[1].slice(0,-1)),'"a","b","c"');
  assert.deepEqual((await onlyChangedRows(async()=>{throw new Error('down')},'/tcg_cards',rows,['id'])).length,3,'a failed read writes everything');
  const printings=[{source:'s',provider_id:'p1',rarity:'C'},{source:'s',provider_id:'p2',rarity:'R'}];
  const kept=await onlyChangedRows(async path=>{requested=path;return [{source:'s',provider_id:'p1',rarity:'C'},{source:'other',provider_id:'p2',rarity:'R'}]},'/tcg_printings',printings,['source','provider_id']);
  assert.match(requested,/provider_id=in\./);
  assert.deepEqual(kept.map(row=>row.provider_id),['p2'],'a same provider id from another source does not count');
});

test('Yu-Gi-Oh sync skips cards without TCG sets and only creates series that cards use (set names compared case-insensitively)',async()=>{
  const originalFetch=globalThis.fetch;
  const apiSets=[
    {set_name:'Burst of Destiny',set_code:'BODE',num_of_cards:2,tcg_date:'2023-11-03'},
    {set_name:"Yu-Gi-Oh! 5D's Tag Force 5 promotional cards",set_code:'TF05',num_of_cards:3,tcg_date:'2010-09-16'},
    {set_name:'Adidas collaboration card',set_code:'ADC1',num_of_cards:1,tcg_date:'2024-02-14'}
  ];
  const apiCards=[
    {id:1,name:'Printed Card',type:'Effect Monster',card_sets:[{set_name:'Burst of Destiny',set_code:'BODE-EN001',set_rarity:'Common'}],card_images:[{id:1,image_url_small:'https://images.ygoprodeck.com/images/cards_small/1.jpg'}]},
    {id:2,name:'Promo Card',type:'Spell Card',card_sets:[{set_name:"Yu-Gi-Oh! 5D's Tag Force 5 Promotional Cards",set_code:'TF05-EN001',set_rarity:'Super Rare'}],card_images:[{id:2}]},
    {id:3,name:'OCG Only Card',type:'Trap Card',card_images:[{id:3}]}
  ];
  const posted=new Map();
  globalThis.fetch=async input=>{
    const url=String(typeof input==='string'?input:input.url);
    const body=url.includes('cardsets.php')?apiSets:url.includes('cardinfo.php')?{data:apiCards}:null;
    if(!body)throw new Error(`Unexpected provider request: ${url}`);
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const result=await syncCatalog(async(path,options={})=>{
      if(path==='/catalog_sync_runs'&&options.method==='POST')return[{id:'sync-test'}];
      if(options.method==='POST'&&path.includes('?on_conflict=')){const table=path.slice(0,path.indexOf('?'));posted.set(table,[...(posted.get(table)||[]),...JSON.parse(options.body)])}
      return[];
    },{providers:['yugioh']});
    assert.equal(result.yugioh.seen,3,JSON.stringify(result.yugioh));
    assert.equal(result.yugioh.metadata.skippedWithoutSets,1);
    assert.deepEqual(posted.get('/tcg_series').map(row=>row.official_code).sort(),['BODE','TF05']);
    assert.deepEqual(posted.get('/tcg_cards').map(row=>row.id).sort(),['yugioh-ygoprodeck-1','yugioh-ygoprodeck-2']);
    const printings=posted.get('/tcg_printings');
    assert.ok(printings.every(row=>row.series_id),JSON.stringify(printings.map(row=>[row.local_card_number,row.series_id])));
    assert.equal(printings.find(row=>row.local_card_number==='TF05-EN001').series_id,'yugioh-ygoprodeck-tf05');
    assert.ok(!printings.some(row=>row.local_set_code==='unspecified'));
  }finally{
    globalThis.fetch=originalFetch;
  }
});
