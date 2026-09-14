import type { CardInstanceId, HandCardView, PlayerId, PlayerView } from '@cabo/shared-types';
import type { GameState } from '../model/game-state.js';
import { knows } from './knowledge.js';

function projectHand(
  state: GameState,
  viewerId: PlayerId,
  hand: readonly CardInstanceId[],
  handLocked: boolean,
): HandCardView[] {
  return hand.map((cardInstanceId, position) => {
    const card = state.cardsById[cardInstanceId];
    const visible = knows(state.knowledge, viewerId, cardInstanceId);
    return {
      cardInstanceId,
      position,
      value: visible && card ? card.def : 'hidden',
      locked: handLocked,
    };
  });
}

// §J: the sole function allowed to turn GameState into something sent over
// the wire. Every broadcast site calls this once per recipient socket —
// nothing else ever serializes GameState directly.
export function projectPlayerView(state: GameState, viewerId: PlayerId): PlayerView {
  const viewer = state.players.find((p) => p.id === viewerId);
  const self = {
    playerId: viewerId,
    hand: viewer ? projectHand(state, viewerId, viewer.hand, viewer.handLocked) : [],
  };

  const opponents = state.players
    .filter((p) => p.id !== viewerId)
    .map((p) => ({
      playerId: p.id,
      displayName: p.displayName,
      connected: p.connected,
      hand: projectHand(state, viewerId, p.hand, p.handLocked),
    }));

  const discardTop = state.discardPile.at(-1) ?? null;

  return {
    viewerId,
    self,
    opponents,
    drawPileCount: state.deck.cards.length,
    discardPileTop: discardTop ? discardTop.def : null,
    phase: state.turn.phase,
    currentTurnPlayerId: state.turn.currentPlayerId,
    caboCallerId: state.cabo.callerId,
    contestWindowExpiresAt: state.turn.contestWindow?.expiresAtMs ?? null,
  };
}
