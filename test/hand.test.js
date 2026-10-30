import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHand, runOut, stacks } from './helpers.js';

const total = (h) => [...h.players.values()].reduce((s, p) => s + p.stack + p.total, 0);

test('heads-up: button posts the small blind, acts first preflop and last after the flop', () => {
  const h = makeHand({ players: { 0: 10000, 1: 10000 }, numSeats: 6, button: 0, sb: 0, bb: 1 });
  assert.equal(h.players.get(0).committed, 50);
  assert.equal(h.players.get(1).committed, 100);
  assert.equal(h.toAct, 0, 'button/SB acts first preflop');
  h.act(0, 'call');
  assert.equal(h.toAct, 1, 'big blind gets the option');
  h.act(1, 'check');
  assert.equal(h.phase, 'roundComplete');
  h.advance();
  assert.equal(h.street, 'flop');
  assert.equal(h.toAct, 1, 'big blind acts first after the flop');
});

test('everyone folds to the big blind: blind wins, no showdown', () => {
  const h = makeHand({ players: { 0: 5000, 1: 5000, 2: 5000 }, button: 0, sb: 1, bb: 2 });
  assert.equal(h.toAct, 0, 'first to act is left of the big blind (the button, 3-handed)');
  h.act(0, 'fold');
  h.act(1, 'fold');
  assert.equal(h.phase, 'complete');
  assert.equal(h.results.showdown, false);
  assert.deepEqual(stacks(h), { 0: 5000, 1: 4950, 2: 5050 });
});

test('big blind has the option to raise when the pot is limped', () => {
  const h = makeHand({ players: { 0: 5000, 1: 5000, 2: 5000 }, button: 0, sb: 1, bb: 2 });
  h.act(0, 'call');
  h.act(1, 'call');
  assert.equal(h.toAct, 2);
  const legal = h.legalActions();
  assert.equal(legal.canCheck, true);
  assert.equal(legal.canRaise, true);
  assert.equal(legal.minRaiseTo, 200);
});

test('minimum raise is the size of the last full raise', () => {
  const h = makeHand({ players: { 0: 10000, 1: 10000, 2: 10000, 3: 10000 }, button: 0, sb: 1, bb: 2 });
  h.act(3, 'raise', 300); // raise of 200
  assert.equal(h.legalActions().minRaiseTo, 500);
  assert.throws(() => h.act(0, 'raise', 450), /between 500/);
  h.act(0, 'raise', 900); // raise of 600
  assert.equal(h.legalActions().minRaiseTo, 1500);
});

test('a short all-in does not re-open the betting to players who already acted', () => {
  const h = makeHand({ players: { 0: 10000, 1: 10000, 2: 10000, 3: 450 }, button: 0, sb: 1, bb: 2 });
  h.act(3, 'call'); // UTG limps 100
  h.act(0, 'raise', 300); // button raises to 300 (full raise of 200)
  h.act(1, 'fold');
  h.act(2, 'call'); // BB calls 300
  assert.equal(h.toAct, 3);
  h.act(3, 'allin'); // UTG shoves 450: a raise of only 150
  assert.equal(h.currentBet, 450);
  assert.equal(h.toAct, 0);
  let legal = h.legalActions();
  assert.equal(legal.canCall, true);
  assert.equal(legal.canRaise, false, 'button already acted and faces less than a full raise');
  h.act(0, 'call');
  legal = h.legalActions();
  assert.equal(h.toAct, 2);
  assert.equal(legal.canRaise, false, 'BB already acted too');
});

test('a player who has not acted may raise over a short all-in, by at least the last full raise', () => {
  const h = makeHand({ players: { 0: 10000, 1: 10000, 2: 10000, 3: 10000, 4: 450 }, button: 0, sb: 1, bb: 2 });
  h.act(3, 'raise', 300);
  h.act(4, 'allin'); // 450, short
  assert.equal(h.toAct, 0);
  const legal = h.legalActions();
  assert.equal(legal.canRaise, true);
  assert.equal(legal.minRaiseTo, 650, '450 + the last full raise of 200');
});

