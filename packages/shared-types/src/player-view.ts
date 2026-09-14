import type { CardDefinition } from './card.js';
import type { GamePhase } from './phase.js';
import type { CardInstanceId, PlayerId } from './ids.js';

// §J — "hidden" is a sentinel, never the real CardDefinition: a card is only
// ever real here for a card this specific viewer currently has a knowledge
// grant for (self or opponent alike — the rule is uniform, driven entirely
// by the knowledge set, not by whose hand the card sits in).
export interface HandCardView {
  cardInstanceId: CardInstanceId;
  position: number;
  value: CardDefinition | 'hidden';
  locked: boolean;
}

export interface OpponentView {
  playerId: PlayerId;
  displayName: string;
  connected: boolean;
  hand: HandCardView[];
}

// No broadcast site anywhere in the system emits full GameState or a shared
// room payload — every emit is per-socket, built from exactly this shape for
// that one viewer (§J).
export interface PlayerView {
  viewerId: PlayerId;
  self: { playerId: PlayerId; hand: HandCardView[] };
  opponents: OpponentView[];
  drawPileCount: number;
  discardPileTop: CardDefinition | null; // public — always the real value, no grant needed
  phase: GamePhase;
  currentTurnPlayerId: PlayerId;
  caboCallerId: PlayerId | null;
  contestWindowExpiresAt: number | null;
}
