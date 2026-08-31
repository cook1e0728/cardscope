import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port=4197;
let server;

test.before(async()=>{
  server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),SUPABASE_URL:'',SUPABASE_SERVICE_KEY:''},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server start timeout')),5000);server.once('error',reject);server.stdout.on('data',chunk=>{if(String(chunk).includes('CardScope is running')){clearTimeout(timer);resolve()}})});
});

test.after(()=>server?.kill());

async function api(path){const response=await fetch(`http://127.0.0.1:${port}${path}`);assert.equal(response.status,200);return response.json()}

test('catalog exposes canonical cards with images and printing metadata',async()=>{
  const {data}=await api('/api/catalog');
  assert.equal(data.source,'catalog.json');
  assert.ok(data.cards.length>=5);
  for(const card of data.cards){assert.ok(card.id===card.canonicalId);assert.ok(card.imageUrl);assert.ok(card.printings.length);assert.ok(card.printings[0].region);assert.ok(card.printings[0].language)}
});

test('product feed never promotes a single card as a box or series image',{timeout:45000},async()=>{
  const {data}=await api('/api/products');
  assert.ok(data.length);
  assert.ok(data.every(item=>item.imageKind!=='card'));
  for(const item of data.filter(item=>item.source==='curated-official-index')){
    assert.equal(item.imageUrl,null);
    assert.equal(item.cardsCount,null);
    assert.equal(item.productType,'系列');
  }
});

for(const [query,expected] of [
  ['噴火龍','Charizard'],['Charizard','Charizard'],['リザードン','Charizard'],
  ['超夢','Mewtwo'],['Mewtwo','Mewtwo'],['ミュウツー','Mewtwo'],
  ['夢幻','Mew ex'],['Mew','Mew ex'],['ミュウ','Mew ex'],
  ['魯夫','Monkey.D.Luffy'],['黑魔導女孩','Dark Magician Girl']
])test(`multilingual search: ${query}`,async()=>{const {data,meta}=await api(`/api/search?q=${encodeURIComponent(query)}`);assert.equal(meta.architecture,'canonical-card-with-printings');assert.equal(data.length,1,`${query} should prefer one exact multilingual name`);assert.equal(data[0].nameEn,expected)});
