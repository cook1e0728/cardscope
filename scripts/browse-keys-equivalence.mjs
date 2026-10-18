// Compares the live (whole-game scan) browse RPCs with the materialized-key ones on production data, read-only.
//   node scripts/browse-keys-equivalence.mjs list                       print the chunks that would run
//   node scripts/browse-keys-equivalence.mjs run [--game pokemon] [--chunk 14] [--every 1] [--only pages|rest]   (rest = facets and rarity values, which read published tables)
//   node scripts/browse-keys-equivalence.mjs sql <chunk-index> [--game ...]  print the comparison query of one chunk (used by the rollback test)
// Needs browse_refresh_keys_build(game) (pending generation, checked before publishing) or a published refresh first. Each combination calls
// browse_cards_filtered_live and browse_cards_filtered_mat with the same arguments (rarity map built here with the server's own normalizers)
// and compares the whole jsonb answer: total, unmapped flag, and for the page every card with printings and images, in order.
// Facets, rarity values and the "unmapped" report (a rarity map missing a value) are compared too.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rarityCanonicalCode, rarityRank, rarityToken } from '../providers/normalize.mjs';

const GAMES = ['pokemon', 'yugioh', 'onepiece', 'weiss-schwarz', 'haikyuu'];
const SORTS = ['number-asc', 'number-desc', 'name-asc', 'name-desc', 'release-asc', 'release-desc', 'rarity-desc', 'rarity-asc'];
const [command = 'list', ...rest] = process.argv.slice(2);
const option = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i === -1 ? fallback : rest[i + 1]; };
const games = option('game') ? [option('game')] : GAMES;
const chunkSize = Number(option('chunk', 14)), every = Number(option('every', 1));
const scratch = mkdtempSync(join(tmpdir(), 'browse-keys-'));
const runSql = sql => { const file = join(scratch, 'q.sql'); writeFileSync(file, sql); return JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./run-sql.mjs', import.meta.url)), file], { encoding: 'utf8', maxBuffer: 1 << 28 })); };
const literal = value => `'${String(value).replace(/'/g, "''")}'`;

function rarityMap(game, raws) {
  return raws.map(raw => {
    const code = rarityCanonicalCode(game, raw), rank = code ? rarityRank(game, code) : Number.MAX_SAFE_INTEGER;
    return { raw, code, token: code ? rarityToken(code) : null, rank: rank === Number.MAX_SAFE_INTEGER ? null : rank };
  });
}

function plan() {
  const combos = [], maps = {}, facetJobs = [], rawJobs = [];
  for (const game of games) {
    const raws = runSql(`select coalesce(jsonb_agg(v order by v), '[]') as raws from (select rarity v from public.tcg_cards where game_id = ${literal(game)} and rarity is not null union select p.rarity from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where c.game_id = ${literal(game)} and p.rarity is not null union select p.rarity_code from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where c.game_id = ${literal(game)} and p.rarity_code is not null union select p.rarity_label from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where c.game_id = ${literal(game)} and p.rarity_label is not null) t`)[0].raws;
    const regions = runSql(`select coalesce(jsonb_agg(distinct p.region), '[]') as r from public.tcg_printings p join public.tcg_cards c on c.id = p.card_id where c.game_id = ${literal(game)} and p.region is not null`)[0].r;
    const freq = runSql(`select rarity, count(*)::int n from public.tcg_cards where game_id = ${literal(game)} and rarity is not null and btrim(rarity) <> '' group by 1 order by 2 desc, 1`);
    const map = rarityMap(game, raws);
    maps[game] = map;
    // Filters: none, the most frequent, the second most frequent and the rarest card rarity, an alias spelling of the most frequent token, and a rarity nobody has.
    const tokens = [null];
    const add = value => { const code = rarityCanonicalCode(game, value), token = code ? rarityToken(code) : null; if (token && !tokens.includes(token)) tokens.push(token); };
    if (freq[0]) add(freq[0].rarity);
    if (freq[1]) add(freq[1].rarity);
    if (freq.length > 2) add(freq.at(-1).rarity);
    const top = freq[0]?.rarity && map.find(row => row.token && row.token === rarityToken(rarityCanonicalCode(game, freq[0].rarity)) && row.raw !== freq[0].rarity);
    if (top) add(top.raw);
    add('ZZ-NOT-A-RARITY');
    for (const sort of SORTS) for (const token of tokens) for (const offset of [0, 100]) combos.push({ game, region: null, token, sort, offset, map: 'full', label: `${game}|all|${token || '-'}|${sort}|${offset}` });
    for (const region of regions) {
      for (const sort of ['number-asc', 'name-desc', 'release-asc', 'rarity-desc']) for (const token of tokens.slice(0, 2)) combos.push({ game, region, token, sort, offset: 0, map: 'full', label: `${game}|${region}|${token || '-'}|${sort}|0` });
      facetJobs.push({ game, region, label: `facets|${game}|${region}` });
    }
    facetJobs.push({ game, region: null, label: `facets|${game}|all` });
    // A rarity map that lacks one value must report unmapped on both paths (and still agree on everything else).
    const trimmed = map.filter((row, index) => index !== Math.floor(map.length / 2));
    maps[`${game}:trimmed`] = trimmed;
    for (const sort of ['rarity-desc', 'number-asc']) combos.push({ game, region: null, token: tokens[1] || null, sort, offset: 0, map: 'trimmed', label: `${game}|all|trimmed|${sort}|0` });
    facetJobs.push({ game, region: null, label: `facets|${game}|all|trimmed`, trimmed: true });
    rawJobs.push({ game, label: `rarity-values|${game}` });
  }
  const picked = combos.filter((_, index) => index % every === 0);
  const chunks = [];
  const mapsCte = keys => `maps(k, rmap) as (values\n    ${[...new Set(keys)].map(key => `(${literal(key)}, ${literal(JSON.stringify(maps[key]))}::jsonb)`).join(',\n    ')})`;
  for (let i = 0; i < picked.length; i += chunkSize) chunks.push({ kind: 'pages', items: picked.slice(i, i + chunkSize) });
  chunks.push({ kind: 'facets', items: facetJobs }, { kind: 'raws', items: rawJobs });
  return { chunks, mapsFor: mapsCte };
}

function chunkSql({ kind, items }, mapsFor) {
  if (kind === 'pages') {
    const mapsCte = mapsFor(items.map(item => (item.map === 'trimmed' ? `${item.game}:trimmed` : item.game)));
    const values = items.map(item => `(${literal(item.label)}, ${literal(item.game)}, ${item.region ? literal(item.region) : 'null::text'}, ${item.token ? literal(item.token) : 'null::text'}, ${literal(item.sort)}, 100, ${item.offset}, ${literal(item.map === 'trimmed' ? `${item.game}:trimmed` : item.game)})`).join(',\n    ');
    return `with ${mapsCte},
  c(label, game, region, token, sort, lim, off, mk) as (values\n    ${values}),
  r as (select c.label, public.browse_cards_filtered_live(c.game, c.region, c.token, c.sort, c.lim, c.off, m.rmap) as l, public.browse_cards_filtered_mat(c.game, c.region, c.token, c.sort, c.lim, c.off, m.rmap, (select p.gen from public.browse_key_pending p where p.game_id = c.game)) as m from c join maps m on m.k = c.mk)
  select count(*)::int as combos, count(*) filter (where l = m)::int as equal, coalesce(jsonb_agg(label) filter (where l is distinct from m), '[]') as different, sum((l->>'total')::int)::bigint as rows_total, count(*) filter (where (l->>'unmapped')::boolean)::int as unmapped_reported from r`;
  }
  if (kind === 'facets') {
    const mapsCte = mapsFor(items.map(item => (item.trimmed ? `${item.game}:trimmed` : item.game)));
    const values = items.map(item => `(${literal(item.label)}, ${literal(item.game)}, ${item.region ? literal(item.region) : 'null::text'}, ${literal(item.trimmed ? `${item.game}:trimmed` : item.game)})`).join(',\n    ');
    return `with ${mapsCte},
  c(label, game, region, mk) as (values\n    ${values}),
  r as (select c.label, public.browse_cards_facets_live(c.game, c.region, m.rmap) as l, public.browse_cards_facets_mat(c.game, c.region, m.rmap, (select p.gen from public.browse_key_pending p where p.game_id = c.game)) as m from c join maps m on m.k = c.mk)
  select count(*)::int as combos, count(*) filter (where l = m)::int as equal, coalesce(jsonb_agg(label) filter (where l is distinct from m), '[]') as different from r`;
  }
  const values = items.map(item => `(${literal(item.label)}, ${literal(item.game)})`).join(', ');
  return `with c(label, game) as (values ${values}),
  r as (select c.label, public.browse_rarity_values_live(c.game) as l, public.browse_rarity_values_mat(c.game) as m from c)
  select count(*)::int as combos, count(*) filter (where l = m)::int as equal, coalesce(jsonb_agg(label) filter (where l is distinct from m), '[]') as different from r`;
}

const { chunks, mapsFor } = plan();
if (command === 'list') {
  chunks.forEach((chunk, index) => console.log(index, chunk.kind, chunk.items.length, chunk.items[0].label));
} else if (command === 'sql') {
  console.log(chunkSql(chunks[Number(rest[0])], mapsFor));
} else if (command === 'run') {
  let combos = 0, equal = 0;
  const different = [];
  for (const [index, chunk] of chunks.entries()) {
    if (option('only') && (option('only') === 'pages') !== (chunk.kind === 'pages')) continue;
    const started = Date.now();
    const [row] = runSql(chunkSql(chunk, mapsFor));
    combos += row.combos; equal += row.equal; different.push(...row.different);
    console.log(`chunk ${index} ${chunk.kind} ${chunk.items[0].label}: ${row.equal}/${row.combos} equal, ${((Date.now() - started) / 1000).toFixed(1)} s${row.rows_total === undefined ? '' : `, unmapped reported ${row.unmapped_reported}`}`);
  }
  console.log(JSON.stringify({ combos, equal, different }));
  if (equal !== combos) process.exitCode = 1;
}
