import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSyncController, googleCallbackLocation, validateAuthPayload } from '../providers/auth-sync.mjs';

// 自家網域 Google 登入：回呼只轉格式正確的 code/state；授權碼用伺服器上的密鑰換 id_token，再向 Supabase 換 session；密鑰與 id_token 不外洩。
const VERIFIER = 'v'.repeat(43), CODE = '4/0AbCdEf-ghij_klmn', STATE = 'abcdefghijklmnop1234';
const ENV = { SUPABASE2_URL: 'https://ip2.example', SUPABASE2_ANON_KEY: 'anon-key', GOOGLE_CLIENT_ID: 'client-id.apps', GOOGLE_CLIENT_SECRET: 'top-secret-value', PUBLIC_BASE_URL: 'https://cardseektcg.com/' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function controller(env, google) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') return google(new URLSearchParams(init.body));
    if (url === 'https://ip2.example/auth/v1/token?grant_type=id_token') {
      const body = JSON.parse(init.body);
      return body.id_token === 'google-id-token-123' ? json(200, { access_token: 'access-123456', refresh_token: 'refresh-123456', expires_in: 3600, user: { email: 'a@example.com' } }) : json(400, { msg: 'bad' });
    }
    return json(404, {});
  };
  const c = createAuthSyncController({ getEnv: () => env, fetchFn });
  const exchange = body => c.handleAuth({ action: 'exchange', readBody: async () => body });
  return { c, calls, exchange };
}

test('google callback forwards only well-formed code and state', () => {
  assert.equal(googleCallbackLocation(new URLSearchParams({ code: CODE, state: STATE, scope: 'x' })), `/?view=collection&code=${encodeURIComponent(CODE)}&state=${STATE}`);
  for (const q of [{ error: 'access_denied', state: STATE }, { code: CODE }, { code: CODE, state: 'short' }, { code: 'bad code!', state: STATE }]) {
    assert.equal(googleCallbackLocation(new URLSearchParams(q)), '/?view=collection&login=failed');
  }
});

test('exchange payload with provider google is validated strictly', () => {
  assert.equal(validateAuthPayload('exchange', { code: CODE, verifier: VERIFIER, provider: 'google' }), true);
  assert.equal(validateAuthPayload('exchange', { code: CODE, verifier: VERIFIER, provider: 'github' }), false);
  assert.equal(validateAuthPayload('exchange', { code: CODE, verifier: 'short', provider: 'google' }), false);
  assert.equal(validateAuthPayload('exchange', { code: CODE, verifier: VERIFIER, provider: 'google', x: 1 }), false);
  assert.equal(validateAuthPayload('exchange', { code: CODE, verifier: VERIFIER }), false, "old Supabase codes never contain '/'");
});

test('google exchange: code -> id_token -> Supabase session, no secret or id_token in the reply', async () => {
  const { c, calls, exchange } = controller(ENV, form => {
    assert.equal(form.get('client_secret'), 'top-secret-value');
    assert.equal(form.get('code_verifier'), VERIFIER);
    assert.equal(form.get('redirect_uri'), 'https://cardseektcg.com/api/auth/google/callback');
    return form.get('code') === CODE ? json(200, { id_token: 'google-id-token-123' }) : json(400, { error: 'invalid_grant' });
  });
  assert.equal(c.googleClientId(), 'client-id.apps');
  const ok = await exchange({ code: CODE, verifier: VERIFIER, provider: 'google' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.email, 'a@example.com');
  assert.equal(JSON.stringify(ok).includes('top-secret-value') || JSON.stringify(ok).includes('google-id-token-123'), false);
  assert.ok(calls.every(call => call.init.redirect === 'manual'), 'Workers fetch does not support redirect: error');

  const bad = await exchange({ code: '4/0Wrong-code-xyz', verifier: VERIFIER, provider: 'google' });
  assert.equal(bad.status, 401);
});

test('google exchange: upstream failure is 502, missing secrets are 503 and never call Google', async () => {
  const down = controller(ENV, () => json(500, { error: 'boom-detail' }));
  const r = await down.exchange({ code: CODE, verifier: VERIFIER, provider: 'google' });
  assert.equal(r.status, 502);
  assert.equal(JSON.stringify(r).includes('boom-detail'), false);

  const off = controller({ ...ENV, GOOGLE_CLIENT_SECRET: '' }, () => json(200, {}));
  assert.equal(off.c.googleClientId(), null);
  assert.equal((await off.exchange({ code: CODE, verifier: VERIFIER, provider: 'google' })).status, 503);
  assert.equal(off.calls.length, 0);
});

test('worker answers the google callback itself instead of proxying /api/* to Render', async () => {
  const { default: worker } = await import('../worker/index.mjs');
  const res = await worker.fetch(new Request(`https://cardseektcg.com/api/auth/google/callback?code=${encodeURIComponent(CODE)}&state=${STATE}`), { PUBLIC_BASE_URL: 'https://cardseektcg.com' }, { waitUntil() {} });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `/?view=collection&code=${encodeURIComponent(CODE)}&state=${STATE}`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
