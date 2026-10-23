// Yu-Gi-Oh! (YGOPRODeck, English names only) Chinese search aliases: appends the entries of data/yugioh-zh-aliases.json to tcg_cards.search_text,
// the column search_cards_ranked falls back to when no card name matches. Nothing else is touched: name_zh (the displayed official Chinese name)
// and the aliases column stay as they are; metadata only gains zhAliasSource='cardscope-curated' and zhAliases. The names are CardScope's own
// collection of what Taiwanese players call these cards, not official card names.
// Dry-run by default (also reports names that match no card and aliases already shadowed by an existing card name); --apply writes in one transaction.
// Re-run after a YGOPRODeck catalog sync: that sync rewrites search_text and drops the appended aliases. Re-running is safe (only missing terms are appended).
// Usage: node scripts/apply-yugioh-zh-aliases.mjs [--apply]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RUN_SQL = fileURLToPath(new URL('./run-sql.mjs', import.meta.url));
const DATA = new URL('../data/yugioh-zh-aliases.json', import.meta.url);
export const SOURCE = 'cardscope-curated';
// Same folding as providers/catalog-sync.mjs searchText(): lower case, NFKC, no spaces or separators, so "人造人-念力衝擊者" is also found as "人造人念力衝擊者".
const fold = value => value.toLocaleLowerCase().normalize('NFKC').replace(/[\s・·._:：'’"\-]/g, '');

export function validate(file) {
  if (file?.source !== SOURCE || !/非官方中文名/.test(file.notice || '') || !Array.isArray(file.entries)) throw new Error('ALIAS_FILE_HEADER_INVALID');
  const seen = new Set();
  for (const e of file.entries) {
    if (!(typeof e.nameEn === 'string' && e.nameEn.trim()) && !/^\d+$/.test(e.passcode || '')) throw new Error(`ENTRY_NEEDS_NAME_OR_PASSCODE: ${JSON.stringify(e)}`);
    const key = e.passcode || e.nameEn.toLowerCase();
    if (seen.has(key)) throw new Error(`DUPLICATE_ENTRY: ${key}`);
    seen.add(key);
    if (!Array.isArray(e.aliases) || !e.aliases.length || e.aliases.some(a => typeof a !== 'string' || !a.trim() || /[%_\\]/.test(a))) throw new Error(`ALIASES_INVALID: ${key}`);
  }
  return file.entries;
}

export const termsOf = aliases => [...new Set(aliases.map(a => a.trim()).flatMap(a => [a, fold(a)]).filter(Boolean))];

// rows: { id, name_en, provider_id } of the YGOPRODeck cards; returns the per-card plan plus entries that matched nothing.
export function planAliases(entries, rows) {
  const byName = new Map(), byCode = new Map(), plan = new Map(), unmatched = [];
  for (const r of rows) {
    const k = r.name_en.toLowerCase();
    byName.set(k, [...(byName.get(k) || []), r]);
    byCode.set(String(r.provider_id), [r]);
  }
  for (const e of entries) {
    const hits = e.passcode ? byCode.get(e.passcode) || [] : byName.get(e.nameEn.toLowerCase()) || [];
    if (!hits.length) unmatched.push(e.passcode || e.nameEn);
    for (const r of hits) {
      const p = plan.get(r.id) || { id: r.id, nameEn: r.name_en, aliases: [] };
      p.aliases = [...new Set([...p.aliases, ...e.aliases.map(a => a.trim())])];
      plan.set(r.id, p);
    }
  }
  return { plan: [...plan.values()].map(p => ({ ...p, terms: termsOf(p.aliases) })), unmatched };
}

function sql(query, write = false) {
  const dir = mkdtempSync(join(tmpdir(), 'zhalias-')), path = join(dir, 'q.sql');
  writeFileSync(path, query);
  try { return JSON.parse(execFileSync('node', [RUN_SQL, path, ...(write ? [] : ['--read-only'])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })); }
  finally { unlinkSync(path); }
}

const literal = value => `$zhalias$${JSON.stringify(value)}$zhalias$::jsonb`;
const fetchSql = entries => `select id, name_en, provider_id from public.tcg_cards
  where game_id = 'yugioh' and source = 'ygoprodeck'
    and (lower(name_en) in (select lower(v) from jsonb_array_elements_text(${literal(entries.filter(e => !e.passcode).map(e => e.nameEn))}) v)
      or provider_id in (select v from jsonb_array_elements_text(${literal(entries.filter(e => e.passcode).map(e => e.passcode))}) v))`;
// Aliases already contained in some card name: search_cards_ranked only falls back to search_text when no name matches, so these cannot surface the new cards.
const shadowSql = aliases => `select a as alias, (select count(*) from public.tcg_cards k where k.search_names like '%' || lower(a) || '%') as name_hits
  from jsonb_array_elements_text(${literal(aliases)}) a`;
export const applySql = plan => `with p as (select * from jsonb_to_recordset(${literal(plan.map(({ id, terms, aliases }) => ({ id, terms, aliases })))}) as x(id text, terms text[], aliases text[])),
u as (
  update public.tcg_cards c set
    search_text = coalesce(c.search_text, '') || ' ' || (select string_agg(t, ' ') from unnest(p.terms) t where position(t in coalesce(c.search_text, '')) = 0),
    metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('zhAliasSource', '${SOURCE}', 'zhAliases', to_jsonb(p.aliases))
  from p
  where c.id = p.id and c.game_id = 'yugioh' and c.source = 'ygoprodeck'
    and exists (select 1 from unnest(p.terms) t where position(t in coalesce(c.search_text, '')) = 0)
  returning c.id
)
select (select count(*) from u) as updated;`;

const SAMPLES = ['青眼白龍', '黑魔術師', '黑魔導女孩', '真紅眼黑龍', '三幻神', '歐西里斯的天空龍', '青眼', '黑魔導'];
const checkSql = `select q, r->>'matchedBy' as matched_by, (r->>'matchCount')::int as match_count, (r->>'groupCount')::int as group_count,
  (select string_agg(x->>'nameEn', ' | ') from (select x from jsonb_array_elements(r->'cards') x where (x->>'hit')::boolean is not false limit 4) t) as top
  from (select q, public.search_cards_ranked(array['%' || q || '%'], array[q], 40, null, 0, null) r from unnest(array[${SAMPLES.map(s => `'${s}'`).join(',')}]) q) s`;
const NAME_ZH = `select count(*) filter (where name_zh is not null) as name_zh_set, count(*) as yugioh_cards, pg_size_pretty(pg_database_size(current_database())) as db_size from public.tcg_cards where game_id = 'yugioh'`;

async function main() {
  const apply = process.argv.includes('--apply'), entries = validate(JSON.parse(readFileSync(DATA, 'utf8')));
  const { plan, unmatched } = planAliases(entries, sql(fetchSql(entries)));
  const shadowed = sql(shadowSql([...new Set(plan.flatMap(p => p.aliases))])).filter(r => Number(r.name_hits) > 0);
  console.log(JSON.stringify({ entries: entries.length, cardsToUpdate: plan.length, unmatched, shadowedByCardName: shadowed, before: sql(NAME_ZH) }, null, 1));
  console.log('SEARCH BEFORE', JSON.stringify(sql(checkSql)));
  if (!apply) return console.log('dry-run only (pass --apply to write)');
  const [r] = sql(applySql(plan), true);
  console.log(JSON.stringify({ updated: r.updated, after: sql(NAME_ZH) }, null, 1));
  console.log('SEARCH AFTER', JSON.stringify(sql(checkSql)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
