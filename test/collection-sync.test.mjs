import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

// Y2: POST /api/sync/pull and /api/sync/push over HTTP against a fake second database (SUPABASE2_*). The sync code is a password:
// bad requests never reach the database, the server only uses its SHA-256, and no response or error text contains the code or the hash.

const sha = code => createHash('sha256').update(code).digest('hex');
const CODE = 'K3M9T7Q2XB4V8ZD6N1HW5RPJ0C', OTHER = 'A1B2C3D4E5F6G7H8J9K0L1M2N3', BROKEN = 'ZZZZ9999ZZZZ9999ZZZZ9999ZZ';
const KEY = 'local-fixture-key';
const T = n => new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString();
const live = (id, quantity = 1, at = T(1), over = {}) => ({ id, canonicalId: '', favorite: false, quantity, condition: '', finish: '', note: '', updatedAt: at, ...over });
const tomb = (id, at = T(2)) => ({ id, deleted: true, updatedAt: at });

const listen = async httpServer => { await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); }); return httpServer.address().port; };
const close = httpServer => new Promise(resolve => httpServer.close(resolve));

// In-memory stand-in for PostgREST on public.collection_sync: GET by key, POST insert (409 on duplicate key), PATCH ... where revision = n.
async function fakeDb() {
  const rows = new Map(), calls = [], failing = new Set();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake'), text = Buffer.concat(chunks).toString('utf8'), body = text ? JSON.parse(text) : null;
      const send = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(payload === undefined ? '' : JSON.stringify(payload)); };
      calls.push({ method: req.method, path: url.pathname, query: url.search, body, authorized: req.headers.apikey === KEY && req.headers.authorization === `Bearer ${KEY}` });
      if (url.pathname !== '/rest/v1/collection_sync') return send(404, { message: 'no such table' });
      const hash = (url.searchParams.get('sync_key_hash') || body?.sync_key_hash || '').replace(/^eq\./, '');
      if (failing.has(hash)) return send(500, { message: 'boom-secret-detail' });
      if (req.method === 'GET') return send(200, rows.has(hash) ? [rows.get(hash)] : []);
      if (req.method === 'POST') { if (rows.has(hash)) return send(409, { code: '23505', message: 'duplicate key' }); rows.set(hash, { items: body.items, revision: body.revision, updated_at: body.updated_at }); return send(201); }
      if (req.method === 'PATCH') {
        const row = rows.get(hash), expected = Number((url.searchParams.get('revision') || '').replace(/^eq\./, ''));
        if (!row || row.revision !== expected) return send(200, []);
        Object.assign(row, { items: body.items, revision: body.revision, updated_at: body.updated_at });
        return send(200, [{ revision: row.revision }]);
      }
      if (req.method === 'DELETE') { rows.delete(hash); return send(204); }
      return send(405, {});
    });
  });
  return { port: await listen(server), rows, calls, failing, stop: () => close(server) };
}

async function startApp(env) {
  const probe = createServer(), port = await listen(probe);
  await close(probe);
  const app = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', SUPABASE2_URL: '', SUPABASE2_SERVICE_KEY: '', CATALOG_WARM_ON_START: 'false', CATALOG_SYNC_ON_START: 'false', CARD_IMAGE_CACHE_ON_START: 'false', PRICE_SNAPSHOT_ENABLED: 'false', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`sync fixture start timeout: ${output}`)), 8000);
    app.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`sync fixture exited (${code ?? signal}): ${output}`)); });
    const onData = chunk => { output += String(chunk); if (output.includes('CardScope is running')) { clearTimeout(timer); resolve(); } };
    app.stdout.on('data', onData); app.stderr.on('data', onData);
  });
  const call = async (path, body, raw) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: text ? JSON.parse(text) : null };
  };
  const stop = () => new Promise(resolve => { if (app.exitCode !== null || app.signalCode !== null) return resolve(); app.once('exit', resolve); app.kill(); });
  return { port, pull: body => call('/api/sync/pull', body), push: body => call('/api/sync/push', body), del: body => call('/api/sync/delete', body), raw: (path, raw) => call(path, null, raw), stop };
}

