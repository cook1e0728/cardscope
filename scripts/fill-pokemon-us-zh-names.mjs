// US Pokemon cards without a Chinese name: compose [region prefix] + species + [ex/V/VMAX/VSTAR/GX/EX] from names already in the database.
// Species pairs (English -> official Traditional Chinese) come only from US cards that already carry a name_zh, joined by national Pokedex number.
// Dry-run by default; --apply writes only where name_zh is still empty, in batches of <= 500 rows (one transaction each).
// Usage: node scripts/fill-pokemon-us-zh-names.mjs [--out plan.json] [--apply]
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RUN_SQL = fileURLToPath(new URL('./run-sql.mjs', import.meta.url));
// shortcut: only affixes whose zh form is attested verbatim in official TW/JP names (阿羅拉 九尾GX, 洗翠 火爆獸VSTAR); Mega, Dark/Light, Team X's and trainer-owned names are left empty.
export const REGIONAL = { 'Alolan ': '阿羅拉', 'Galarian ': '伽勒爾', 'Hisuian ': '洗翠', 'Paldean ': '帕底亞' };
// Same separator the existing US mechanism uses ("噴火龍 ex"); "-GX"/"-EX" become " GX"/" EX".
export const SUFFIX = { '': '', ' ex': ' ex', ' V': ' V', ' VSTAR': ' VSTAR', ' VMAX': ' VMAX', '-GX': ' GX', '-EX': ' EX' };
const STRIP = [' VSTAR', ' VMAX', ' ex', ' V'];

export function buildSpecies(rows) {
  const byDex = new Map();
  for (const r of rows) {
    if (!r.name_zh || r.st !== 'Pokémon' || r.dex?.length !== 1) continue;
    const list = byDex.get(r.dex[0]) || [];
    list.push([r.name_en, r.name_zh]);
    byDex.set(r.dex[0], list);
  }
  const species = new Map();
  for (const [dex, list] of byDex) {
    list.sort((a, b) => a[0].length - b[0].length);
    let [en, zh] = list[0];
    for (const s of STRIP) if (en.endsWith(s) && zh.endsWith(s)) { en = en.slice(0, -s.length); zh = zh.slice(0, -s.length); break; }
    if (list.every(([e, z]) => e === en ? z === zh : e.startsWith(`${en} `) && z.startsWith(`${zh} `))) species.set(dex, { en, zh });
  }
  return species;
}

export function composeZh(row, species) {
  if (row.st !== 'Pokémon') return { reason: `supertype:${row.st}` };
  if (!row.dex?.length) return { reason: 'no-pokedex-number' };
  if (row.dex.length > 1) return { reason: 'tag-team-multi-species' };
  const sp = species.get(row.dex[0]);
  if (!sp) return { reason: 'species-not-in-db' };
  const i = row.name_en.indexOf(sp.en);
  if (i < 0) return { reason: 'species-name-differs' };
  const prefix = row.name_en.slice(0, i), suffix = row.name_en.slice(i + sp.en.length);
  if (prefix && !(prefix in REGIONAL)) return { reason: `prefix:${prefix.trim()}` };
  if (!(suffix in SUFFIX)) return { reason: `suffix:${suffix.trim()}` };
  return { zh: `${prefix ? `${REGIONAL[prefix]} ` : ''}${sp.zh}${SUFFIX[suffix]}`, rule: prefix ? 'regional-form' : suffix ? 'species-suffix' : 'species' };
}

export function planNames(rows) {
  const species = buildSpecies(rows), plan = [], skipped = new Map();
  for (const r of rows) {
    if (r.name_zh) continue;
    const out = composeZh(r, species);
    if (out.zh) plan.push({ id: r.id, name_en: r.name_en, name_zh: out.zh, rule: out.rule });
    else skipped.set(out.reason, (skipped.get(out.reason) || 0) + 1);
  }
  return { plan, skipped, species };
}

