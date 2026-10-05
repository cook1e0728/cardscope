import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOfficialJpSameNamePlan, buildOfficialJpSameNameSql } from '../providers/pokemon-jp-official-same-name-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-official-same-name-plan.mjs <existing.json> <out-dir> --cache <cache.json> [--cache <cache.json> ...]',
  '        [--era-cache <cache.json> ...] [--era-rarity-codes C,U,R,RR,SR,UR] [--series CODE,CODE] [--actor NAME]',
  '',
  'ADR 0025: plans for private.supplement_pokemon_jp_official_series. existing.json: [{ code, num }] for every card',
  'already in the Japanese official series. Each series is read from the cache that lists it; --era-cache marks',
  'caches whose series keep only --era-rarity-codes (ADR 0019). Writes <CODE>-same-name.json/.sql/-replay.sql and',
  'same-name-report.json. No network or database calls.'
].join('\n');

try {
  const args = process.argv.slice(2);
  const [existingPath, outDir] = args;
  const many = name => args.flatMap((arg, i) => (arg === name ? [args[i + 1]] : []));
  const flag = name => many(name)[0] ?? null;
  const cachePaths = [...many('--cache'), ...many('--era-cache')];
  if (!existingPath || !outDir || !cachePaths.length) throw new Error('ARGUMENTS_REQUIRED');
  const actor = flag('--actor') ?? 'claude-code-local:aa26488931';
  const eraCodes = new Set((flag('--era-rarity-codes') ?? 'C,U,R,RR,SR,UR').split(','));
  const eraCaches = new Set(many('--era-cache'));
  const existing = JSON.parse(readFileSync(existingPath, 'utf8'));
  const caches = cachePaths.map(path => ({ path, era: eraCaches.has(path), data: JSON.parse(readFileSync(path, 'utf8')) }));
  const codes = flag('--series') ? flag('--series').split(',') : [...new Set(existing.map(row => row.code))];
  mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const code of codes) {
    const holders = caches.filter(cache => cache.data.lists?.[code]);
    if (holders.length !== 1) throw new Error(`CACHE_NOT_SINGLE:${code}:${holders.length}`);
    const [{ data: cache, era, path }] = holders;
    const result = buildOfficialJpSameNamePlan({ code, cache, seriesId: `pokemon-official-ja-${code.toLowerCase()}`, existingNumbers: existing.filter(row => row.code === code).map(row => row.num), rarityCodes: era ? eraCodes : null });
    let digest = null;
    if (result.plan) {
      const sql = buildOfficialJpSameNameSql(result.plan, actor);
      digest = sql.digest;
      writeFileSync(join(outDir, `${code}-same-name.json`), `${JSON.stringify(result.plan, null, 1)}\n`);
      writeFileSync(join(outDir, `${code}-same-name.sql`), sql.gated);
      writeFileSync(join(outDir, `${code}-same-name-replay.sql`), sql.replay);
    }
    report.push({ ...result.summary, cache: path.split(/[\\/]/).at(-1), eraRarity: era, planDigest: digest, conflicts: result.conflicts, rarityUnknown: result.rarityUnknown.length, added: result.plan?.cards.map(card => ({ number: card.official_card_number, name: card.name_ja, rarity: card.rarity_code, ids: card.metadata.officialCardIds })) ?? [] });
    console.log(JSON.stringify({ ...result.summary, planDigest: digest }));
  }
  writeFileSync(join(outDir, 'same-name-report.json'), `${JSON.stringify(report, null, 1)}\n`);
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
