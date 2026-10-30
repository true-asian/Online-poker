import { rankOf, suitOf } from './cards.js';
import { evaluate } from './evaluator.js';

const BOT_NAMES = [
  'Ace Ventura', 'River Rat', 'Nit Wit', 'Lucky Lou', 'Calling Station', 'Big Slick', 'Pocket Rockets',
  'The Grinder', 'Fish & Chips', 'Donk Quixote', 'Tilt Master', 'Check Raiser', 'Full Housewife',
  'Cowboy Kenny', 'Dame Diamond', 'Captain Bluff', 'Sir Folds-a-Lot', 'Short Stack Sam', 'Nuts Ned',
  'Gutshot Gary', 'Flush Gordon', 'Steady Eddie', 'Maverick', 'Queen Bee', 'Snap Caller', 'Rounder Rita',
  'Card Shark', 'Jack Pot', 'Kicker Kim', 'Royal Ray',
];

export function pickBotName(taken) {
  const free = BOT_NAMES.filter((n) => !taken.has(n));
  return free.length ? free[Math.floor(Math.random() * free.length)] : `Bot ${Math.floor(Math.random() * 1000)}`;
}

/** Each bot gets a personality so tables don't feel like eight copies of one player. */
export function createBotProfile(rand = Math.random) {
  return {
    tightness: -1.5 + rand() * 3, // shifts hand-strength thresholds; negative = looser
    aggression: 0.25 + rand() * 0.55, // chance of betting/raising instead of checking/calling
    bluff: 0.03 + rand() * 0.1,
    passive: rand() * 0.5, // chance of limping/flatting instead of folding marginal hands
  };
}

/** Chen formula: quick preflop hand strength, roughly -1 (72o) to 20 (AA). */
export function chenScore([a, b]) {
  const VALUES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10];
  const hi = Math.max(rankOf(a), rankOf(b));
  const lo = Math.min(rankOf(a), rankOf(b));
  if (hi === lo) return Math.max(VALUES[hi] * 2, 5);
  let s = VALUES[hi];
  if (suitOf(a) === suitOf(b)) s += 2;
  const gap = hi - lo - 1;
  s -= [0, 1, 2, 4][Math.min(gap, 3)] + (gap >= 4 ? 1 : 0);
  if (gap <= 1 && hi < 10) s += 1; // connected cards below a queen can make more straights
  return s;
}

/** Monte Carlo equity of `hole` against `opponents` random hands. */
export function estimateEquity(hole, board, opponents, iterations = 300, rand = Math.random) {
  const known = new Set([...hole, ...board]);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) deck.push(c);
  const need = opponents * 2 + (5 - board.length);
  let total = 0;

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rand() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const runout = deck.slice(opponents * 2, need);
    const fullBoard = [...board, ...runout];
    const mine = evaluate([...hole, ...fullBoard]);
    let best = 0;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      const theirs = evaluate([deck[o * 2], deck[o * 2 + 1], ...fullBoard]);
      if (theirs > best) { best = theirs; ties = 0; }
      if (theirs === best) ties++;
    }
    if (mine > best) total += 1;
    else if (mine === best) total += 1 / (ties + 1);
  }
  return total / iterations;
}

/**
 * Pick an action for a bot.
 * @param {object} v  what the bot can see: hole, board, street, pot (incl. bets in front), legal actions,
 *                    bigBlind, opponents (live), position ('early'|'middle'|'late'|'blinds')
 */
export function decideBot(v, profile, rand = Math.random) {
  const { legal } = v;
  const toCall = legal.callAmount;
  const passiveAction = () => (legal.canCheck ? { type: 'check' } : { type: 'fold' });
  const call = () => (legal.canCall ? { type: 'call' } : { type: 'check' });
  const raiseTo = (target) => {
    if (!legal.canRaise) return call();
    let to = Math.round(target / v.bigBlind) * v.bigBlind;
    to = Math.min(Math.max(to, legal.minRaiseTo), legal.maxRaiseTo);
    if (to >= legal.maxRaiseTo * 0.7) to = legal.maxRaiseTo; // that much in means commit the rest
    return { type: 'raise', amount: to };
  };
  const potRaise = (fraction) => raiseTo(legal.currentBet + fraction * (v.pot + toCall));

  if (v.street === 'preflop') {
    const strength = chenScore(v.hole) - profile.tightness;
    const bbs = (legal.stack + legal.committed) / v.bigBlind;
    const facingBBs = legal.currentBet / v.bigBlind;
    const positionBonus = { early: 0, middle: 1, late: 2.5, blinds: 1 }[v.position] ?? 0;

    if (bbs <= 12) {
      // Short stack: push or fold.
      if (strength >= 9 - positionBonus * 0.5 - (facingBBs <= 1 ? 1 : 0)) return { type: 'allin' };
      return passiveAction();
    }

    if (facingBBs <= 1) {
      // Unopened pot (possibly limped).
      if (strength + positionBonus >= 9 || (rand() < profile.bluff && strength >= 4)) {
        const limpers = Math.max(0, Math.round((v.pot - 1.5 * v.bigBlind) / v.bigBlind));
        return raiseTo((2.5 + rand() + limpers) * v.bigBlind);
      }
      if (legal.canCheck) return { type: 'check' };
      if (strength + positionBonus >= 7 && rand() < profile.passive) return call();
      return { type: 'fold' };
    }

    // Facing a raise.
    const bigShove = toCall > legal.stack * 0.4;
    if (facingBBs >= 20 || bigShove) {
      if (strength >= 14) return { type: 'allin' };
      if (strength >= 12 && toCall < legal.stack * 0.5) return call();
      return passiveAction();
    }
    if (strength >= 12 || (rand() < profile.bluff * 0.5 && strength >= 7)) return raiseTo(legal.currentBet * (2.8 + rand() * 0.6));
    const callBar = 8.5 - positionBonus * 0.4 + (facingBBs > 5 ? 1.5 : 0);
    if (strength >= callBar || (strength >= callBar - 2 && rand() < profile.passive)) return call();
    return passiveAction();
  }

  // Postflop: equity against random hands, discounted a little when facing big bets.
  const opponents = Math.max(1, Math.min(v.opponents, 5));
  const equity = estimateEquity(v.hole, v.board, opponents, 250, rand);
  const betSize = 0.45 + rand() * 0.35;

  if (legal.canCheck) {
    if (equity > 0.72) return rand() < 0.15 ? { type: 'check' } : potRaise(betSize + 0.15);
    if (equity > 0.52 && rand() < profile.aggression) return potRaise(betSize);
    if (rand() < profile.bluff && v.street !== 'river') return potRaise(0.5);
    return { type: 'check' };
  }

  const potOdds = toCall / (v.pot + toCall);
  const adjusted = equity - (toCall > v.pot * 0.6 ? 0.08 : 0) - (toCall > legal.stack * 0.5 ? 0.05 : 0);
  if (adjusted > 0.8 && rand() < 0.5 + profile.aggression * 0.5) return potRaise(0.8 + rand() * 0.4);
  if (adjusted > potOdds + 0.04) return call();
  if (rand() < profile.bluff * 0.3 && v.street !== 'river') return potRaise(0.9);
  return { type: 'fold' };
}
