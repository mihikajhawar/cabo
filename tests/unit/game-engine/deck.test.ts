import { describe, expect, it } from 'vitest';
import { createStandardDeck, reshuffleDiscardIntoDeck, shuffle } from '@cabo/game-engine';
import { asCardInstanceId } from '@cabo/shared-types';
import type { CardInstance } from '@cabo/game-engine';
import { seededRng } from './helpers.js';

describe('createStandardDeck', () => {
  it('has exactly 52 cards', () => {
    expect(createStandardDeck()).toHaveLength(52);
  });

  it('gives every card a unique CardInstanceId', () => {
    const ids = createStandardDeck().map((c) => c.id);
    expect(new Set(ids).size).toBe(52);
  });

  it('has 4 copies of every non-king rank', () => {
    const deck = createStandardDeck();
    const nonKingRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'] as const;
    for (const rank of nonKingRanks) {
      expect(deck.filter((c) => c.def.rank === rank)).toHaveLength(4);
    }
  });

  it('has exactly 2 Red Kings and 2 Black Kings', () => {
    const deck = createStandardDeck();
    expect(deck.filter((c) => c.def.rank === 'K_RED')).toHaveLength(2);
    expect(deck.filter((c) => c.def.rank === 'K_BLACK')).toHaveLength(2);
  });

  it('assigns the §D value table correctly, including both Kings', () => {
    const deck = createStandardDeck();
    const valueOf = (rank: string) => deck.find((c) => c.def.rank === rank)!.def.value;

    expect(valueOf('A')).toBe(1);
    expect(valueOf('2')).toBe(2);
    expect(valueOf('9')).toBe(9);
    expect(valueOf('10')).toBe(10);
    expect(valueOf('J')).toBe(11);
    expect(valueOf('Q')).toBe(12);
    expect(valueOf('K_BLACK')).toBe(13);
    expect(valueOf('K_RED')).toBe(-1);
  });
});

describe('shuffle', () => {
  it('returns a permutation — same length and same multiset of elements', () => {
    const deck = createStandardDeck();
    const shuffled = shuffle(deck, seededRng());
    expect(shuffled).toHaveLength(deck.length);
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(deck.map((c) => c.id)));
  });

  it('does not mutate the input array', () => {
    const deck = createStandardDeck();
    const originalIds = deck.map((c) => c.id);
    shuffle(deck, seededRng());
    expect(deck.map((c) => c.id)).toEqual(originalIds);
  });

  it('is deterministic given the same rng sequence', () => {
    const deck = createStandardDeck();
    const a = shuffle(deck, seededRng(7));
    const b = shuffle(deck, seededRng(7));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it('actually reorders elements with a non-identity rng', () => {
    const deck = createStandardDeck();
    const shuffled = shuffle(deck, seededRng(7));
    expect(shuffled.map((c) => c.id)).not.toEqual(deck.map((c) => c.id));
  });
});

function fakeCard(n: number): CardInstance {
  return { id: asCardInstanceId(`fake-${n}`), def: { rank: 'A', value: 1 } };
}

describe('reshuffleDiscardIntoDeck', () => {
  it('moves everything but the discard top into a shuffled new deck', () => {
    const discardPile = [fakeCard(1), fakeCard(2), fakeCard(3), fakeCard(4)];
    const result = reshuffleDiscardIntoDeck([], discardPile, seededRng());

    expect(result.discardPile).toEqual([fakeCard(4)]);
    expect(new Set(result.deck.map((c) => c.id))).toEqual(
      new Set([fakeCard(1).id, fakeCard(2).id, fakeCard(3).id]),
    );
  });

  it('excludes the top card from the reshuffled pool', () => {
    const discardPile = [fakeCard(1), fakeCard(2)];
    const result = reshuffleDiscardIntoDeck([], discardPile, seededRng());
    expect(result.deck.some((c) => c.id === fakeCard(2).id)).toBe(false);
  });

  it('preserves any cards already in the deck, alongside the reshuffled ones', () => {
    const existingDeckCard = fakeCard(99);
    const discardPile = [fakeCard(1), fakeCard(2)];
    const result = reshuffleDiscardIntoDeck([existingDeckCard], discardPile, seededRng());
    expect(result.deck.some((c) => c.id === existingDeckCard.id)).toBe(true);
  });

  it('is a no-op (never throws) when the discard pile is empty — §S.3', () => {
    const result = reshuffleDiscardIntoDeck([], [], seededRng());
    expect(result.deck).toEqual([]);
    expect(result.discardPile).toEqual([]);
  });

  it('is a no-op (never throws) when the discard pile is just its top card — §S.3', () => {
    const discardPile = [fakeCard(1)];
    const result = reshuffleDiscardIntoDeck([], discardPile, seededRng());
    expect(result.deck).toEqual([]);
    expect(result.discardPile).toEqual(discardPile);
  });
});
