// JP Pokemon cards still without a Chinese name after ADR 0013/0053 (e.g. ウパー, 名探偵ピカチュウ): fill name_zh from the species name.
// Species pairs (Japanese -> Traditional Chinese) come from PokeAPI's pokemon_species_names.csv (language 1 ja-Hrkt, 4 zh-Hant),
// and a species is used only when every JP card that already has a TW-official name agrees with it (no conflict in our own data).
// Rules, all ending in an optional ex/EX/GX/V/VMAX/VSTAR written without a space (超夢EX, 皮卡丘ex):
//   species        ウパー -> 烏波
//   regional-form  アローラロコン -> 阿羅拉 六尾 (same spacing as the existing derived names)
//   tw-name        名探偵ピカチュウ -> 名偵探皮卡丘: a kanji prefix whose characters are exactly those of a TW official card name's prefix, and only one such TW name.
// Dry-run by default; --apply writes only where name_zh is still empty, in transactional batches.
// Usage: node scripts/fill-pokemon-jp-zh-name-species.mjs --csv pokemon_species_names.csv [--out plan.json] [--apply] [--batch 200]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { jaKey, splitAffix } from './fill-pokemon-jp-zh-name-affix.mjs';

const RUN_SQL = fileURLToPath(new URL('./run-sql.mjs', import.meta.url));
export const BASIS = 'jp-species-name';
const OFFICIAL = new Set(['tw-official', 'tw-official-same-number']);
export const REGIONAL = { 'アローラ': '阿羅拉', 'ガラル': '伽勒爾', 'ヒスイ': '洗翠', 'パルデア': '帕底亞' };
const HAN = /^[\p{Script=Han}]+$/u;
const sortedChars = s => [...s].sort().join('');

// csv text -> Map(ja key -> zh-Hant); a Japanese name that two species share is dropped.
export function parseSpeciesCsv(text) {
  const byId = new Map();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [id, lang, name] = line.split(',');
    if (!name || (lang !== '1' && lang !== '4')) continue;
    const e = byId.get(id) || {};
    e[lang === '1' ? 'ja' : 'zh'] = name.trim().normalize('NFKC'); // 謎擬Ｑ -> 謎擬Q, as most TW card names write it
    byId.set(id, e);
  }
  const species = new Map(), dup = new Set();
  for (const { ja, zh } of byId.values()) {
    if (!ja || !zh) continue;
    const k = jaKey(ja);
    if (species.has(k)) dup.add(k); else species.set(k, zh);
  }
  for (const k of dup) species.delete(k);
  return species;
}

// Drop species our own TW-official names contradict (plain species or species + affix only).
export function checkSpecies(species, rows) {
  const conflicts = [];
  for (const r of rows) {
    if (!r.name_zh?.trim() || !OFFICIAL.has(r.b)) continue;
    const ja = splitAffix(r.name_ja), zh = splitAffix(r.name_zh.trim().normalize('NFKC')), k = jaKey(ja.base);
    if (!species.has(k) || ja.affix !== zh.affix) continue;
    if (species.get(k) !== zh.base.trim()) conflicts.push({ ja: ja.base, pokeapi: species.get(k), official: zh.base.trim(), card: r.id });
  }
  for (const c of conflicts) species.delete(jaKey(c.ja));
  return conflicts;
}

// The longest species name the Japanese base ends with, so that ピカチュウ wins over チュウ-like tails.
function speciesTail(base, species) {
  const k = jaKey(base);
  for (let i = 0; i < k.length; i++) { const tail = k.slice(i); if (species.has(tail)) return { prefix: k.slice(0, i), ja: tail, zh: species.get(tail) }; }
  return null;
}

export function planSpeciesNames(rows, species, twNames) {
  const plan = [], skipped = new Map(), skip = reason => skipped.set(reason, (skipped.get(reason) || 0) + 1);
  for (const r of rows) {
    if (r.name_zh?.trim() || !r.name_ja?.trim()) continue;
    const { base, affix } = splitAffix(r.name_ja), hit = speciesTail(base, species);
    if (!hit) { skip('no-species'); continue; }
    let zh = null, rule = null;
    if (!hit.prefix) { zh = hit.zh + affix; rule = 'species'; }
    else if (REGIONAL[hit.prefix]) { zh = `${REGIONAL[hit.prefix]} ${hit.zh}${affix}`; rule = 'regional-form'; }
    else if (HAN.test(hit.prefix)) {
      const want = sortedChars(hit.prefix), tail = hit.zh + affix;
      const found = [...twNames].filter(n => n.endsWith(tail) && n.length > tail.length && sortedChars(n.slice(0, -tail.length)) === want);
      if (found.length === 1) { zh = found[0]; rule = 'tw-name'; } else { skip(found.length ? 'tw-name-ambiguous' : 'prefix-not-in-tw-names'); continue; }
    } else { skip('prefix-not-kanji'); continue; }
    plan.push({ id: r.id, name_ja: r.name_ja, name_zh: zh, rule });
  }
  return { plan, skipped };
}

