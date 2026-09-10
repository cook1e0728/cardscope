import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET_LOCALE,
  buildYugiohExactIndexes,
  createYugiohZhEnrichmentProvider,
  normalizeTraditionalChineseLocale,
  normalizeYugiohCode,
  normalizeYugiohZhRecord,
  planYugiohZhEnrichment
} from '../providers/yugioh-zh-enrichment.mjs';

const source='approved-yugioh-zh-manifest';
const sourceUrl='https://approved.example.invalid/yugioh/zh-hant.json';
const record=(overrides={})=>({
  game:'yugioh',
  locale:TARGET_LOCALE,
  provider:'ygoprodeck',
  providerCardId:'100',
  nameZh:'青眼白龍',
  source,
  sourceUrl,
  ...overrides
});
const cards=[
  {
    id:'ygo-card-1',game_id:'yugioh',source:'ygoprodeck',provider_id:'100',name_zh:null,
    printings:[{local_set_code:'LOB',local_card_number:'LOB-001'}]
  },
  {
    id:'ygo-card-2',game_id:'yugioh',source:'ygoprodeck',provider_id:'200',name_zh:'黑魔導',
    printings:[{local_set_code:'SDY',local_card_number:'SDY-006'}]
  }
];

test('normalizers preserve exact identifiers and normalize Traditional Chinese locale/code',()=>{
  assert.equal(normalizeTraditionalChineseLocale('zh_TW'),TARGET_LOCALE);
  assert.equal(normalizeTraditionalChineseLocale('zh-Hans-CN'),null);
  assert.equal(normalizeYugiohCode(' lob – 001 '),'LOB-001');
  assert.equal(normalizeYugiohZhRecord({source,provider:'ygoprodeck',providerCardId:'100',name:'Blue-Eyes'}),null);
  assert.equal(normalizeYugiohZhRecord({source,provider:'ygoprodeck',providerCardId:'100',locale:'zh-TW',name:'青眼白龍'}).nameZh,'青眼白龍');
  const normalized=normalizeYugiohZhRecord(record({providerCardId:'00100'}));
  assert.equal(normalized.providerCardId,'00100');
  assert.equal(normalized.provenance.source,source);
  assert.equal(normalizeYugiohZhRecord(record({source:'APPROVED-MANIFEST'})).provenance.source,'APPROVED-MANIFEST');
  assert.equal(normalized.nameZh,'青眼白龍');
});

test('exact provider ID creates both safe patch rows with provenance',()=>{
  const plan=planYugiohZhEnrichment({cards,records:[record()]});
  assert.equal(plan.counts.changed,1);
  assert.equal(plan.results[0].matchedBy,'provider-card-id');
  assert.deepEqual(plan.patches.tcg_cards,[{id:'ygo-card-1',name_zh:'青眼白龍',updated_at:plan.state.generatedAt}]);
  const namePatch=plan.patches.tcg_card_names[0];
  assert.equal(namePatch.card_id,'ygo-card-1');
  assert.equal(namePatch.locale,TARGET_LOCALE);
  assert.equal(namePatch.source,source);
  assert.equal(namePatch.source_url,sourceUrl);
  assert.ok(!Object.entries(plan.patches.tcg_cards[0]).some(([,value])=>value==null));
});

test('exact set/card code matches when stable provider ID is absent',()=>{
  const plan=planYugiohZhEnrichment({cards,records:[record({provider:null,providerCardId:null,setCode:'LOB',cardNumber:'LOB-001',nameZh:'青眼白龍'})]});
  assert.equal(plan.counts.changed,1);
  assert.equal(plan.results[0].matchedBy,'set-card-code');
  assert.equal(plan.patches.tcg_cards[0].id,'ygo-card-1');
});

