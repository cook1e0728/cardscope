// Dry-run plan: Taiwan official set page (asia.pokemon-card.com/tw/archive/special/card/<code>/) -> series release date.
// Read-only. Only a page with exactly one distinct 發售日 is accepted; a year written on the page wins,
// otherwise the year must be the single one in 2020..2027 whose weekday matches. Anything else stays null.
// Usage: node scripts/build-pokemon-tw-official-release-dates-plan.mjs <series-codes.json> [--out plan.json]
import { readFileSync, writeFileSync } from 'node:fs';

export const ORIGIN = 'https://asia.pokemon-card.com';
// Codes whose official page is shared with a sibling series (same launch day, one page).
const PAGE_ALIASES = { SV11B: 'sv11', SV11W: 'sv11', M1L: 'm1', M1S: 'm1' };
const WEEKDAYS = '日一二三四五六';

export const pageUrl = code => `${ORIGIN}/tw/archive/special/card/${PAGE_ALIASES[code] ?? code.toLowerCase()}/`;

export function parseReleaseDates(html) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const found = new Map();
  for (const m of text.matchAll(/發售日[：:]\s*(?:(20\d\d)年\s*)?(\d{1,2})月(\d{1,2})日\s*[（(]([日一二三四五六])[）)]/g)) {
    const [, year, month, day, weekday] = m;
    found.set(`${year ?? ''}-${month}-${day}-${weekday}`, { year: year ? Number(year) : null, month: Number(month), day: Number(day), weekday });
  }
  return [...found.values()];
}

export function resolveDate({ year, month, day, weekday }) {
  const iso = y => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const matches = y => { const d = new Date(`${iso(y)}T00:00:00Z`); return d.getUTCMonth() + 1 === month && WEEKDAYS[d.getUTCDay()] === weekday; };
  if (year) return matches(year) ? { date: iso(year), basis: 'page-year' } : { error: 'WEEKDAY_MISMATCH' };
  const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027].filter(matches);
  return years.length === 1 ? { date: iso(years[0]), basis: 'weekday-unique-year' } : { error: 'YEAR_AMBIGUOUS', candidates: years.map(iso) };
}

if (process.argv[1]?.endsWith('build-pokemon-tw-official-release-dates-plan.mjs')) {
  const codes = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const plan = [];
  for (const code of codes) {
    const url = pageUrl(code);
    const response = await fetch(url);
    if (!response.ok) { plan.push({ code, url, status: `HTTP_${response.status}` }); continue; }
    const dates = parseReleaseDates(await response.text());
    if (dates.length !== 1) plan.push({ code, url, status: dates.length ? 'MULTIPLE_DATES' : 'NO_DATE', dates });
    else { const r = resolveDate(dates[0]); plan.push({ code, url, ...r, status: r.date ? 'OK' : 'UNRESOLVED', raw: dates[0] }); }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  if (out) writeFileSync(out, JSON.stringify(plan, null, 1));
  for (const row of plan) console.log(row.code, row.status, row.date ?? '', row.basis ?? row.error ?? '', row.candidates?.join(',') ?? '');
}
