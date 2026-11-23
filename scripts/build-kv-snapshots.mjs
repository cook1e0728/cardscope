// 產生首頁統計與收錄覆蓋率（pack-prizes、series-hits、catalog/coverage）預產快照，並選用寫入本機 JSON 或推送至 Cloudflare Workers KV。
// 用法：
//   node scripts/build-kv-snapshots.mjs [--targets pack-prizes,series-hits,catalog-coverage] [--out <file.json>] [--push] [--if-configured]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KV_KEYS, createSnapshotGenerator, putCloudflareKvValue } from '../providers/kv-snapshots.mjs';

export const SNAPSHOT_TARGETS = Object.freeze(['pack-prizes', 'series-hits', 'catalog-coverage']);

export function parseSnapshotArgs(argv = []) {
  const opts = {
    targets: [...SNAPSHOT_TARGETS],
    outPath: '',
    push: false,
    ifConfigured: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--push') {
      opts.push = true;
    } else if (arg === '--if-configured') {
      opts.ifConfigured = true;
    } else if (arg === '--targets' && argv[i + 1]) {
      const list = String(argv[++i]).split(',').map(s => s.trim()).filter(Boolean);
      for (const item of list) {
        if (!SNAPSHOT_TARGETS.includes(item)) {
          throw new Error(`不支援的快照目標：${item}`);
        }
      }
      if (list.length) opts.targets = [...new Set(list)];
    } else if (arg === '--out' && argv[i + 1]) {
      opts.outPath = String(argv[++i]).trim();
    }
  }
  return opts;
}

export async function runSnapshotBuild({
  env = process.env,
  fetchFn = globalThis.fetch,
  now = Date.now,
  targets = SNAPSHOT_TARGETS,
  outPath = '',
  push = false,
  ifConfigured = false,
  apiBaseUrl = 'https://api.cloudflare.com/client/v4',
  log = console
} = {}) {
  const hasSupabase = Boolean(env?.SUPABASE_URL && env?.SUPABASE_SERVICE_KEY);
  const hasKv = Boolean(env?.CF_ACCOUNT_ID && env?.CF_KV_NAMESPACE_ID && env?.CF_API_TOKEN);

  if (!hasSupabase || (push && !hasKv)) {
    if (ifConfigured) {
      log.log?.('kv-snapshots: 尚未設定完整 SUPABASE_* 或 CF_* Secrets，略過本次排程執行。');
      return { skipped: true, snapshots: {}, pushed: [], errors: {} };
    }
    if (!hasSupabase) throw new Error('SUPABASE_NOT_CONFIGURED');
    throw new Error('CLOUDFLARE_KV_CREDENTIALS_MISSING');
  }

  const generator = createSnapshotGenerator({ env, fetchFn, now });
  const needCatalog = targets.includes('pack-prizes') || targets.includes('series-hits');
  let sharedCatalog = null;
  if (needCatalog) {
    sharedCatalog = await generator.loadCatalogForSnapshot();
  }

  const snapshots = {};
  const pushed = [];
  const errors = {};

  const runners = new Map([
    ['pack-prizes', { key: KV_KEYS.packPrizes, run: () => generator.computePackPrizesSnapshot(sharedCatalog) }],
    ['series-hits', { key: KV_KEYS.seriesHits, run: () => generator.computeSeriesHitsSnapshot(sharedCatalog) }],
    ['catalog-coverage', { key: KV_KEYS.catalogCoverage, run: () => generator.computeCatalogCoverageSnapshot() }]
  ]);

  for (const target of targets) {
    const entry = runners.get(target);
    if (!entry) continue;
    try {
      const payload = await entry.run();
      snapshots[entry.key] = payload;
      if (push) {
        const result = await putCloudflareKvValue({
          accountId: env.CF_ACCOUNT_ID,
          namespaceId: env.CF_KV_NAMESPACE_ID,
          apiToken: env.CF_API_TOKEN,
          key: entry.key,
          value: payload,
          apiBaseUrl,
          fetchFn
        });
        pushed.push(result);
        log.log?.(`kv-snapshots: 已寫入 ${result.key} (${result.bytes} bytes)`);
      }
    } catch (error) {
      errors[target] = String(error?.message || error);
      log.error?.(`kv-snapshots: ${target} 產生或寫入失敗`, errors[target]);
    }
  }

  if (outPath && Object.keys(snapshots).length > 0) {
    const fullPath = resolve(outPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, `${JSON.stringify(snapshots, null, 2)}\n`, 'utf8');
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error(`SNAPSHOT_BUILD_FAILED:${Object.keys(errors).join(',')}`);
    err.snapshots = snapshots;
    err.pushed = pushed;
    err.errors = errors;
    throw err;
  }

  return { skipped: false, snapshots, pushed, errors };
}

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  const opts = parseSnapshotArgs(process.argv.slice(2));
  runSnapshotBuild(opts).catch(error => {
    console.error('kv-snapshots failed:', error?.message || error);
    process.exitCode = 1;
  });
}
