import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoundedSnapshotCache, createRateLimiter, imageSourceOf, summarizeImageHealth} from '../providers/backend-reliability.mjs';
import {createGradedPrices} from '../providers/graded-prices.mjs';

test('snapshot cache serves the last success during a bounded refresh failure without leaking raw error text',async()=>{
  let now=Date.parse('2026-09-18T00:00:00Z');
  const cache=createBoundedSnapshotCache({ttlMs:100,maxStaleMs:500,now:()=>now});
  const first=await cache.get(async()=>({version:1}));
  assert.equal(first.cache.status,'fresh');
  now+=150;
  const stale=await cache.get(async()=>{throw new Error('SUPABASE_500: relation secret_table does not exist')});
  assert.deepEqual(stale.data,{version:1});
  assert.equal(stale.cache.status,'stale');
  assert.equal(stale.cache.error,'UPSTREAM_UNAVAILABLE');
  assert.equal(/secret_table|SUPABASE/i.test(stale.cache.error),false);
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

test('rate limiter caps tracked keys by sweeping expired keys first and evicting oldest keys when still full', () => {
  let clock = 0;
  const allow = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3, now: () => clock });
  assert.equal(allow('k1'), true);
  assert.equal(allow('k1'), false);
  clock = 500;
  assert.equal(allow('k2'), true);
  assert.equal(allow('k3'), true);
  // At t=1100, k1 is expired while k2 and k3 are active; inserting k4 sweeps k1 and keeps k2/k3 limited.
  clock = 1100;
  assert.equal(allow('k4'), true);
  assert.equal(allow('k2'), false, 'active k2 was not evicted when expired k1 could be swept');
  assert.equal(allow('k3'), false, 'active k3 was not evicted');
  // Map is now full with active [k2, k3, k4]; inserting k5 must evict the oldest active key (k2).
  assert.equal(allow('k5'), true);
  assert.equal(allow('k3'), false, 'newer active k3 stays limited');
  assert.equal(allow('k2'), true, 'evicted oldest key k2 was dropped from the map');
});

test('graded prices deduplicates concurrent in-flight lookups so quota is spent once and failures are not stuck', async () => {
  const jpCard = {
    name: 'Charizard ex - 201/165',
    setName: 'SV2a: Pokemon Card 151',
    cardNumber: '201/165',
    ebay: { salesByGrade: { psa10: { count: 10, medianPrice: 500, minPrice: 400, maxPrice: 600 } } }
  };
  let calls = 0, release;
  const fetchFn = () => {
    calls++;
    return new Promise(resolve => {
      release = resolve;
    });
  };
  const lookup = createGradedPrices({ apiKey: 'k', fetchFn, dailyLimit: 1, now: () => Date.parse('2026-11-03T00:00:00Z') });
  const p1 = lookup({ set: 'SV2a', number: '201' }, 32);
  const p2 = lookup({ set: 'sv2a', number: '201' }, 32);
  assert.equal(calls, 1, 'concurrent identical queries share one upstream fetch');
  release({ ok: true, json: async () => ({ data: [jpCard], metadata: { total: 1 } }) });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual(r1, r2);
  assert.equal(r1.status, 'ok');
  assert.equal(calls, 1);

  // Failed in-flight lookup rejects all waiters and cleans up pending so a retry can proceed.
  let failCalls = 0, releaseFail;
  const failLookup = createGradedPrices({
    apiKey: 'k',
    fetchFn: () => {
      failCalls++;
      return new Promise(resolve => { releaseFail = resolve; });
    },
    dailyLimit: 5,
    now: () => Date.parse('2026-11-03T00:00:00Z')
  });
  const f1 = failLookup({ set: 'SV2a', number: '99' }, 32);
  const f2 = failLookup({ set: 'SV2a', number: '99' }, 32);
  assert.equal(failCalls, 1);
  releaseFail({ ok: false, status: 503 });
  await Promise.all([assert.rejects(f1, /GRADED_503/), assert.rejects(f2, /GRADED_503/)]);
  const retry = failLookup({ set: 'SV2a', number: '99' }, 32);
  assert.equal(failCalls, 2, 'pending map was cleared after failure');
  releaseFail({ ok: true, json: async () => ({ data: [], metadata: { total: 0 } }) });
  assert.equal((await retry).status, 'no-match');
});
