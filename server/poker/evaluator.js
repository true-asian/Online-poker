import { rankOf, suitOf } from './cards.js';

// Hand categories, weakest to strongest.
export const CATEGORIES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

const SINGULAR = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const PLURAL = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

// Scores pack the category and up to five tie-break ranks into one integer (4 bits each),
// so comparing two hands is a plain numeric comparison.
function score(category, r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0) {
  return (((((category * 16 + r0) * 16 + r1) * 16 + r2) * 16 + r3) * 16) + r4;
}

/** Highest rank of a 5-card straight inside a 13-bit rank mask, or -1. Handles the A-2-3-4-5 wheel. */
function straightHigh(mask) {
  const m = (mask << 1) | ((mask >> 12) & 1); // bit 0 is the ace playing low
  for (let hi = 13; hi >= 4; hi--) {
    if (((m >> (hi - 4)) & 0x1f) === 0x1f) return hi - 1;
  }
  return -1;
}

/** Top `count` ranks set in a rank mask, highest first. */
function topRanks(mask, count) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < count; r--) if (mask & (1 << r)) out.push(r);
  return out;
}

const counts = new Uint8Array(13);
const suitMasks = new Uint16Array(4);
const suitCounts = new Uint8Array(4);

/**
 * Score the best five-card poker hand that can be made from 5–7 cards.
 * Higher is better; equal scores are exact ties.
 */
export function evaluate(cards) {
  counts.fill(0);
  suitMasks.fill(0);
  suitCounts.fill(0);
  let rankMask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    counts[r]++;
    suitMasks[s] |= 1 << r;
    suitCounts[s]++;
    rankMask |= 1 << r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sf = straightHigh(suitMasks[flushSuit]);
    if (sf >= 0) return score(8, sf);
  }

  let quad = -1;
  const trips = [];
  const pairs = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) quad = r;
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }

  if (quad >= 0) {
    const [kicker] = topRanks(rankMask & ~(1 << quad), 1);
    return score(7, quad, kicker);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const pairRank = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return score(6, trips[0], pairRank);
  }
  if (flushSuit >= 0) return score(5, ...topRanks(suitMasks[flushSuit], 5));

  const st = straightHigh(rankMask);
  if (st >= 0) return score(4, st);

  if (trips.length) return score(3, trips[0], ...topRanks(rankMask & ~(1 << trips[0]), 2));
  if (pairs.length >= 2) {
    const [hi, lo] = pairs;
    const [kicker] = topRanks(rankMask & ~(1 << hi) & ~(1 << lo), 1);
    return score(2, hi, lo, kicker);
  }
  if (pairs.length) return score(1, pairs[0], ...topRanks(rankMask & ~(1 << pairs[0]), 3));
  return score(0, ...topRanks(rankMask, 5));
}

export function categoryOf(handScore) {
  return Math.floor(handScore / 16 ** 5);
}

function ranksOf(handScore) {
  const out = [];
  for (let i = 4; i >= 0; i--) out.push(Math.floor(handScore / 16 ** i) % 16);
  return out;
}

/** Human-readable hand name, e.g. "Full House, Kings full of Sevens". */
export function describe(handScore) {
  const cat = categoryOf(handScore);
  const [a, b] = ranksOf(handScore);
  switch (cat) {
    case 8: return a === 12 ? 'Royal Flush' : `Straight Flush, ${SINGULAR[a]} high`;
    case 7: return `Four of a Kind, ${PLURAL[a]}`;
    case 6: return `Full House, ${PLURAL[a]} full of ${PLURAL[b]}`;
    case 5: return `Flush, ${SINGULAR[a]} high`;
    case 4: return `Straight, ${SINGULAR[a]} high`;
    case 3: return `Three of a Kind, ${PLURAL[a]}`;
    case 2: return `Two Pair, ${PLURAL[a]} and ${PLURAL[b]}`;
    case 1: return `Pair of ${PLURAL[a]}`;
    default: return `High Card, ${SINGULAR[a]}`;
  }
}

/** The five cards (out of 5–7) that make the best hand. Used for highlighting at showdown. */
export function bestFive(cards) {
  const target = evaluate(cards);
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            if (evaluate(five) === target) return five;
          }
  return cards.slice(0, 5);
}
