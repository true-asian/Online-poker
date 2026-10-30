import { Deck, cardToString } from './cards.js';
import { evaluate, describe, bestFive } from './evaluator.js';
import { splitPots } from './pots.js';

const NEXT_STREET = { preflop: 'flop', flop: 'turn', turn: 'river' };
const fmt = (n) => n.toLocaleString('en-US');
const showCards = (cards) => `[${cards.map(cardToString).join(' ')}]`;

export class HandError extends Error {}

/**
 * One hand of No-Limit Texas Hold'em, from blinds to pot award.
 *
 * The hand is a synchronous state machine; the table drives it with delays for presentation:
 *   phase 'betting'        → waiting on `toAct` to call act()
 *   phase 'roundComplete'  → betting round closed; call advance() to deal the next street / showdown
 *   phase 'complete'       → `results` is set and stacks are final
 */
export class Hand {
  /**
   * @param {object} o
   * @param {{seat:number, id:string, name:string, stack:number}[]} o.players  everyone dealt in
   * @param {number} o.numSeats
   * @param {number} o.buttonSeat
   * @param {number} o.sbSeat
   * @param {number} o.bbSeat
   * @param {number[]} [o.posters]  new players posting a live big blind to be dealt in early
   * @param {number} o.smallBlind
   * @param {number} o.bigBlind
   * @param {Deck} [o.deck]
   * @param {number} [o.number]
   */
  constructor(o) {
    this.numSeats = o.numSeats;
    this.button = o.buttonSeat;
    this.sbSeat = o.sbSeat;
    this.bbSeat = o.bbSeat;
    this.posters = o.posters ?? [];
    this.smallBlind = o.smallBlind;
    this.bigBlind = o.bigBlind;
    this.deck = o.deck ?? new Deck();
    this.number = o.number ?? 0;

    this.players = new Map();
    for (const p of o.players) {
      this.players.set(p.seat, {
        seat: p.seat, id: p.id, name: p.name,
        stack: p.stack, startStack: p.stack,
        cards: [],
        committed: 0, // this street
        total: 0, // whole hand
        folded: false, allIn: false,
        hasActed: false, // acted voluntarily this street (posting a blind doesn't count)
        actedAt: 0, // the bet level they last acted at; drives the short all-in re-open rule
        lastAction: null,
      });
    }

    this.board = [];
    this.street = 'preflop';
    this.phase = 'new';
    this.currentBet = 0;
    this.minRaise = this.bigBlind; // size of the last full bet/raise this street
    this.toAct = -1;
    this.aggressor = -1; // last bettor/raiser this street; shows first at showdown
    this.cardsExposed = false; // all-in with no betting left: every live hand is turned up
    this.results = null;
    this.history = [];
  }

  // ── setup ──────────────────────────────────────────────────────────

  start() {
    this.log(`Hand #${this.number} — No-Limit Hold'em (${fmt(this.smallBlind)}/${fmt(this.bigBlind)})`);
    this.log(`${this.players.get(this.button).name} has the button`);
    this.postBlind(this.sbSeat, this.smallBlind, 'small blind', 'SB');
    this.postBlind(this.bbSeat, this.bigBlind, 'big blind', 'BB');
    for (const seat of this.posters) this.postBlind(seat, this.bigBlind, 'big blind', 'Post');
    // A big blind that is all-in for less still plays as a full big blind.
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;

    // Deal one card at a time, starting left of the button.
    const order = this.seatsAfter(this.button);
    for (let round = 0; round < 2; round++) for (const p of order) p.cards.push(this.deck.draw());

    this.phase = 'betting';
    this.toAct = this.bbSeat;
    this.advanceTurn();
  }

  postBlind(seat, amount, label, tag) {
    const p = this.players.get(seat);
    const paid = Math.min(amount, p.stack);
    this.commit(p, paid);
    p.lastAction = { label: tag, amount: paid };
    this.log(`${p.name} posts ${label} ${fmt(paid)}${p.allIn ? ' and is all-in' : ''}`);
  }

  // ── queries ────────────────────────────────────────────────────────

  /** Players in the hand, clockwise starting with the first seat after `seat`. */
  seatsAfter(seat) {
    const out = [];
    for (let i = 1; i <= this.numSeats; i++) {
      const p = this.players.get((seat + i) % this.numSeats);
      if (p) out.push(p);
    }
    return out;
  }

  livePlayers() {
    return [...this.players.values()].filter((p) => !p.folded);
  }

  needsToAct(p) {
    if (p.folded || p.allIn) return false;
    const others = this.livePlayers().filter((o) => o !== p);
    if (others.every((o) => o.allIn)) {
      // Nobody left to bet against: only act if there's still something to call.
      return p.committed < Math.max(0, ...others.map((o) => o.committed));
    }
    return !p.hasActed || p.committed < this.currentBet;
  }

