import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAuthApp } from './app.mjs';

let server;
let closeStore;
let baseUrl;
const abilityScores = {
  strength: 10, dexterity: 14, constitution: 12,
  intelligence: 16, wisdom: 11, charisma: 8,
};

async function register(email, role = 'Player') {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email, displayName: email.split('@')[0], password: 'roll-for-initiative', role,
    }),
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie').split(';')[0];
}

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
  const account = {
    email: 'duplicate@example.com',
    displayName: 'Duplicate Guide',
    password: 'roll-for-initiative',
    role: 'Dungeon Master',
  };
  const initial = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(account),
  });
  assert.equal(initial.status, 201);

  const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...account, email: 'DUPLICATE@example.com' }),
  });
  assert.equal(duplicate.status, 409);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: 'incorrect' }),
  });
  assert.equal(login.status, 401);
});

test('logs in and invalidates the session on logout', async () => {
  const account = {
    email: 'logout@example.com',
    displayName: 'Logout Guide',
    password: 'roll-for-initiative',
    role: 'Player',
  };
  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(account),
  });
  assert.equal(registration.status, 201);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
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

test('creates, updates, and isolates owned characters', async () => {
      const ownerCookie = await register('hero-owner@example.com');
      const otherCookie = await register('other-player@example.com');
      const character = {
        name: 'Aelindra', className: 'Wizard', species: 'Elf', level: 5,
        armorClass: 15, hitPoints: 32, speed: 30, abilities: abilityScores, notes: 'Evoker',
      };
      const created = await fetch(`${baseUrl}/api/characters`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify(character),
      });
      assert.equal(created.status, 201);
      const id = (await created.json()).character.id;

      const updated = await fetch(`${baseUrl}/api/characters/${id}`, {
        method: 'PUT', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ ...character, level: 6 }),
      });
      assert.equal((await updated.json()).character.level, 6);

      const forbidden = await fetch(`${baseUrl}/api/characters/${id}`, {
        method: 'DELETE', headers: { cookie: otherCookie },
      });
      assert.equal(forbidden.status, 404);
      const list = await fetch(`${baseUrl}/api/characters`, { headers: { cookie: ownerCookie } });
      assert.equal((await list.json()).characters.length, 1);
});

test('allows only dungeon masters to manage monster stat blocks', async () => {
      const playerCookie = await register('monster-player@example.com');
      const dmCookie = await register('monster-dm@example.com', 'Dungeon Master');
      const monster = {
        name: 'Young Ember Drake', size: 'Large', creatureType: 'Dragon',
        challengeRating: '6', armorClass: 17, hitPoints: 110, speed: 40,
        abilities: { ...abilityScores, strength: 19 }, actions: 'Multiattack; Flame Breath.',
      };
      const forbidden = await fetch(`${baseUrl}/api/monsters`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: playerCookie },
        body: JSON.stringify(monster),
      });
      assert.equal(forbidden.status, 403);

      const created = await fetch(`${baseUrl}/api/monsters`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: dmCookie },
        body: JSON.stringify(monster),
      });
      assert.equal(created.status, 201);
      assert.equal((await created.json()).monster.name, monster.name);
});

test('creates a party and lets a player join with an owned character', async () => {
      const dmCookie = await register('party-dm@example.com', 'Dungeon Master');
      const playerCookie = await register('party-player@example.com');
      const characterResponse = await fetch(`${baseUrl}/api/characters`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: playerCookie },
        body: JSON.stringify({
          name: 'Thorne', className: 'Paladin', species: 'Human', level: 4,
          armorClass: 18, hitPoints: 41, speed: 30, abilities: abilityScores, notes: '',
        }),
      });
      const characterId = (await characterResponse.json()).character.id;
      const createParty = await fetch(`${baseUrl}/api/parties`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: dmCookie },
        body: JSON.stringify({ name: 'The Dawn Guard' }),
      });
      const party = (await createParty.json()).party;

      const join = await fetch(`${baseUrl}/api/parties/join`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: playerCookie },
        body: JSON.stringify({ inviteCode: party.inviteCode, characterId }),
      });
      assert.equal(join.status, 200);
      assert.equal((await join.json()).party.members[0].characterName, 'Thorne');

      const dmParties = await fetch(`${baseUrl}/api/parties`, { headers: { cookie: dmCookie } });
      assert.equal((await dmParties.json()).parties[0].members[0].displayName, 'party-player');
});
