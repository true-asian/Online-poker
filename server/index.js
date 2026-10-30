import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { openStore } from './db.js';
import { createApiRouter, userIdFromCookie } from './auth.js';
import { Room } from './room.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');

const store = openStore(path.join(DATA_DIR, 'poker.db'));
const restored = store.restoreInPlay();
if (restored) console.log(`Returned table chips to ${restored} player bankroll(s) after restart`);

const app = express();
app.set('trust proxy', 1); // behind Render/Railway/Fly proxies, so req.secure reflects HTTPS
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  // Only accept WebSocket connections from our own pages.
  allowRequest: (req, done) => {
    const origin = req.headers.origin;
    try {
      done(null, !origin || new URL(origin).host === req.headers.host);
    } catch {
      done(null, false);
    }
  },
});

const room = new Room(io, store);
app.use('/api', createApiRouter(store, (userId) => room.emitMe(userId)));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

io.use((socket, next) => {
  const userId = userIdFromCookie(store, socket.handshake.headers.cookie);
  if (!userId) return next(new Error('unauthorized'));
  socket.data.userId = userId;
  next();
});
io.on('connection', (socket) => room.attach(socket));

server.listen(PORT, () => console.log(`Poker room running on http://localhost:${PORT}`));