test('several short all-ins that add up to a full raise do re-open the betting', () => {
  const h = makeHand({ players: { 0: 10000, 1: 10000, 2: 10000, 3: 10000, 4: 450, 5: 520 }, button: 0, sb: 1, bb: 2 });
  h.act(3, 'raise', 300);
  h.act(4, 'allin'); // 450
  h.act(5, 'allin'); // 520
  h.act(0, 'fold');
  h.act(1, 'fold');
  h.act(2, 'call');
  assert.equal(h.toAct, 3);
  assert.equal(h.legalActions().canRaise, true, 'raised 220 since acting, more than the 200 full raise');
});

test('a big blind all-in for less still plays as a full big blind', () => {
  const h = makeHand({ players: { 0: 10000, 1: 10000, 2: 60 }, button: 0, sb: 1, bb: 2 });
  assert.equal(h.players.get(2).allIn, true);
  assert.equal(h.currentBet, 100);
  assert.equal(h.legalActions(0).callAmount, 100);
});

test('uncalled part of a bet is returned', () => {
  const h = makeHand({ players: { 0: 10000, 1: 2000, 2: 10000 }, button: 0, sb: 1, bb: 2 });
  h.act(0, 'allin'); // 10,000
  h.act(1, 'allin'); // 2,000 call all-in
  h.act(2, 'fold');
  assert.equal(h.phase, 'roundComplete');
  assert.equal(h.players.get(0).total, 2000, 'only 2,000 of the shove was called');
  assert.equal(h.players.get(0).stack, 8000);
  assert.equal(h.cardsExposed, true);
});

test('side pots: short stack can only win what they matched', () => {
  const h = makeHand({
    players: { 0: 10000, 1: 1000, 2: 10000 },
    button: 0, sb: 1, bb: 2,
    hole: { 0: 'Kc Kd', 1: 'Ac Ad', 2: 'Qc Qd' },
    board: '2h 7s 9c 3d 4h',
  });
  const before = total(h);
  h.act(0, 'raise', 3000);
  h.act(1, 'allin'); // 1,000 total
  h.act(2, 'call'); // 3,000
  runOut(h);
  // Flop: KK and QQ still have chips behind, so they keep betting.
  assert.equal(h.phase, 'betting');
  h.act(2, 'check');
  h.act(0, 'check');
  runOut(h);
  h.act(2, 'check');
  h.act(0, 'check');
  runOut(h);
  h.act(2, 'check');
  h.act(0, 'check');
  runOut(h);
  assert.equal(h.phase, 'complete');
  // Main pot 3,000 (1,000 x3) to AA; side pot 4,000 (2,000 x2) to KK.
  assert.deepEqual(h.results.pots.map((p) => p.amount), [3000, 4000]);
  assert.deepEqual(h.results.pots[0].winners, [{ seat: 1, amount: 3000 }]);
  assert.deepEqual(h.results.pots[1].winners, [{ seat: 0, amount: 4000 }]);
  assert.deepEqual(stacks(h), { 0: 11000, 1: 3000, 2: 7000 });
  assert.equal(Object.values(stacks(h)).reduce((a, b) => a + b, 0), before);
  // Someone was all-in, so every hand is tabled at showdown.
  assert.ok(h.results.shown[2]);
});

