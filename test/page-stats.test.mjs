import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageStats, isBot, pageKind, taipeiDay, PAGE_KINDS } from '../providers/page-stats.mjs';

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
