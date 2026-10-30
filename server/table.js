import { randomInt } from 'node:crypto';
import { Hand, HandError } from './poker/hand.js';
import { planHand, isBetween } from './poker/positions.js';
import { cardToString } from './poker/cards.js';
import { decideBot, createBotProfile, pickBotName } from './poker/bot.js';
import { ACTION_TIMEOUT_MS, SIT_OUT_LIMIT_MS, BUY_IN_MIN_BB, BUY_IN_MAX_BB } from './config.js';

const DEAL_DELAY_MS = 800;
const RUNOUT_DELAY_MS = 1600;
const UNCONTESTED_DELAY_MS = 2500;
const SHOWDOWN_DELAY_MS = 5500;
const START_DELAY_MS = 1500;
const LOG_LIMIT = 80;
const CHAT_LIMIT = 50;
const fmt = (n) => n.toLocaleString('en-US');

export class TableError extends Error {}

/**
 * A cash table: seats, the hand in progress, timers, bots, and the per-player view.
 * The table owns the game clock; the Hand it runs is a pure rules engine.
 */
export class Table {
  /**
   * @param {{id:string, name:string, maxSeats:number, smallBlind:number, bigBlind:number}} cfg
   * @param {object} deps
   * @param {ReturnType<import('./db.js').openStore>} deps.store
   * @param {(table:Table) => void} deps.onUpdate   state changed; push views to watchers
   * @param {(userId:number) => void} deps.onChips  a user's bankroll / in-play chips changed
   * @param {(tableId:string) => boolean} deps.hasAudience  someone is watching
   */
  constructor(cfg, deps) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.maxSeats = cfg.maxSeats;
    this.smallBlind = cfg.smallBlind;
    this.bigBlind = cfg.bigBlind;
    this.minBuyIn = cfg.bigBlind * BUY_IN_MIN_BB;
    this.maxBuyIn = cfg.bigBlind * BUY_IN_MAX_BB;
    Object.assign(this, { store: deps.store, onUpdate: deps.onUpdate, onChips: deps.onChips, hasAudience: deps.hasAudience });

