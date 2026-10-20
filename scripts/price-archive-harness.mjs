// ADR 0046 verification against the live bucket, without touching production rows: nothing is deleted from price_snapshots, and every object goes under a throw-away prefix that is removed at the end.
//   node scripts/price-archive-harness.mjs                 equivalence: real rows -> archive (real Storage) -> merged history vs database-only history, for many real cards
//   node --max-old-space-size=256 scripts/price-archive-harness.mjs --memory   synthetic 6-month archive (realistic volume), worst-case history requests, peak heap
// The service key comes from SUPABASE_SERVICE_KEY, or is fetched with SUPABASE_ACCESS_TOKEN (.env.local) from the Management API; it is never printed.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

process.env.PORT = '0'; process.env.CATALOG_SYNC_ON_START = 'false'; process.env.CATALOG_WARM_ON_START = 'false';
const PROJECT_REF = 'ubiaftrvmywwmifqzmik', BASE_URL = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const { buildPriceHistory, server } = await import('../server.mjs');
const { createArchiveReader, createArchiveStorage, encodeShard, mergeSnapshotRows, shardOf, shortDigest, storeRowsInArchive, ARCHIVE_SHARDS } = await import('../providers/price-archive.mjs');

async function serviceKey() {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY;
  const token = process.env.SUPABASE_ACCESS_TOKEN || readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/).find(row => row.startsWith('SUPABASE_ACCESS_TOKEN=')).slice('SUPABASE_ACCESS_TOKEN='.length).trim();
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } });
  const keys = await response.json();
  const legacy = keys.find(key => key.name === 'service_role' && key.type === 'legacy') || keys.find(key => key.type === 'secret');
  if (!legacy?.api_key) throw new Error('SERVICE_KEY_UNAVAILABLE');
  return legacy.api_key;
}

