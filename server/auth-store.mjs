import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';

const scrypt = promisify(scryptCallback);
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function passwordMatches(password, encodedHash) {
  const [saltHex, hashHex] = encodedHash.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== 64) return false;
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  return timingSafeEqual(expected, actual);
}

export class AuthStore {
  constructor(databasePath = 'data/auth.db') {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('Dungeon Master', 'Player')),
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
    `);
  }

  async createUser({ email, displayName, password, role }) {
    const passwordHash = await hashPassword(password);
    const result = this.database
      .prepare(
        'INSERT INTO users (email, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(email, displayName, role, passwordHash, Date.now());
    return this.findUserById(Number(result.lastInsertRowid));
  }

  findUserByEmail(email) {
    return this.database
      .prepare(
        'SELECT id, email, display_name AS displayName, role, password_hash AS passwordHash FROM users WHERE email = ?',
      )
      .get(email);
  }

  findUserById(id) {
    return this.database
      .prepare('SELECT id, email, display_name AS displayName, role FROM users WHERE id = ?')
      .get(id);
  }

  async authenticate(email, password) {
    const user = this.findUserByEmail(email);
    if (!user || !(await passwordMatches(password, user.passwordHash))) return null;
    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  }

  createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    this.database
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), userId, expiresAt);
    return { token, expiresAt, maxAge: SESSION_TTL_SECONDS };
  }

  findUserBySession(token) {
    if (!token) return null;
    return (
      this.database
        .prepare(
          `SELECT users.id, users.email, users.display_name AS displayName, users.role
           FROM sessions JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
        )
        .get(hashToken(token), Date.now()) ?? null
    );
  }

  deleteSession(token) {
    if (token) this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  close() {
    this.database.close();
  }
}
