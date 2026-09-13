import type { CardInstanceId, PlayerId } from '@cabo/shared-types';

export interface PlayerState {
  id: PlayerId;
  displayName: string;
  connected: boolean;
  hand: CardInstanceId[]; // VARIABLE LENGTH, 0..4 — zero-length is fully valid, never rejected as malformed
  isCaboCaller: boolean;
  handLocked: boolean; // set true atomically the instant this player calls CABO
  hasTakenFinalTurn: boolean;
  // Not itself part of §D's model table, but needed to implement §E's stated
  // "DEALING → PLAYING (all initial-peek acks received, or timeout)" rule —
  // same independent-boolean style as handLocked/hasTakenFinalTurn.
  ackedInitialPeek: boolean;
}
