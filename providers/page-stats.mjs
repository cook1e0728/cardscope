// F4 (SITE_IMPROVEMENT_PLAN decision 4): how many times each kind of page was opened per day.
// Totals only. Never stores an IP, user agent, query string or referrer: record() reads them, bumps one integer and forgets them.
// Counts live in memory and are added into one database row per Taipei day by the page_stats_add RPC.

export const PAGE_KINDS = ['home', 'game', 'series', 'card', 'search', 'other', 'bot'];
const BOT_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|preview|uptimerobot|curl|wget|python|headless/i;

export const isBot = userAgent => BOT_PATTERN.test(String(userAgent || ''));

// The most specific parameter wins: ?card=… is a card page whatever else is in the URL.
export function pageKind(params) {
  if (params.get('card')) return 'card';
  if (params.get('series')) return 'series';
  if (params.get('q')) return 'search';
  if (params.get('view')) return 'other';
  if (params.get('game')) return 'game';
  return 'home';
}

// Taiwan has no daylight saving time, so a fixed +8 h shift is the Asia/Taipei calendar date.
export const taipeiDay = ms => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);

export function createPageStats({ db, enabled = () => true, now = Date.now, intervalMs = 10 * 60 * 1000, maxDays = 3, logger = console } = {}) {
  const days = new Map(); // day -> { kind: count } not yet written to the database
  let warned = false, timer = null, chain = Promise.resolve();

  function record(params, userAgent, fetchDest) {
    // Browsers label a page navigation "document"; the service worker's precache and fetch() calls are not page opens.
    if (!enabled() || (fetchDest && fetchDest !== 'document')) return;
    const kind = isBot(userAgent) ? 'bot' : pageKind(params), day = taipeiDay(now());
    let row = days.get(day);
    if (!row) { row = {}; days.set(day, row); while (days.size > maxDays) days.delete([...days.keys()].sort()[0]); } // a long outage cannot grow memory
    row[kind] = (row[kind] || 0) + 1;
  }

  async function flushOnce() {
    if (!enabled()) return;
    for (const day of [...days.keys()].sort()) {
      const sent = { ...days.get(day) };
      if (!Object.keys(sent).length) { days.delete(day); continue; }
      try { await db('/rpc/page_stats_add', { method: 'POST', body: JSON.stringify({ p_day: day, p_counts: sent }), signal: AbortSignal.timeout(10000) }); }
      catch (error) {
        if (!warned) { warned = true; logger.warn('page stats flush failed; keeping counts in memory and retrying:', error?.message); }
        return; // keep every delta; the next flush retries
      }
      warned = false;
      const current = days.get(day) || {}; // visits that arrived while the request was in flight stay
      for (const kind of Object.keys(sent)) { current[kind] = (current[kind] || 0) - sent[kind]; if (current[kind] <= 0) delete current[kind]; }
      if (!Object.keys(current).length) days.delete(day);
    }
  }

  // Serialized so a SIGTERM flush never overlaps the interval flush and double-sends; flushOnce never throws.
  const flush = () => (chain = chain.then(flushOnce));
  return {
    record, flush,
    start() { if (!timer) { timer = setInterval(flush, intervalMs); timer.unref(); } },
    stop() { clearInterval(timer); timer = null; },
    pending: () => Object.fromEntries([...days].sort(([a], [b]) => (a < b ? 1 : -1)).map(([day, row]) => [day, { ...row }]))
  };
}
