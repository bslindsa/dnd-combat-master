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
      CREATE TABLE IF NOT EXISTS encounters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
        dm_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','completed')),
        round INTEGER NOT NULL DEFAULT 1,
        turn_index INTEGER NOT NULL DEFAULT 0,
        action_taken INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS combatants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        encounter_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        source_type TEXT NOT NULL CHECK(source_type IN ('character','monster')),
        source_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        armor_class INTEGER NOT NULL,
        max_hp INTEGER NOT NULL,
        current_hp INTEGER NOT NULL,
        initiative INTEGER NOT NULL,
        abilities TEXT NOT NULL,
        conditions TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS combat_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        encounter_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        roll_data TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS combatants_encounter ON combatants(encounter_id,initiative DESC);
      CREATE INDEX IF NOT EXISTS combat_log_encounter ON combat_log(encounter_id,id DESC);
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
    const parties = this.database.prepare(
      `SELECT DISTINCT parties.id,parties.name,parties.invite_code AS inviteCode,
       parties.dm_id AS dmId,users.display_name AS dmName FROM parties
       JOIN users ON users.id=parties.dm_id
       LEFT JOIN party_members ON party_members.party_id=parties.id
       WHERE parties.dm_id=? OR party_members.user_id=? ORDER BY parties.id DESC`,
    ).all(userId, userId);
    if (!parties.length) return [];
    const placeholders = parties.map(() => '?').join(',');
    const members = this.database.prepare(
      `SELECT party_members.party_id AS partyId,users.id,users.display_name AS displayName,
       characters.id AS characterId,characters.name AS characterName FROM party_members
       JOIN users ON users.id=party_members.user_id
       LEFT JOIN characters ON characters.id=party_members.character_id
       WHERE party_members.party_id IN (${placeholders})`,
    ).all(...parties.map(({ id }) => id));
    return parties.map((party) => {
      const visible = party.dmId === userId
        ? { ...party }
        : (({ inviteCode: _, ...withoutInvite }) => withoutInvite)(party);
      return { ...visible, members: members.filter((member) => member.partyId === party.id)
        .map(({ partyId: _, ...member }) => member) };
    });
  }

  findParty(id, viewerId) {
    const party = this.database.prepare(
      `SELECT parties.id,parties.name,parties.invite_code AS inviteCode,parties.dm_id AS dmId,
       users.display_name AS dmName FROM parties JOIN users ON users.id=parties.dm_id
       WHERE parties.id=? AND (parties.dm_id=? OR EXISTS
       (SELECT 1 FROM party_members WHERE party_id=parties.id AND user_id=?))`,
    ).get(id, viewerId, viewerId);
    if (!party) return null;
    const visibleParty = party.dmId === viewerId
      ? { ...party }
      : (({ inviteCode: _, ...withoutInvite }) => withoutInvite)(party);
    visibleParty.members = this.database.prepare(
      `SELECT users.id,users.display_name AS displayName,characters.id AS characterId,
       characters.name AS characterName FROM party_members JOIN users ON users.id=party_members.user_id
       LEFT JOIN characters ON characters.id=party_members.character_id WHERE party_members.party_id=?`,
    ).all(id);
    return visibleParty;
  }

  createEncounter(dmId, partyId, name, monsterIds, rollInitiative) {
    const party = this.database.prepare('SELECT id FROM parties WHERE id=? AND dm_id=?').get(partyId, dmId);
    if (!party) return null;
    const transaction = this.database.transaction(() => {
      const result = this.database.prepare(
        `INSERT INTO encounters (party_id,dm_id,name,status,round,turn_index,created_at)
         VALUES (?,?,?,'active',1,0,?)`,
      ).run(partyId, dmId, name, Date.now());
      const encounterId = Number(result.lastInsertRowid);
      const insert = this.database.prepare(
        `INSERT INTO combatants (encounter_id,user_id,source_type,source_id,name,armor_class,
         max_hp,current_hp,initiative,abilities) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      );
      const characters = this.database.prepare(
        `SELECT characters.*,party_members.user_id FROM party_members JOIN characters
         ON characters.id=party_members.character_id WHERE party_members.party_id=?`,
      ).all(partyId);
      for (const character of characters) {
        const abilities = JSON.parse(character.abilities);
        insert.run(encounterId, character.user_id, 'character', character.id, character.name,
          character.armor_class, character.hit_points, character.hit_points,
          rollInitiative(abilities.dexterity), character.abilities);
      }
      for (const monsterId of monsterIds) {
        const monster = this.database.prepare('SELECT * FROM monsters WHERE id=? AND owner_id=?').get(monsterId, dmId);
        if (!monster) throw new Error('INVALID_MONSTER');
        const abilities = JSON.parse(monster.abilities);
        insert.run(encounterId, null, 'monster', monster.id, monster.name, monster.armor_class,
          monster.hit_points, monster.hit_points, rollInitiative(abilities.dexterity), monster.abilities);
      }
      const combatantCount = this.database.prepare(
        'SELECT COUNT(*) AS count FROM combatants WHERE encounter_id=?',
      ).get(encounterId).count;
      if (combatantCount < 2) throw new Error('NOT_ENOUGH_COMBATANTS');
      this.addCombatLog(encounterId, 'Initiative rolled. Combat begins!');
      return encounterId;
    });
    try {
      return this.getEncounter(transaction(), dmId);
    } catch (error) {
      if (error.message === 'INVALID_MONSTER') return false;
      if (error.message === 'NOT_ENOUGH_COMBATANTS') return 'NOT_ENOUGH_COMBATANTS';
      throw error;
    }
  }

  listEncounters(userId) {
    return this.database.prepare(
      `SELECT DISTINCT encounters.id FROM encounters JOIN parties ON parties.id=encounters.party_id
       LEFT JOIN party_members ON party_members.party_id=parties.id
       WHERE encounters.dm_id=? OR party_members.user_id=? ORDER BY encounters.created_at DESC`,
    ).all(userId, userId).map(({ id }) => this.getEncounter(id, userId));
  }

  getEncounter(id, userId) {
    const encounter = this.database.prepare(
      `SELECT encounters.* FROM encounters JOIN parties ON parties.id=encounters.party_id
       LEFT JOIN party_members ON party_members.party_id=parties.id
       WHERE encounters.id=? AND (encounters.dm_id=? OR party_members.user_id=?)`,
    ).get(id, userId, userId);
    if (!encounter) return null;
    const combatants = this.database.prepare(
      `SELECT id,user_id AS userId,source_type AS sourceType,source_id AS sourceId,name,
       armor_class AS armorClass,max_hp AS maxHp,current_hp AS currentHp,initiative,
       abilities,conditions FROM combatants WHERE encounter_id=? ORDER BY initiative DESC,id`,
    ).all(id).map((row) => ({ ...row, abilities: JSON.parse(row.abilities), conditions: JSON.parse(row.conditions) }));
    const logs = this.database.prepare(
      `SELECT id,message,roll_data AS rollData,created_at AS createdAt FROM combat_log
       WHERE encounter_id=? ORDER BY id DESC LIMIT 50`,
    ).all(id).map((row) => ({ ...row, rollData: row.rollData ? JSON.parse(row.rollData) : null }));
    return {
      id: encounter.id, partyId: encounter.party_id, dmId: encounter.dm_id, name: encounter.name,
      status: encounter.status, round: encounter.round, turnIndex: encounter.turn_index,
      actionTaken: Boolean(encounter.action_taken),
      combatants, logs,
    };
  }

  addCombatLog(encounterId, message, rollData = null) {
    this.database.prepare(
      'INSERT INTO combat_log (encounter_id,message,roll_data,created_at) VALUES (?,?,?,?)',
    ).run(encounterId, message, rollData ? JSON.stringify(rollData) : null, Date.now());
  }

  performCombatAction(encounterId, userId, action, roller) {
    const encounter = this.getEncounter(encounterId, userId);
    if (!encounter || encounter.status !== 'active') return null;
    const actor = encounter.combatants[encounter.turnIndex];
    if (!actor || (encounter.dmId !== userId && actor.userId !== userId)) return false;
    if (encounter.actionTaken) return 'ACTION_TAKEN';
    const target = encounter.combatants.find(({ id }) => id === action.targetId);
    if (!target) return 'INVALID_TARGET';
    if ((action.type === 'attack' && actor.sourceType === target.sourceType) ||
        (action.type === 'heal' && actor.sourceType !== target.sourceType)) return 'INVALID_TARGET';
    const modifier = Math.floor((actor.abilities[action.ability] - 10) / 2);
    const roll = roller(20);
    let message;
    let rollData;
    if (action.type === 'attack') {
      const total = roll + modifier;
      const hit = roll === 20 || (roll !== 1 && total >= target.armorClass);
      const damage = hit
        ? Math.max(1, roller(action.damageDie) + (roll === 20 ? roller(action.damageDie) : 0) + modifier)
        : 0;
      this.database.prepare(
        'UPDATE combatants SET current_hp=MAX(0,current_hp-?) WHERE id=? AND encounter_id=?',
      ).run(damage, target.id, encounterId);
      message = `${actor.name} attacks ${target.name}: ${total} to hit — ${hit ? `${damage} damage` : 'miss'}.`;
      rollData = { type: 'attack', die: roll, modifier, total, hit, damage, critical: roll === 20 };
    } else {
      const amount = Math.max(1, roller(action.damageDie) + modifier);
      this.database.prepare(
        'UPDATE combatants SET current_hp=MIN(max_hp,current_hp+?) WHERE id=? AND encounter_id=?',
      ).run(amount, target.id, encounterId);
      message = `${actor.name} restores ${amount} HP to ${target.name}.`;
      rollData = { type: 'heal', die: roll, modifier, amount };
    }
    this.database.prepare('UPDATE encounters SET action_taken=1 WHERE id=?').run(encounterId);
    this.addCombatLog(encounterId, message, rollData);
    return this.getEncounter(encounterId, userId);
  }

  advanceTurn(encounterId, dmId) {
    const encounter = this.getEncounter(encounterId, dmId);
    if (!encounter || encounter.dmId !== dmId || encounter.status !== 'active') return null;
    let next = encounter.turnIndex;
    let round = encounter.round;
    for (let count = 0; count < encounter.combatants.length; count += 1) {
      next = (next + 1) % encounter.combatants.length;
      if (next === 0) round += 1;
      if (encounter.combatants[next].currentHp > 0) break;
    }
    this.database.prepare(
      'UPDATE encounters SET turn_index=?,round=?,action_taken=0 WHERE id=?',
    ).run(next, round, encounterId);
    this.addCombatLog(encounterId, `Round ${round}: ${encounter.combatants[next].name}'s turn.`);
    return this.getEncounter(encounterId, dmId);
  }

  endEncounter(encounterId, dmId) {
    return this.database.prepare(
      `UPDATE encounters SET status='completed' WHERE id=? AND dm_id=? AND status='active'`,
    ).run(encounterId, dmId).changes;
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