function sql(query, file = false) {
  let path;
  try {
    if (file) { path = join(mkdtempSync(join(tmpdir(), 'zhfill-')), 'q.sql'); writeFileSync(path, query); }
    const out = execFileSync('node', [RUN_SQL, ...(file ? [path] : ['--read-only', '-e', query])], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(out);
  } finally { if (path) unlinkSync(path); }
}

const FETCH_US = `select c.id, c.name_en, c.name_zh, c.metadata->'nationalPokedexNumbers' dex, c.metadata->>'supertype' st
  from tcg_cards c join tcg_series s on s.id=c.series_id where c.game_id='pokemon' and s.region='US' and c.source='pokemontcg'`;
const COVERAGE = `select s.region, count(*) total, count(*) filter (where nullif(btrim(c.name_zh),'') is not null) with_zh
  from tcg_cards c join tcg_series s on s.id=c.series_id where c.game_id='pokemon' group by 1 order by 1`;

const applySql = batch => `with p as (select * from jsonb_to_recordset($zhplan$${JSON.stringify(batch)}$zhplan$::jsonb) as x(id text, name_en text, name_zh text, rule text)),
u as (
  update public.tcg_cards c set
    name_zh = p.name_zh,
    aliases = case when p.name_zh = any(coalesce(c.aliases, '{}')) then c.aliases else coalesce(c.aliases, '{}') || p.name_zh end,
    search_text = case when starts_with(c.search_text, c.name_en || ' ') then c.name_en || ' ' || p.name_zh || substr(c.search_text, length(c.name_en) + 1) else coalesce(c.search_text || ' ', '') || p.name_zh end,
    metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('nameZhBasis', 'us-species-affix', 'nameZhRule', p.rule),
    updated_at = now()
  from p
  where c.id = p.id and c.name_en = p.name_en and c.game_id = 'pokemon' and c.source = 'pokemontcg' and nullif(btrim(c.name_zh), '') is null
  returning c.id, p.name_zh
), n as (
  insert into public.tcg_card_names (card_id, locale, name, name_type, source_url, data_status, source)
  select u.id, 'zh-Hant-TW', u.name_zh, 'official', e.source_url, 'verified', 'pokemontcg'
  from u join public.tcg_card_names e on e.card_id = u.id and e.locale = 'en' and e.name_type = 'official'
  on conflict do nothing returning 1
)
select (select count(*) from u) updated, (select count(*) from n) names_inserted;`;

async function main() {
  const args = process.argv.slice(2), out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const rows = sql(FETCH_US), { plan, skipped, species } = planNames(rows);
  if (out) writeFileSync(out, JSON.stringify(plan, null, 1));
  const byRule = {};
  for (const p of plan) byRule[p.rule] = (byRule[p.rule] || 0) + 1;
  console.log(JSON.stringify({ species: species.size, usMissingZh: rows.filter(r => !r.name_zh).length, plan: plan.length, byRule, skipped: Object.fromEntries([...skipped].sort((a, b) => b[1] - a[1])), coverageBefore: sql(COVERAGE) }, null, 1));
  console.log('SAMPLE', JSON.stringify(plan.filter((_, i) => i % Math.max(1, Math.floor(plan.length / 30)) === 0).slice(0, 30).map(p => `${p.id.replace('pokemon-pokemontcg-', '')} | ${p.name_en} -> ${p.name_zh}`), null, 1));
  if (!args.includes('--apply')) return console.log('dry-run only (pass --apply to write)');
  let updated = 0, names = 0;
  for (let i = 0; i < plan.length; i += 500) {
    const t = Date.now(), [r] = sql(applySql(plan.slice(i, i + 500)), true), sec = (Date.now() - t) / 1000;
    updated += Number(r.updated); names += Number(r.names_inserted);
    console.log(`batch ${i / 500 + 1}: updated ${r.updated}, names ${r.names_inserted}, ${sec}s`);
    if (sec > 40) { console.log('batch too slow, stopping'); break; }
  }
  console.log(JSON.stringify({ updated, names, coverageAfter: sql(COVERAGE) }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
