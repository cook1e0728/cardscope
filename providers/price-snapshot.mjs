// ADR 0042: once a day, store the TCGdex-relayed reference prices (Cardmarket trend, TCGplayer marketPrice) of every card the detail page prices,
// but only when the value moved >= 2% (or 7 days passed) since the card's last stored value. Polite: one request at a time, at most one per second.
import { readFile } from 'node:fs/promises';
import { TCGDEX_OFFICIAL_JP_SERIES, TCGDEX_REQUEST_TIMEOUT_MS, createTcgdexPricing, tcgdexLookupForPrinting } from './tcgdex-pricing.mjs';
import { catalogCollectionAllowed } from './source-policy.mjs';

export const PRICE_SNAPSHOT_PROVIDER = 'price-snapshot';
export const MIN_SNAPSHOT_AMOUNT = 0.5;            // EUR / USD; below this the card is not stored
export const SNAPSHOT_CHANGE_PERCENT = 2;          // store when the value moved by at least this much
export const SNAPSHOT_MAX_AGE_DAYS = 7;            // ... or when the last stored value is this old
export const SNAPSHOT_REQUEST_INTERVAL_MS = 1000;  // one TCGdex request per second
export const SNAPSHOT_MAX_CONSECUTIVE_FAILURES = 20;
export const SNAPSHOT_PAGE_SIZE = 1000;            // PostgREST page (keyset)
export const SNAPSHOT_CHUNK_SIZE = 50;             // cards priced, then compared and written together
export const SNAPSHOT_WRITE_BATCH_SIZE = 200;
export const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const SNAPSHOT_INITIAL_DELAY_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const PRINTING_SELECT = 'id,card_id,source,provider_id,region,local_set_code,local_card_number,card:tcg_cards(game_id,name_ja,name_en)';
const PRIMARY_KEY = 'card_id,provider,variant,snapshot_date';
const quoteList = values => `in.(${[...values].map(value => `"${String(value).replaceAll('"', '')}"`).join(',')})`;
const emptySkipped = () => ({ notFound: 0, noPrice: 0, httpError: 0, timeout: 0, networkError: 0, unchanged: 0, sameDay: 0 });
const defaultSleep = (ms, signal) => new Promise(resolve => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});

export async function loadEnSetMap() {
  return JSON.parse(await readFile(new URL('../data/tcgdex-en-set-map.json', import.meta.url), 'utf8')).sets;
}

// PRICE_SNAPSHOT_ENABLED=false or the registry's tcgdex-pricing collectionEnabled:false stops the snapshot; stored rows stay.
export function priceSnapshotEnabled({ env = process.env, collectionAllowed = catalogCollectionAllowed } = {}) {
  return String(env.PRICE_SNAPSHOT_ENABLED ?? '').trim().toLowerCase() !== 'false' && collectionAllowed('tcgdexPricing') === true;
}

// The same three families the detail page prices (ADR 0036/0037/0038). Each is a keyset-paged printing query; tcgdexLookupForPrinting makes the final call.
export function snapshotBranches({ enSetMap, officialJpSeries = TCGDEX_OFFICIAL_JP_SERIES }) {
  return [
    { name: 'tcgdex-ja', filter: { source: 'eq.tcgdex-ja' } },
    { name: 'official-jp', filter: { region: 'eq.JP', source: 'neq.tcgdex-ja', local_set_code: quoteList(officialJpSeries) } },
    { name: 'us', filter: { source: 'eq.pokemontcg', region: 'eq.US', local_set_code: quoteList(Object.keys(enSetMap)) } }
  ];
}

export function parseSnapshotCursor(cursor) {
  const match = /^(\d+):(\d+)$/.exec(String(cursor ?? ''));
  return match ? { branch: Number(match[1]), id: Number(match[2]) } : { branch: 0, id: 0 };
}