test('pull and push: first write, revision lock, normalised storage, grouped codes, and no hash or code in any response', async () => {
  const db = await fakeDb(), app = await startApp({ SUPABASE2_URL: `http://127.0.0.1:${db.port}`, SUPABASE2_SERVICE_KEY: KEY, SYNC_RATE_LIMIT_PER_MINUTE: '1000' }), seen = [];
  const note = r => { seen.push(r.text, JSON.stringify([...r.headers])); return r; };
  try {
    const empty = note(await app.pull({ code: CODE }));
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.data, { items: [], revision: 0, updatedAt: null }, 'an unknown code looks like an empty cloud copy (no way to tell whether it exists)');
    assert.equal(empty.headers.get('cache-control'), 'no-store');

    const old = tomb('gone', new Date(Date.now() - 40 * 86400000).toISOString().replace(/\.\d+Z$/, 'Z'));
    const first = note(await app.push({ code: CODE, revision: 0, items: [live('b', 2, T(3), { extra: 'dropped', note: 'a\nb' }), tomb('z'), live('a', 1), old] }));
    assert.equal(first.status, 200);
    assert.equal(first.body.data.revision, 1);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    const stored = db.rows.get(sha(CODE));
    assert.deepEqual(stored.items.map(e => e.id), ['a', 'b', 'z'], 'sorted, expired tombstone dropped');
    assert.equal(stored.items[1].note, 'a b', 'validated and cleaned like an import');
    assert.equal('extra' in stored.items[1], false, 'unknown fields are not stored');
    assert.equal(stored.revision, 1);
    assert.ok(db.calls.every(call => call.authorized), 'every database call carries the service key');

    const pulled = note(await app.pull({ code: CODE }));
    assert.equal(pulled.body.data.revision, 1);
    assert.deepEqual(pulled.body.data.items.map(e => e.id), ['a', 'b', 'z']);
    const grouped = note(await app.pull({ code: 'k3m9-t7q2 xb4v-8zd6 n1hw-5rpj-0c' }));
    assert.equal(grouped.body.data.revision, 1, 'a grouped, lower-case code is the same code');
    assert.equal(note(await app.pull({ code: OTHER })).body.data.revision, 0, 'another code sees nothing of it');

    // revision lock
    assert.equal(note(await app.push({ code: CODE, revision: 0, items: [live('late')] })).status, 409, 'a second device that never pulled: insert collides');
    const second = note(await app.push({ code: CODE, revision: 1, items: [live('a', 3, T(5))] }));
    assert.equal(second.status, 200); assert.equal(second.body.data.revision, 2);
    assert.equal(note(await app.push({ code: CODE, revision: 1, items: [live('a', 9, T(6))] })).status, 409, 'stale revision');
    assert.equal(db.rows.get(sha(CODE)).items[0].quantity, 3, 'the rejected push changed nothing');
    assert.equal(note(await app.push({ code: OTHER, revision: 4, items: [] })).status, 409, 'a revision for a code that has no row');
    assert.equal(db.rows.has(sha(OTHER)), false);
    assert.match(first.body.data.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    // a clock a year ahead is pulled back to now
    note(await app.push({ code: OTHER, revision: 0, items: [live('future', 1, '2099-01-01T00:00:00Z')] }));
    assert.ok(Date.parse(db.rows.get(sha(OTHER)).items[0].updatedAt) < Date.now() + 5000);

    const all = seen.join('\n');
    for (const secret of [CODE, OTHER, sha(CODE), sha(OTHER), CODE.toLowerCase()]) assert.equal(all.includes(secret), false, 'no response or header contains the code or its hash');
  } finally { await app.stop(); await db.stop(); }
});