const key = await serviceKey();
const prefix = `harness-${Date.now()}`;
const storage = createArchiveStorage({ baseUrl: BASE_URL, key, prefix });
const dbGet = async path => { const response = await fetch(`${BASE_URL}/rest/v1${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }); if (!response.ok) throw new Error(`DB ${response.status}`); return response.json(); };
const MB = value => `${(value / 1048576).toFixed(1)} MB`;
const fx = { rates: { EUR: 38, USD: 32 }, source: 'harness' };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
const uploaded = new Set();
const trackedStorage = new Proxy(storage, { get: (target, name) => name === 'put' ? async (path, ...rest) => { uploaded.add(path); return target.put(path, ...rest); } : target[name] });

async function cleanup() {
  const paths = [...uploaded];
  for (let i = 0; i < paths.length; i += 50) await storage.remove(paths.slice(i, i + 50));
  const left = []; for (const path of paths) if (await storage.get(path)) left.push(path);
  console.log(`cleanup: removed ${paths.length} objects, ${left.length} left`);
}

async function equivalence() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) { const page = await dbGet(`/price_snapshots?select=card_id,provider,variant,currency,snapshot_date,amount&order=card_id.asc,provider.asc,variant.asc,snapshot_date.asc&limit=1000&offset=${offset}`); rows.push(...page); if (page.length < 1000) break; }
  const dates = [...new Set(rows.map(row => row.snapshot_date))].sort();
  const cutoff = dates[Math.floor(dates.length / 2)];
  console.log(`db rows ${rows.length}, dates ${dates[0]}..${dates.at(-1)}, simulated cutoff ${cutoff} (rows before it are archived, rows from it stay)`);
  const old = rows.filter(row => row.snapshot_date < cutoff), kept = rows.filter(row => row.snapshot_date >= cutoff);
  await storage.ensureBucket();
  let t = Date.now();
  const first = await storeRowsInArchive(trackedStorage, old);
  console.log(`archived ${old.length} rows into ${first.files} files (${first.filesWritten} written) in ${Date.now() - t} ms`);
  const again = await storeRowsInArchive(trackedStorage, old);
  console.log(`re-run: rowsWritten ${again.rowsWritten}, filesWritten ${again.filesWritten} (must be 0 / 0)`);
  if (again.rowsWritten || again.filesWritten) throw new Error('NOT_IDEMPOTENT');
  // a partially overlapping re-store (crash window: some rows exist already) must merge, not overwrite
  const overlap = await storeRowsInArchive(trackedStorage, [...old.slice(0, 500), ...kept.slice(0, 500)]);
  console.log(`overlap store: wrote ${overlap.rowsWritten} new rows (the ${kept.slice(0, 500).length} kept rows, which would be archived later), existing ${overlap.rowsAlready}`);
  const reader = createArchiveReader({ storage });
  const byCard = new Map();
  for (const row of rows) { if (!byCard.has(row.card_id)) byCard.set(row.card_id, []); byCard.get(row.card_id).push(row); }
  const cards = [...byCard.keys()];
  const sample = new Set(cards.filter((_, i) => i % Math.max(1, Math.floor(cards.length / 600)) === 0));
  for (const id of [...byCard.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 25).map(entry => entry[0])) sample.add(id);
  let compared = 0, mismatches = 0, linePoints = 0;
  const ids = [...sample], from = dates[0];
  for (let i = 0; i < ids.length; i++) {
    const group = ids.slice(i, i + 1 + (i % 3));            // singles, pairs, triples of cards, like a detail page with printings
    const card = { id: group[0], region: 'JP', printings: group.slice(1).map(cardId => ({ cardId, region: 'US' })) };
    const expected = buildPriceHistory(group.flatMap(id => byCard.get(id)), { card, requestedId: group[0], fx, now: Date.parse('2026-10-21T00:00:00Z') });
    const actual = buildPriceHistory(mergeSnapshotRows(kept.filter(row => group.includes(row.card_id)), await reader.rowsFor(group, { from })), { card, requestedId: group[0], fx, now: Date.parse('2026-10-21T00:00:00Z') });
    compared++;
    linePoints += expected.series.reduce((sum, line) => sum + line.points.length, 0);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) { mismatches++; console.log('MISMATCH', group.join(','), digest(expected), digest(actual)); }
  }
  console.log(`compared ${compared} histories (${linePoints} points): mismatches ${mismatches}; cache ${JSON.stringify({ ...reader.stats(), keys: undefined })}`);
  if (mismatches) throw new Error('HISTORY_DIFFERS');
}

async function memory() {
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'], perShardRows = 5600, perShardCards = 700;   // 180k rows per month ~ today's volume x 30 days, over 32 shards
  await storage.ensureBucket();
  const manifest = { v: 1, months: {} }, cards = Array.from({ length: perShardCards * ARCHIVE_SHARDS * 2 }, (_, i) => `synthetic-card-${i}`), byShard = Array.from({ length: ARCHIVE_SHARDS }, () => []);
  for (const id of cards) byShard[shardOf(id)].push(id);
  let bytes = 0, files = 0;
  for (const month of months) {
    manifest.months[month] = {};
    for (let shard = 0; shard < ARCHIVE_SHARDS; shard++) {
      const unique = new Map();
      for (let i = 0; unique.size < perShardRows; i++) {
        const id = byShard[shard][i % byShard[shard].length], day = String(1 + Math.floor(i / byShard[shard].length) % 28).padStart(2, '0'), provider = i % 2 ? 'tcgplayer' : 'cardmarket', variant = ['holo', 'normal', 'reverse', ''][Math.floor(i / 2) % 4];
        unique.set(`${id}|${provider}|${variant}|${day}`, { card_id: id, provider, variant, currency: provider === 'tcgplayer' ? 'USD' : 'EUR', snapshot_date: `${month}-${day}`, amount: Math.round((1 + (i * 37) % 9000) * 100) / 100 });
      }
      const uniqueRows = [...unique.values()];
      const encoded = await encodeShard(month, shard, uniqueRows);
      await trackedStorage.put(storage.shardPath(month, shard), encoded.gz, 'application/gzip');
      manifest.months[month][String(shard).padStart(2, '0')] = { n: uniqueRows.length, d: shortDigest(encoded.digest) }; bytes += encoded.gz.length; files++;
    }
  }
  await trackedStorage.put(storage.manifestPath, Buffer.from(JSON.stringify(manifest)), 'application/json');
  console.log(`synthetic archive: ${files} files, ${MB(bytes)} gzipped (${(bytes / files / 1024).toFixed(0)} KB per shard-month), prefix ${prefix}`);
  const heapBefore = process.memoryUsage().heapUsed;
  let peak = 0;
  const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5);
  const run = async (label, ids) => {
    const reader = createArchiveReader({ storage });
    const started = Date.now();
    const rows = await reader.rowsFor(ids, { from: '2026-04-01' });
    const body = buildPriceHistory(mergeSnapshotRows([], rows), { card: { id: ids[0], printings: ids.slice(1).map(cardId => ({ cardId })) }, requestedId: ids[0], fx });
    console.log(`${label}: ${ids.length} id(s), ${rows.length} archive rows, ${body.series.length} lines, ${Date.now() - started} ms cold, cache ${JSON.stringify({ ...reader.stats(), keys: undefined })}`);
    return reader;
  };
  await run('typical card (1 id, 6 months)', [cards[0]]);
  await run('detail page with printings (3 ids)', [cards[0], cards[1], cards[2]]);
  const reader = await run('worst case (30 ids = every shard, 6 months, 192 files)', cards.slice(0, 400).filter((id, i, all) => all.findIndex(other => shardOf(other) === shardOf(id)) === i).slice(0, 30));
  const started = Date.now(); await reader.rowsFor(cards.slice(0, 30), { from: '2026-04-01' }); console.log(`worst case again (cache bounded to ${reader.stats().entries} entries): ${Date.now() - started} ms`);
  clearInterval(sampler);
  console.log(`heap before ${MB(heapBefore)}, peak during requests ${MB(peak)}, heap limit ${MB(process.execArgv.includes('--max-old-space-size=256') ? 256 * 1048576 : 0)}`);
}

let failed = false;
try {
  if (process.argv.includes('--memory')) await memory(); else await equivalence();
  console.log('HARNESS_OK');
} catch (error) { failed = true; console.error('HARNESS_FAILED', error.message); }
finally { await cleanup().catch(error => { console.error('cleanup failed', error.message); failed = true; }); server.close(); process.exit(failed ? 1 : 0); }
