import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PriceHistoryValidationError,
  assertPriceSourceAllowed,
  buildPriceHistoryCoverage,
  comparePriceObservations,
  encodePriceHistoryCursor,
  normalizePriceObservation,
  planPriceHistory
} from '../providers/price-history.mjs';

const observation=(overrides={})=>({
  source:'pokemon',
  cardId:'sv4a-347',
  priceType:'buyback',
  currency:'JPY',
  amount:12000,
  observedAt:'2026-09-01T00:00:00.000Z',
  ...overrides
});

test('disabled source policy is explicit and cannot be overridden',()=>{
  assert.throws(()=>assertPriceSourceAllowed('yuyutei'),error=>error instanceof PriceHistoryValidationError&&error.code==='SOURCE_POLICY_BLOCKED');
  assert.throws(()=>normalizePriceObservation(observation({source:'yuyutei'})),error=>error.code==='SOURCE_POLICY_BLOCKED');
  assert.throws(()=>normalizePriceObservation(observation({source:'yuyutei'}),{approvedSources:['yuyutei']}),error=>error.code==='SOURCE_POLICY_BLOCKED');
});

test('unknown external source requires an explicit approval',()=>{
  assert.throws(()=>normalizePriceObservation(observation({source:'partner-feed'})),error=>error.code==='SOURCE_POLICY_UNKNOWN');
  const row=normalizePriceObservation(observation({source:'partner-feed'}),{approvedSources:['partner-feed']});
  assert.equal(row.source,'partner-feed');
  assert.equal(row.policy_status,'enabled');
});

test('observation validation requires price dimensions, stable identity and timestamp',()=>{
  assert.throws(()=>normalizePriceObservation(observation({cardId:null})),error=>error.code==='CARD_IDENTITY_REQUIRED');
  assert.throws(()=>normalizePriceObservation(observation({priceType:null})),error=>error.code==='PRICE_TYPE_REQUIRED');
  assert.throws(()=>normalizePriceObservation(observation({currency:'NT$'})),error=>error.code==='CURRENCY_INVALID');
  assert.throws(()=>normalizePriceObservation(observation({amount:'not-a-price'})),error=>error.code==='AMOUNT_INVALID');
  assert.throws(()=>normalizePriceObservation(observation({observedAt:'not-a-date'})),error=>error.code==='TIMESTAMP_INVALID');
  assert.throws(()=>normalizePriceObservation({source:'pokemon',priceType:'buyback',currency:'JPY',amount:1,observedAt:'2026-09-01T00:00:00Z',cardName:'皮卡丘'}),error=>error.code==='CARD_IDENTITY_REQUIRED');
});

test('observation keys are deterministic and exact duplicates are idempotent',()=>{
  const first=normalizePriceObservation(observation());
  const reordered=normalizePriceObservation({observedAt:observation().observedAt,amount:12000,currency:'jpy',priceType:'BUYBACK',card_id:'sv4a-347',provider:'pokemon'});
  assert.equal(first.observation_key,reordered.observation_key);
  const plan=planPriceHistory([observation(),observation()],{existingObservations:[]});
  assert.equal(plan.accepted,1);
  assert.equal(plan.skipped.duplicates,1);
  const replay=planPriceHistory([observation()],{existingObservations:plan.upserts});
  assert.equal(replay.accepted,0);
  assert.equal(replay.skipped.duplicates,1);
});

test('unchanged snapshots are skipped and changed snapshots link and calculate changes',()=>{
  const base=observation();
  const plan=planPriceHistory([
    base,
    observation({amount:12000,observedAt:'2026-09-02T00:00:00.000Z'}),
    observation({amount:15000,observedAt:'2026-09-03T00:00:00.000Z'})
  ]);
  assert.equal(plan.accepted,2);
  assert.equal(plan.skipped.unchanged,1);
  const changed=plan.upserts.at(-1);
  assert.equal(changed.previous_observation_key,plan.upserts[0].observation_key);
  assert.equal(changed.comparison_key,plan.upserts[0].comparison_key);
  assert.match(changed.comparison_key,/^phc_[0-9a-f]{64}$/);
  assert.equal(changed.change_amount,3000);
  assert.equal(changed.change_percent,25);
  assert.equal(changed.change_direction,'up');
});

test('comparisons never cross source, price type, currency or card identity',()=>{
  const previous=normalizePriceObservation(observation({amount:10000}));
  for(const overrides of [
    {source:'yugioh'},
    {priceType:'listing'},
    {currency:'USD'},
    {cardId:'other-card'}
  ]){
    const current=normalizePriceObservation(observation({amount:12000,...overrides}),{approvedSources:['yugioh']});
    const result=comparePriceObservations(previous,current);
    assert.equal(result.comparable,false);
    assert.equal(result.reason,'DIMENSION_MISMATCH');
  }
  const comparable=comparePriceObservations(previous,normalizePriceObservation(observation({amount:12000,observedAt:'2026-09-02T00:00:00Z'})));
  assert.equal(comparable.comparable,true);
  assert.equal(comparable.changePercent,20);
});

test('bounded plans support deterministic cursor resume',()=>{
  const rows=[1,2,3].map(index=>observation({amount:10000+index*100,observedAt:`2026-09-0${index}T00:00:00.000Z`}));
  const first=planPriceHistory(rows,{limit:2});
  assert.equal(first.scanned,2);
  assert.equal(first.hasMore,true);
  assert.ok(first.nextCursor);
  const second=planPriceHistory(rows,{limit:2,cursor:first.nextCursor,existingObservations:first.upserts});
  assert.equal(second.scanned,1);
  assert.equal(second.accepted,1);
  assert.equal(second.hasMore,false);
  assert.equal(second.nextCursor,null);
  assert.equal(encodePriceHistoryCursor(normalizePriceObservation(rows[1])),first.nextCursor);
});

test('coverage metadata is honest about source scope and missing denominators',()=>{
  const coverage=buildPriceHistoryCoverage([
    observation({amount:10000}),
    observation({amount:11000,observedAt:'2026-09-02T00:00:00Z',cardId:'sv4a-348'})
  ]);
  assert.equal(coverage.scope,'approved-external-observations');
  assert.equal(coverage.sample,true);
  assert.equal(coverage.complete,false);
  assert.equal(coverage.completeness,'unknown');
  assert.equal(coverage.denominatorStatus,'unknown');
  assert.deepEqual(coverage.sources,['pokemon']);
  assert.deepEqual(coverage.priceTypes,['buyback']);
  assert.equal(coverage.uniqueCards,2);
  assert.equal(coverage.observationWindow.earliest,'2026-09-01T00:00:00.000Z');
  assert.equal(coverage.observationWindow.latest,'2026-09-02T00:00:00.000Z');
});