function sql(query, file = false) {
  let path;
  try {
    if (file) { path = join(mkdtempSync(join(tmpdir(), 'zhsp-')), 'q.sql'); writeFileSync(path, query); }
    const out = execFileSync('node', [RUN_SQL, ...(file ? [path] : ['--read-only', '-e', query])], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(out);
  } finally { if (path) unlinkSync(path); }
}

const FETCH_JP = `select c.id, c.name_ja, c.name_zh, c.metadata->>'nameZhBasis' b
  from tcg_cards c join tcg_series s on s.id=c.series_id where c.game_id='pokemon' and s.region='JP'`;
const FETCH_TW = `select distinct btrim(c.name_zh) name from tcg_cards c join tcg_series s on s.id=c.series_id
  where c.game_id='pokemon' and s.region='TW' and nullif(btrim(c.name_zh),'') is not null`;
const TOTAL = `select count(*) total, count(*) filter (where nullif(btrim(c.name_zh),'') is not null) with_zh
  from tcg_cards c join tcg_series s on s.id=c.series_id where c.game_id='pokemon' and s.region='JP'`;

// Same write path as ADR 0053: only name_zh and metadata change; search_names and the canonical card follow name_zh.
const applySql = batch => `with p as (select * from jsonb_to_recordset($zhplan$${JSON.stringify(batch)}$zhplan$::jsonb) as x(id text, name_ja text, name_zh text, rule text)),
u as (
  update public.tcg_cards c set
    name_zh = p.name_zh,
    metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('nameZhBasis', '${BASIS}', 'nameZhRule', p.rule, 'nameZhSource', 'pokeapi-species-names'),
    updated_at = now()
  from p
  where c.id = p.id and c.name_ja = p.name_ja and c.game_id = 'pokemon' and nullif(btrim(c.name_zh), '') is null
    and exists (select 1 from public.tcg_series s where s.id = c.series_id and s.region = 'JP')
  returning c.id
)
select count(*) updated from u;`;

async function main() {
  const args = process.argv.slice(2), arg = k => args.includes(k) ? args[args.indexOf(k) + 1] : null;
  if (!arg('--csv')) throw new Error('--csv <pokemon_species_names.csv> is required');
  const size = Math.min(1000, Number(arg('--batch')) || 200), out = arg('--out');
  const species = parseSpeciesCsv(readFileSync(arg('--csv'), 'utf8')), rows = sql(FETCH_JP), conflicts = checkSpecies(species, rows);
  const { plan, skipped } = planSpeciesNames(rows, species, new Set(sql(FETCH_TW).map(r => r.name)));
  if (out) writeFileSync(out, JSON.stringify({ plan, conflicts }, null, 1));
  const byRule = {};
  for (const p of plan) byRule[p.rule] = (byRule[p.rule] || 0) + 1;
  console.log(JSON.stringify({ species: species.size, conflicts: conflicts.length, jpMissingZh: rows.filter(r => !r.name_zh?.trim()).length, plan: plan.length, byRule, skipped: Object.fromEntries(skipped), coverageBefore: sql(TOTAL) }, null, 1));
  console.log('CONFLICTS', JSON.stringify(conflicts.slice(0, 20)));
  console.log('SAMPLE', JSON.stringify(plan.filter((_, i) => i % Math.max(1, Math.floor(plan.length / 30)) === 0).slice(0, 30).map(p => `${p.name_ja} -> ${p.name_zh} (${p.rule})`), null, 1));
  if (!args.includes('--apply')) return console.log('dry-run only (pass --apply to write)');
  let updated = 0;
  for (let i = 0; i < plan.length; i += size) {
    const t = Date.now(), [r] = sql(applySql(plan.slice(i, i + size)), true), sec = (Date.now() - t) / 1000;
    updated += Number(r.updated);
    console.log(`batch ${i / size + 1}: updated ${r.updated}/${Math.min(size, plan.length - i)}, ${sec}s`);
    if (sec > 40) { console.log('batch too slow, stopping'); break; }
  }
  console.log(JSON.stringify({ updated, coverageAfter: sql(TOTAL) }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
