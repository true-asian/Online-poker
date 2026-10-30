import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, cardToString } from '../server/poker/cards.js';
import { evaluate, describe, categoryOf, bestFive } from '../server/poker/evaluator.js';

const ev = (s) => evaluate(parseCards(s));
const name = (s) => describe(ev(s));

test('names every category', () => {
  assert.equal(name('As Ks Qs Js Ts 2d 3c'), 'Royal Flush');
  assert.equal(name('9h 8h 7h 6h 5h Ad Ac'), 'Straight Flush, Nine high');
  assert.equal(name('Kd Kc Kh Ks 2d 3c 4h'), 'Four of a Kind, Kings');
  assert.equal(name('Kd Kc Kh 7s 7d 3c 4h'), 'Full House, Kings full of Sevens');
  assert.equal(name('Ad 9d 7d 4d 2d Kc Qh'), 'Flush, Ace high');
  assert.equal(name('Td 9c 8h 7s 6d 2c 2h'), 'Straight, Ten high');
  assert.equal(name('7d 7c 7h As Kd 3c 2h'), 'Three of a Kind, Sevens');
  assert.equal(name('Kd Kc 7h 7s 2d 3c 9h'), 'Two Pair, Kings and Sevens');
  assert.equal(name('Ad Ac 7h 5s 2d 3c 9h'), 'Pair of Aces');
  assert.equal(name('Ad Jc 7h 5s 2d 3c 9h'), 'High Card, Ace');
});

test('wheel is a five-high straight and loses to a six-high straight', () => {
  assert.equal(name('Ad 2c 3h 4s 5d Kc Kh'), 'Straight, Five high');
  assert.ok(ev('2c 3h 4s 5d 6c Kc Kh') > ev('Ad 2c 3h 4s 5d Kc Kh'));
  assert.equal(name('Ah 2h 3h 4h 5h Kc Kd'), 'Straight Flush, Five high');
});

test('kickers decide pairs, two pair and high card', () => {
  assert.ok(ev('Ad Ac Kh 5s 2d 3c 9h') > ev('Ad Ac Qh 5s 2d 3c 9h'));
  // Third pair can't play: the kicker is the best remaining card.
  assert.ok(ev('Kd Kc 7h 7s 4d 4c Ah') > ev('Kd Kc 7h 7s 4d 4c Qh'));
  assert.equal(ev('Kd Kc 7h 7s 4d 4c Ah'), ev('Kd Kc 7h 7s 2d 3c Ah'));
  assert.ok(ev('Ad Jc 9h 5s 3d') > ev('Ad Jc 9h 5s 2d'));
});

test('board plays: identical best five tie', () => {
  const board = 'As Ks Qd Jc Th';
  assert.equal(ev(`2c 3d ${board}`), ev(`4h 5h ${board}`));
});

test('two trips make a full house using the higher trips', () => {
  assert.equal(name('9d 9c 9h 4s 4d 4c Ah'), 'Full House, Nines full of Fours');
});

test('flush beats straight, full house beats flush', () => {
  const straight = ev('9c 8d 7h 6s 5c Ad Kd');
  const flush = ev('2d 8d 7d 6d Jd As Kc');
  const boat = ev('8c 8d 8h 6s 6c Ad Kd');
  assert.ok(flush > straight);
  assert.ok(boat > flush);
  assert.equal(categoryOf(boat), 6);
});

test('7-card evaluation equals the best of all 5-card subsets', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let t = 0; t < 2000; t++) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const seven = deck.slice(0, 7);
    let best = -1;
    for (let skipA = 0; skipA < 7; skipA++)
      for (let skipB = skipA + 1; skipB < 7; skipB++)
        best = Math.max(best, evaluate(seven.filter((_, i) => i !== skipA && i !== skipB)));
    assert.equal(evaluate(seven), best, seven.map(cardToString).join(' '));
  }
});

test('bestFive returns the five cards that make the hand', () => {
  const five = bestFive(parseCards('Kd Kc Kh 7s 7d 3c 4h')).map(cardToString).sort();
  assert.deepEqual(five, ['7d', '7s', 'Kc', 'Kd', 'Kh']);
});