    this.seats = new Array(this.maxSeats).fill(null);
    this.hand = null;
    this.handCount = 0;
    this.button = -1;
    this.lastBB = -1;
    this.timer = null;
    this.turn = null;
    this.turnCounter = 0;
    this.botCounter = 0;
    this.chatCounter = 0;
    this.log = [];
    this.logCursor = 0;
    this.chat = [];
    this.lastChatAt = new Map();
    this.status = 'Waiting for players';
    this.balanceBots();
  }

  // ── seats ──────────────────────────────────────────────────────────

  newPlayer({ userId, name, isBot, stack }) {
    return {
      userId, name, isBot, stack,
      profile: isBot ? createBotProfile() : null,
      sittingOut: false,
      sitOutNext: false,
      sitOutSince: 0,
      waiting: true, // new players wait for the big blind (or post to play now)
      postNow: false,
      missedBB: false,
      leaving: false,
      pendingChips: 0, // chips added mid-hand, applied before the next deal
    };
  }

  seatOf(userId) {
    return this.seats.findIndex((s) => s && s.userId === userId);
  }

  player(userId) {
    const seat = this.seatOf(userId);
    if (seat < 0) throw new TableError('You are not seated at this table');
    return [seat, this.seats[seat]];
  }

  /** In the hand that's currently being played (not just finished). */
  inLiveHand(seat) {
    const h = this.hand;
    return !!h && h.phase !== 'complete' && h.players.get(seat)?.id === this.seats[seat]?.userId;
  }

  sit(user, seat, buyIn) {
    if (this.seatOf(user.id) >= 0) throw new TableError('You are already seated here');
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.maxSeats) throw new TableError('Invalid seat');
    if (this.seats[seat]) throw new TableError('That seat is taken');
    const amount = Math.floor(Number(buyIn));
    if (!(amount >= this.minBuyIn && amount <= this.maxBuyIn)) {
      throw new TableError(`Buy-in must be between ${fmt(this.minBuyIn)} and ${fmt(this.maxBuyIn)}`);
    }
    if (!this.store.buyIn(user.id, amount)) throw new TableError('Not enough chips in your bankroll');
    this.seats[seat] = this.newPlayer({ userId: user.id, name: user.username, isBot: false, stack: amount });
    this.addLog(`${user.username} sits down in seat ${seat + 1} with ${fmt(amount)}`);
    this.onChips(user.id);
    this.update();
    this.wake();
  }

  stand(userId) {
    const seat = this.seatOf(userId);
    if (seat < 0) return;
    const s = this.seats[seat];
    this.addLog(`${s.name} leaves the table`);
    if (this.inLiveHand(seat)) {
      const p = this.hand.players.get(seat);
      if (p.folded) {
        // Already out of the hand: leave now with whatever is behind.
        this.seats[seat] = null;
        this.store.cashOut(s.userId, p.stack + s.pendingChips, s.stack + s.pendingChips);
        this.onChips(s.userId);
      } else {
        s.leaving = true; // folded when the action reaches them, then stood up
        if (this.hand.phase === 'betting' && this.hand.toAct === seat) return this.forceAction(seat, false);
      }
    } else {
      this.removeSeat(seat);
    }
    this.update();
  }

  removeSeat(seat) {
    const s = this.seats[seat];
    this.seats[seat] = null;
    if (s && !s.isBot) {
      const chips = s.stack + s.pendingChips;
      this.store.cashOut(s.userId, chips, chips);
      this.onChips(s.userId);
    }
  }

  setSitOut(userId, value) {
    const [, s] = this.player(userId);
    if (value) {
      if (!s.sittingOut) s.sitOutNext = true;
    } else {
      s.sitOutNext = false;
      if (s.sittingOut) {
        if (s.stack + s.pendingChips <= 0) throw new TableError('Add chips before sitting back in');
        s.sittingOut = false;
        s.waiting = s.missedBB; // missed the big blind while away: wait for it (or post)
        s.postNow = false;
        this.wake();
      }
    }
    this.update();
  }

  setPostNow(userId, value) {
    const [, s] = this.player(userId);
    s.postNow = !!value;
    this.update();
  }

  topUp(userId, amount) {
    const [seat, s] = this.player(userId);
    const chips = Math.floor(Number(amount));
    if (!(chips > 0)) throw new TableError('Enter an amount');
    const current = s.stack + s.pendingChips;
    if (current + chips > this.maxBuyIn) throw new TableError(`You can have at most ${fmt(this.maxBuyIn)} on this table`);
    if (current === 0 && chips < this.minBuyIn) throw new TableError(`Minimum buy-in is ${fmt(this.minBuyIn)}`);
    if (!this.store.buyIn(userId, chips)) throw new TableError('Not enough chips in your bankroll');
    if (this.inLiveHand(seat)) s.pendingChips += chips;
    else s.stack += chips;
    this.addLog(`${s.name} adds ${fmt(chips)} chips${this.inLiveHand(seat) ? ' (after this hand)' : ''}`);
    this.onChips(userId);
    this.update();
  }

  addChat(user, text) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean) return;
    const now = Date.now();
    if (now - (this.lastChatAt.get(user.id) ?? 0) < 1000) throw new TableError('Slow down a little');
    this.lastChatAt.set(user.id, now);
    this.chat.push({ id: ++this.chatCounter, from: user.username, text: clean });
    if (this.chat.length > CHAT_LIMIT) this.chat.shift();
    this.update();
  }

  // ── bots ───────────────────────────────────────────────────────────

  /** Keep (seats - 2) chairs filled: bots leave as people sit and come back as they go. */
  balanceBots() {
    const humans = this.seats.filter((s) => s && !s.isBot).length;
    const target = Math.max(0, this.maxSeats - 2 - humans);
    const botSeats = [];
    this.seats.forEach((s, i) => s?.isBot && botSeats.push(i));
    while (botSeats.length > target) {
      const [seat] = botSeats.splice(randomInt(botSeats.length), 1);
      this.addLog(`${this.seats[seat].name} leaves the table`);
      this.seats[seat] = null;
    }
    const empty = [];
    this.seats.forEach((s, i) => !s && empty.push(i));
    const taken = new Set(this.seats.filter(Boolean).map((s) => s.name));
    for (let n = botSeats.length; n < target && empty.length; n++) {
      const [seat] = empty.splice(randomInt(empty.length), 1);
      const name = pickBotName(taken);
      taken.add(name);
      const stack = this.bigBlind * (60 + randomInt(41));
      this.seats[seat] = this.newPlayer({ userId: `bot:${this.id}:${++this.botCounter}`, name, isBot: true, stack });
      if (this.handCount) this.addLog(`${name} sits down in seat ${seat + 1}`);
    }
  }

  positionOf(seat) {
    const h = this.hand;
    if (seat === h.sbSeat || seat === h.bbSeat) return 'blinds';
    const order = h.seatsAfter(h.bbSeat).map((p) => p.seat).filter((s) => s !== h.sbSeat && s !== h.bbSeat);
    const i = order.indexOf(seat);
    if (i >= order.length - 2) return 'late';
    return i < Math.ceil(order.length / 3) ? 'early' : 'middle';
  }

  botAct(seat) {
    const h = this.hand;
    if (!h || h.phase !== 'betting' || h.toAct !== seat) return;
    const p = h.players.get(seat);
    const legal = h.legalActions(seat);
    const decision = decideBot({
      hole: p.cards,
      board: h.board,
      street: h.street,
      pot: h.totalPot(),
      legal,
      bigBlind: this.bigBlind,
      opponents: h.livePlayers().length - 1,
      position: this.positionOf(seat),
    }, this.seats[seat].profile);
    try {
      h.act(seat, decision.type, decision.amount);
    } catch (err) {
      if (!(err instanceof HandError)) throw err;
      h.act(seat, legal.canCheck ? 'check' : 'fold');
    }
    this.afterChange();
  }

  // ── game loop ──────────────────────────────────────────────────────

  schedule(fn, ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fn();
      } catch (err) {
        console.error(`[table ${this.id}]`, err);
        this.abortHand();
      }
    }, ms);
  }

  /** Start dealing if the table is idle (e.g. someone just sat down or started watching). */
  wake() {
    const idle = !this.timer && (!this.hand || this.hand.phase === 'complete');
    if (idle) this.schedule(() => this.startHand(), START_DELAY_MS);
  }

  startHand() {
    this.betweenHands();
    this.hand = null;
    this.turn = null;

    const humansSeated = this.seats.some((s) => s && !s.isBot);
    if (!humansSeated && !this.hasAudience(this.id)) {
      this.status = 'Paused — nobody is watching';
      return this.update();
    }

    const ready = this.seats.map((s) => (s && !s.sittingOut && !s.leaving && s.stack > 0 ? s : null));
    const plan = planHand(ready.map((s) => s && { waiting: s.waiting, postNow: s.postNow }), this.button);
    if (!plan) {
      this.status = 'Waiting for players';
      return this.update();
    }

    // Anyone away while the big blind passed their seat must wait for it (or post) when they return.
    if (this.lastBB >= 0) {
      this.seats.forEach((s, i) => {
        if (s && !ready[i] && isBetween(this.lastBB, i, plan.bb, this.maxSeats)) s.missedBB = true;
      });
    }
    for (const i of plan.activated) Object.assign(this.seats[i], { waiting: false, postNow: false, missedBB: false });
    this.button = plan.button;
    this.lastBB = plan.bb;
    this.status = null;

    this.hand = new Hand({
      players: plan.dealtIn.map((i) => ({ seat: i, id: this.seats[i].userId, name: this.seats[i].name, stack: this.seats[i].stack })),
      numSeats: this.maxSeats,
      buttonSeat: plan.button,
      sbSeat: plan.sb,
      bbSeat: plan.bb,
      posters: plan.posters,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      number: ++this.handCount,
    });
    this.logCursor = 0;
    this.hand.start();
    this.afterChange();
  }

  /** Housekeeping between hands: departures, top-ups, busts, sit-outs, bots. */
  betweenHands() {
    const now = Date.now();
    this.seats.forEach((s, i) => {
      if (!s) return;
      if (s.leaving) return this.removeSeat(i);
      if (s.pendingChips) {
        s.stack += s.pendingChips;
        s.pendingChips = 0;
      }
      if (s.isBot) {
        if (s.stack <= 0) {
          this.addLog(`${s.name} busts and leaves`);
          this.seats[i] = null;
        } else if (s.stack < this.bigBlind * 40 && Math.random() < 0.5) {
          s.stack = this.bigBlind * 100;
        }
        return;
      }
      if ((s.sitOutNext || s.stack <= 0) && !s.sittingOut) {
        s.sittingOut = true;
        s.sitOutSince = now;
      }
      s.sitOutNext = false;
      if (s.sittingOut && now - s.sitOutSince > SIT_OUT_LIMIT_MS) {
        this.addLog(`${s.name} was sitting out too long and left the table`);
        this.removeSeat(i);
      }
    });
    this.balanceBots();
  }

  afterChange() {
    this.flushLog();
    this.drive();
    this.update();
  }

  /** Arrange whatever happens next in the current hand. */
  drive() {
    const h = this.hand;
    this.turn = null;
    if (!h) return;
    if (h.phase === 'betting') {
      const seat = h.toAct;
      const s = this.seats[seat];
      this.turn = { seat, id: ++this.turnCounter, endsAt: Date.now() + ACTION_TIMEOUT_MS };
      if (s.isBot) return this.schedule(() => this.botAct(seat), 700 + randomInt(1600));
      if (s.leaving) return this.schedule(() => this.forceAction(seat, false), 300);
      return this.schedule(() => this.forceAction(seat, true), ACTION_TIMEOUT_MS);
    }
    if (h.phase === 'roundComplete') {
      return this.schedule(() => {
        if (this.hand !== h) return;
        h.advance();
        this.afterChange();
      }, h.cardsExposed ? RUNOUT_DELAY_MS : DEAL_DELAY_MS);
    }
    if (h.phase === 'complete') this.finishHand();
  }

  /** Timeout or departed player: check if free, otherwise fold. */
  forceAction(seat, timedOut) {
    const h = this.hand;
    if (!h || h.phase !== 'betting' || h.toAct !== seat) return;
    const s = this.seats[seat];
    const type = h.legalActions(seat).canCheck && !s.leaving ? 'check' : 'fold';
    h.act(seat, type);
    if (timedOut && type === 'fold') {
      s.sitOutNext = true;
      this.addLog(`${s.name} ran out of time and will sit out`);
    }
    this.afterChange();
  }

  act(userId, type, amount) {
    const [seat] = this.player(userId);
    const h = this.hand;
    if (!h || h.phase !== 'betting' || h.toAct !== seat) throw new TableError('It is not your turn');
    try {
      h.act(seat, type, amount);
    } catch (err) {
      if (err instanceof HandError) throw new TableError(err.message);
      throw err;
    }
    this.afterChange();
  }

  finishHand() {
    const h = this.hand;
    for (const p of h.players.values()) {
      const s = this.seats[p.seat];
      if (!s || s.userId !== p.id) continue;
      const delta = p.stack - s.stack;
      s.stack = p.stack;
      if (!s.isBot && delta) {
        this.store.adjustInPlay(s.userId, delta);
        this.onChips(s.userId);
      }
    }
    this.schedule(() => this.startHand(), h.results.showdown ? SHOWDOWN_DELAY_MS : UNCONTESTED_DELAY_MS);
  }

  /** Last-resort recovery if something throws mid-hand: refund everyone's bets and move on. */
  abortHand() {
    if (this.hand && this.hand.phase !== 'complete') {
      this.addLog('Hand cancelled because of a server error; bets returned');
    }
    this.hand = null;
    this.turn = null;
    this.update();
    this.schedule(() => this.startHand(), START_DELAY_MS);
  }

  flushLog() {
    if (!this.hand) return;
    for (const line of this.hand.history.slice(this.logCursor)) this.addLog(line);
    this.logCursor = this.hand.history.length;
  }

  addLog(line) {
    this.log.push(line);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  update() {
    this.onUpdate(this);
  }

  // ── views ──────────────────────────────────────────────────────────

  summary() {
    const occupied = this.seats.filter(Boolean);
    return {
      id: this.id,
      name: this.name,
      maxSeats: this.maxSeats,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      minBuyIn: this.minBuyIn,
      maxBuyIn: this.maxBuyIn,
      players: occupied.length,
      humans: occupied.filter((s) => !s.isBot).map((s) => s.name),
    };
  }

  /** Everything one viewer is allowed to see. Hole cards are only included when they should be visible. */
  viewFor(userId) {
    const h = this.hand;
    const live = !!h && h.phase !== 'complete';
    const results = h?.phase === 'complete' ? h.results : null;
    const heroSeat = this.seatOf(userId);

    const seats = this.seats.map((s, i) => {
      if (!s) return null;
      const hp = h?.players.get(i);
      const p = hp && hp.id === s.userId ? hp : null;
      let cards = [];
      if (p) {
        const shown = results?.shown[i];
        if (shown) cards = shown.cards;
        else if (p.id === userId || (h.cardsExposed && !p.folded)) cards = p.cards.map(cardToString);
        else if (!p.folded) cards = ['xx', 'xx'];
      }
      return {
        seat: i,
        name: s.name,
        isBot: s.isBot,
        isYou: s.userId === userId,
        stack: p && live ? p.stack : s.stack,
        bet: p && live ? p.committed : 0,
        inHand: !!p,
        folded: !!p?.folded,
        allIn: live && !!p?.allIn,
        cards,
        lastAction: p && live ? p.lastAction : null,
        sittingOut: s.sittingOut,
        waiting: s.waiting && !p && !s.sittingOut,
        leaving: s.leaving,
      };
    });

    const me = heroSeat >= 0 ? this.seats[heroSeat] : null;
    return {
      id: this.id,
      name: this.name,
      maxSeats: this.maxSeats,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      minBuyIn: this.minBuyIn,
      maxBuyIn: this.maxBuyIn,
      status: this.status,
      seats,
      hand: h && {
        number: h.number,
        street: h.street,
        board: h.board.map(cardToString),
        button: h.button,
        sb: h.sbSeat,
        bb: h.bbSeat,
        pots: live ? h.collectedPots().map((p) => p.amount) : [],
        totalPot: h.totalPot(),
        results: results && {
          showdown: results.showdown,
          winners: results.winners,
          pots: results.pots,
          shown: results.shown,
        },
      },
      turn: live && this.turn
        ? { seat: this.turn.seat, id: this.turn.id, remainingMs: Math.max(0, this.turn.endsAt - Date.now()), totalMs: ACTION_TIMEOUT_MS }
        : null,
      you: me && {
        seat: heroSeat,
        stack: me.stack,
        sittingOut: me.sittingOut,
        sitOutNext: me.sitOutNext,
        waiting: me.waiting && !me.sittingOut && !(h?.players.get(heroSeat)?.id === me.userId),
        postNow: me.postNow,
        pendingChips: me.pendingChips,
        legal: live && h.phase === 'betting' && h.toAct === heroSeat ? h.legalActions(heroSeat) : null,
      },
      log: this.log.slice(-40),
      chat: this.chat,
    };
  }
}