  legalActions(seat = this.toAct) {
    const p = this.players.get(seat);
    const owed = Math.max(0, this.currentBet - p.committed);
    const maxRaiseTo = p.committed + p.stack;
    const othersCanAct = this.livePlayers().some((o) => o !== p && !o.allIn);
    // An all-in that is less than a full raise does not re-open the betting to a player who
    // already acted, unless the raises since they acted add up to at least a full raise.
    const reopened = !p.hasActed || this.currentBet - p.actedAt >= this.minRaise;
    return {
      canFold: true,
      canCheck: owed === 0,
      canCall: owed > 0,
      callAmount: Math.min(owed, p.stack),
      canRaise: othersCanAct && reopened && maxRaiseTo > this.currentBet,
      minRaiseTo: Math.min(this.currentBet + this.minRaise, maxRaiseTo),
      maxRaiseTo,
      isBet: this.currentBet === 0,
      currentBet: this.currentBet,
      committed: p.committed,
      stack: p.stack,
    };
  }

  /** Chips in the middle from completed streets, split into main/side pots (for display). */
  collectedPots() {
    return splitPots([...this.players.values()].map((p) => ({
      seat: p.seat, amount: p.total - p.committed, live: !p.folded,
    })));
  }

  totalPot() {
    let sum = 0;
    for (const p of this.players.values()) sum += p.total;
    return sum;
  }

  // ── actions ────────────────────────────────────────────────────────

  /**
   * @param {number} seat
   * @param {'fold'|'check'|'call'|'bet'|'raise'|'allin'} type
   * @param {number} [amount] raise-to amount (total chips in front of the player this street)
   */
  act(seat, type, amount = 0) {
    if (this.phase !== 'betting') throw new HandError('No action is pending');
    if (seat !== this.toAct) throw new HandError('It is not your turn');
    const p = this.players.get(seat);
    const legal = this.legalActions(seat);

    if (type === 'allin') {
      if (legal.canRaise) [type, amount] = ['raise', legal.maxRaiseTo];
      else type = legal.canCall ? 'call' : 'check';
    }

    switch (type) {
      case 'fold':
        p.folded = true;
        p.lastAction = { label: 'Fold' };
        this.log(`${p.name} folds`);
        break;
      case 'check':
        if (!legal.canCheck) throw new HandError('You cannot check facing a bet');
        p.lastAction = { label: 'Check' };
        this.log(`${p.name} checks`);
        break;
      case 'call':
        if (!legal.canCall) throw new HandError('There is nothing to call');
        this.commit(p, legal.callAmount);
        p.lastAction = { label: p.allIn ? 'All-in' : 'Call', amount: p.committed };
        this.log(`${p.name} calls ${fmt(legal.callAmount)}${p.allIn ? ' and is all-in' : ''}`);
        break;
      case 'bet':
      case 'raise': {
        if (!legal.canRaise) throw new HandError('You cannot raise here');
        const to = Math.floor(Number(amount));
        if (!Number.isFinite(to) || to < legal.minRaiseTo || to > legal.maxRaiseTo) {
          throw new HandError(`${legal.isBet ? 'Bet' : 'Raise'} must be between ${fmt(legal.minRaiseTo)} and ${fmt(legal.maxRaiseTo)}`);
        }
        const increment = to - this.currentBet;
        this.commit(p, to - p.committed);
        if (increment >= this.minRaise) this.minRaise = increment; // a full raise sets the new minimum
        this.currentBet = to;
        this.aggressor = seat;
        p.lastAction = { label: p.allIn ? 'All-in' : legal.isBet ? 'Bet' : 'Raise', amount: to };
        this.log(`${p.name} ${legal.isBet ? 'bets' : `raises ${fmt(increment)} to`} ${fmt(to)}${p.allIn ? ' and is all-in' : ''}`);
        break;
      }
      default:
        throw new HandError(`Unknown action: ${type}`);
    }

    p.hasActed = true;
    p.actedAt = this.currentBet;
    this.advanceTurn();
  }

  commit(p, amount) {
    p.stack -= amount;
    p.committed += amount;
    p.total += amount;
    if (p.stack === 0) p.allIn = true;
  }

  advanceTurn() {
    if (this.livePlayers().length === 1) return this.finishUncontested();
    const next = this.seatsAfter(this.toAct).find((p) => this.needsToAct(p));
    if (next) {
      this.toAct = next.seat;
      this.phase = 'betting';
      return;
    }
    this.endBettingRound();
  }

  endBettingRound() {
    this.returnUncalled();
    this.toAct = -1;
    const live = this.livePlayers();
    if (live.filter((p) => !p.allIn).length <= 1 && !this.cardsExposed) {
      this.cardsExposed = true;
      this.log(`All-in — ${live.map((p) => `${p.name} shows ${showCards(p.cards)}`).join(', ')}`);
    }
    this.phase = 'roundComplete';
  }

