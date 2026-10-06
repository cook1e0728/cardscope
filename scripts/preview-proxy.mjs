// Local design preview: serves this checkout's front-end files and forwards /api/* (read-only GETs) to the
// production site, so a styling branch can be judged against real cards without database credentials.
// Usage: node scripts/preview-proxy.mjs [port]   (default 4300; PREVIEW_UPSTREAM overrides the API host)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const upstream = process.env.PREVIEW_UPSTREAM || 'https://cardscope.onrender.com';
const port = Number(process.argv[2] || process.env.PORT || 4300);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') { res.writeHead(405).end('preview proxy is read-only'); return; }
    try {
      const response = await fetch(upstream + url.pathname + url.search, { headers: { accept: req.headers.accept || '*/*' } });
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') || 'application/json' });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(502).end(String(error)); }
    return;
  }
  const file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(file); } catch { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
}).listen(port, () => console.log(`Design preview at http://localhost:${port} (API from ${upstream})`));
