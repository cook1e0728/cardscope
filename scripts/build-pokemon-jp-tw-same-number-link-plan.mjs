import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planJpTwSameNumberLinks } from '../providers/pokemon-jp-tw-same-number-link.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-tw-same-number-link-plan.mjs <pairs.json> <linked-elsewhere.json> <out-dir> [--actor NAME]',
  '',
  'ADR 0024: plans for private.link_pokemon_jp_tw_same_number. pairs.json: every JP/TW card pair with the same',
  'series code and number [{ code, num, jp_id, jc, jn, tw_id, tc, tn, jp_dupes, tw_links }]; linked-elsewhere.json:',
  '[{ code }] of series whose JP cards are linked to a TW card of another number. Writes link.sql (every batch,',
  'gated, one transaction), link-replay.sql and link-report.json. No network or database calls.'
].join('\n');

const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;

try {
  const args = process.argv.slice(2);
  const [pairsPath, elsewherePath, outDir] = args;
  const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (!pairsPath || !elsewherePath || !outDir) throw new Error('ARGUMENTS_REQUIRED');
  const actor = flag('--actor') ?? 'claude-code-local:aa26488931';
  const pairs = JSON.parse(readFileSync(pairsPath, 'utf8'));
  const elsewhere = JSON.parse(readFileSync(elsewherePath, 'utf8')).map(row => row.code);
  const { plans, byCode, misaligned, skipped } = planJpTwSameNumberLinks(pairs, elsewhere);
  const call = (plan, dry) => `private.link_pokemon_jp_tw_same_number($plan$${JSON.stringify(plan)}$plan$::jsonb, ${sqlText(actor)}, ${dry})`;
  // One top-level statement per batch keeps each call under its own statement timeout; run-sql still
  // sends the whole file as one transaction, so any failed batch rolls every batch back.
  const total = plans.reduce((n, p) => n + p.rows.length, 0);
  const gated = [`-- ADR 0024: ${plans.length} batches, ${total} links, one transaction.`];
  plans.forEach((plan, i) => gated.push(
    'do $do$', 'declare d jsonb; r jsonb;', 'begin',
    `  d := ${call(plan, true)};`,
    `  if (d->>'replay')::boolean or (d->>'links')::int <> ${plan.rows.length} then raise exception 'batch ${i + 1} unexpected dry run %', d; end if;`,
    `  r := ${call(plan, false)};`,
    `  if (r->>'replay')::boolean or (r->>'links')::int <> ${plan.rows.length} or r->>'planDigest' <> d->>'planDigest' then raise exception 'batch ${i + 1} unexpected link %', r; end if;`,
    'end', '$do$;'
  ));
  gated.push('');
  const replay = [...plans.flatMap((plan, i) => ['do $do$', 'declare r jsonb;', 'begin', `  r := ${call(plan, false)}; if not (r->>'replay')::boolean then raise exception 'batch ${i + 1} replay changed rows %', r; end if;`, 'end', '$do$;']), ''];
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'link.sql'), gated.join('\n'));
  writeFileSync(join(outDir, 'link-replay.sql'), replay.join('\n'));
  writeFileSync(join(outDir, 'link-report.json'), `${JSON.stringify({ links: total, batches: plans.length, byCode, misaligned, skipped, plans }, null, 1)}\n`);
  console.log(JSON.stringify({ links: total, batches: plans.length, byCode, misaligned, skipped: skipped.length }));
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
