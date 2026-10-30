import crypto from 'node:crypto';
import { STARTING_BANKROLL, RELOAD_THRESHOLD } from './config.js';

const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;
const MAX_PLAYERS = 2000;

export class PlayerError extends Error {}

export function cleanName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Players live in memory only: pick a nickname, get a fresh bankroll, and everything is gone when
 * the server restarts. Exposes the same chip-accounting calls the tables use.
 *
 * `bankroll` is chips off the tables; `inPlay` mirrors the player's stacks on tables.
 */
export class PlayerStore {
  constructor() {
    this.byId = new Map();
    this.byToken = new Map();
    this.nextId = 1;
  }

  create(rawName) {
    const name = cleanName(rawName);
    if (!NAME_RE.test(name)) throw new PlayerError('Names are 2–16 letters, numbers, spaces, _ or -.');
    const taken = [...this.byId.values()].some((p) => p.username.toLowerCase() === name.toLowerCase());
    if (taken) throw new PlayerError('Someone is already playing under that name.');
    if (this.byId.size >= MAX_PLAYERS) throw new PlayerError('The room is full right now. Try again soon.');
    const player = {
      id: this.nextId++,
      username: name,
      bankroll: STARTING_BANKROLL,
      inPlay: 0,
      token: crypto.randomBytes(24).toString('base64url'),
      lastSeen: Date.now(),
    };
    this.byId.set(player.id, player);
    this.byToken.set(player.token, player);
    return player;
  }

  user(id) {
    return this.byId.get(id);
  }

  fromToken(token) {
    return (typeof token === 'string' && this.byToken.get(token)) || null;
  }

  remove(id) {
    const p = this.byId.get(id);
    if (!p) return;
    this.byId.delete(id);
    this.byToken.delete(p.token);
  }

  /** Move chips from bankroll to a table. Returns false if the bankroll is too small. */
  buyIn(id, amount) {
    const p = this.byId.get(id);
    if (!p || p.bankroll < amount) return false;
    p.bankroll -= amount;
    p.inPlay += amount;
    return true;
  }

  /** Return `amount` chips from a table; `inPlayAmount` is what inPlay had recorded for them. */
  cashOut(id, amount, inPlayAmount = amount) {
    const p = this.byId.get(id);
    if (!p) return;
    p.bankroll += amount;
    p.inPlay = Math.max(0, p.inPlay - inPlayAmount);
  }

  adjustInPlay(id, delta) {
    const p = this.byId.get(id);
    if (p) p.inPlay = Math.max(0, p.inPlay + delta);
  }

  /** Top back up to the starting bankroll once (bankroll + chips on tables) drops under the threshold. */
  reload(id) {
    const p = this.byId.get(id);
    if (!p || p.bankroll + p.inPlay >= RELOAD_THRESHOLD) return false;
    p.bankroll = STARTING_BANKROLL - p.inPlay;
    return true;
  }
}

export function publicUser(p) {
  return {
    id: p.id,
    username: p.username,
    bankroll: p.bankroll,
    inPlay: p.inPlay,
    canReload: p.bankroll + p.inPlay < RELOAD_THRESHOLD,
  };
}
