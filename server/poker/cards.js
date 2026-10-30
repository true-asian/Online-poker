import { randomInt } from 'node:crypto';

// A card is an integer 0..51: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3.
export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

export const rankOf = (card) => card >> 2;
export const suitOf = (card) => card & 3;

export function cardToString(card) {
  return RANKS[rankOf(card)] + SUITS[suitOf(card)];
}

export function parseCard(text) {
  const rank = RANKS.indexOf(text[0].toUpperCase());
  const suit = SUITS.indexOf(text[1].toLowerCase());
  if (rank < 0 || suit < 0 || text.length !== 2) throw new Error(`Bad card: ${text}`);
  return (rank << 2) | suit;
}

export const parseCards = (text) => text.trim().split(/\s+/).filter(Boolean).map(parseCard);

/** Fisher–Yates shuffle driven by a cryptographically secure RNG. */
export function shuffle(cards, rand = randomInt) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export class Deck {
  /** @param {number[]} [stacked] cards in deal order (tests only); otherwise a fresh shuffled deck */
  constructor(stacked) {
    // Cards are drawn from the end of the array.
    this.cards = stacked ? [...stacked].reverse() : shuffle(Array.from({ length: 52 }, (_, i) => i));
  }

  draw() {
    if (!this.cards.length) throw new Error('Deck is empty');
    return this.cards.pop();
  }

  burn() {
    this.draw();
  }
}
