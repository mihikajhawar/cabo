import type { CardDefinition, PlayerId } from '@cabo/shared-types';

export interface RoundResult {
  perPlayerScore: Record<PlayerId, number>; // may be 0 or negative
  caboCallerId: PlayerId | null;
  caboSucceeded: boolean;
  // ARRAY, not a single id — §S resolves tied non-caller winners as
  // co-winners, so every tied lowest score is included here, never collapsed
  // to one.
  winnerIds: PlayerId[];
  revealedHands: Record<PlayerId, CardDefinition[]>;
}