  /** The part of the biggest bet nobody matched goes back to the bettor. */
  returnUncalled() {
    const [top, second] = [...this.players.values()].sort((a, b) => b.committed - a.committed);
    const excess = top.committed - (second ? second.committed : 0);
    if (excess <= 0) return;
    top.committed -= excess;
    top.total -= excess;
    top.stack += excess;
    top.allIn = false;
    this.log(`Uncalled bet (${fmt(excess)}) returned to ${top.name}`);
  }

  /** Deal the next street, or go to showdown after the river. */
  advance() {
    if (this.phase !== 'roundComplete') throw new HandError('Betting round is still open');
    if (this.street === 'river') return this.showdown();

    for (const p of this.players.values()) {
      p.committed = 0;
      p.hasActed = false;
      p.actedAt = 0;
      if (!p.folded && !p.allIn) p.lastAction = null;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.aggressor = -1;

    this.deck.burn();
    const count = this.street === 'preflop' ? 3 : 1;
    for (let i = 0; i < count; i++) this.board.push(this.deck.draw());
    this.street = NEXT_STREET[this.street];
    this.log(`*** ${this.street.toUpperCase()} *** ${showCards(this.board)}`);

    if (this.livePlayers().filter((p) => !p.allIn).length >= 2) {
      this.phase = 'betting';
      this.toAct = this.button; // first live player left of the button acts first
      this.advanceTurn();
    } else {
      this.phase = 'roundComplete'; // all-in run-out, no betting
    }
  }

  // ── endings ────────────────────────────────────────────────────────

  finishUncontested() {
    this.returnUncalled();
    const [winner] = this.livePlayers();
    const amount = this.totalPot();
    winner.stack += amount;
    this.log(`${winner.name} wins ${fmt(amount)} (no showdown)`);
    this.results = {
      showdown: false,
      pots: [{ amount, winners: [{ seat: winner.seat, amount }], handName: null }],
      winners: [{ seat: winner.seat, amount }],
      shown: {},
    };
    this.toAct = -1;
    this.phase = 'complete';
  }

  showdown() {
    this.street = 'showdown';
    const live = this.livePlayers();
    const scores = new Map(live.map((p) => [p.seat, evaluate([...p.cards, ...this.board])]));
    const pots = splitPots([...this.players.values()].map((p) => ({ seat: p.seat, amount: p.total, live: !p.folded })));

    // Odd chips go to the winner closest to the left of the button.
    const clockwise = this.seatsAfter(this.button).map((p) => p.seat);
    const winnings = new Map();
    const potResults = pots.map((pot, i) => {
      const best = Math.max(...pot.eligible.map((s) => scores.get(s)));
      const winners = clockwise.filter((s) => pot.eligible.includes(s) && scores.get(s) === best);
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      const paid = winners.map((seat) => {
        const amount = share + (odd-- > 0 ? 1 : 0);
        winnings.set(seat, (winnings.get(seat) ?? 0) + amount);
        return { seat, amount };
      });
      return { amount: pot.amount, winners: paid, handName: describe(best), label: i === 0 ? 'main pot' : `side pot ${i}` };
    });

    // Showing order: last aggressor on the river, otherwise first live player left of the button.
    // With anyone all-in every hand is tabled; otherwise a player shows when they're first,
    // win something, or beat what's shown so far, and mucks otherwise.
    const firstSeat = this.aggressor >= 0 && !this.players.get(this.aggressor).folded
      ? this.aggressor
      : clockwise.find((s) => !this.players.get(s).folded);
    const order = [firstSeat, ...this.seatsAfter(firstSeat).map((p) => p.seat).filter((s) => s !== firstSeat)]
      .filter((s) => !this.players.get(s).folded);
    const exposeAll = this.cardsExposed || live.some((p) => p.allIn);
    const shown = {};
    let bestShown = -1;
    for (const seat of order) {
      const p = this.players.get(seat);
      const sc = scores.get(seat);
      if (exposeAll || seat === firstSeat || winnings.has(seat) || sc >= bestShown) {
        bestShown = Math.max(bestShown, sc);
        const all = [...p.cards, ...this.board];
        shown[seat] = {
          cards: p.cards.map(cardToString),
          handName: describe(sc),
          best: bestFive(all).map(cardToString),
        };
        this.log(`${p.name} shows ${showCards(p.cards)} (${describe(sc)})`);
      } else {
        this.log(`${p.name} mucks`);
      }
    }

    for (const pot of potResults) {
      for (const w of pot.winners) {
        this.log(`${this.players.get(w.seat).name} wins ${fmt(w.amount)} from the ${pot.label} with ${pot.handName}`);
      }
    }
    for (const [seat, amount] of winnings) this.players.get(seat).stack += amount;

    this.results = {
      showdown: true,
      pots: potResults,
      winners: [...winnings].map(([seat, amount]) => ({ seat, amount })),
      shown,
    };
    this.toAct = -1;
    this.phase = 'complete';
  }

  log(text) {
    this.history.push(text);
  }
}
