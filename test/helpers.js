import { Deck, parseCards } from '../server/poker/cards.js';
import { Hand } from '../server/poker/hand.js';

/**
 * Build a deck that deals the given hole cards and board, accounting for deal order and burn cards.
 * @param {{button:number, numSeats:number, hole:Record<number,string>, board?:string}} o
 */
export function stackedDeck({ button, numSeats, hole, board = '' }) {
  const holeCards = Object.fromEntries(Object.entries(hole).map(([s, c]) => [s, parseCards(c)]));
  const boardCards = parseCards(board);
  const used = new Set([...Object.values(holeCards).flat(), ...boardCards]);
  const rest = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  const filler = () => rest.pop();

  const order = [];
  for (let i = 1; i <= numSeats; i++) {
    const s = (button + i) % numSeats;
    if (holeCards[s]) order.push(s);
  }
  const seq = [];
  for (let r = 0; r < 2; r++) for (const s of order) seq.push(holeCards[s][r]);
  const b = (i) => boardCards[i] ?? filler();
  seq.push(filler(), b(0), b(1), b(2), filler(), b(3), filler(), b(4));
  return new Deck([...seq, ...rest]);
}

/**
 * Convenience constructor: players is {seat: stack}, names are "P<seat>".
 */
export function makeHand({ players, numSeats = 9, button, sb, bb, posters = [], blinds = [50, 100], hole, board }) {
  const list = Object.entries(players).map(([seat, stack]) => ({ seat: Number(seat), id: `p${seat}`, name: `P${seat}`, stack }));
  const deck = hole ? stackedDeck({ button, numSeats, hole, board }) : undefined;
  const hand = new Hand({
    players: list, numSeats, buttonSeat: button, sbSeat: sb, bbSeat: bb, posters,
    smallBlind: blinds[0], bigBlind: blinds[1], deck,
  });
  hand.start();
  return hand;
}

/** Advance through any closed betting rounds until someone must act or the hand ends. */
export function runOut(hand) {
  while (hand.phase === 'roundComplete') hand.advance();
}

export function stacks(hand) {
  return Object.fromEntries([...hand.players.values()].map((p) => [p.seat, p.stack]));
}
