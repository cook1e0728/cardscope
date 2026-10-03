import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOfficialJpSeedClaimPlan, buildOfficialJpSeedClaimSql, buildOfficialJpSeriesPlans, buildOfficialJpSeriesSql } from '../providers/pokemon-jp-official-series-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-official-series-plan.mjs <cache.json> <series-meta.json> <out-dir> [--series CODE,CODE] [--actor NAME] [--seed-claim seed.json] [--rarity-codes C,U,R]',
  '',
  'ADR 0012: turns a whole-series official card search cache (fetch-pokemon-jp-official-rarity.mjs',
  '--whole-series) into import plans of at most 100 cards for private.import_pokemon_jp_official_series.',
  'series-meta.json: { CODE: { name_ja, release_date, basis } }. Writes per batch <CODE>-<n>.json,',
  '<CODE>-<n>.sql (gated: dry run must match before the write) and <CODE>-<n>-replay.sql, plus',
  '<CODE>-report.json with quarantined pages and unknown rarities. No network or database calls.',
  '--seed-claim (ADR 0016, one series): seed.json is the hand-written Seed row read from the database',
  '({ seriesId, cardId, printingId, cardNumber, nameJa, cardRarity, printingRarity, seriesNameJa, releaseDate });',
  'writes <CODE>-claim.json/.sql/-replay.sql and plans that import into the Seed series without that card.',
  '--rarity-codes (ADR 0019): keep only these mapped rarity codes; other icons leave the rarity empty.'
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
  const seed = flag('--seed-claim') ? JSON.parse(readFileSync(flag('--seed-claim'), 'utf8')) : null;
  if (seed && codes.length !== 1) throw new Error('SEED_CLAIM_NEEDS_ONE_SERIES');
  mkdirSync(outDir, { recursive: true });
  for (const code of codes) {
    const seedClaim = seed ? { seriesId: seed.seriesId, cardNumbers: [String(seed.cardNumber).split('/')[0]] } : null;
    const { plans, evidence, quarantined, rarityUnknown, claimed, summary } = buildOfficialJpSeriesPlans({ code, seriesMeta: meta[code], cache, seedClaim, rarityCodes });
    if (seed) {
      const claim = buildOfficialJpSeedClaimPlan({ code, cache, seed, evidenceHash: summary.evidenceHash, sourceObservedAt: plans[0].sourceObservedAt });
      const { digest, gated, replay } = buildOfficialJpSeedClaimSql(claim, actor);
      writeFileSync(join(outDir, `${code}-claim.json`), `${JSON.stringify(claim, null, 1)}\n`);
      writeFileSync(join(outDir, `${code}-claim.sql`), gated);
      writeFileSync(join(outDir, `${code}-claim-replay.sql`), replay);
      console.log(JSON.stringify({ code, claim: claim.seed.cardId, officialCardId: claim.card.provider_id, rarity: claim.card.rarity_code, planDigest: digest }));
    }
    const digests = [];
    for (const plan of plans) {
      const name = `${code}-${plan.batch.index}`;
      const { digest, gated, replay } = buildOfficialJpSeriesSql(plan, actor);
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
      writeFileSync(join(outDir, `${name}.sql`), gated);
      writeFileSync(join(outDir, `${name}-replay.sql`), replay);
      digests.push({ batch: plan.batch.index, cards: plan.cards.length, planDigest: digest });
    }
    writeFileSync(join(outDir, `${code}-report.json`), `${JSON.stringify({ summary, digests, quarantined, rarityUnknown, claimed, evidence }, null, 1)}\n`);
    console.log(JSON.stringify({ ...summary, digests }));
  }
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