// Pages of { items: [{ cardId, id, expectedName, language, printingId, cursor }] }; every item is one card to price. Read-only, keyset on the printing id, <= 1000 rows per request.
export async function* listSnapshotCandidates(db, { enSetMap, officialJpSeries = TCGDEX_OFFICIAL_JP_SERIES, pageSize = SNAPSHOT_PAGE_SIZE, cursor = null, signal } = {}) {
  const branches = snapshotBranches({ enSetMap, officialJpSeries }), start = parseSnapshotCursor(cursor);
  for (let branch = start.branch; branch < branches.length; branch++) {
    let after = branch === start.branch ? start.id : 0;
    for (;;) {
      if (signal?.aborted) return;
      const params = new URLSearchParams({ select: PRINTING_SELECT, ...branches[branch].filter, id: `gt.${after}`, order: 'id.asc', limit: String(pageSize) });
      const rows = (await db(`/tcg_printings?${params}`)) || [], items = [];
      for (const row of rows) {
        const card = Array.isArray(row.card) ? row.card[0] : row.card;
        if (card?.game_id !== 'pokemon') continue;
        const lookup = tcgdexLookupForPrinting({ cardId: row.card_id, source: row.source, providerId: row.provider_id, region: row.region, localSetCode: row.local_set_code, localCardNumber: row.local_card_number, nameJa: card.name_ja, nameEn: card.name_en }, { nameEn: card.name_en }, { enSetMap, officialJpSeries });
        if (lookup) items.push({ cardId: row.card_id, ...lookup, printingId: row.id, cursor: `${branch}:${row.id}` });
      }
      if (rows.length) yield { items, rowsScanned: rows.length, branch: branches[branch].name, cursor: `${branch}:${rows.at(-1).id}` };
      if (rows.length < pageSize) break;
      after = rows.at(-1).id;
    }
  }
}

const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;

// previous = the card's latest stored row for the same provider and variant (or null). Amounts compare in whole cents.
export function snapshotDecision(previous, amount, today) {
  if (!previous) return { store: true, reason: 'first' };
  if (previous.snapshot_date === today) return { store: false, reason: 'sameDay' };
  if (daysBetween(previous.snapshot_date, today) >= SNAPSHOT_MAX_AGE_DAYS) return { store: true, reason: 'age' };
  const before = Math.round(Number(previous.amount) * 100), after = Math.round(Number(amount) * 100);
  if (!(before > 0) || Math.abs(after - before) * 100 >= before * SNAPSHOT_CHANGE_PERCENT) return { store: true, reason: 'changed' };
  return { store: false, reason: 'unchanged' };
}

const providerOf = market => market === 'TCGplayer' ? 'tcgplayer' : market === 'Cardmarket' ? 'cardmarket' : null;

// Only the platform reference price (priceType market); listing prices are never stored.
export function snapshotRowsFromRecords(cardId, records, today) {
  const rows = [], seen = new Set();
  let belowThreshold = 0;
  for (const record of records) {
    const provider = providerOf(record.market);
    if (record.priceType !== 'market' || !provider) continue;
    const amount = Number(record.amount), variant = String(record.variant ?? '').trim(), key = `${provider}|${variant}`;
    if (!Number.isFinite(amount) || seen.has(key)) continue;
    seen.add(key);
    if (amount < MIN_SNAPSHOT_AMOUNT) { belowThreshold++; continue; }
    rows.push({ card_id: cardId, provider, variant, currency: record.currency, snapshot_date: today, amount: Math.round(amount * 100) / 100, observed_at: record.observedAt ?? null });
  }
  return { rows, belowThreshold };
}

