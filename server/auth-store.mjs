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
      CREATE TABLE IF NOT EXISTS characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        species TEXT NOT NULL,
        level INTEGER NOT NULL,
        armor_class INTEGER NOT NULL,
        hit_points INTEGER NOT NULL,
        speed INTEGER NOT NULL,
        abilities TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monsters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        size TEXT NOT NULL,
        creature_type TEXT NOT NULL,
        armor_class INTEGER NOT NULL,
        hit_points INTEGER NOT NULL,
        speed INTEGER NOT NULL,
        challenge_rating TEXT NOT NULL,
        abilities TEXT NOT NULL,
        actions TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dm_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        invite_code TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS party_members (
        party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
        PRIMARY KEY (party_id, user_id)
      );
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

  listCharacters(userId) {
    return this.database
      .prepare('SELECT * FROM characters WHERE owner_id = ? ORDER BY updated_at DESC')
      .all(userId)
      .map(this.mapCharacter);
  }

  saveCharacter(userId, character, id = null) {
    const values = [
      character.name, character.className, character.species, character.level,
      character.armorClass, character.hitPoints, character.speed,
      JSON.stringify(character.abilities), character.notes, Date.now(),
    ];
    if (id) {
      const result = this.database.prepare(
        `UPDATE characters SET name=?, class_name=?, species=?, level=?, armor_class=?,
         hit_points=?, speed=?, abilities=?, notes=?, updated_at=? WHERE id=? AND owner_id=?`,
      ).run(...values, id, userId);
      return result.changes ? this.findCharacter(id) : null;
    }
    const result = this.database.prepare(
      `INSERT INTO characters (name,class_name,species,level,armor_class,hit_points,speed,
       abilities,notes,updated_at,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(...values, userId);
    return this.findCharacter(Number(result.lastInsertRowid));
  }

  findCharacter(id) {
    const row = this.database.prepare('SELECT * FROM characters WHERE id=?').get(id);
    return row ? this.mapCharacter(row) : null;
  }

  deleteCharacter(userId, id) {
    return this.database.prepare('DELETE FROM characters WHERE id=? AND owner_id=?').run(id, userId).changes;
  }

  listMonsters(userId) {
    return this.database
      .prepare('SELECT * FROM monsters WHERE owner_id=? ORDER BY updated_at DESC')
      .all(userId)
      .map(this.mapMonster);
  }

  saveMonster(userId, monster, id = null) {
    const values = [
      monster.name, monster.size, monster.creatureType, monster.armorClass,
      monster.hitPoints, monster.speed, monster.challengeRating,
      JSON.stringify(monster.abilities), monster.actions, Date.now(),
    ];
    if (id) {
      const result = this.database.prepare(
        `UPDATE monsters SET name=?,size=?,creature_type=?,armor_class=?,hit_points=?,
         speed=?,challenge_rating=?,abilities=?,actions=?,updated_at=? WHERE id=? AND owner_id=?`,
      ).run(...values, id, userId);
      return result.changes ? this.findMonster(id) : null;
    }
    const result = this.database.prepare(
      `INSERT INTO monsters (name,size,creature_type,armor_class,hit_points,speed,
       challenge_rating,abilities,actions,updated_at,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(...values, userId);
    return this.findMonster(Number(result.lastInsertRowid));
  }

  findMonster(id) {
    const row = this.database.prepare('SELECT * FROM monsters WHERE id=?').get(id);
    return row ? this.mapMonster(row) : null;
  }

  deleteMonster(userId, id) {
    return this.database.prepare('DELETE FROM monsters WHERE id=? AND owner_id=?').run(id, userId).changes;
  }

  createParty(dmId, name, inviteCode) {
    const result = this.database
      .prepare('INSERT INTO parties (dm_id,name,invite_code) VALUES (?,?,?)')
      .run(dmId, name, inviteCode);
    return this.findParty(Number(result.lastInsertRowid), dmId);
  }

  joinParty(userId, inviteCode, characterId) {
    const party = this.database.prepare('SELECT id FROM parties WHERE invite_code=?').get(inviteCode);
    if (!party) return null;
    if (characterId && !this.database.prepare('SELECT id FROM characters WHERE id=? AND owner_id=?').get(characterId, userId)) {
      return false;
    }
    this.database.prepare(
      `INSERT INTO party_members (party_id,user_id,character_id) VALUES (?,?,?)
       ON CONFLICT(party_id,user_id) DO UPDATE SET character_id=excluded.character_id`,
    ).run(party.id, userId, characterId || null);
    return this.findParty(party.id, userId);
  }

  listParties(userId) {
    const rows = this.database.prepare(
      `SELECT DISTINCT parties.id FROM parties LEFT JOIN party_members ON party_members.party_id=parties.id
       WHERE parties.dm_id=? OR party_members.user_id=? ORDER BY parties.id DESC`,
    ).all(userId, userId);
    return rows.map(({ id }) => this.findParty(id, userId));
  }

  findParty(id, viewerId) {
    const party = this.database.prepare(
      `SELECT parties.id,parties.name,parties.invite_code AS inviteCode,parties.dm_id AS dmId,
       users.display_name AS dmName FROM parties JOIN users ON users.id=parties.dm_id
       WHERE parties.id=? AND (parties.dm_id=? OR EXISTS
       (SELECT 1 FROM party_members WHERE party_id=parties.id AND user_id=?))`,
    ).get(id, viewerId, viewerId);
    if (!party) return null;
    if (party.dmId !== viewerId) delete party.inviteCode;
    party.members = this.database.prepare(
      `SELECT users.id,users.display_name AS displayName,characters.id AS characterId,
       characters.name AS characterName FROM party_members JOIN users ON users.id=party_members.user_id
       LEFT JOIN characters ON characters.id=party_members.character_id WHERE party_members.party_id=?`,
    ).all(id);
    return party;
  }

  mapCharacter(row) {
    return {
      id: row.id, ownerId: row.owner_id, name: row.name, className: row.class_name,
      species: row.species, level: row.level, armorClass: row.armor_class,
      hitPoints: row.hit_points, speed: row.speed, abilities: JSON.parse(row.abilities),
      notes: row.notes,
    };
  }

  mapMonster(row) {
    return {
      id: row.id, ownerId: row.owner_id, name: row.name, size: row.size,
      creatureType: row.creature_type, armorClass: row.armor_class,
      hitPoints: row.hit_points, speed: row.speed, challengeRating: row.challenge_rating,
      abilities: JSON.parse(row.abilities), actions: row.actions,
    };
  }

  close() {
    this.database.close();
  }
}
