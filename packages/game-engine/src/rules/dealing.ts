import type { CardInstanceId, PlayerId } from '@cabo/shared-types';
import type { CardInstance } from '../model/card.js';

export const CARDS_PER_PLAYER = 4;
export const MIN_PLAYERS = 2;
// 52-card deck / 4 cards each — the ceiling a full deal can actually support.
export const MAX_PLAYERS = 13;

export function dealInitialHands(
  playerIds: readonly PlayerId[],
  deck: readonly CardInstance[],
): { hands: Record<PlayerId, CardInstanceId[]>; remainingDeck: CardInstance[] } {
  const hands: Record<PlayerId, CardInstanceId[]> = {};
  for (const id of playerIds) hands[id] = [];

  const remainingDeck = deck.slice();
  for (let round = 0; round < CARDS_PER_PLAYER; round++) {
    for (const playerId of playerIds) {
      const card = remainingDeck.shift();
      if (!card) {
        // Guarded by MIN_PLAYERS/MAX_PLAYERS at the START_GAME validator —
        // reachable only if that guard is ever bypassed.
        throw new Error('deck exhausted during initial deal');
      }
      hands[playerId]!.push(card.id);
    }
  }
  return { hands, remainingDeck };
}
