import type { CardInstanceId, PlayerId } from '@cabo/shared-types';
import type { GamePhase } from '../state-machine/phases.js';

// §G references CardRef for power targets without spelling it out — a target
// is always "this player's card at this position."
export interface CardRef {
  playerId: PlayerId;
  position: number;
}

export interface PowerAction {
  kind: '7_8_LOOK_OWN' | '9_10_LOOK_OPPONENT' | 'JQ_BLIND_SWAP' | 'KING_INSPECT_SWAP';
  ownerPlayerId: PlayerId;
  sourceCardInstanceId: CardInstanceId; // which drawn card granted this power
  kingSelection?: { a: CardRef; b: CardRef; inspected: boolean };
}

export interface ContestWindowState {
  openedAtMs: number;
  discardTopCardInstanceId: CardInstanceId;
  expiresAtMs: number; // openedAtMs + 2000, server-authoritative
  resolved: boolean;
}

export interface TurnState {
  phase: GamePhase;
  currentPlayerId: PlayerId;
  drawnCard: CardInstanceId | null; // the "undecided, held" card for the active player's current draw
  pendingPower: PowerAction | null;
  contestWindow: ContestWindowState | null;
  finalTurnQueue: PlayerId[]; // excludes the CABO caller by construction
  // true only after a full normal-turn sequence has resolved for
  // currentPlayerId; the only state in which CALL_CABO is legal
  awaitingCaboDecision: boolean;
}
