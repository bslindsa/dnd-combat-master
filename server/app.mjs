import express from 'express';
import { AuthStore } from './auth-store.mjs';

const COOKIE_NAME = 'encounter_session';
const VALID_ROLES = new Set(['Dungeon Master', 'Player']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  if (!EMAIL_PATTERN.test(email)) return { error: 'Enter a valid email address.' };
  if (displayName.length < 2 || displayName.length > 60) {
    return { error: 'Display name must be between 2 and 60 characters.' };
  }
  if (password.length < 8 || password.length > 128) {
    return { error: 'Password must be between 8 and 128 characters.' };
  }
  if (!VALID_ROLES.has(role)) return { error: 'Choose a valid role.' };
  return { value: { email, displayName, password, role } };
}

export function createAuthApp({
  databasePath = process.env.AUTH_DATABASE_PATH ?? 'data/auth.db',
  secureCookies = process.env.NODE_ENV === 'production',
} = {}) {
  const app = express();
  const store = new AuthStore(databasePath);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.use('/api/auth', (request, response, next) => {
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

  app.post('/api/auth/register', async (request, response, next) => {
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

  app.post('/api/auth/login', async (request, response, next) => {
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

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: 'Unable to complete the request.' });
  });

  return { app, close: () => store.close() };
}