test('split pot: odd chip goes to the first winner left of the button', () => {
  const h = makeHand({
    players: { 0: 10000, 1: 10000, 2: 10000 },
    button: 0, sb: 1, bb: 2, blinds: [25, 50],
    hole: { 0: '2c 3d', 1: '4c 5d', 2: '6c 7d' },
    board: 'As Ks Qd Jc Th', // Broadway on board: everyone plays it
  });
  h.act(0, 'call');
  h.act(1, 'fold'); // dead 25 from the small blind makes the pot odd
  h.act(2, 'check');
  for (let street = 0; street < 3; street++) {
    runOut(h);
    h.act(2, 'check');
    h.act(0, 'check');
  }
  runOut(h);
  assert.equal(h.phase, 'complete');
  const [pot] = h.results.pots;
  assert.equal(pot.amount, 125);
  assert.deepEqual(pot.winners, [{ seat: 2, amount: 63 }, { seat: 0, amount: 62 }]);
});

test('engine refuses out-of-turn and illegal actions', () => {
  const h = makeHand({ players: { 0: 10000, 1: 10000, 2: 10000 }, button: 0, sb: 1, bb: 2 });
  assert.throws(() => h.act(1, 'fold'), /not your turn/);
  assert.throws(() => h.act(0, 'check'), /cannot check/);
  assert.throws(() => h.act(0, 'raise', 150), /between 200/);
  assert.throws(() => h.act(0, 'raise', 999999), /between/);
});

test('showdown order: last river aggressor shows first; a beaten hand mucks', () => {
  const h = makeHand({
    players: { 0: 10000, 1: 10000, 2: 10000 },
    button: 0, sb: 1, bb: 2,
    hole: { 0: 'Ac Ad', 1: '7c 2d', 2: 'Kc Kd' },
    board: '3h 8s 9c 4d Jh',
  });
  h.act(0, 'call');
  h.act(1, 'call');
  h.act(2, 'check');
  for (let i = 0; i < 2; i++) {
    runOut(h);
    h.act(1, 'check');
    h.act(2, 'check');
    h.act(0, 'check');
  }
  runOut(h);
  h.act(1, 'check');
  h.act(2, 'bet', 200); // KK bets the river
  h.act(0, 'call');
  h.act(1, 'call');
  runOut(h);
  assert.ok(h.results.shown[2], 'aggressor shows first');
  assert.ok(h.results.shown[0], 'winner shows');
  assert.equal(h.results.shown[1], undefined, '72 is beaten and mucks');
  assert.deepEqual(h.results.winners, [{ seat: 0, amount: 900 }]);
});

test('all-in preflop runs the board out with every hand exposed', () => {
  const h = makeHand({ players: { 0: 3000, 1: 3000 }, numSeats: 2, button: 0, sb: 0, bb: 1 });
  h.act(0, 'allin');
  h.act(1, 'call');
  assert.equal(h.cardsExposed, true);
  assert.equal(h.phase, 'roundComplete');
  runOut(h);
  assert.equal(h.board.length, 5);
  assert.equal(h.phase, 'complete');
  assert.equal(Object.keys(h.results.shown).length, 2);
  assert.equal(h.players.get(0).stack + h.players.get(1).stack, 6000);
});

test('a new player posting a live big blind has the option', () => {
  const h = makeHand({ players: { 0: 5000, 1: 5000, 2: 5000, 4: 5000 }, button: 0, sb: 1, bb: 2, posters: [4] });
  assert.equal(h.players.get(4).committed, 100);
  assert.equal(h.toAct, 4, 'poster acts in normal order after the big blind');
  assert.equal(h.legalActions().canCheck, true);
  h.act(4, 'check');
  h.act(0, 'call');
  h.act(1, 'call');
  assert.equal(h.toAct, 2);
  h.act(2, 'check');
  assert.equal(h.phase, 'roundComplete');
  assert.equal(h.totalPot(), 400);
});

test('cannot raise when every opponent is already all-in', () => {
  const h = makeHand({ players: { 0: 10000, 1: 500, 2: 10000 }, button: 0, sb: 1, bb: 2 });
  h.act(0, 'fold');
  h.act(1, 'allin');
  const legal = h.legalActions();
  assert.equal(h.toAct, 2);
  assert.equal(legal.canCall, true);
  assert.equal(legal.canRaise, false);
});
