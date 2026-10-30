import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { STARTING_BANKROLL, RELOAD_THRESHOLD } from './config.js';

/**
 * Persistent storage for accounts, sessions and chips.
 *
 * Chip accounting: `bankroll` is chips off the tables; `in_play` mirrors the user's stacks on tables
 * as of the last completed hand. If the server stops mid-hand, in_play is returned to the bankroll on
 * the next boot, so nobody loses chips to a crash.
 */
export function openStore(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      bankroll INTEGER NOT NULL,
      in_play INTEGER NOT NULL DEFAULT 0,
      reloads INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);

  const q = {
    insertUser: db.prepare('INSERT INTO users (username, password_hash, bankroll, created_at) VALUES (?, ?, ?, ?)'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    session: db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    buyIn: db.prepare('UPDATE users SET bankroll = bankroll - ?1, in_play = in_play + ?1 WHERE id = ?2 AND bankroll >= ?1'),
    cashOut: db.prepare('UPDATE users SET bankroll = bankroll + ?1, in_play = MAX(0, in_play - ?2) WHERE id = ?3'),
    adjustInPlay: db.prepare('UPDATE users SET in_play = MAX(0, in_play + ?) WHERE id = ?'),
    reload: db.prepare(`UPDATE users SET bankroll = ?1 - in_play, reloads = reloads + 1
                        WHERE id = ?2 AND bankroll + in_play < ?3`),
    restoreInPlay: db.prepare('UPDATE users SET bankroll = bankroll + in_play, in_play = 0 WHERE in_play > 0'),
  };

  return {
    createUser(username, passwordHash) {
      const { lastInsertRowid } = q.insertUser.run(username, passwordHash, STARTING_BANKROLL, Date.now());
      return q.userById.get(lastInsertRowid);
    },
    userByName: (username) => q.userByName.get(username),
    user: (id) => q.userById.get(id),

    createSession(tokenHash, userId, ttlMs) {
      q.purgeSessions.run(Date.now());
      q.insertSession.run(tokenHash, userId, Date.now() + ttlMs);
    },
    sessionUser: (tokenHash) => q.session.get(tokenHash, Date.now())?.user_id ?? null,
    deleteSession: (tokenHash) => q.deleteSession.run(tokenHash),

    /** Move chips from bankroll to a table. Returns false if the bankroll is too small. */
    buyIn: (userId, amount) => q.buyIn.run(amount, userId).changes === 1,
    /** Return `amount` chips from a table; `inPlayAmount` is what in_play had recorded for them. */
    cashOut: (userId, amount, inPlayAmount = amount) => q.cashOut.run(amount, inPlayAmount, userId),
    adjustInPlay: (userId, delta) => q.adjustInPlay.run(delta, userId),
    reload: (userId) => q.reload.run(STARTING_BANKROLL, userId, RELOAD_THRESHOLD).changes === 1,
    restoreInPlay: () => q.restoreInPlay.run().changes,
    close: () => db.close(),
  };
}
