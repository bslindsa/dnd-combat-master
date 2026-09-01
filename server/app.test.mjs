import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAuthApp } from './app.mjs';

let server;
let closeStore;
let baseUrl;

before(async () => {
  const auth = createAuthApp({ databasePath: ':memory:' });
  closeStore = auth.close;
  server = auth.app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeStore();
});

test('registers a user and restores the cookie session', async () => {
  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'dm@example.com',
      displayName: 'Dungeon Guide',
      password: 'roll-for-initiative',
      role: 'Dungeon Master',
    }),
  });

  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).user.role, 'Dungeon Master');
  assert.match(registration.headers.get('set-cookie'), /HttpOnly/);

  const session = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { cookie: registration.headers.get('set-cookie').split(';')[0] },
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.email, 'dm@example.com');
});

test('rejects duplicate registrations and invalid credentials', async () => {
  const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'DM@example.com',
      displayName: 'Another Guide',
      password: 'roll-for-initiative',
      role: 'Dungeon Master',
    }),
  });
  assert.equal(duplicate.status, 409);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'dm@example.com', password: 'incorrect' }),
  });
  assert.equal(login.status, 401);
});

test('logs in and invalidates the session on logout', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'dm@example.com', password: 'roll-for-initiative' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(logout.status, 204);

  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } });
  assert.equal(session.status, 401);
});

test('rejects malformed and cross-origin mutation requests', async () => {
  for (const origin of ['null', 'https://malicious.example']) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: 'dm@example.com', password: 'roll-for-initiative' }),
    });
    assert.equal(response.status, 403);
  }
});
