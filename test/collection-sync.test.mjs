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
  return { port, pull: body => call('/api/sync/pull', body), push: body => call('/api/sync/push', body), raw: (path, raw) => call(path, null, raw), stop };
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