test('bad requests are refused with 400/413 before the database is touched, and the error text names no secret', async () => {
  const db = await fakeDb(), app = await startApp({ SUPABASE2_URL: `http://127.0.0.1:${db.port}`, SUPABASE2_SERVICE_KEY: KEY, SYNC_RATE_LIMIT_PER_MINUTE: '1000' });
  try {
    const good = [live('a')];
    const cases = [
      ['pull', {}], ['pull', { code: '' }], ['pull', { code: 'SHORT' }], ['pull', { code: 5 }], ['pull', { code: [CODE] }], ['pull', { code: CODE.slice(1) }], ['pull', { code: `${CODE}!` }], ['pull', { code: 'x'.repeat(300) }],
      ['pull', { code: CODE, items: [] }], ['pull', []], ['pull', null], ['pull', 'text'],
      ['push', { code: CODE, revision: 0 }], ['push', { code: CODE, items: good }], ['push', { revision: 0, items: good }], ['push', { code: 'SHORT', revision: 0, items: good }],
      ['push', { code: CODE, revision: -1, items: good }], ['push', { code: CODE, revision: 1.5, items: good }], ['push', { code: CODE, revision: '1', items: good }], ['push', { code: CODE, revision: 2 ** 31, items: good }], ['push', { code: CODE, revision: null, items: good }],
      ['push', { code: CODE, revision: 0, items: 'nope' }], ['push', { code: CODE, revision: 0, items: { 0: live('a') } }], ['push', { code: CODE, revision: 0, items: good, extra: 1 }],
      ['push', { code: CODE, revision: 0, items: [live('a'), live('a')] }], ['push', { code: CODE, revision: 0, items: [live('a'), tomb('a')] }],
      ['push', { code: CODE, revision: 0, items: [null] }], ['push', { code: CODE, revision: 0, items: [{ id: 'a' }] }], ['push', { code: CODE, revision: 0, items: [live('a', 1, 'yesterday')] }],
      ['push', { code: CODE, revision: 0, items: [live('a', 0)] }], ['push', { code: CODE, revision: 0, items: [live('a', 1000)] }], ['push', { code: CODE, revision: 0, items: [live('a', 1, T(1), { condition: 'MINT' })] }],
      ['push', { code: CODE, revision: 0, items: [live('__proto__')] }], ['push', { code: CODE, revision: 0, items: [live('')] }],
      ['push', { code: CODE, revision: 0, items: [{ ...tomb('a'), quantity: 1 }] }], ['push', { code: CODE, revision: 0, items: [{ id: 'a', deleted: false, updatedAt: T(1) }] }], ['push', { code: CODE, revision: 0, items: [{ id: 'a', deleted: true }] }],
      ['push', { code: CODE, revision: 0, items: Array.from({ length: 10001 }, (_, i) => tomb(`t${i}`)) }]
    ];
    for (const [action, body] of cases) {
      const r = await app[action](body);
      assert.equal(r.status, 400, `${action} ${JSON.stringify(body).slice(0, 80)}`);
      assert.ok(r.body.error && !r.text.includes(CODE) && !r.text.includes(sha(CODE)), 'a plain message, no secret');
    }
    assert.equal((await app.raw('/api/sync/pull', '{not json')).status, 400);
    assert.equal((await app.raw('/api/sync/push', '')).status, 400, 'an empty body is not a request');
    // over 2 MB: readJsonBody answers 413 and drops the connection, so a client still sending may see the reset instead of the status; either way it is refused
    const huge = await app.raw('/api/sync/push', JSON.stringify({ code: CODE, revision: 0, items: [{ id: 'x'.repeat(2.2 * 1024 * 1024) }] })).catch(error => ({ status: 413, reset: error.cause?.code }));
    assert.equal(huge.status, 413, 'over 2 MB');
    assert.equal(db.calls.length, 0, 'none of them reached the database');
    const get = await fetch(`http://127.0.0.1:${app.port}/api/sync/pull`);
    assert.notEqual(get.status, 200, 'GET is not served');

    const ten = Array.from({ length: 10000 }, (_, i) => live(`c${String(i).padStart(5, '0')}`));
    assert.equal((await app.push({ code: CODE, revision: 0, items: ten })).status, 200, 'exactly itemsMax rows is allowed');
    assert.equal(db.rows.get(sha(CODE)).items.length, 10000);
  } finally { await app.stop(); await db.stop(); }
});

test('a database failure is a plain 502 that leaks neither the database message nor the hash', async () => {
  const db = await fakeDb(), app = await startApp({ SUPABASE2_URL: `http://127.0.0.1:${db.port}`, SUPABASE2_SERVICE_KEY: KEY, SYNC_RATE_LIMIT_PER_MINUTE: '1000' });
  try {
    db.failing.add(sha(BROKEN));
    for (const r of [await app.pull({ code: BROKEN }), await app.push({ code: BROKEN, revision: 0, items: [live('a')] }), await app.push({ code: BROKEN, revision: 3, items: [live('a')] })]) {
      assert.equal(r.status, 502);
      assert.ok(!r.text.includes('boom-secret-detail') && !r.text.includes(BROKEN) && !r.text.includes(sha(BROKEN)));
    }
  } finally { await app.stop(); await db.stop(); }
});

