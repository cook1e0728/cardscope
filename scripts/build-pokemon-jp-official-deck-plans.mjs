import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { groupOfficialJpDecks } from '../providers/pokemon-jp-official-decks.mjs';
import { buildOfficialJpSeriesPlans, buildOfficialJpSeriesSql, OFFICIAL_JP_SOURCE } from '../providers/pokemon-jp-official-series-plan.mjs';
import { buildOfficialJpSameNameSql } from '../providers/pokemon-jp-official-same-name-plan.mjs';

const usage = [
  'Usage: node scripts/build-pokemon-jp-official-deck-plans.mjs <series-cache.json> <products.json> <series-meta.json> <existing.json> <out-dir>',
  '        --series SA,SCS [--actor NAME]',
  '',
  'ADR 0032：同一代碼由多盒各自從 001 編號的系列，依官方「収録商品」每盒一個系列（第 1 盒沿用原代碼，',
  '第 k 盒為 <代碼>-<k>）。existing.json：[{ seriesId, providerIds: [...] }]，資料庫中已有的日版官方系列與其卡片官方 ID。',
  '系列不存在 → private.import_pokemon_jp_official_series 計畫；已存在 → 只補缺的卡（private.supplement_pokemon_jp_official_series）。',
  '不連網、不連資料庫。'
].join('\n');

try {
  const args = process.argv.slice(2);
  const [cachePath, productsPath, metaPath, existingPath, outDir] = args;
  const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (!cachePath || !productsPath || !metaPath || !existingPath || !outDir || !flag('--series')) throw new Error('ARGUMENTS_REQUIRED');
  const actor = flag('--actor') ?? 'claude-code-local:aa26488931';
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  const [cache, products, meta, existing] = [cachePath, productsPath, metaPath, existingPath].map(read);
  mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const code of flag('--series').split(',')) {
    if (!meta[code]) throw new Error(`SERIES_META_MISSING:${code}`);
    const list = cache.lists[code];
    for (const deck of groupOfficialJpDecks({ code, cache, products })) {
      const seriesId = `pokemon-official-ja-${deck.deckCode.toLowerCase()}`;
      const deckCache = { lists: { [deck.deckCode]: { hitCount: deck.cardIds.length, cardIds: deck.cardIds, fetchedAt: list.fetchedAt } }, details: cache.details };
      const seriesMeta = { name_ja: deck.productName, release_date: meta[code].release_date ?? null, basis: `pokemon-card.com card detail 収録商品 (${deck.productPath})` };
      const built = buildOfficialJpSeriesPlans({ code: deck.deckCode, seriesMeta, cache: deckCache, printedSetMark: code });
      const product = { officialProduct: deck.productName };
      const held = existing.find(row => row.seriesId === seriesId);
      const entry = { code, deckCode: deck.deckCode, product: deck.productName, pages: deck.cardIds.length, quarantined: built.quarantined, rarityUnknown: built.rarityUnknown.length, files: [] };
      if (!held) {
        for (const plan of built.plans) {
          plan.series.metadata = { ...plan.series.metadata, ...product, printedSetMark: code };
          plan.cards = plan.cards.map(card => ({ ...card, metadata: { ...card.metadata, ...product } }));
          const name = `${deck.deckCode}-import-${plan.batch.index}`, sql = buildOfficialJpSeriesSql(plan, actor);
          writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
          writeFileSync(join(outDir, `${name}.sql`), sql.gated);
          writeFileSync(join(outDir, `${name}-replay.sql`), sql.replay);
          entry.files.push({ name, kind: 'import', cards: plan.cards.length, digest: sql.digest });
        }
      } else {
        const present = new Set(held.providerIds.map(String));
        const cards = built.plans.flatMap(plan => plan.cards).filter(card => !present.has(card.provider_id))
          .map(card => ({ ...card, metadata: { ...card.metadata, officialCardIds: [card.provider_id], ...product } }));
        const first = built.plans[0];
        entry.alreadyPresent = present.size;
        for (let part = 0; part * 100 < cards.length; part++) {
          const plan = { planVersion: 1, source: OFFICIAL_JP_SOURCE, seriesProviderId: deck.deckCode, evidenceHash: first.evidenceHash, sourceObservedAt: first.sourceObservedAt, series: { id: seriesId, provider_id: deck.deckCode }, cards: cards.slice(part * 100, (part + 1) * 100) };
          const name = `${deck.deckCode}-supplement-${part + 1}`, sql = buildOfficialJpSameNameSql(plan, actor);
          writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(plan, null, 1)}\n`);
          writeFileSync(join(outDir, `${name}.sql`), sql.gated);
          writeFileSync(join(outDir, `${name}-replay.sql`), sql.replay);
          entry.files.push({ name, kind: 'supplement', cards: plan.cards.length, digest: sql.digest });
        }
      }
      report.push(entry);
      console.log(JSON.stringify({ deckCode: entry.deckCode, product: entry.product, pages: entry.pages, quarantined: entry.quarantined.length, files: entry.files.map(f => `${f.name}:${f.cards}`) }));
    }
  }
  writeFileSync(join(outDir, 'deck-report.json'), `${JSON.stringify(report, null, 1)}\n`);
} catch (error) {
  console.error(error.message === 'ARGUMENTS_REQUIRED' ? usage : error.message);
  process.exitCode = 1;
}
