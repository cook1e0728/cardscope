// JP Pokemon cards without a Chinese name whose Japanese name is <base> + ex/EX/GX/V/VMAX/VSTAR: take the official zh name of <base> and re-attach the same affix (ADR 0053).
// Evidence = JP cards whose zh name is TW-official (nameZhBasis tw-official / tw-official-same-number); derived names are never evidence.
// A base is usable only when every official card carrying it (plain or with any affix) gives exactly one zh base string.
// Dry-run by default; --apply writes only where name_zh is still empty, in transactional batches (default 100 rows).
// Usage: node scripts/fill-pokemon-jp-zh-name-affix.mjs [--out plan.json] [--apply] [--batch 100]
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RUN_SQL = fileURLToPath(new URL('./run-sql.mjs', import.meta.url));
export const BASIS = 'jp-name-affix-unique', RULE = 'adr-0053';
const OFFICIAL = new Set(['tw-official', 'tw-official-same-number']);
// Same key as private.jp_name_key (ADR 0013): NFKC, no whitespace.
export const jaKey = s => (s || '').normalize('NFKC').replace(/\s/g, '');
const AFFIX = /^(.+?)(\s*)(VSTAR|VMAX|ex|EX|GX|V)$/;
// shortcut: bases whose official zh carries Source name markup (<X的>, [..], trailing parentheses) are skipped, not normalised; revisit if the count matters.
const MARKUP = /[<>\[\]()（）]/;

export function splitAffix(name) {
  const m = AFFIX.exec((name || '').trim());
  return m ? { base: m[1], sep: m[2], affix: m[3] } : { base: (name || '').trim(), sep: '', affix: '' };
}

// base ja key -> { zh: Set of zh base strings, seps: Set of separators seen before the zh affix, bad: unparseable evidence, src: first evidence card id }
export function buildBases(rows) {
  const bases = new Map();
  for (const r of rows) {
    if (!r.name_zh?.trim() || !OFFICIAL.has(r.b)) continue;
    const ja = splitAffix(r.name_ja), zh = r.name_zh.trim();
    const e = bases.get(jaKey(ja.base)) || { zh: new Set(), seps: new Set(), bad: false, src: new Map() };
    bases.set(jaKey(ja.base), e);
    let zhBase = zh;
    if (ja.affix) {
      const m = AFFIX.exec(zh);
      if (!m || m[3] !== ja.affix) { e.bad = true; continue; }
      zhBase = m[1]; e.seps.add(m[2]);
    }
    e.zh.add(zhBase);
    if (!e.src.has(zhBase)) e.src.set(zhBase, r.id);
  }
  return bases;
}

export function planJpNames(rows) {
  const bases = buildBases(rows), plan = [], skipped = new Map(), ambiguous = [];
  const skip = reason => skipped.set(reason, (skipped.get(reason) || 0) + 1);
  for (const r of rows) {
    if (r.name_zh?.trim()) continue;
    const ja = splitAffix(r.name_ja);
    if (!ja.affix) { skip('not-affix-card'); continue; }
    const e = bases.get(jaKey(ja.base));
    if (!e) { skip('base-not-in-official-names'); continue; }
    if (e.bad) { skip('evidence-affix-mismatch'); continue; }
    if (e.zh.size > 1) { skip('base-not-unique'); ambiguous.push({ id: r.id, name_ja: r.name_ja, candidates: [...e.zh] }); continue; }
    const [zhBase] = e.zh;
    if (MARKUP.test(zhBase)) { skip('markup-in-base'); continue; }
    if (e.seps.size > 1) { skip('affix-spacing-conflict'); continue; }
    const [sep = ''] = e.seps;
    plan.push({ id: r.id, name_ja: r.name_ja, name_zh: `${zhBase}${sep}${ja.affix}`, affix: ja.affix, source_card_id: e.src.get(zhBase), rule: RULE });
  }
  return { plan, skipped, ambiguous };
}

function sql(query, file = false) {
  let path;
  try {
    if (file) { path = join(mkdtempSync(join(tmpdir(), 'zhjp-')), 'q.sql'); writeFileSync(path, query); }
    const out = execFileSync('node', [RUN_SQL, ...(file ? [path] : ['--read-only', '-e', query])], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(out);
  } finally { if (path) unlinkSync(path); }
}

const FETCH_JP = `select c.id, c.name_ja, c.name_zh, c.metadata->>'nameZhBasis' b
  from tcg_cards c join tcg_series s on s.id=c.series_id where c.game_id='pokemon' and s.region='JP'`;
const TOTAL = `select count(*) total, count(*) filter (where nullif(btrim(c.name_zh),'') is not null) with_zh
  from tcg_cards c join tcg_series s on s.id=c.series_id where c.game_id='pokemon' and s.region='JP'`;

// Only name_zh and metadata change: JP cards keep aliases/search_text as card numbers only and have no tcg_card_names rows (ADR 0013 path);
// search_names is generated from name_zh and the canonical-card trigger carries the name into tcg_canonical_cards.
const applySql = batch => `with p as (select * from jsonb_to_recordset($zhplan$${JSON.stringify(batch)}$zhplan$::jsonb) as x(id text, name_ja text, name_zh text, affix text, source_card_id text, rule text)),
u as (
  update public.tcg_cards c set
    name_zh = p.name_zh,
    metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('nameZhBasis', '${BASIS}', 'nameZhRule', p.rule, 'nameZhSourceCardId', p.source_card_id, 'nameZhAffix', p.affix),
    updated_at = now()
  from p join public.tcg_cards src on src.id = p.source_card_id and src.game_id = 'pokemon' and src.metadata->>'nameZhBasis' in ('tw-official', 'tw-official-same-number') and nullif(btrim(src.name_zh), '') is not null
  where c.id = p.id and c.name_ja = p.name_ja and c.game_id = 'pokemon' and nullif(btrim(c.name_zh), '') is null
    and exists (select 1 from public.tcg_series s where s.id = c.series_id and s.region = 'JP')
  returning c.id
)
select count(*) updated from u;`;

async function main() {
  const args = process.argv.slice(2), arg = k => args.includes(k) ? args[args.indexOf(k) + 1] : null;
  const size = Math.min(1000, Number(arg('--batch')) || 100), out = arg('--out');
  const rows = sql(FETCH_JP), { plan, skipped, ambiguous } = planJpNames(rows);
  if (out) writeFileSync(out, JSON.stringify({ plan, ambiguous }, null, 1));
  const byAffix = {};
  for (const p of plan) byAffix[p.affix] = (byAffix[p.affix] || 0) + 1;
  console.log(JSON.stringify({ jpMissingZh: rows.filter(r => !r.name_zh?.trim()).length, plan: plan.length, byAffix, skipped: Object.fromEntries([...skipped].sort((a, b) => b[1] - a[1])), ambiguousBases: ambiguous.length, coverageBefore: sql(TOTAL) }, null, 1));
  console.log('SAMPLE', JSON.stringify(plan.filter((_, i) => i % Math.max(1, Math.floor(plan.length / 30)) === 0).slice(0, 30).map(p => `${p.id.replace('pokemon-', '')} | ${p.name_ja} -> ${p.name_zh}`), null, 1));
  console.log('AMBIGUOUS', JSON.stringify(ambiguous.slice(0, 20)));
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
