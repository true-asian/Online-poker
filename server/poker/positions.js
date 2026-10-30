import { randomInt } from 'node:crypto';

/** First seat clockwise after `from` (wrapping, `from` itself checked last) that matches `pred`, or -1. */
export function nextSeat(from, numSeats, pred) {
  for (let i = 1; i <= numSeats; i++) {
    const seat = (((from + i) % numSeats) + numSeats) % numSeats;
    if (pred(seat)) return seat;
  }
  return -1;
}

/** True when `seat` lies strictly between `a` and `b` going clockwise. */
export function isBetween(a, seat, b, numSeats) {
  const dist = (x) => (((x - a) % numSeats) + numSeats) % numSeats;
  return dist(seat) > 0 && dist(seat) < dist(b);
}

/**
 * Decide who is dealt into the next hand and where the button and blinds go.
 *
 * Online cash-game rules ("moving button"):
 *  - The button moves to the next player who played last orbit; the small blind is the next one after it.
 *  - The big blind goes to the next seated player after the small blind. A new or returning player
 *    who is waiting for the big blind is dealt in when it reaches them.
 *  - A waiting player may instead post a live big blind to play immediately, except from the seats
 *    between the button and the small blind.
 *  - Heads-up, the button posts the small blind and the other player the big blind.
 *  - When fewer than two players are already playing (a new game), everyone is dealt in.
 *
 * @param {Array<null | {waiting:boolean, postNow:boolean}>} seats  players ready to play (null = empty / sitting out)
 * @param {number} prevButton  last hand's button seat, or -1 for a new game
 * @returns {null | {button:number, sb:number, bb:number, dealtIn:number[], posters:number[], activated:number[]}}
 */
export function planHand(seats, prevButton, pick = (arr) => arr[randomInt(arr.length)]) {
  const n = seats.length;
  const ready = new Set();
  const active = new Set();
  seats.forEach((s, i) => {
    if (!s) return;
    ready.add(i);
    if (!s.waiting) active.add(i);
  });
  if (ready.size < 2) return null;

  const activated = [];
  if (active.size < 2) {
    for (const i of ready) if (!active.has(i)) { active.add(i); activated.push(i); }
  }

  const button = prevButton >= 0 ? nextSeat(prevButton, n, (i) => active.has(i)) : pick([...active]);
  const sb = nextSeat(button, n, (i) => active.has(i));
  const bb = nextSeat(sb, n, (i) => ready.has(i));

  if (bb === button) {
    // Heads-up: nobody waiting claims the big blind, so the button is the small blind.
    return { button, sb: button, bb: sb, dealtIn: [button, sb].sort((a, b) => a - b), posters: [], activated };
  }

  const dealtIn = new Set(active);
  if (!active.has(bb)) { dealtIn.add(bb); activated.push(bb); }

  const posters = [];
  for (const i of ready) {
    if (dealtIn.has(i) || !seats[i].postNow) continue;
    if (isBetween(button, i, sb, n)) continue; // can't buy in between the button and the blinds
    dealtIn.add(i);
    activated.push(i);
    posters.push(i);
  }

  return { button, sb, bb, dealtIn: [...dealtIn].sort((a, b) => a - b), posters, activated };
}