test('duplicate exact set/card code is rejected as ambiguous',()=>{
  const duplicateCards=[...cards,{id:'ygo-card-3',game_id:'yugioh',source:'another-provider',provider_id:'300',name_zh:null,printings:[{local_set_code:'LOB',local_card_number:'LOB-001'}]}];
  const plan=planYugiohZhEnrichment({cards:duplicateCards,records:[record({provider:null,providerCardId:null,setCode:'LOB',cardNumber:'LOB-001'})]});
  assert.equal(plan.counts.ambiguous,1);
  assert.equal(plan.results[0].reason,'AMBIGUOUS_SET_CARD_CODE');
  assert.deepEqual(plan.patches,{tcg_cards:[],tcg_card_names:[]});
});

test('name-only and provider-namespace mismatches never fall back to fuzzy names',()=>{
  const nameOnly=planYugiohZhEnrichment({cards,records:[record({provider:null,providerCardId:null,nameZh:'黑魔導',nameEn:'Dark Magician'})]});
  assert.equal(nameOnly.counts.unmatched,1);
  assert.equal(nameOnly.results[0].reason,'NO_EXACT_IDENTIFIER');
  const wrongProvider=planYugiohZhEnrichment({cards,records:[record({provider:'unreviewed-provider',providerCardId:'100'})]});
  assert.equal(wrongProvider.counts.unmatched,1);
  assert.equal(wrongProvider.results[0].reason,'NO_EXACT_MATCH');
  assert.deepEqual(wrongProvider.patches,{tcg_cards:[],tcg_card_names:[]});
});

test('existing same Traditional Chinese name is unchanged and conflicting name is held for review',()=>{
  const unchanged=planYugiohZhEnrichment({cards,records:[record({providerCardId:'200',nameZh:'黑魔導'})]});
  assert.equal(unchanged.counts.unchanged,1);
  assert.deepEqual(unchanged.patches,{tcg_cards:[],tcg_card_names:[]});
  const conflict=planYugiohZhEnrichment({cards,records:[record({providerCardId:'200',nameZh:'黑魔導師'})]});
  assert.equal(conflict.counts.ambiguous,1);
  assert.equal(conflict.results[0].reason,'EXISTING_NAME_CONFLICT');
  assert.deepEqual(conflict.patches,{tcg_cards:[],tcg_card_names:[]});
});

test('checksum repeat is skipped and explicit cursor supports incremental reruns',()=>{
  const records=[record({providerCardId:'100',cursor:'001'}),record({providerCardId:'200',nameZh:'黑魔導',cursor:'002'})];
  const first=planYugiohZhEnrichment({cards,records});
  assert.equal(first.counts.changed,1);
  assert.equal(first.counts.unchanged,1);
  const repeat=planYugiohZhEnrichment({cards,records,previousState:first.state});
  assert.equal(repeat.incremental.repeated,true);
  assert.equal(repeat.counts.skippedByChecksum,2);
  assert.equal(repeat.counts.considered,0);
  assert.deepEqual(repeat.patches,{tcg_cards:[],tcg_card_names:[]});
  const incremental=planYugiohZhEnrichment({cards,records,cursor:'001'});
  assert.equal(incremental.counts.skippedByCursor,1);
  assert.equal(incremental.counts.considered,1);
  assert.equal(incremental.state.cursor,'002');
});

test('adapter is external-record-only and does not provide an unreviewed crawler',()=>{
  const provider=createYugiohZhEnrichmentProvider({defaultSource:source,defaultSourceUrl:sourceUrl});
  assert.equal(provider.collectionEnabled,false);
  assert.equal(provider.requiresExternalRecords,true);
  assert.equal(provider.mode,'external-records');
  const plan=provider.plan({cards,records:[record({source:null,sourceUrl:null})]});
  assert.equal(plan.provenance.collection,'external-records-only');
  assert.equal(plan.counts.changed,1);
});

test('exact index keeps provider IDs namespaced and preserves duplicate code evidence',()=>{
  const indexes=buildYugiohExactIndexes(cards);
  assert.equal(indexes.stable.get('stable:provider:yugioh:ygoprodeck:100').size,1);
  assert.equal(indexes.codes.get('code:yugioh:LOB:LOB-001').size,1);
});
