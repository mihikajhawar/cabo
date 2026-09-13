import type { CardInstanceId, GameId, PlayerId } from '@cabo/shared-types';
import type { CardInstance } from './card.js';
import type { Deck } from './deck.js';
import type { PlayerState } from './player.js';
import type { TurnState } from './turn.js';
import type { CaboState } from './cabo.js';
import type { RoundResult } from './result.js';

export interface GameState {
  id: GameId;
  hostPlayerId: PlayerId;
  players: PlayerState[];
  deck: Deck;
  discardPile: CardInstance[]; // top = last element
  turn: TurnState;
  cabo: CaboState;
  roundNumber: number;
  lastRoundResult: RoundResult | null;
  knowledge: Record<PlayerId, Set<CardInstanceId>>;
  // §D stores full CardInstance objects in deck/discardPile but only bare
  // CardInstanceIds in hand/drawnCard — this registry is what lets a hand
  // position or a held drawnCard be resolved back to its definition. Built
  // once at deal time and stable for the round, same as the ids themselves.
  cardsById: Record<CardInstanceId, CardInstance>;
}

// The host joins as part of game creation (mirrors §K's CREATE_GAME), so
// hostPlayerId and players are never in a mutually-inconsistent state —
// there's no LOBBY tick with a host id but no matching player.
export function createInitialGameState(
  gameId: GameId,
  host: { id: PlayerId; displayName: string },
): GameState {
  const hostPlayer: PlayerState = {
    id: host.id,
    displayName: host.displayName,
    connected: true,
    hand: [],
    isCaboCaller: false,
    handLocked: false,
    hasTakenFinalTurn: false,
    ackedInitialPeek: false,
  };

  return {
    id: gameId,
    hostPlayerId: host.id,
    players: [hostPlayer],
    deck: { cards: [] },
    discardPile: [],
    turn: {
      phase: 'LOBBY',
      currentPlayerId: host.id,
      drawnCard: null,
      pendingPower: null,
      contestWindow: null,
      finalTurnQueue: [],
      awaitingCaboDecision: false,
    },
    cabo: { called: false, callerId: null, calledAfterTurnNumber: null },
    roundNumber: 0,
    lastRoundResult: null,
    knowledge: {},
    cardsById: {},
  };
}
