import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { refreshBrowseKeys, syncCatalog } from '../providers/catalog-sync.mjs';

const migration = await readFile(new URL('../supabase/migrations/20261017110000_browse_card_keys_materialized.sql', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');

const rpcDb = ({ stale, failBuilds = 0 }) => {
  const calls = [];
  let failed = 0;
  const db = async (path, options = {}) => {
    const name = path.replace('/rpc/', ''), body = options.body ? JSON.parse(options.body) : {};
    calls.push([name, body.p_game ?? null]);
    if (name === 'browse_keys_stale') return stale;
    if (name === 'browse_refresh_keys_build') { if (failed < failBuilds) { failed++; throw new Error('SUPABASE_500:canceling statement due to statement timeout'); } return { game: body.p_game, cards: 3 }; }
    if (name === 'browse_refresh_keys_publish') return { game: body.p_game, cards: 3, ms: 10 };
    throw new Error(`unexpected ${path}`);
  };
  return { db, calls };
};

test('stale games are rebuilt: build then publish, one game at a time, and nothing else is touched', async () => {
  const { db, calls } = rpcDb({ stale: ['pokemon', 'yugioh'] });
  const result = await refreshBrowseKeys(db);
  assert.deepEqual(calls, [['browse_keys_stale', null], ['browse_refresh_keys_build', 'pokemon'], ['browse_refresh_keys_publish', 'pokemon'], ['browse_refresh_keys_build', 'yugioh'], ['browse_refresh_keys_publish', 'yugioh']]);
  assert.deepEqual(Object.keys(result), ['pokemon', 'yugioh']);
  assert.equal(result.pokemon.attempts, 1);
});

test('a build that is cut by the 20 s request limit is retried (the pages it read stay cached) and then published', async () => {
  const { db, calls } = rpcDb({ stale: ['pokemon'], failBuilds: 2 });
  const result = await refreshBrowseKeys(db);
  assert.equal(result.pokemon.attempts, 3);
  assert.equal(result.pokemon.published.cards, 3);
  assert.deepEqual(calls.map(call => call[0]), ['browse_keys_stale', 'browse_refresh_keys_build', 'browse_refresh_keys_build', 'browse_refresh_keys_build', 'browse_refresh_keys_publish']);
  const { db: db2 } = rpcDb({ stale: ['pokemon'], failBuilds: 9 });
  const failed = await refreshBrowseKeys(db2);
  assert.match(failed.pokemon.error, /statement timeout/);
  assert.equal(failed.pokemon.attempts, 3, 'gives up after three tries and leaves the slow, correct live query in place');
});

test('only the requested games are rebuilt, and fresh games are skipped', async () => {
  const { db, calls } = rpcDb({ stale: ['pokemon', 'onepiece'] });
  const result = await refreshBrowseKeys(db, { games: ['onepiece', 'yugioh'] });
  assert.deepEqual(Object.keys(result), ['onepiece']);
  assert.equal(calls.filter(call => call[0] === 'browse_refresh_keys_build').length, 1);
  const none = await refreshBrowseKeys(rpcDb({ stale: [] }).db);
  assert.deepEqual(none, {});
});

test('the end of every catalog sync rebuilds stale keys, and a rebuild failure never fails the sync', async () => {
  const { db, calls } = rpcDb({ stale: ['yugioh'] });
  const result = await syncCatalog(db, { providers: [] });
  assert.deepEqual(calls.map(call => call[0]), ['browse_keys_stale', 'browse_refresh_keys_build', 'browse_refresh_keys_publish']);
  assert.equal(result.browseKeys.yugioh.published.cards, 3);
  const quiet = await syncCatalog(rpcDb({ stale: [] }).db, { providers: [] });
  assert.ok(!('browseKeys' in quiet), 'nothing stale, nothing reported');
  const broken = await syncCatalog(async () => { throw new Error('SUPABASE_503'); }, { providers: [] });
  assert.match(broken.browseKeys.error, /SUPABASE_503/);
});

test('the scheduled server tick also heals stale keys (manual SQL batches are noticed by the triggers)', () => {
  assert.match(server, /import \{[^}]*refreshBrowseKeys[^}]*\} from '\.\/providers\/catalog-sync\.mjs'/);
  assert.match(server, /scheduled catalog sync complete[^\n]*\{const keys=await refreshBrowseKeys\(supabaseFetch\)/);
});

test('the migration keeps the public RPC signatures, falls back to the live query, and watches both tables', () => {
  for (const signature of ['browse_rarity_values(p_game text)', 'browse_cards_facets(p_game text, p_region text, p_rmap jsonb)', 'browse_cards_filtered(p_game text, p_region text, p_token text, p_sort text, p_limit integer, p_offset integer, p_rmap jsonb)'])
    assert.ok(migration.includes(`create or replace function public.${signature}`), signature);
  for (const name of ['browse_rarity_values', 'browse_cards_facets', 'browse_cards_filtered']) {
    assert.match(migration, new RegExp(`alter function public\\.${name}\\([^)]*\\) rename to ${name}_live`));
    assert.match(migration, new RegExp(`return public\\.${name}_live\\(`));
    assert.match(migration, new RegExp(`browse_keys_fresh\\(p_game\\) then return public\\.${name}_mat\\(`));
  }
  assert.equal((migration.match(/create trigger browse_note_(cards|printings)_(insert|update|delete|truncate)/g) || []).length, 8);
  assert.match(migration, /after truncate on public\.tcg_cards/);
  assert.match(migration, /after truncate on public\.tcg_printings/);
  // The image columns are deliberately not watched (the server's image cache rewrites them continuously).
  const printingTrigger = migration.slice(migration.indexOf('function public.browse_note_printing_change()'), migration.indexOf('drop trigger if exists browse_note_cards_insert'));
  assert.ok(printingTrigger.length > 500);
  assert.doesNotMatch(printingTrigger, /image_url|image_rehost/);
});

test('a rebuild clears only the changes it saw before reading, and flips the generation in one transaction', () => {
  assert.match(migration, /v_seen := array\(select ch\.id from public\.browse_key_changes ch where ch\.game_id = p_game\);/);
  assert.match(migration, /delete from public\.browse_key_changes where id = any\(v_pend\.seen\);/);
  assert.match(migration, /exists \(select 1 from public\.browse_key_state s where s\.game_id = p_game\)\s+and not exists \(select 1 from public\.browse_key_changes c where c\.game_id = p_game\)/);
  assert.match(migration, /m\.gen = coalesce\(\$7, \(select s\.gen from public\.browse_key_state s where s\.game_id = \$1\)\)/);
});

test('the new tables and functions are reachable by service_role only', () => {
  assert.doesNotMatch(migration, /grant [^;]* to (anon|authenticated|public)\b/i);
  for (const table of ['browse_card_keys_mat', 'browse_key_raws', 'browse_key_facets', 'browse_key_state', 'browse_key_changes', 'browse_key_pending'])
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`), table);
  for (const fn of ['browse_refresh_keys(text, boolean)', 'browse_refresh_keys_build(text)', 'browse_refresh_keys_publish(text)', 'browse_keys_stale()', 'browse_keys_fresh(text)'])
    assert.ok(migration.includes(`grant execute on function public.${fn} to service_role;`), fn);
});
