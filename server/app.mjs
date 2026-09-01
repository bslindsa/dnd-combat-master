import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { AuthStore } from './auth-store.mjs';

const COOKIE_NAME = 'encounter_session';
const VALID_ROLES = new Set(['Dungeon Master', 'Player']);

function isValidEmail(email) {
  if (email.length < 3 || email.length > 254) return false;
  for (const character of email) {
    if (character.trim() === '') return false;
  }
  const at = email.indexOf('@');
  const dot = email.lastIndexOf('.');
  return at > 0 && at <= 64 && at === email.lastIndexOf('@') && dot > at + 1 && dot < email.length - 1;
}

function readCookie(request, name) {
  const cookies = request.headers.cookie?.split(';') ?? [];
  const match = cookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
  return match ? decodeURIComponent(match.trim().slice(name.length + 1)) : null;
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

function validateRegistration(body) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role;

  if (!isValidEmail(email)) return { error: 'Enter a valid email address.' };
  if (displayName.length < 2 || displayName.length > 60) {
    return { error: 'Display name must be between 2 and 60 characters.' };
  }

  if (password.length < 8 || password.length > 128) {
    return { error: 'Password must be between 8 and 128 characters.' };
  }

  if (!VALID_ROLES.has(role)) return { error: 'Choose a valid role.' };
  return { value: { email, displayName, password, role } };
}

const ABILITY_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
function boundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function validateCreature(body, monster = false) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const abilities = body.abilities;
  if (!name || name.length > 80) return { error: 'Name is required and must be under 80 characters.' };
  if (!abilities || ABILITY_NAMES.some((ability) => !boundedInteger(abilities[ability], 1, 30))) {
    return { error: 'All six ability scores must be between 1 and 30.' };
  }
  if (!boundedInteger(body.armorClass, 1, 30) || !boundedInteger(body.hitPoints, 1, 9999) ||
      !boundedInteger(body.speed, 0, 500)) return { error: 'Combat statistics are outside their valid range.' };
  if (monster) {
    const size = typeof body.size === 'string' ? body.size.trim() : '';
    const creatureType = typeof body.creatureType === 'string' ? body.creatureType.trim() : '';
    const challengeRating = typeof body.challengeRating === 'string' ? body.challengeRating.trim() : '';
    const actions = typeof body.actions === 'string' ? body.actions.trim() : '';
    if (!size || !creatureType || !challengeRating || actions.length > 5000) {
      return { error: 'Size, type, and challenge rating are required.' };
    }
    return { value: { name, size, creatureType, challengeRating, actions,
      armorClass: body.armorClass, hitPoints: body.hitPoints, speed: body.speed, abilities } };
  }
  const className = typeof body.className === 'string' ? body.className.trim() : '';
  const species = typeof body.species === 'string' ? body.species.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (!className || !species || !boundedInteger(body.level, 1, 20) || notes.length > 5000) {
    return { error: 'Class, species, and a level from 1 to 20 are required.' };
  }
  return { value: { name, className, species, level: body.level, notes,
    armorClass: body.armorClass, hitPoints: body.hitPoints, speed: body.speed, abilities } };
}

