import { Table, TableError } from './table.js';
import { publicUser } from './players.js';
import { TABLES } from './config.js';

/** Players who closed their tab are forgotten (and their name freed) after this long. */
const IDLE_PLAYER_MS = 10 * 60_000;

/** Owns every table and wires them to Socket.IO clients. */
export class Room {
  /**
   * @param {import('socket.io').Server} io
   * @param {import('./players.js').PlayerStore} players
   */
  constructor(io, players) {
    this.io = io;
    this.players = players;
    this.watchers = new Map(); // tableId -> Set<socket>
    this.userSockets = new Map(); // userId -> Set<socket>
    this.lastLobby = '';
    this.tables = new Map(TABLES.map((cfg) => [cfg.id, new Table(cfg, {
      store: players,
      onUpdate: (t) => this.emitTable(t),
      onChips: (userId) => this.emitMe(userId),
      hasAudience: (id) => (this.watchers.get(id)?.size ?? 0) > 0,
    })]));
    setInterval(() => this.emitLobby(), 1500).unref();
    setInterval(() => this.forgetIdlePlayers(), 60_000).unref();
  }

  lobby() {
    return [...this.tables.values()].map((t) => t.summary());
  }

  table(id) {
    const t = this.tables.get(id);
    if (!t) throw new TableError('No such table');
    return t;
  }

  isSeated(userId) {
    return [...this.tables.values()].some((t) => t.seatOf(userId) >= 0);
  }

  emitTable(table) {
    for (const socket of this.watchers.get(table.id) ?? []) {
      socket.emit('table:state', table.viewFor(socket.data.userId));
    }
  }

  emitMe(userId) {
    const user = this.players.user(userId);
    if (!user) return;
    for (const socket of this.userSockets.get(userId) ?? []) socket.emit('me', publicUser(user));
  }

  emitLobby() {
    const data = this.lobby();
    const json = JSON.stringify(data);
    if (json === this.lastLobby) return;
    this.lastLobby = json;
    this.io.to('lobby').emit('lobby', data);
  }

  unwatch(socket) {
    const id = socket.data.watching;
    if (!id) return;
    this.watchers.get(id)?.delete(socket);
    socket.data.watching = null;
  }

  /** Stand a player up everywhere and forget them. */
  endSession(userId) {
    for (const t of this.tables.values()) t.stand(userId);
    this.players.remove(userId);
  }

  forgetIdlePlayers() {
    const cutoff = Date.now() - IDLE_PLAYER_MS;
    for (const p of [...this.players.byId.values()]) {
      if (!this.userSockets.has(p.id) && p.lastSeen < cutoff && !this.isSeated(p.id)) this.players.remove(p.id);
    }
  }

  /** @param {import('socket.io').Socket} socket  socket.data.userId is set by the auth middleware */
  attach(socket) {
    const { userId } = socket.data;
    if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
    this.userSockets.get(userId).add(socket);

    const on = (event, fn) => socket.on(event, (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply({ ok: true, ...(fn(payload ?? {}) ?? {}) });
      } catch (err) {
        if (!(err instanceof TableError)) console.error(`[${event}]`, err);
        reply({ ok: false, error: err instanceof TableError ? err.message : 'Something went wrong' });
      }
    });
    const user = () => {
      const u = this.players.user(userId);
      if (!u) throw new TableError('Your session has ended — refresh to play again');
      return u;
    };

    on('lobby:join', () => {
      socket.join('lobby');
      socket.emit('lobby', this.lobby());
    });
    on('lobby:leave', () => socket.leave('lobby'));

    on('player:reload', () => {
      if (!this.players.reload(user().id)) throw new TableError('Reloads are available once you have under 1,000 chips in total');
      this.emitMe(userId);
    });
    on('player:quit', () => this.endSession(userId)); // the client disconnects itself

    on('table:watch', ({ tableId }) => {
      const t = this.table(tableId);
      this.unwatch(socket);
      if (!this.watchers.has(t.id)) this.watchers.set(t.id, new Set());
      this.watchers.get(t.id).add(socket);
      socket.data.watching = t.id;
      socket.emit('table:state', t.viewFor(userId));
      t.wake();
    });
    on('table:unwatch', () => this.unwatch(socket));

    on('table:sit', ({ tableId, seat, buyIn }) => this.table(tableId).sit(user(), seat, buyIn));
    on('table:leave', ({ tableId }) => this.table(tableId).stand(userId));
    on('table:action', ({ tableId, type, amount }) => this.table(tableId).act(userId, String(type), amount));
    on('table:sitout', ({ tableId, value }) => this.table(tableId).setSitOut(userId, !!value));
    on('table:postnow', ({ tableId, value }) => this.table(tableId).setPostNow(userId, !!value));
    on('table:topup', ({ tableId, amount }) => this.table(tableId).topUp(userId, amount));
    on('table:chat', ({ tableId, text }) => this.table(tableId).addChat(user(), text));

    socket.on('disconnect', () => {
      this.unwatch(socket);
      const set = this.userSockets.get(userId);
      set?.delete(socket);
      if (set && !set.size) this.userSockets.delete(userId);
      const p = this.players.user(userId);
      if (p) p.lastSeen = Date.now();
    });

    const p = this.players.user(userId);
    if (p) p.lastSeen = Date.now();
    this.emitMe(userId);
  }
}