async function startRun(db, scope) {
  const rows = await db('/catalog_sync_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ provider: PRICE_SNAPSHOT_PROVIDER, scope, status: 'running' }]) });
  return rows?.[0]?.id;
}
const patchRun = (db, id, body, extra = '') => db(`/catalog_sync_runs?id=eq.${id}${extra}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
async function finishRun(db, id, status, stats, error = null) {
  if (!id) return;
  await patchRun(db, id, { status, rows_seen: stats.seen || 0, rows_written: stats.written || 0, cursor: stats.cursor || null, error: error ? String(error).slice(0, 1000) : null, metadata: stats.metadata || {}, finished_at: new Date().toISOString() });
}

async function loadPrevious(db, cardIds, since) {
  const latest = new Map(), pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({ select: 'card_id,provider,variant,snapshot_date,amount', card_id: quoteList(cardIds), snapshot_date: `gte.${since}`, order: 'card_id.asc,provider.asc,variant.asc,snapshot_date.desc', limit: String(pageSize), offset: String(offset) });
    const rows = (await db(`/price_snapshots?${params}`)) || [];
    for (const row of rows) { const key = `${row.card_id}|${row.provider}|${row.variant}`; if (!latest.has(key)) latest.set(key, row); }
    if (rows.length < pageSize) return latest;
  }
}

// One run: list candidates, price each card (throttled), compare with the last stored value, insert the changed ones. Never throws for a failed run; check stats.status.
export async function runPriceSnapshot(options = {}) {
  const { db, env = process.env, collectionAllowed = catalogCollectionAllowed, fetch: fetchImpl = (...args) => globalThis.fetch(...args), now = Date.now, sleep = defaultSleep, signal,
    cursor: resumeCursor = null, resumedFrom = null, intervalMs = SNAPSHOT_REQUEST_INTERVAL_MS, timeoutMs = TCGDEX_REQUEST_TIMEOUT_MS, maxConsecutiveFailures = SNAPSHOT_MAX_CONSECUTIVE_FAILURES,
    pageSize = SNAPSHOT_PAGE_SIZE, chunkSize = SNAPSHOT_CHUNK_SIZE, writeBatchSize = SNAPSHOT_WRITE_BATCH_SIZE, onProgress, log = console, officialJpSeries = TCGDEX_OFFICIAL_JP_SERIES } = options;
  const today = new Date(now()).toISOString().slice(0, 10), startedAt = now();
  const stats = { status: 'running', date: today, candidates: 0, rowsScanned: 0, requests: 0, written: 0, belowThreshold: 0, skipped: emptySkipped(), errorCodes: {}, errorSamples: [], cursor: resumeCursor, resumedFrom, error: null, startedAt: new Date(startedAt).toISOString(), finishedAt: null, durationMs: 0 };
  const skippedTotal = () => Object.values(stats.skipped).reduce((sum, n) => sum + n, 0);
  const snapshot = () => ({ ...stats, skipped: { ...stats.skipped }, skippedTotal: skippedTotal() });
  if (!priceSnapshotEnabled({ env, collectionAllowed })) return { ...snapshot(), status: 'disabled' };
  if (!db) throw new Error('PRICE_SNAPSHOT_DB_REQUIRED');

  const enSetMap = options.enSetMap ?? await loadEnSetMap();
  let runId = null, lastStatus = null, nextRequestAt = 0, consecutiveFailures = 0, stopReason = null;
  const heartbeat = async () => { if (!runId) return; try { await patchRun(db, runId, { rows_seen: stats.candidates, rows_written: stats.written, cursor: stats.cursor, metadata: { heartbeatAt: new Date(now()).toISOString(), requests: stats.requests, skipped: stats.skipped, errorCodes: stats.errorCodes, errorSamples: stats.errorSamples, belowThreshold: stats.belowThreshold } }); } catch (error) { log.warn?.('price snapshot heartbeat failed', error.message); } };

  // The only way out to TCGdex: sequential, at most one request per intervalMs, abortable.
  const throttledFetch = async (url, init = {}) => {
    lastStatus = null;
    const wait = nextRequestAt - now();
    if (wait > 0) await sleep(wait, signal);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    nextRequestAt = now() + intervalMs;
    stats.requests++;
    const combined = init.signal && signal ? AbortSignal.any([init.signal, signal]) : init.signal || signal;
    const response = await fetchImpl(url, { ...init, signal: combined });
    lastStatus = response.status;
    return response;
  };

  try {
    runId = await startRun(db, `daily-${today}`);
    if (resumedFrom) await patchRun(db, resumedFrom, { status: 'failed', error: 'INTERRUPTED', finished_at: new Date().toISOString() }, '&status=eq.running').catch(() => {});
    // Fail before any TCGdex request when the table is missing (migration not applied yet).
    await db('/price_snapshots?select=card_id&limit=1');

    const since = new Date(Date.parse(`${today}T00:00:00Z`) - SNAPSHOT_MAX_AGE_DAYS * DAY_MS).toISOString().slice(0, 10);
    for await (const page of listSnapshotCandidates(db, { enSetMap, officialJpSeries, pageSize, cursor: resumeCursor, signal })) {
      stats.rowsScanned += page.rowsScanned;
      for (let i = 0; i < page.items.length && !stopReason; i += chunkSize) {
        const chunk = page.items.slice(i, i + chunkSize);
        const pricing = { ja: createTcgdexPricing({ language: 'ja', fetch: throttledFetch, now, timeoutMs }), en: createTcgdexPricing({ language: 'en', fetch: throttledFetch, now, timeoutMs }) };
        const found = [];
        let done = 0;
        for (const item of chunk) {
          if (signal?.aborted) { stopReason = 'ABORTED'; break; }
          const before = stats.requests;
          lastStatus = null;
          let records;
          try {
            records = await pricing[item.language === 'en' ? 'en' : 'ja'](item.id, { expectedName: item.expectedName });
          } catch (error) {
            if (signal?.aborted) { stopReason = 'ABORTED'; break; }
            done++;
            const kind = error?.name === 'TimeoutError' ? 'timeout' : String(error?.message).startsWith('TCGDEX_PRICING_') ? 'httpError' : 'networkError';
            stats.skipped[kind]++;
            // 記下狀態碼分布與前幾個例子，Render 上的錯誤才查得到原因（本機重打同一批卡都是 200）。
            const code = kind === 'httpError' ? String(error.message).slice('TCGDEX_PRICING_'.length) : kind;
            stats.errorCodes[code] = (stats.errorCodes[code] || 0) + 1;
            if (stats.errorSamples.length < 10) stats.errorSamples.push(`${item.language}:${item.id}:${code}`);
            if (++consecutiveFailures >= maxConsecutiveFailures) { stopReason = 'CONSECUTIVE_FAILURES'; break; }
            continue;
          }
          done++;
          if (stats.requests > before) consecutiveFailures = 0;
          if (lastStatus === 404) { stats.skipped.notFound++; continue; }
          const { rows, belowThreshold } = snapshotRowsFromRecords(item.cardId, records, today);
          stats.belowThreshold += belowThreshold;
          if (!rows.length && !belowThreshold) stats.skipped.noPrice++;
          found.push(...rows);
        }
        stats.candidates += done;
        if (found.length) {
          const previous = await loadPrevious(db, [...new Set(found.map(row => row.card_id))], since), toWrite = new Map();
          for (const row of found) {
            const decision = snapshotDecision(previous.get(`${row.card_id}|${row.provider}|${row.variant}`), row.amount, today);
            if (!decision.store) { stats.skipped[decision.reason]++; continue; }
            toWrite.set(`${row.card_id}|${row.provider}|${row.variant}|${row.snapshot_date}`, row);
          }
          const rows = [...toWrite.values()];
          for (let offset = 0; offset < rows.length; offset += writeBatchSize) {
            const batch = rows.slice(offset, offset + writeBatchSize);
            await db(`/price_snapshots?on_conflict=${PRIMARY_KEY}`, { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(batch) });
            stats.written += batch.length;
          }
        }
        if (done) stats.cursor = chunk[done - 1].cursor;
        await heartbeat();
        onProgress?.(snapshot());
      }
      if (stopReason) break;
    }
    if (!stopReason && signal?.aborted) stopReason = 'ABORTED';
    stats.status = stopReason ? (stopReason === 'ABORTED' ? 'aborted' : 'failed') : 'completed';
    stats.error = stopReason;
  } catch (error) {
    stats.status = 'failed';
    stats.error = String(error?.message || error).slice(0, 300);
    log.error?.('price snapshot failed', stats.error);
  }
  stats.finishedAt = new Date(now()).toISOString();
  stats.durationMs = now() - startedAt;
  const final = snapshot();
  try {
    await finishRun(db, runId, stats.status === 'completed' ? 'completed' : 'failed', { seen: stats.candidates, written: stats.written, cursor: stats.status === 'completed' ? null : stats.cursor, metadata: { date: today, requests: stats.requests, rowsScanned: stats.rowsScanned, skipped: stats.skipped, errorCodes: stats.errorCodes, errorSamples: stats.errorSamples, skippedTotal: final.skippedTotal, belowThreshold: stats.belowThreshold, resumedFrom, durationMs: stats.durationMs } }, stats.error);
  } catch (error) { log.error?.('price snapshot run record failed', error.message); }
  return final;
}

// Decide what the scheduler does next from the latest price-snapshot run: wait (done within the interval), busy (another instance is alive), or run (fresh, or resume an interrupted run).
export async function planNextSnapshotRun(db, { now = Date.now, intervalMs = SNAPSHOT_INTERVAL_MS, resumeWindowMs = 12 * 60 * 60 * 1000, heartbeatStaleMs = 10 * 60 * 1000 } = {}) {
  const params = new URLSearchParams({ select: 'id,status,cursor,error,started_at,metadata', provider: `eq.${PRICE_SNAPSHOT_PROVIDER}`, order: 'started_at.desc', limit: '1' });
  const latest = ((await db(`/catalog_sync_runs?${params}`)) || [])[0];
  if (!latest) return { action: 'run' };
  const age = now() - Date.parse(latest.started_at), resume = latest.cursor && age <= resumeWindowMs ? { action: 'run', cursor: latest.cursor, resumedFrom: latest.id } : { action: 'run' };
  if (latest.status === 'running') {
    const heartbeat = Date.parse(latest.metadata?.heartbeatAt || latest.started_at);
    return now() - heartbeat < heartbeatStaleMs ? { action: 'busy', waitMs: heartbeatStaleMs } : resume;
  }
  if (latest.status === 'completed') return age < intervalMs - 60_000 ? { action: 'wait', waitMs: intervalMs - age } : { action: 'run' };
  return latest.error === 'ABORTED' ? { action: 'run' } : resume;
}

// What server.mjs wires in: a daily scheduler plus run / status / stop for the admin endpoints. Rounds never overlap (one in-process run at a time).
export function createPriceSnapshotController({ db, log = console, intervalMs = SNAPSHOT_INTERVAL_MS, initialDelayMs = SNAPSHOT_INITIAL_DELAY_MS, minGapMs = 10 * 60 * 1000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, ...runOptions } = {}) {
  let timer = null, running = null, abort = null, progress = null, last = null, nextRunAt = null, disposed = false;
  const enabled = () => priceSnapshotEnabled({ env: runOptions.env, collectionAllowed: runOptions.collectionAllowed });

  function execute(plan = {}) {
    abort = new AbortController();
    progress = null;
    running = runPriceSnapshot({ ...runOptions, db, log, now, signal: abort.signal, cursor: plan.cursor ?? null, resumedFrom: plan.resumedFrom ?? null, onProgress: value => { progress = value; } })
      .then(result => { last = result; log.log?.('price snapshot', JSON.stringify({ status: result.status, candidates: result.candidates, requests: result.requests, written: result.written, skipped: result.skipped, belowThreshold: result.belowThreshold, error: result.error })); return result; })
      .catch(error => { last = { status: 'failed', error: String(error?.message || error) }; log.error?.('price snapshot failed', last.error); return last; })
      .finally(() => { running = null; abort = null; progress = null; });
    return running;
  }

  function schedule(delayMs) {
    if (disposed) return;
    nextRunAt = new Date(now() + delayMs).toISOString();
    timer = setTimer(tick, delayMs);
    timer?.unref?.();
  }

  async function tick() {
    timer = null; nextRunAt = null;
    let delay = intervalMs;
    try {
      if (running) delay = minGapMs;
      else if (!enabled()) delay = intervalMs;
      else {
        const plan = await planNextSnapshotRun(db, { now, intervalMs });
        if (plan.action === 'wait') delay = Math.max(minGapMs, plan.waitMs);
        else if (plan.action === 'busy') delay = plan.waitMs;
        else { const startedAt = now(); await execute(plan); delay = Math.max(minGapMs, intervalMs - (now() - startedAt)); }
      }
    } catch (error) { log.error?.('price snapshot scheduler failed', error.message); delay = 60 * 60 * 1000; }
    schedule(delay);
  }

  return {
    // Starts the daily schedule (first look after initialDelayMs). Safe to call once at start-up.
    start() { if (!timer && !disposed) schedule(initialDelayMs); return this; },
    // Manual round for the admin endpoint; returns at once, the round keeps going in the background.
    async runNow() {
      if (running) return { started: false, reason: 'already-running' };
      if (!enabled()) return { started: false, reason: 'disabled' };
      execute();
      return { started: true };
    },
    // Aborts the current round (it is recorded as failed/ABORTED and not resumed); the daily schedule stays.
    stop() { if (!running) return { stopped: false, reason: 'not-running' }; abort.abort(); return { stopped: true }; },
    status() { return { enabled: enabled(), running: Boolean(running), schedulerActive: Boolean(timer) || Boolean(running), nextRunAt, progress, last }; },
    // Stops timers and any running round (for shutdown and tests).
    dispose() { disposed = true; if (timer) clearTimer(timer); timer = null; abort?.abort(); return running ?? Promise.resolve(); }
  };
}
