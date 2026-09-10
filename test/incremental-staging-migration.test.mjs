import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planPriceHistory} from '../providers/price-history.mjs';

const migrationUrl=new URL('../supabase/migrations/20260910_incremental_enrichment_staging.sql',import.meta.url);

test('incremental staging is private and separate from formal catalog coverage',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  for(const table of ['catalog_enrichment_candidates','price_observations']){
    assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql,new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.match(sql,new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
  }
  assert.doesNotMatch(sql,/grant\s+select[^;]+to\s+(anon|authenticated)/i);
});

test('price planner rows match the append-only observation schema',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  const plan=planPriceHistory([{
    source:'pokemon',cardId:'sv4a-347',priceType:'buyback',currency:'JPY',
    amount:12000,observedAt:'2026-09-10T00:00:00.000Z'
  }]);
  const row=plan.upserts[0];
  assert.match(row.observation_key,/^pho_[0-9a-f]{64}$/);
  assert.match(row.comparison_key,/^phc_[0-9a-f]{64}$/);
  for(const column of Object.keys(row))assert.match(sql,new RegExp(`\\b${column}\\b`),`missing migration column: ${column}`);
});