export function createAuthApp({
  databasePath = process.env.AUTH_DATABASE_PATH ?? 'data/auth.db',
  secureCookies = process.env.NODE_ENV === 'production',
} = {}) {
  const app = express();
  const store = new AuthStore(databasePath);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  const credentialLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  app.use('/api', (request, response, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next();
    const origin = request.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host === request.get('host')) return next();
      } catch {
        // Invalid and opaque origins are not trusted.
      }
      return response.status(403).json({ error: 'Cross-origin request rejected.' });
    }
    return next();
  });

  const setSession = (response, userId) => {
    const session = store.createSession(userId);
    response.cookie(COOKIE_NAME, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
      maxAge: session.maxAge * 1000,
    });
  };

  const requireUser = (request, response, next) => {
    request.user = store.findUserBySession(readCookie(request, COOKIE_NAME));
    return request.user ? next() : response.status(401).json({ error: 'Authentication required.' });
  };

  app.post('/api/auth/register', credentialLimiter, async (request, response, next) => {
    try {
      const registration = validateRegistration(request.body ?? {});
      if (registration.error) return response.status(400).json({ error: registration.error });
      if (store.findUserByEmail(registration.value.email)) {
        return response.status(409).json({ error: 'An account already exists for this email.' });
      }
      const user = await store.createUser(registration.value);
      setSession(response, user.id);
      return response.status(201).json({ user: publicUser(user) });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/login', credentialLimiter, async (request, response, next) => {
    try {
      const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      const user = await store.authenticate(email, password);
      if (!user) return response.status(401).json({ error: 'Email or password is incorrect.' });
      setSession(response, user.id);
      return response.json({ user: publicUser(user) });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/auth/session', (request, response) => {
    const user = store.findUserBySession(readCookie(request, COOKIE_NAME));
    if (!user) return response.status(401).json({ user: null });
    return response.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', (request, response) => {
    store.deleteSession(readCookie(request, COOKIE_NAME));
    response.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
    });
    return response.status(204).send();
  });

  app.get('/api/characters', requireUser, (request, response) =>
      response.json({ characters: store.listCharacters(request.user.id) }));
    app.post('/api/characters', requireUser, (request, response) => {
      const result = validateCreature(request.body ?? {});
      return result.error ? response.status(400).json({ error: result.error }) :
        response.status(201).json({ character: store.saveCharacter(request.user.id, result.value) });
    });
    app.put('/api/characters/:id', requireUser, (request, response) => {
      const result = validateCreature(request.body ?? {});
      if (result.error) return response.status(400).json({ error: result.error });
      const character = store.saveCharacter(request.user.id, result.value, Number(request.params.id));
      return character ? response.json({ character }) : response.status(404).json({ error: 'Character not found.' });
    });
    app.delete('/api/characters/:id', requireUser, (request, response) =>
      store.deleteCharacter(request.user.id, Number(request.params.id)) ?
        response.status(204).send() : response.status(404).json({ error: 'Character not found.' }));

    app.get('/api/monsters', requireUser, (request, response) =>
      response.json({ monsters: store.listMonsters(request.user.id) }));
    app.post('/api/monsters', requireUser, (request, response) => {
      if (request.user.role !== 'Dungeon Master') return response.status(403).json({ error: 'DM access required.' });
      const result = validateCreature(request.body ?? {}, true);
      return result.error ? response.status(400).json({ error: result.error }) :
        response.status(201).json({ monster: store.saveMonster(request.user.id, result.value) });
    });
    app.put('/api/monsters/:id', requireUser, (request, response) => {
      if (request.user.role !== 'Dungeon Master') return response.status(403).json({ error: 'DM access required.' });
      const result = validateCreature(request.body ?? {}, true);
      if (result.error) return response.status(400).json({ error: result.error });
      const monster = store.saveMonster(request.user.id, result.value, Number(request.params.id));
      return monster ? response.json({ monster }) : response.status(404).json({ error: 'Monster not found.' });
    });
    app.delete('/api/monsters/:id', requireUser, (request, response) => {
      if (request.user.role !== 'Dungeon Master') return response.status(403).json({ error: 'DM access required.' });
      return store.deleteMonster(request.user.id, Number(request.params.id)) ?
        response.status(204).send() : response.status(404).json({ error: 'Monster not found.' });
    });

    app.get('/api/parties', requireUser, (request, response) =>
      response.json({ parties: store.listParties(request.user.id) }));
    app.post('/api/parties', requireUser, (request, response) => {
      const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
      if (request.user.role !== 'Dungeon Master') return response.status(403).json({ error: 'DM access required.' });
      if (!name || name.length > 80) return response.status(400).json({ error: 'Party name is required.' });
      const inviteCode = randomBytes(5).toString('hex').toUpperCase();
      return response.status(201).json({ party: store.createParty(request.user.id, name, inviteCode) });
    });
    app.post('/api/parties/join', requireUser, (request, response) => {
      const code = typeof request.body?.inviteCode === 'string' ? request.body.inviteCode.trim().toUpperCase() : '';
      const party = store.joinParty(request.user.id, code, Number(request.body?.characterId) || null);
      if (party === false) return response.status(400).json({ error: 'Choose one of your own characters.' });
      return party ? response.json({ party }) : response.status(404).json({ error: 'Invite code not found.' });
    });
  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: 'Unable to complete the request.' });
  });

  return { app, close: () => store.close() };
}