test('rate limit: a sixth request a minute from one IP passes, the seventh gets 429 (pull and push share it, bad requests count, and nothing reaches the database for them)', async () => {
  const db = await fakeDb(), app = await startApp({ SUPABASE2_URL: `http://127.0.0.1:${db.port}`, SUPABASE2_SERVICE_KEY: KEY });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await app.pull({ code: 'bad' })).status, 400);
    for (let i = 0; i < 3; i++) assert.equal((await app.push({ code: 'bad' })).status, 400);
    const blocked = await app.pull({ code: CODE });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '60');
    assert.equal(blocked.headers.get('cache-control'), 'no-store');
    assert.ok(!blocked.text.includes(CODE) && !blocked.text.includes(sha(CODE)));
    assert.equal(db.calls.length, 0);
  } finally { await app.stop(); await db.stop(); }
});

test('without SUPABASE2_* the sync endpoints answer 503, a malformed code is still 400', async () => {
  const app = await startApp({ SYNC_RATE_LIMIT_PER_MINUTE: '1000' });
  try {
    const down = await app.pull({ code: CODE });
    assert.equal(down.status, 503); assert.ok(!down.text.includes(CODE));
    assert.equal((await app.push({ code: CODE, revision: 0, items: [live('a')] })).status, 503);
    assert.equal((await app.pull({ code: 'x' })).status, 400);
  } finally { await app.stop(); }
});

test('Y1 migration: one table in the second database, RLS on with no policy, only service_role has access', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const dir = new URL('../supabase/ip2/', import.meta.url), name = (await readdir(dir)).find(file => /^\d{14}_collection_sync\.sql$/.test(file));
  assert.ok(name, 'migration file exists in supabase/ip2');
  const sql = (await readFile(new URL(name, dir), 'utf8')).replace(/--[^\n]*/g, '');
  assert.match(sql, /create table if not exists public\.collection_sync/);
  for (const column of [/sync_key_hash text not null/, /items jsonb not null/, /updated_at timestamp with time zone not null/, /revision integer not null/, /primary key \(sync_key_hash\)/]) assert.match(sql, column);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.collection_sync from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on public\.collection_sync to service_role/);
  assert.doesNotMatch(sql, /create policy/i, 'no policy: RLS blocks every non-service role');
  assert.doesNotMatch(sql, /grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i, 'nothing is granted to the open roles');
});

test('delete: removes only this code cloud row, replies without code or hash, 400 before the database, and the limit and 503 rules apply', async () => {
  const db = await fakeDb(), app = await startApp({ SUPABASE2_URL: `http://127.0.0.1:${db.port}`, SUPABASE2_SERVICE_KEY: KEY, SYNC_RATE_LIMIT_PER_MINUTE: '1000' });
  try {
    await app.push({ code: CODE, revision: 0, items: [live('a')] });
    await app.push({ code: OTHER, revision: 0, items: [live('b')] });
    const done = await app.del({ code: CODE });
    assert.equal(done.status, 200);
    assert.deepEqual(done.body, { data: { deleted: true } });
    assert.equal(done.headers.get('cache-control'), 'no-store');
    assert.ok(!done.text.includes(CODE) && !done.text.includes(sha(CODE)) && !JSON.stringify([...done.headers]).includes(sha(CODE)));
    assert.ok(!db.rows.has(sha(CODE)) && db.rows.has(sha(OTHER)), 'only the row of this code is gone');
    const last = db.calls.at(-1);
    assert.equal(last.method, 'DELETE'); assert.ok(last.authorized);
    assert.equal(last.query, `?sync_key_hash=eq.${sha(CODE)}`, 'the delete is limited to one key: never an unfiltered delete');
    assert.equal((await app.del({ code: CODE })).status, 200, 'deleting what is already gone still succeeds');
    assert.deepEqual((await app.pull({ code: CODE })).body.data, { items: [], revision: 0, updatedAt: null });

    const before = db.calls.length;
    for (const bad of [{ code: 'short' }, { code: CODE, items: [] }, {}, { code: CODE.toLowerCase().slice(0, 10) }, []]) assert.equal((await app.del(bad)).status, 400);
    assert.equal((await app.raw('/api/sync/delete', '{oops')).status, 400);
    assert.equal(db.calls.length, before, 'bad requests never reach the database');

    db.failing.add(sha(BROKEN));
    const broken = await app.del({ code: BROKEN });
    assert.equal(broken.status, 502);
    assert.ok(!broken.text.includes('boom-secret-detail') && !broken.text.includes(BROKEN) && !broken.text.includes(sha(BROKEN)));
  } finally { await app.stop(); await db.stop(); }
  const limited = await startApp({ SUPABASE2_URL: '', SUPABASE2_SERVICE_KEY: '' });
  try {
    assert.equal((await limited.del({ code: CODE })).status, 503);
    for (let i = 0; i < 4; i++) await limited.del({ code: 'bad' });
    assert.equal((await limited.del({ code: CODE })).status, 503, 'sixth request still passes the shared limit');
    const blocked = await limited.del({ code: CODE });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('cache-control'), 'no-store');
  } finally { await limited.stop(); }
});

