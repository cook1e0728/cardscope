// 依 server.mjs 同一份 PUBLIC_STATIC 白名單收集靜態資源至 worker/public/，並產生 Cloudflare Static Assets 的 _headers。
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  REVALIDATE_EXTENSIONS,
  buildPageCsp,
  computeInlineScriptSources,
  isPublicStaticPath,
  renderCloudflareHeadersFile
} from '../providers/http-security.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUT = join(DEFAULT_ROOT, 'worker', 'public');

async function collectFiles(dir, { recursive = false, prefix = '' } = {}) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (recursive) found.push(...await collectFiles(fullPath, { recursive: true, prefix: relPath }));
      continue;
    }
    if (entry.isFile()) found.push({ fullPath, webPath: `/${relPath}` });
  }
  return found;
}

export async function prepareWorkerAssets({ rootDir = DEFAULT_ROOT, outDir = DEFAULT_OUT } = {}) {
  const resolvedRoot = resolve(rootDir);
  const resolvedOut = resolve(outDir);

  await rm(resolvedOut, { recursive: true, force: true });
  await mkdir(resolvedOut, { recursive: true });

  // 只從明確的前端公開位置收集，絕不掃描 server.mjs、providers/、docs/、scripts/、supabase/、test/、node_modules/ 與隱藏檔。
  const candidates = [
    ...await collectFiles(resolvedRoot, { recursive: false }),
    ...await collectFiles(join(resolvedRoot, 'assets'), { recursive: true, prefix: 'assets' }),
    ...await collectFiles(join(resolvedRoot, 'data'), { recursive: false, prefix: 'data' })
  ];

  const copied = [];
  const revalidatePaths = [];
  for (const item of candidates.sort((a, b) => a.webPath.localeCompare(b.webPath))) {
    if (!isPublicStaticPath(item.webPath)) continue;
    const dest = join(resolvedOut, item.webPath.slice(1));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(item.fullPath, dest);
    copied.push(item.webPath);
    if (REVALIDATE_EXTENSIONS.has(extname(item.webPath).toLowerCase())) {
      revalidatePaths.push(item.webPath);
    }
  }

  const indexPath = join(resolvedRoot, 'index.html');
  const indexHtml = await readFile(indexPath, 'utf8');
  const inlineSources = await computeInlineScriptSources(indexHtml);
  const pageCsp = buildPageCsp(inlineSources);

  // Cloudflare Workers Static Assets _headers 上限為 100 條規則（1 條 /* + revalidatePaths）。
  if (1 + revalidatePaths.length > 100) {
    throw new Error(`_headers 規則數超過 Cloudflare 上限 100（目前 ${1 + revalidatePaths.length}）`);
  }

  const headersText = renderCloudflareHeadersFile({ pageCsp, revalidatePaths });
  await writeFile(join(resolvedOut, '_headers'), headersText, 'utf8');

  return { copied, revalidatePaths, pageCsp, outDir: resolvedOut };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await prepareWorkerAssets();
  console.log(`已準備 Worker 靜態資源：共 ${result.copied.length} 個檔案（${result.revalidatePaths.length} 筆 no-cache 規則）→ ${result.outDir}`);
}
