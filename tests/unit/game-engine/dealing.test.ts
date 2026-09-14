import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_PLAYER,
  MAX_PLAYERS,
  MIN_PLAYERS,
  createStandardDeck,
  dealInitialHands,
  shuffle,
} from '@cabo/game-engine';
import { asPlayerId } from '@cabo/shared-types';
import { seededRng } from './helpers.js';

describe('constants', () => {
  it('MIN_PLAYERS is 2 and MAX_PLAYERS matches a full 52-card deal at CARDS_PER_PLAYER', () => {
    expect(MIN_PLAYERS).toBe(2);
    expect(CARDS_PER_PLAYER).toBe(4);
    expect(MAX_PLAYERS * CARDS_PER_PLAYER).toBeLessThanOrEqual(52);
    expect((MAX_PLAYERS + 1) * CARDS_PER_PLAYER).toBeGreaterThan(52);
  });
});

describe('dealInitialHands', () => {
  it('deals CARDS_PER_PLAYER cards to every player', () => {
    const deck = shuffle(createStandardDeck(), seededRng());
    const playerIds = [asPlayerId('a'), asPlayerId('b'), asPlayerId('c')];
    const { hands } = dealInitialHands(playerIds, deck);

    for (const id of playerIds) {
      expect(hands[id]).toHaveLength(CARDS_PER_PLAYER);
    }
  });

  it('removes exactly the dealt cards from the remaining deck', () => {
    const deck = shuffle(createStandardDeck(), seededRng());
    const playerIds = [asPlayerId('a'), asPlayerId('b')];
    const { hands, remainingDeck } = dealInitialHands(playerIds, deck);

    expect(remainingDeck).toHaveLength(deck.length - playerIds.length * CARDS_PER_PLAYER);
    const dealtIds = new Set(Object.values(hands).flat());
    expect(remainingDeck.some((c) => dealtIds.has(c.id))).toBe(false);
  });

  it('deals disjoint card instances across hands — no card dealt twice', () => {
    const deck = shuffle(createStandardDeck(), seededRng());
    const playerIds = [asPlayerId('a'), asPlayerId('b'), asPlayerId('c'), asPlayerId('d')];
    const { hands } = dealInitialHands(playerIds, deck);

    const allDealt = Object.values(hands).flat();
    expect(new Set(allDealt).size).toBe(allDealt.length);
  });

  it('supports MAX_PLAYERS without exhausting the deck mid-deal', () => {
    const deck = shuffle(createStandardDeck(), seededRng());
    const playerIds = Array.from({ length: MAX_PLAYERS }, (_, i) => asPlayerId(`p${i}`));

    expect(() => dealInitialHands(playerIds, deck)).not.toThrow();
    const { remainingDeck } = dealInitialHands(playerIds, deck);
    expect(remainingDeck).toHaveLength(52 - MAX_PLAYERS * CARDS_PER_PLAYER);
  });
});
