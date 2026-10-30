import crypto from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import { RELOAD_THRESHOLD } from './config.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = 'sid';
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [, saltHex, keyHex] = stored.split('$');
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Resolve the logged-in user id from a raw Cookie header, or null. */
export function userIdFromCookie(store, cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE];
  return token ? store.sessionUser(hashToken(token)) : null;
}

export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    bankroll: u.bankroll,
    inPlay: u.in_play,
    canReload: u.bankroll + u.in_play < RELOAD_THRESHOLD,
  };
}

/** Small fixed-window limiter so the login form can't be brute-forced. */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || now > entry.reset) hits.set(req.ip, { count: 1, reset: now + windowMs });
    else if (++entry.count > max) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
    if (hits.size > 10_000) hits.clear();
    next();
  };
}

/**
 * @param {ReturnType<import('./db.js').openStore>} store
 * @param {(userId:number) => void} onChipsChanged
 */
export function createApiRouter(store, onChipsChanged) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 60_000, max: 10 });

  const startSession = (req, res, user) => {
    const token = crypto.randomBytes(32).toString('base64url');
    store.createSession(hashToken(token), user.id, SESSION_TTL_MS);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
    res.json({ user: publicUser(user) });
  };

  const requireUser = (req, res, next) => {
    const id = userIdFromCookie(store, req.headers.cookie);
    const user = id && store.user(id);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    req.user = user;
    next();
  };

  router.post('/register', limiter, async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–16 letters, numbers or underscores.' });
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 100) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (store.userByName(username)) return res.status(409).json({ error: 'That username is taken.' });
    const user = store.createUser(username, await hashPassword(password));
    startSession(req, res, user);
  });

  router.post('/login', limiter, async (req, res) => {
    const { username, password } = req.body ?? {};
    const user = typeof username === 'string' && store.userByName(username);
    if (!user || typeof password !== 'string' || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    startSession(req, res, user);
  });

  router.post('/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) store.deleteSession(hashToken(token));
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

  router.post('/reload', requireUser, (req, res) => {
    if (!store.reload(req.user.id)) {
      return res.status(400).json({ error: `Reloads are available when you have under ${RELOAD_THRESHOLD.toLocaleString('en-US')} chips in total.` });
    }
    onChipsChanged(req.user.id);
    res.json({ user: publicUser(store.user(req.user.id)) });
  });

  return router;
}
