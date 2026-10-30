import test from 'node:test';
import assert from 'node:assert/strict';
import { planHand, isBetween } from '../server/poker/positions.js';

const P = { waiting: false, postNow: false };
const W = { waiting: true, postNow: false };
const POST = { waiting: true, postNow: true };
const first = (arr) => arr[0];

test('isBetween works clockwise with wrap-around', () => {
  assert.equal(isBetween(7, 8, 1, 9), true);
  assert.equal(isBetween(7, 0, 1, 9), true);
  assert.equal(isBetween(7, 1, 1, 9), false);
  assert.equal(isBetween(1, 5, 3, 9), false);
});

test('button and blinds move one seat clockwise each hand', () => {
  const seats = [P, P, null, P, P, null];
  const a = planHand(seats, 0);
  assert.deepEqual([a.button, a.sb, a.bb], [1, 3, 4]);
  const b = planHand(seats, a.button);
  assert.deepEqual([b.button, b.sb, b.bb], [3, 4, 0]);
  assert.deepEqual(b.dealtIn, [0, 1, 3, 4]);
});

test('heads-up: button is the small blind', () => {
  const plan = planHand([P, null, null, P, null, null], 0);
  assert.deepEqual([plan.button, plan.sb, plan.bb], [3, 3, 0]);
});

test('a new game deals everyone in, even players marked as waiting', () => {
  const plan = planHand([W, W, W, null, null, null], -1, first);
  assert.deepEqual(plan.dealtIn, [0, 1, 2]);
  assert.deepEqual(plan.activated.sort(), [0, 1, 2]);
});

test('a new player waits until the big blind reaches them', () => {
  // Seats 0,1,2,3 playing; newcomer at 5. Button moves 0 -> 1, SB 2, BB 3: newcomer sits out.
  let plan = planHand([P, P, P, P, null, W], 0);
  assert.deepEqual([plan.button, plan.sb, plan.bb], [1, 2, 3]);
  assert.equal(plan.dealtIn.includes(5), false);
  // Next hand: button 2, SB 3, and the big blind lands on the newcomer.
  plan = planHand([P, P, P, P, null, W], 1);
  assert.deepEqual([plan.button, plan.sb, plan.bb], [2, 3, 5]);
  assert.deepEqual(plan.activated, [5]);
  assert.equal(plan.dealtIn.includes(5), true);
});

test('a waiting player may post to play now, but not between the button and the small blind', () => {
  // Button moves to 1, SB 3, BB 4. Seat 2 sits between button and SB; seat 6 is after the BB.
  const seats = [P, P, POST, P, P, null, POST];
  const plan = planHand(seats, 0);
  assert.deepEqual([plan.button, plan.sb, plan.bb], [1, 3, 4]);
  assert.deepEqual(plan.posters, [6]);
  assert.equal(plan.dealtIn.includes(2), false);
});

test('heads-up with a newcomer between the players: newcomer waits a hand then takes the big blind', () => {
  // Players at 0 and 4, newcomer at 2 (between them going clockwise from 0).
  let plan = planHand([P, null, W, null, P, null], 4);
  assert.deepEqual([plan.button, plan.sb, plan.bb], [0, 0, 4]);
  assert.deepEqual(plan.dealtIn, [0, 4]);
  plan = planHand([P, null, W, null, P, null], 0);
  assert.deepEqual([plan.button, plan.sb, plan.bb], [4, 0, 2]);
  assert.deepEqual(plan.dealtIn, [0, 2, 4]);
});

test('needs two ready players', () => {
  assert.equal(planHand([P, null, null], -1), null);
});