test('Y4 cleanup migration: a daily pg_cron job deletes sync rows not written for 180 days, written as a file only', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const dir = new URL('../supabase/ip2/', import.meta.url), name = (await readdir(dir)).find(file => /^\d{14}_collection_sync_cleanup\.sql$/.test(file));
  assert.ok(name, 'cleanup migration exists in supabase/ip2');
  const sql = (await readFile(new URL(name, dir), 'utf8')).replace(/--[^\n]*/g, '');
  assert.match(sql, /delete from public\.collection_sync where updated_at < now\(\) - interval '180 days'/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path to ''/);
  assert.match(sql, /revoke all on function public\.collection_sync_purge_stale\(\) from public, anon, authenticated/);
  assert.match(sql, /cron\.schedule\('collection-sync-purge', '\d+ \d+ \* \* \*', 'select public\.collection_sync_purge_stale\(\)'\)/);
});

// ---- Google 登入（docs/COLLECTION_SYNC_GOOGLE_PLAN.md）----
const ANON = 'anon-fixture-key';
const USER_A = '11111111-2222-3333-4444-555555555555', USER_B = '66666666-7777-8888-9999-000000000000';
const VALID_VERIFIER = 'v'.repeat(48), VALID_CODE = 'pkce-auth-code-123456';
const makeJwt = (sub, expSec = Math.floor(Date.now() / 1000) + 3600) => [
  Buffer.from('{"alg":"HS256"}').toString('base64url'),
  Buffer.from(JSON.stringify({ sub, exp: expSec })).toString('base64url'),
  'sig'
].join('.');

async function fakeDbAndAuth() {
  const rows = new Map(), calls = [], authCalls = [], tokens = new Map(), refreshMap = new Map();
  let authFail = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake'), text = Buffer.concat(chunks).toString('utf8'), body = text ? JSON.parse(text) : null;
      const send = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(payload === undefined ? '' : JSON.stringify(payload)); };
      if (url.pathname.startsWith('/auth/v1/')) {
        authCalls.push({ method: req.method, path: url.pathname, query: url.search, body, apikey: req.headers.apikey, auth: req.headers.authorization || '' });
        if (req.headers.apikey !== ANON) return send(401, { msg: 'bad apikey' });
        if (authFail) return send(authFail, { error_description: 'upstream-secret-auth-error' });
        if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
          if (body?.auth_code === VALID_CODE && body?.code_verifier === VALID_VERIFIER) {
            const access = makeJwt(USER_A), refresh = 'refresh-token-valid-12345';
            tokens.set(access, { id: USER_A, email: 'trainer@example.com' });
            refreshMap.set(refresh, { id: USER_A, email: 'trainer@example.com' });
            return send(200, { access_token: access, refresh_token: refresh, expires_in: 3600, user: { id: USER_A, email: 'trainer@example.com' } });
          }
          return send(400, { error: 'invalid_grant', error_description: 'secret-pkce-mismatch' });
        }
        if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
          const user = refreshMap.get(body?.refresh_token);
          if (!user) return send(400, { error: 'invalid_grant', error_description: 'secret-refresh-expired' });
          const access = makeJwt(user.id), nextRefresh = 'refresh-token-rotated-67890';
          tokens.set(access, user); refreshMap.set(nextRefresh, user);
          return send(200, { access_token: access, refresh_token: nextRefresh, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
        }
        if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
          const tok = (req.headers.authorization || '').replace(/^Bearer /, ''), user = tokens.get(tok);
          if (!user) return send(401, { msg: 'invalid_jwt: secret-jwt-detail' });
          return send(200, user);
        }
        if (url.pathname === '/auth/v1/logout') {
          const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
          tokens.delete(tok);
          return send(204);
        }
        return send(404, {});
      }
      calls.push({ method: req.method, path: url.pathname, query: url.search, body });
      if (url.pathname !== '/rest/v1/collection_sync') return send(404, { message: 'no such table' });
      const hash = (url.searchParams.get('sync_key_hash') || body?.sync_key_hash || '').replace(/^eq\./, '');
      if (req.method === 'GET') return send(200, rows.has(hash) ? [rows.get(hash)] : []);
      if (req.method === 'POST') { if (rows.has(hash)) return send(409, { code: '23505' }); rows.set(hash, { items: body.items, revision: body.revision, updated_at: body.updated_at }); return send(201); }
      if (req.method === 'PATCH') {
        const row = rows.get(hash), expected = Number((url.searchParams.get('revision') || '').replace(/^eq\./, ''));
        if (!row || row.revision !== expected) return send(200, []);
        Object.assign(row, { items: body.items, revision: body.revision, updated_at: body.updated_at });
        return send(200, [{ revision: row.revision }]);
      }
      if (req.method === 'DELETE') { rows.delete(hash); return send(204); }
      return send(405, {});
    });
  });
  return { port: await listen(server), rows, calls, authCalls, tokens, refreshMap, setAuthFail: code => { authFail = code; }, stop: () => close(server) };
}

