import test from 'node:test';
import assert from 'node:assert/strict';
import { googleAvatar, authSession } from '../providers/auth-sync.mjs';

test('Google avatar: only https lh3.googleusercontent.com URLs pass; session carries it', () => {
  const good = 'https://lh3.googleusercontent.com/a/ACg8ocJ_x-Y=s96-c';
  assert.equal(googleAvatar({ avatar_url: good }), good);
  assert.equal(googleAvatar({ picture: good }), good);
  for (const bad of ['http://lh3.googleusercontent.com/a/x', 'https://evil.example/a.png', 'https://lh3.googleusercontent.com.evil.example/a', 'https://lh3.googleusercontent.com/a"onerror=x', 'javascript:alert(1)', 42]) {
    assert.equal(googleAvatar({ avatar_url: bad }), '', String(bad));
  }
  const token = 'a'.repeat(40);
  const session = authSession({ access_token: token, refresh_token: token, expires_in: 3600, user: { email: 'x@example.com', user_metadata: { avatar_url: good } } }, 0);
  assert.equal(session.avatar, good);
  assert.equal(authSession({ access_token: token, refresh_token: token, expires_in: 3600, user: {} }, 0).avatar, '');
});
