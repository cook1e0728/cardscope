#!/usr/bin/env node
// 背景工作（原本在 Render 長駐伺服器裡用計時器跑，2026-11-25 起改由 GitHub Actions 排程呼叫，見 .github/workflows/background-jobs.yml）：
//   node scripts/background-job.mjs catalog-sync     目錄同步（只同步超過 72 小時沒更新的來源）＋重建瀏覽排序鍵＋遊戲王卡圖快取
//   node scripts/background-job.mjs price-snapshot   每日價格快照（一次最多跑 --budget-minutes，沒跑完下一輪從 cursor 接著跑）
//   node scripts/background-job.mjs price-archive    把 30 天前的價格快照封存到 Storage
//   node scripts/background-job.mjs tcgapi-pricing   TCGAPI 日版價格與卡圖（需要 TCGAPI_KEY）
//   node scripts/background-job.mjs yugioh-images    只跑遊戲王卡圖快取（取代 /api/admin/catalog/cache-images）
// 需要的環境變數：SUPABASE_URL、SUPABASE_SERVICE_KEY（tcgapi-pricing 另需 TCGAPI_KEY）。工作本身失敗時結束碼為 1。
import { pathToFileURL } from 'node:url';
import { MAIN_ONLY_PATH } from '../providers/supabase-client.mjs';
import { catalogProvidersNeedingSync, closeInterruptedCatalogRuns, refreshBrowseKeys, syncCatalog } from '../providers/catalog-sync.mjs';
import { cacheYugiohImages } from '../providers/image-cache.mjs';
import { createArchiveStorage, runPriceArchive } from '../providers/price-archive.mjs';
import { planNextSnapshotRun, runPriceSnapshot } from '../providers/price-snapshot.mjs';
import { createTcgapiPricing } from '../providers/tcgapi-pricing.mjs';
import { filterAllowedCatalogProviders, imageCollectionAllowed } from '../providers/source-policy.mjs';

// 與 server.mjs 的 supabaseFetch 相同：預設主庫，options.db === 'ip2' 才打第二庫；價格、統計、同步紀錄只在主庫。
export function createDb(env = process.env, fetchImpl = (...args) => globalThis.fetch(...args)) {
  return async function supabaseFetch(pathAndQuery, { db, ...options } = {}) {
    const which = db === 'ip2' && !MAIN_ONLY_PATH.test(pathAndQuery) ? 'ip2' : 'main';
    const [base, key] = which === 'ip2' ? [env.SUPABASE2_URL, env.SUPABASE2_SERVICE_KEY] : [env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY];
    if (!base || !key) throw new Error(which === 'ip2' ? 'SUPABASE2_NOT_CONFIGURED' : 'SUPABASE_NOT_CONFIGURED');
    const response = await fetchImpl(`${String(base).replace(/\/+$/, '')}/rest/v1${pathAndQuery}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
    if (!response.ok) { const text = await response.text().catch(() => ''); throw new Error(`SUPABASE_${response.status}:${text.slice(0, 200)}`); }
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  };
}

export async function runCatalogSync({ db, env = process.env, log = console, startedAt = new Date().toISOString() }) {
  // Actions 的 concurrency 讓目錄同步不會重疊，所以開始時還在 running 的目錄同步紀錄一定是被砍掉的上一輪；不關掉它，那個來源要 6 小時後才會再同步。
  await closeInterruptedCatalogRuns(db, startedAt).catch(error => log.warn('closing interrupted catalog runs failed', error?.message));
  const maxAgeHours = Math.max(1, Number(env.CATALOG_SYNC_MAX_AGE_HOURS) || 72);
  const needed = await catalogProvidersNeedingSync(db, maxAgeHours, { includeTcgdexTw: env.TCGDEX_TW_SYNC === 'true' });
  const providers = filterAllowedCatalogProviders(needed), blocked = needed.filter(provider => !providers.includes(provider));
  if (blocked.length) log.warn('source policy blocked scheduled catalog sync', blocked.join(','));
  const result = { providers, sync: null, browseKeys: null, images: null };
  if (providers.length) { log.log('starting catalog sync', providers.join(',')); result.sync = await syncCatalog(db, { providers }); }
  result.browseKeys = await refreshBrowseKeys(db);
  if (env.CARD_IMAGE_CACHE_ON_START !== 'false' && providers.includes('yugioh')) result.images = await runYugiohImages({ db, env });
  return result;
}

export async function runYugiohImages({ db, env = process.env }) {
  if (!imageCollectionAllowed('yugioh')) return { status: 'disabled', note: '來源政策尚未允許保存遊戲王卡圖' };
  return cacheYugiohImages(db, { limit: Number(env.CARD_IMAGE_CACHE_LIMIT || 15000), concurrency: Number(env.CARD_IMAGE_CACHE_CONCURRENCY || 4) });
}

// Render 時期補圖靠記憶體記「上次補圖」每 7 天一次；Actions 每次都是新程序，改成每週一（UTC）才補圖，其他天整份額度拿來抓價。
// shortcut: 週一補圖若被額度打斷，要等下週一才接著補；缺圖多到一天補不完時再改成把上次補圖時間存進資料庫。
export const tcgapiImagesDue = (date = new Date()) => date.getUTCDay() === 1;

export async function runSnapshotJob({ db, env = process.env, budgetMinutes = 300, now = Date.now, log = console, run = runPriceSnapshot }) {
  const plan = await planNextSnapshotRun(db, { now });
  if (plan.action !== 'run') return { status: plan.action, waitMinutes: Math.round((plan.waitMs || 0) / 60000) };
  return run({ db, env, log, now, cursor: plan.cursor ?? null, resumedFrom: plan.resumedFrom ?? null, deadline: now() + budgetMinutes * 60000 });
}

const FAILED = new Set(['failed']);
async function main(argv = process.argv.slice(2), env = process.env) {
  const [job] = argv, budgetArg = argv.find(arg => arg.startsWith('--budget-minutes='));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定');
  const db = createDb(env);
  let result;
  if (job === 'catalog-sync') result = await runCatalogSync({ db, env });
  else if (job === 'price-snapshot') result = await runSnapshotJob({ db, env, budgetMinutes: Number(budgetArg?.split('=')[1]) || 300 });
  else if (job === 'price-archive') result = env.PRICE_ARCHIVE_ENABLED === 'false' ? { status: 'disabled' } : await runPriceArchive({ db, storage: createArchiveStorage({ baseUrl: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY }) });
  else if (job === 'tcgapi-pricing') result = env.TCGAPI_KEY ? await createTcgapiPricing({ apiKey: env.TCGAPI_KEY, db, lastImageRun: tcgapiImagesDue() ? 0 : Date.now() }).runOnce() : { status: 'not-configured', note: '沒有設定 TCGAPI_KEY，略過' };
  else if (job === 'yugioh-images') result = await runYugiohImages({ db, env });
  else throw new Error(`未知的工作：${job || '(空白)'}；可用 catalog-sync、price-snapshot、price-archive、tcgapi-pricing、yugioh-images`);
  console.log(job, JSON.stringify(result));
  // 快照時間到（TIME_BUDGET）是正常的分段，不算失敗；其他 failed 讓 Actions 顯示紅燈。
  if (FAILED.has(result?.status) && result?.error !== 'TIME_BUDGET') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error?.message || error); process.exitCode = 1; });
