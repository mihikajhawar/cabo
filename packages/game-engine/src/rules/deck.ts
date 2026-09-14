import type { Rank } from '@cabo/shared-types';
import { asCardInstanceId } from '@cabo/shared-types';
import type { CardInstance } from '../model/card.js';

const RANK_VALUES: Record<Rank, number> = {
  A: 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K_BLACK: 13,
  K_RED: -1,
};

const NON_KING_RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'];

export function createStandardDeck(): CardInstance[] {
  const cards: CardInstance[] = [];
  let index = 0;

  for (const rank of NON_KING_RANKS) {
    for (let copy = 0; copy < 4; copy++) {
      cards.push({ id: asCardInstanceId(`card-${index}`), def: { rank, value: RANK_VALUES[rank] } });
      index++;
    }
  }
  for (let copy = 0; copy < 2; copy++) {
    cards.push({ id: asCardInstanceId(`card-${index}`), def: { rank: 'K_RED', value: RANK_VALUES.K_RED } });
    index++;
  }
  for (let copy = 0; copy < 2; copy++) {
    cards.push({ id: asCardInstanceId(`card-${index}`), def: { rank: 'K_BLACK', value: RANK_VALUES.K_BLACK } });
    index++;
  }

  return cards;
}

export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

// §L / §S.3 — reshuffle-on-empty: move the discard pile (minus its current
// top card) back into the draw pile, shuffled. If there's nothing to
// reshuffle (discard pile empty or down to just its top card), returns the
// deck unchanged rather than throwing — an exhausted draw is reported by the
// caller as DECK_EXHAUSTED, never as a crash.
export function reshuffleDiscardIntoDeck(
  deck: readonly CardInstance[],
  discardPile: readonly CardInstance[],
  rng: () => number = Math.random,
): { deck: CardInstance[]; discardPile: CardInstance[] } {
  if (discardPile.length <= 1) {
    return { deck: deck.slice(), discardPile: discardPile.slice() };
  }
  const top = discardPile[discardPile.length - 1]!;
  const toReshuffle = discardPile.slice(0, -1);
  return {
    // Any cards still in the deck stay on top of the draw order; the
    // reshuffled discard remnants are appended beneath them.
    deck: [...deck, ...shuffle(toReshuffle, rng)],
    discardPile: [top],
  };
}
