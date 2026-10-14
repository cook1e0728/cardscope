import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOfficialJpUnnumberedPlans, buildOfficialJpUnnumberedSql } from '../providers/pokemon-jp-official-unnumbered-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-official-unnumbered-plan.mjs <cache.json> <series-meta.json> <out-dir> [--series CODE,CODE] [--actor NAME] [--rarity-codes C,U,R]',
  '',
  'ADR 0026：官方詳細頁沒有卡號的系列（DP 世代、EP08），每個官方詳細頁一張卡，依清單順序，',
  '轉成 private.import_pokemon_jp_official_unnumbered_series 的計畫（每批 ≤100 張）。',
  'series-meta.json: { CODE: { name_ja, release_date, basis, listKey } }；listKey 是 cache.lists 的鍵（預設同代碼）。',
  '每批輸出 <CODE>-<n>.json、<CODE>-<n>.sql（gated）、<CODE>-<n>-replay.sql，以及 <CODE>-report.json。不連網、不連資料庫。'
].join('\n');

try {
  const args = process.argv.slice(2);
  const [cachePath, metaPath, outDir] = args;
  if (!cachePath || !metaPath || !outDir || [cachePath, metaPath, outDir].some(arg => arg.startsWith('--'))) throw new Error('ARGUMENTS_REQUIRED');
  const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const actor = flag('--actor') ?? 'claude-code-local:aa26488931';
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const codes = flag('--series')?.split(',') ?? Object.keys(meta);
  const rarityCodes = flag('--rarity-codes') ? new Set(flag('--rarity-codes').split(',')) : null;
  mkdirSync(outDir, { recursive: true });
  for (const code of codes) {
    const { plans, quarantined, rarityUnknown, summary } = buildOfficialJpUnnumberedPlans({ code, listKey: meta[code]?.listKey ?? code, seriesMeta: meta[code], cache, rarityCodes });
    const digests = [];
    for (const plan of plans) {
      const name = `${code}-${plan.batch.index}`;
      const { digest, gated, replay } = buildOfficialJpUnnumberedSql(plan, actor);
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
      writeFileSync(join(outDir, `${name}.sql`), gated);
      writeFileSync(join(outDir, `${name}-replay.sql`), replay);
      digests.push({ batch: plan.batch.index, cards: plan.cards.length, planDigest: digest });
    }
    writeFileSync(join(outDir, `${code}-report.json`), `${JSON.stringify({ summary, digests, quarantined, rarityUnknown }, null, 1)}\n`);
    console.log(JSON.stringify({ ...summary, digests }));
  }
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
