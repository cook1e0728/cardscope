import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPokemonJpImportSql, pokemonJpPlanDigest, postgresJsonbText } from '../providers/pokemon-jp-import-sql.mjs';

const readPlan = async name => JSON.parse(await readFile(new URL(`../docs/evidence/pokemon-jp/${name}`, import.meta.url), 'utf8'));

test('jsonb text follows PostgreSQL key order and separators', () => {
  assert.equal(postgresJsonbText({ bb: 1, a: [true, null], c: 'x' }), '{"a": [true, null], "c": "x", "bb": 1}');
});

test('plan digests match the values production returned', async () => {
  assert.equal(pokemonJpPlanDigest(await readPlan('SVLN-import-plan-20261001.json')), '48f1dbfe08d5775ba2c2b5dc1deaca7f86910721e1f7a346fcbf249913d91b46');
  assert.equal(pokemonJpPlanDigest(await readPlan('SV6a-import-plan-20261001.json')), 'bcbdb5889dee08b4752889f042d693f9e22bae5ca1a0bff3485debf00a9f6b6b');
});

test('import SQL is guarded by the plan digest and rejects non-derivable cards', async () => {
  const plan = await readPlan('SV6a-import-plan-20261001.json');
  const { digest, sql } = buildPokemonJpImportSql(plan, { actor: 'tester', dryRun: true });
  assert.equal(digest, 'bcbdb5889dee08b4752889f042d693f9e22bae5ca1a0bff3485debf00a9f6b6b');
  assert.match(sql, /= 'bcbdb5889dee08b4752889f042d693f9e22bae5ca1a0bff3485debf00a9f6b6b'\s+then private\.import_pokemon_jp_metadata\(plan, 'tester', true\)/);
  assert.match(sql, /\('090','モモワロウex','SAR'\)/);
  const tampered = { ...plan, cards: plan.cards.map((card, index) => index === 0 ? { ...card, search_text: 'x' } : card) };
  assert.throws(() => buildPokemonJpImportSql(tampered, { actor: 'tester', dryRun: true }), /NOT_DERIVABLE:SV6a-001/);
  assert.throws(() => buildPokemonJpImportSql(plan, { actor: '', dryRun: true }), /ACTOR_REQUIRED/);
});
