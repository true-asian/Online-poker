import test from 'node:test';
import assert from 'node:assert/strict';
import { Hand } from '../server/poker/hand.js';
import { planHand } from '../server/poker/positions.js';
import { decideBot, createBotProfile } from '../server/poker/bot.js';

function seeded(seed) {
  return () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

/** Random legal action, biased toward all-ins and min-raises to hit edge cases. */
function randomAction(legal, rand) {
  const r = rand();
  if (r < 0.15) return { type: 'fold' };
  if (r < 0.3 && legal.canRaise) return { type: 'allin' };
  if (r < 0.45 && legal.canRaise) return { type: 'raise', amount: legal.minRaiseTo };
  if (r < 0.55 && legal.canRaise) {
    const span = legal.maxRaiseTo - legal.minRaiseTo;
    return { type: 'raise', amount: legal.minRaiseTo + Math.floor(rand() * (span + 1)) };
  }
  return legal.canCheck ? { type: 'check' } : { type: 'call' };
}

function playSession({ numSeats, hands, rand, chooser }) {
  const bb = 100;
  let stacks = Array.from({ length: numSeats }, () => (rand() < 0.3 ? 1 + Math.floor(rand() * 300) : 500 + Math.floor(rand() * 15000)));
  const start = stacks.reduce((a, b) => a + b, 0);
  let button = -1;
  let played = 0;

  for (let n = 0; played < hands; n++) {
    const plan = planHand(stacks.map((s) => (s > 0 ? { waiting: false, postNow: false } : null)), button, (a) => a[0]);
    if (!plan) {
      // Re-buy busted players so the session keeps going; conservation is checked per hand.
      stacks = stacks.map((s) => (s > 0 ? s : 1 + Math.floor(rand() * 5000)));
      continue;
    }
    button = plan.button;
    const players = plan.dealtIn.map((seat) => ({ seat, id: `p${seat}`, name: `P${seat}`, stack: stacks[seat] }));
    const before = players.reduce((s, p) => s + p.stack, 0);
    const hand = new Hand({ players, numSeats, buttonSeat: plan.button, sbSeat: plan.sb, bbSeat: plan.bb, smallBlind: bb / 2, bigBlind: bb, number: n });
    hand.start();

    let steps = 0;
    while (hand.phase !== 'complete') {
      assert.ok(++steps < 500, 'hand did not terminate');
      if (hand.phase === 'roundComplete') {
        hand.advance();
        continue;
      }
      const legal = hand.legalActions();
      const p = hand.players.get(hand.toAct);
      assert.ok(!p.folded && !p.allIn, 'folded or all-in player asked to act');
      const a = chooser(hand, legal, rand);
      hand.act(hand.toAct, a.type, a.amount);
      if (hand.phase !== 'complete') {
        const inPlay = [...hand.players.values()].reduce((s, q) => s + q.stack + q.total, 0);
        assert.equal(inPlay, before, 'chips created or destroyed mid-hand');
      }
    }

    const after = [...hand.players.values()].reduce((s, p) => s + p.stack, 0);
    assert.equal(after, before, `hand ${n}: chips not conserved`);
    const won = hand.results.winners.reduce((s, w) => s + w.amount, 0);
    assert.equal(won, hand.totalPot(), 'pot not fully awarded');
    for (const p of hand.players.values()) {
      assert.ok(p.stack >= 0 && Number.isInteger(p.stack));
      stacks[p.seat] = p.stack;
    }
    if (hand.results.showdown) assert.equal(hand.board.length, 5);
    played++;
  }
  return { played, start };
}

test('10,000 random hands: chips conserved, every hand terminates', () => {
  const rand = seeded(42);
  let total = 0;
  for (const numSeats of [2, 6, 9]) {
    total += playSession({ numSeats, hands: numSeats === 2 ? 2000 : 4000, rand, chooser: (h, legal, r) => randomAction(legal, r) }).played;
  }
  assert.equal(total, 10000);
});

test('bots only ever choose legal actions', () => {
  const rand = seeded(9);
  const profiles = Array.from({ length: 9 }, () => createBotProfile(rand));
  playSession({
    numSeats: 9,
    hands: 300,
    rand,
    chooser: (hand, legal, r) => {
      const p = hand.players.get(hand.toAct);
      const decision = decideBot({
        hole: p.cards,
        board: hand.board,
        street: hand.street,
        pot: hand.totalPot(),
        legal,
        bigBlind: hand.bigBlind,
        opponents: hand.livePlayers().length - 1,
        position: 'middle',
      }, profiles[p.seat], r);
      return decision;
    },
  });
});
