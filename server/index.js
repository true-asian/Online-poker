import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { PlayerStore, PlayerError, publicUser } from './players.js';
import { Room } from './room.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

/** Small fixed-window limiter so nobody can spam new players. */
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

const players = new PlayerStore();
const app = express();
app.set('trust proxy', 1); // behind Render's proxy, so req.ip is the real client
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

app.post('/api/join', rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  try {
    const player = players.create(req.body?.name);
    res.json({ token: player.token, user: publicUser(player) });
  } catch (err) {
    if (!(err instanceof PlayerError)) throw err;
    res.status(400).json({ error: err.message });
  }
});
app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

const server = http.createServer(app);
const io = new Server(server, {
  // Only accept connections from our own pages.
  allowRequest: (req, done) => {
    const origin = req.headers.origin;
    try {
      done(null, !origin || new URL(origin).host === req.headers.host);
    } catch {
      done(null, false);
    }
  },
});

const room = new Room(io, players);
io.use((socket, next) => {
  const player = players.fromToken(socket.handshake.auth?.token);
  if (!player) return next(new Error('unauthorized'));
  socket.data.userId = player.id;
  next();
});
io.on('connection', (socket) => room.attach(socket));

server.listen(PORT, () => console.log(`Poker room running on port ${PORT}`));