test('auth: /api/auth/config, PKCE exchange, refresh, logout, parameter validation, and upstream error hiding', async () => {
  const up = await fakeDbAndAuth();
  const app = await startApp({ SUPABASE2_URL: `http://127.0.0.1:${up.port}`, SUPABASE2_SERVICE_KEY: KEY, SUPABASE2_ANON_KEY: ANON, AUTH_RATE_LIMIT_PER_MINUTE: '1000', SYNC_RATE_LIMIT_PER_MINUTE: '1000' });
  const post = async (path, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${app.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? '' : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, body: text ? JSON.parse(text) : null };
  };
  try {
    const cfg = await (await fetch(`http://127.0.0.1:${app.port}/api/auth/config`)).json();
    assert.equal(cfg.data.url, `http://127.0.0.1:${up.port}`);
    assert.equal(JSON.stringify(cfg).includes(ANON), false, 'anon key is never exposed in config');

    // Parameter validation on exchange & refresh before upstream is touched
    const badExchanges = [
      {}, { code: VALID_CODE }, { verifier: VALID_VERIFIER }, { code: 'short', verifier: VALID_VERIFIER },
      { code: VALID_CODE, verifier: 'short-verifier' }, { code: VALID_CODE, verifier: VALID_VERIFIER, extra: 1 },
      { code: 'bad space', verifier: VALID_VERIFIER }, { code: VALID_CODE, verifier: 'bad space'.repeat(6) }
    ];
    for (const bad of badExchanges) {
      const r = await post('/api/auth/exchange', bad);
      assert.equal(r.status, 400);
      assert.equal(r.headers.get('cache-control'), 'no-store');
    }
    for (const bad of [{}, { refreshToken: 'short' }, { refreshToken: 'bad token' }, { refreshToken: 'valid-token-1234', extra: 1 }]) {
      assert.equal((await post('/api/auth/refresh', bad)).status, 400);
    }
    assert.equal(up.authCalls.length, 0, 'invalid auth payloads never hit Supabase Auth');

    // Wrong code -> 401 without upstream error text
    const wrong = await post('/api/auth/exchange', { code: 'wrong-code-123456', verifier: VALID_VERIFIER });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.text.includes('secret-pkce-mismatch'), false);

    // Valid exchange
    const ex = await post('/api/auth/exchange', { code: VALID_CODE, verifier: VALID_VERIFIER });
    assert.equal(ex.status, 200);
    assert.equal(ex.headers.get('cache-control'), 'no-store');
    assert.equal(ex.body.data.email, 'trainer@example.com');
    assert.ok(ex.body.data.accessToken && ex.body.data.refreshToken && Number.isFinite(ex.body.data.expiresAt));
    assert.equal(ex.text.includes(USER_A), false, 'raw user.id is not in the JSON body (only inside the opaque token)');

    // Valid refresh
    const rf = await post('/api/auth/refresh', { refreshToken: ex.body.data.refreshToken });
    assert.equal(rf.status, 200);
    assert.equal(rf.body.data.refreshToken, 'refresh-token-rotated-67890');

    // Upstream 500 -> 502 without leaking upstream detail
    up.setAuthFail(500);
    const fail502 = await post('/api/auth/refresh', { refreshToken: rf.body.data.refreshToken });
    assert.equal(fail502.status, 502);
    assert.equal(fail502.text.includes('upstream-secret-auth-error'), false);
    up.setAuthFail(0);

    // Logout revokes upstream token and always answers 204 no-store
    const out = await post('/api/auth/logout', undefined, { Authorization: `Bearer ${rf.body.data.accessToken}` });
    assert.equal(out.status, 204);
    assert.equal(out.headers.get('cache-control'), 'no-store');
    assert.equal(up.tokens.has(rf.body.data.accessToken), false);
  } finally { await app.stop(); await up.stop(); }
});

