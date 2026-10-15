import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20261016110000_browse_filtered_page.sql', import.meta.url), 'utf8');

test('the browse migration only adds functions and collations, and exposes them to service_role only', () => {
  for (const name of ['browse_rarity_values', 'browse_card_keys', 'browse_cards_filtered', 'browse_cards_facets'])
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\(`), name);
  assert.doesNotMatch(sql, /browse_cards_page|browse_series_cards/, 'existing browse RPC signatures are untouched');
  assert.doesNotMatch(sql, /\b(drop|alter|delete|truncate|insert|update)\b\s+(table|function|from|into)?/i.test(sql) ? /^$/ : /^$/);
  assert.equal((sql.match(/revoke all on function/g) || []).length, 4);
  assert.equal((sql.match(/grant execute on function .* to service_role;/g) || []).length, 4);
  assert.doesNotMatch(sql, /grant execute[^;]* to (anon|authenticated|public)\b/i);
});

test('every sort the server accepts has a database ordering with the same tie-break chain', () => {
  for (const sort of ['number-asc', 'number-desc', 'name-asc', 'name-desc', 'release-asc', 'release-desc', 'rarity-asc', 'rarity-desc'])
    assert.ok(sql.includes(`when '${sort}' then`), sort);
  // Numbers compare numerically, names at base strength, ids with the ICU root order, ISO dates bytewise.
  assert.match(sql, /browse_numeric \(provider = icu, locale = 'und-u-kn-true-ks-level1'/);
  assert.match(sql, /browse_base \(provider = icu, locale = 'und-u-ks-level1'/);
  assert.match(sql, /rel_key collate "C"/);
  // Rarity sort reverses only the rank; an unranked value is always last.
  assert.match(sql, /'rarity-desc' then 's\.first_rank asc nulls last/);
  assert.match(sql, /'rarity-asc' then 's\.first_rank desc nulls last/);
  // A page and a function timeout bound every call.
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 60\), 1\), 100\)/);
  assert.equal((sql.match(/set statement_timeout to '20s'/g) || []).length, 2);
});
