import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoundedSnapshotCache, imageSourceOf, summarizeImageHealth} from '../providers/backend-reliability.mjs';

test('snapshot cache serves the last success during a bounded refresh failure',async()=>{
  let now=Date.parse('2026-09-18T00:00:00Z');
  const cache=createBoundedSnapshotCache({ttlMs:100,maxStaleMs:500,now:()=>now});
  const first=await cache.get(async()=>({version:1}));
  assert.equal(first.cache.status,'fresh');
  now+=150;
  const stale=await cache.get(async()=>{throw new Error('temporary outage')});
  assert.deepEqual(stale.data,{version:1});
  assert.equal(stale.cache.status,'stale');
  assert.match(stale.cache.error,/temporary outage/);
  now+=600;
  await assert.rejects(cache.get(async()=>{throw new Error('expired outage')}),/expired outage/);
});

test('image health keeps URL, policy, and real-load sampling as separate states',()=>{
  const images=[
    {cardId:'a',imageUrl:'https://example.test/a.jpg',source:'known'},
    {cardId:'b',imageUrl:'https://example.test/b.jpg',source:'unknown'},
    {cardId:'c',imageUrl:null,source:'known'}
  ];
  const health=summarizeImageHealth({
    cards:[{id:'a'},{id:'b'},{id:'c'}],
    images,
    isDisplayable:row=>row.source==='known'&&Boolean(row.imageUrl),
    isPolicyEligible:row=>row.source==='known'?true:'unknown'
  });
  assert.equal(health.urlRecords,2);
  assert.equal(health.policyEligibleUrlRecords,1);
  assert.equal(health.policyUnknownUrlRecords,1);
  assert.equal(health.displayableCards,1);
  assert.equal(health.sampledLoadStatus,'unknown');
  assert.equal(imageSourceOf({imageSource:'preferred',source:'fallback'}),'preferred');
});

test('a stale-while-revalidate snapshot cache returns the last snapshot at once and refreshes in the background', async () => {
  let clock = 0, loads = 0, release;
  const cache = createBoundedSnapshotCache({ ttlMs: 1000, maxStaleMs: 5000, now: () => clock, serveStaleWhileRevalidate: true });
  assert.equal((await cache.get(async () => { loads++; return 'first'; })).data, 'first');
  clock = 2000;
  const slow = () => new Promise(resolve => { loads++; release = () => resolve('second'); });
  const stale = await cache.get(slow);
  assert.equal(stale.data, 'first');
  assert.equal(stale.cache.status, 'stale');
  assert.equal((await cache.get(slow)).data, 'first', 'a second caller shares the running refresh');
  assert.equal(loads, 2);
  release();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await cache.get(slow)).data, 'second');
  clock = 10000;
  await assert.rejects(cache.get(async () => { throw new Error('down'); }), /down/, 'past the stale window the caller waits and sees the failure');
});