test('sync with Bearer token: caches /auth/v1/user lookup, isolates Google key space from sync codes, and never leaks hashes or tokens', async () => {
  const up = await fakeDbAndAuth();
  const app = await startApp({ SUPABASE2_URL: `http://127.0.0.1:${up.port}`, SUPABASE2_SERVICE_KEY: KEY, SUPABASE2_ANON_KEY: ANON, AUTH_RATE_LIMIT_PER_MINUTE: '1000', SYNC_RATE_LIMIT_PER_MINUTE: '1000' });
  const tokenA = makeJwt(USER_A), tokenB = makeJwt(USER_B);
  up.tokens.set(tokenA, { id: USER_A, email: 'a@example.com' });
  up.tokens.set(tokenB, { id: USER_B, email: 'b@example.com' });
  const callSync = async (action, body, token) => {
    const headers = { 'content-type': 'application/json', ...(token !== undefined ? { Authorization: token } : {}) };
    const r = await fetch(`http://127.0.0.1:${app.port}/api/sync/${action}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, text, body: text ? JSON.parse(text) : null };
  };
  try {
    // Malformed or invalid Bearer -> 401
    assert.equal((await callSync('pull', {}, 'NotBearer xyz')).status, 401);
    assert.equal((await callSync('pull', {}, 'Bearer bad space')).status, 401);
    const badJwt = await callSync('pull', {}, 'Bearer unknown.jwt.token');
    assert.equal(badJwt.status, 401);
    assert.equal(badJwt.text.includes('secret-jwt-detail'), false);

    // With Bearer, body must NOT contain code
    assert.equal((await callSync('pull', { code: CODE }, `Bearer ${tokenA}`)).status, 400);
    assert.equal((await callSync('push', { code: CODE, revision: 0, items: [live('a')] }, `Bearer ${tokenA}`)).status, 400);

    // Push & pull with Bearer tokenA
    const userCallsBefore = up.authCalls.filter(c => c.path === '/auth/v1/user').length;
    const pushed = await callSync('push', { revision: 0, items: [live('g1', 3)] }, `Bearer ${tokenA}`);
    assert.equal(pushed.status, 200);
    assert.equal(pushed.body.data.revision, 1);
    const pulled = await callSync('pull', {}, `Bearer ${tokenA}`);
    assert.equal(pulled.status, 200);
    assert.deepEqual(pulled.body.data.items.map(i => [i.id, i.quantity]), [['g1', 3]]);
    const userCallsAfter = up.authCalls.filter(c => c.path === '/auth/v1/user').length;
    assert.equal(userCallsAfter - userCallsBefore, 1, 'second sync with the same token hits the in-memory authCache');

    // Stored under sha256('google:' + USER_A), completely separate from sync code and from USER_B
    const googleHashA = sha(`google:${USER_A}`);
    assert.ok(up.rows.has(googleHashA));
    assert.equal((await callSync('pull', {}, `Bearer ${tokenB}`)).body.data.revision, 0, 'USER_B cannot see USER_A data');
    assert.equal((await app.pull({ code: CODE })).body.data.revision, 0, 'sync code cannot see Google data');

    // No response contains the token, userId, or googleHashA
    for (const secret of [tokenA, USER_A, googleHashA]) {
      assert.equal(pushed.text.includes(secret), false);
      assert.equal(pulled.text.includes(secret), false);
    }

    // Delete with Bearer
    const del = await callSync('delete', {}, `Bearer ${tokenA}`);
    assert.equal(del.status, 200);
    assert.equal(up.rows.has(googleHashA), false);
  } finally { await app.stop(); await up.stop(); }
});


