import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageStats, createCardHotStats, CARD_ID_PATTERN, isBot, pageKind, taipeiDay, PAGE_KINDS } from '../providers/page-stats.mjs';

// F4: daily page-open counts. Pure logic with an injected clock and database; the HTTP side is in page-stats-server.test.mjs.
const params = query => new URLSearchParams(query);
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const silent = { warn() {} };

test('page kinds: the most specific parameter wins', () => {
  const cases = { '': 'home', 'game=pokemon': 'game', 'game=pokemon&series=sv2a': 'series', 'series=sv2a&region=TW': 'series', 'card=pokemon-x&game=pokemon': 'card', 'q=pikachu': 'search', 'q=pikachu&game=pokemon': 'search', 'view=about': 'other', 'view=privacy&game=all': 'other', 'utm_source=x': 'home', 'q=': 'home', 'card=': 'home' };
  for (const [query, kind] of Object.entries(cases)) assert.equal(pageKind(params(query)), kind, query || '(none)');
});

test('bots are recognised by a simple user-agent pattern', () => {
  for (const ua of ['Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'facebookexternalhit/1.1', 'curl/8.4', 'Wget/1.21', 'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/120', 'Slackbot-LinkExpanding', 'UptimeRobot/2.0', 'Mozilla/5.0 (Windows) Preview', 'Baiduspider', 'Yahoo! Slurp']) assert.equal(isBot(ua), true, ua);
  for (const ua of [BROWSER, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', '', undefined]) assert.equal(isBot(ua), false, String(ua));
});

test('the day key is the Asia/Taipei calendar date', () => {
  assert.equal(taipeiDay(Date.parse('2026-11-12T15:59:59Z')), '2026-11-12');
  assert.equal(taipeiDay(Date.parse('2026-11-12T16:00:00Z')), '2026-11-13');
  assert.equal(taipeiDay(Date.parse('2026-12-31T16:30:00Z')), '2027-01-01');
  assert.equal(taipeiDay(Date.parse('2026-11-12T00:00:00Z')), '2026-11-12');
});

test('record counts by kind, sends bots to their own counter and keeps nothing personal', () => {
  let clock = Date.parse('2026-11-12T02:00:00Z');
  const stats = createPageStats({ db: async () => {}, now: () => clock });
  const visits = [['', BROWSER], ['game=pokemon', BROWSER], ['game=pokemon', BROWSER], ['series=sv2a', BROWSER], ['card=pokemon-sv2a-201', BROWSER], ['q=secret-search-term', BROWSER], ['view=about', BROWSER], ['q=pikachu', 'Googlebot/2.1 (+http://www.google.com/bot.html)'], ['', 'curl/8.4']];
  for (const [query, ua] of visits) stats.record(params(query), ua);
  assert.deepEqual(stats.pending(), { '2026-11-12': { home: 1, game: 2, series: 1, card: 1, search: 1, other: 1, bot: 2 } });
  const stored = JSON.stringify(stats.pending());
  for (const secret of ['secret-search-term', 'sv2a', 'Mozilla', 'Googlebot', 'curl']) assert.equal(stored.includes(secret), false, secret);
  for (const kind of Object.keys(Object.values(stats.pending())[0])) assert.ok(PAGE_KINDS.includes(kind));
  // Only page navigations count: the service worker's precache fetch is not a page open.
  stats.record(params(''), BROWSER, 'empty');
  stats.record(params(''), BROWSER, 'document');
  assert.equal(stats.pending()['2026-11-12'].home, 2);
});

test('the Taipei day rolls over at 16:00 UTC', () => {
  let clock = Date.parse('2026-11-12T15:59:00Z');
  const stats = createPageStats({ db: async () => {}, now: () => clock });
  stats.record(params(''), BROWSER);
  clock = Date.parse('2026-11-12T16:01:00Z');
  stats.record(params(''), BROWSER);
  stats.record(params('game=onepiece'), BROWSER);
  assert.deepEqual(stats.pending(), { '2026-11-13': { home: 1, game: 1 }, '2026-11-12': { home: 1 } });
});

test('flush sends one RPC per day and clears what was sent', async () => {
  let clock = Date.parse('2026-11-12T02:00:00Z');
  const calls = [];
  const stats = createPageStats({ db: async (path, options) => { calls.push({ path, options }); }, now: () => clock });
  stats.record(params(''), BROWSER);
  stats.record(params('card=x'), BROWSER);
  clock = Date.parse('2026-11-12T20:00:00Z');
  stats.record(params(''), BROWSER);
  await stats.flush();
  assert.deepEqual(calls.map(call => [call.path, call.options.method, JSON.parse(call.options.body)]), [
    ['/rpc/page_stats_add', 'POST', { p_day: '2026-11-12', p_counts: { home: 1, card: 1 } }],
    ['/rpc/page_stats_add', 'POST', { p_day: '2026-11-13', p_counts: { home: 1 } }]
  ]);
  assert.deepEqual(stats.pending(), {});
  await stats.flush();
  assert.equal(calls.length, 2, 'nothing left to send');
});

test('a failing database keeps every delta, warns once and retries on the next flush', async () => {
  const clock = Date.parse('2026-11-12T02:00:00Z');
  const warnings = [];
  let fail = true;
  const sent = [];
  const stats = createPageStats({ db: async (path, options) => { if (fail) throw new Error('SUPABASE_404:function not found'); sent.push(JSON.parse(options.body)); }, now: () => clock, logger: { warn: (...args) => warnings.push(args.join(' ')) } });
  stats.record(params(''), BROWSER);
  await stats.flush();
  stats.record(params(''), BROWSER);
  await stats.flush();
  await stats.flush();
  assert.equal(warnings.length, 1, 'logged once, not on every retry');
  assert.deepEqual(stats.pending(), { '2026-11-12': { home: 2 } });
  fail = false;
  await stats.flush();
  assert.deepEqual(sent, [{ p_day: '2026-11-12', p_counts: { home: 2 } }]);
  assert.deepEqual(stats.pending(), {});
  // After a recovery a new outage is reported again.
  fail = true;
  stats.record(params(''), BROWSER);
  await stats.flush();
  assert.equal(warnings.length, 2);
});

test('visits that arrive while a flush is in flight are not lost or double counted', async () => {
  const clock = Date.parse('2026-11-12T02:00:00Z');
  let release;
  const sent = [];
  const stats = createPageStats({ db: async (path, options) => { sent.push(JSON.parse(options.body).p_counts); await new Promise(resolve => { release = resolve; }); }, now: () => clock });
  stats.record(params(''), BROWSER);
  const first = stats.flush();
  await new Promise(resolve => setImmediate(resolve)); // the first RPC is now in flight
  stats.record(params(''), BROWSER);
  const second = stats.flush(); // queued behind the first, never overlaps it
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
  release();
  await new Promise(resolve => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  assert.deepEqual(sent, [{ home: 1 }, { home: 1 }]);
  assert.deepEqual(stats.pending(), {});
});

test('memory is capped at three days however long the database is down', async () => {
  let clock = Date.parse('2026-11-01T02:00:00Z');
  const stats = createPageStats({ db: async () => { throw new Error('down'); }, now: () => clock, logger: silent });
  for (let day = 0; day < 10; day++) {
    for (let i = 0; i < 5; i++) stats.record(params(''), BROWSER);
    await stats.flush();
    clock += 24 * 3600 * 1000;
  }
  assert.deepEqual(Object.keys(stats.pending()), ['2026-11-10', '2026-11-09', '2026-11-08']);
  assert.deepEqual(stats.pending()['2026-11-10'], { home: 5 });
});

test('disabled (no database configured) is a no-op', async () => {
  let calls = 0;
  const stats = createPageStats({ db: async () => { calls++; }, enabled: () => false });
  stats.record(params(''), BROWSER);
  await stats.flush();
  assert.deepEqual(stats.pending(), {});
  assert.equal(calls, 0);
});

// Per-card opens (card_hot_daily): same shape as the page counters, plus a per-day id cap and a top-200 send limit.
test('card ids: only safe characters up to 120 long are counted', () => {
  for (const id of ['pokemon-tcgdex-ja-sv6a-039', 'ygo:LOCH-JP001', 'op01.001_a', 'a'.repeat(120)]) assert.equal(CARD_ID_PATTERN.test(id), true, id);
  for (const id of ['', 'a'.repeat(121), 'x y', 'a/b', '<script>', 'a?open=1', '卡', 'a\nb']) assert.equal(CARD_ID_PATTERN.test(id), false, JSON.stringify(id));
  const stats = createCardHotStats({ db: async () => {}, now: () => Date.parse('2026-11-12T02:00:00Z') });
  for (const id of ['bad id', '<x>', '', null, undefined, 5, 'a'.repeat(121)]) stats.record(id);
  assert.deepEqual(stats.pending(), {});
});

test('card opens are counted per Taipei day by card id and nothing else', () => {
  let clock = Date.parse('2026-11-12T15:59:00Z');
  const stats = createCardHotStats({ db: async () => {}, now: () => clock });
  for (const id of ['a', 'b', 'a', 'a']) stats.record(id);
  clock = Date.parse('2026-11-12T16:01:00Z');
  stats.record('a');
  assert.deepEqual(stats.pending(), { '2026-11-13': { a: 1 }, '2026-11-12': { a: 3, b: 1 } });
});

test('card opens are not counted when the database is not configured', () => {
  const stats = createCardHotStats({ db: async () => {}, enabled: () => false });
  stats.record('a');
  assert.deepEqual(stats.pending(), {});
});

test('a day holds at most maxIdsPerDay different cards; known cards keep counting', () => {
  const stats = createCardHotStats({ db: async () => {}, now: () => Date.parse('2026-11-12T02:00:00Z'), maxIdsPerDay: 3 });
  for (const id of ['a', 'b', 'c', 'd', 'e', 'a', 'd']) stats.record(id);
  assert.deepEqual(stats.pending(), { '2026-11-12': { a: 2, b: 1, c: 1 } });
});

test('only the newest maxDays days stay in memory', () => {
  let clock = Date.parse('2026-11-01T02:00:00Z');
  const stats = createCardHotStats({ db: async () => {}, now: () => clock, maxDays: 3 });
  for (let i = 0; i < 5; i++) { stats.record('a'); clock += 24 * 3600 * 1000; }
  assert.deepEqual(Object.keys(stats.pending()), ['2026-11-05', '2026-11-04', '2026-11-03']);
});

test('card flush sends the top 200 of a day through card_hot_add and keeps the rest', async () => {
  const calls = [];
  const stats = createCardHotStats({ db: async (path, options) => { calls.push({ path, options, body: JSON.parse(options.body) }); }, now: () => Date.parse('2026-11-12T02:00:00Z') });
  for (let i = 0; i < 250; i++) for (let n = 0; n <= i; n++) stats.record('card-' + i); // card-249 opened 250 times ... card-0 once
  await stats.flush();
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].path, calls[0].options.method], ['/rpc/card_hot_add', 'POST']);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['p_counts', 'p_day']);
  assert.equal(calls[0].body.p_day, '2026-11-12');
  const sent = Object.keys(calls[0].body.p_counts);
  assert.equal(sent.length, 200);
  assert.equal(calls[0].body.p_counts['card-249'], 250);
  assert.equal(sent.includes('card-49'), false, 'the 50 least opened cards wait for the next flush');
  assert.equal(Object.keys(stats.pending()['2026-11-12']).length, 50, 'pending shows at most 50 per day');
  await stats.flush();
  assert.equal(calls.length, 2, 'the remainder goes out next time');
  assert.equal(Object.keys(calls[1].body.p_counts).length, 50);
  await stats.flush();
  assert.equal(calls.length, 2, 'nothing left to send');
  assert.deepEqual(stats.pending(), {});
});

test('card flush: a failing database keeps every delta, warns once, and a recovered flush sends each open exactly once', async () => {
  const warnings = [];
  let fail = true;
  const sent = [];
  const stats = createCardHotStats({ db: async (path, options) => { if (fail) throw new Error('SUPABASE_404:function not found'); sent.push(JSON.parse(options.body).p_counts); }, now: () => Date.parse('2026-11-12T02:00:00Z'), logger: { warn: (...args) => warnings.push(args.join(' ')) } });
  stats.record('a');
  await stats.flush();
  stats.record('a');
  stats.record('b');
  await stats.flush();
  await stats.flush();
  assert.equal(warnings.length, 1);
  assert.deepEqual(stats.pending(), { '2026-11-12': { a: 2, b: 1 } });
  fail = false;
  await stats.flush();
  await stats.flush();
  assert.deepEqual(sent, [{ a: 2, b: 1 }], 'sent once, not twice');
  assert.deepEqual(stats.pending(), {});
});

test('card flush: opens that arrive while the request is in flight are kept, and concurrent flushes never resend', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const sent = [];
  const stats = createCardHotStats({ db: async (path, options) => { sent.push(JSON.parse(options.body).p_counts); await gate; }, now: () => Date.parse('2026-11-12T02:00:00Z') });
  stats.record('a');
  stats.record('a');
  const first = stats.flush(), second = stats.flush(); // e.g. the interval flush and the SIGTERM flush
  await new Promise(resolve => setImmediate(resolve));
  stats.record('a');
  release();
  await Promise.all([first, second]);
  assert.deepEqual(sent, [{ a: 2 }, { a: 1 }], 'the second flush waited for the first and sent only what was new');
  assert.deepEqual(stats.pending(), {});
});
