import type { CardInstance } from '../model/card.js';
import type { CardInstanceId } from '@cabo/shared-types';
import type { GameState } from '../model/game-state.js';
import type { PlayerState } from '../model/player.js';
import { CARDS_PER_PLAYER, MAX_PLAYERS, MIN_PLAYERS, dealInitialHands } from '../rules/dealing.js';
import { createStandardDeck, reshuffleDiscardIntoDeck, shuffle } from '../rules/deck.js';
import type { EngineAction } from './actions.js';
import { err, ok, type EngineResult } from './errors.js';

// §L: no `await` anywhere in this pipeline — every handler here is a pure,
// synchronous function of (state, action) -> result.
export function reduce(
  state: GameState,
  action: EngineAction,
  rng: () => number = Math.random,
): EngineResult {
  switch (action.type) {
    case 'JOIN_GAME':
      return handleJoinGame(state, action.playerId, action.displayName);
    case 'START_GAME':
      return handleStartGame(state, action.playerId, rng);
    case 'ACK_INITIAL_PEEK':
      return handleAckInitialPeek(state, action.playerId);
    case 'DRAW_CARD':
      return handleDrawCard(state, action.playerId, rng);
    case 'DISCARD_CARD':
      return handleDiscardCard(state, action.playerId);
    case 'REPLACE_CARD':
      return handleReplaceCard(state, action.playerId, action.position);
    case 'END_TURN':
      return handleEndTurn(state, action.playerId);
  }
}

function findPlayer(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

function updatePlayer(
  players: readonly PlayerState[],
  playerId: string,
  fn: (player: PlayerState) => PlayerState,
): PlayerState[] {
  return players.map((p) => (p.id === playerId ? fn(p) : p));
}

function handleJoinGame(state: GameState, playerId: string, displayName: string): EngineResult {
  if (state.turn.phase !== 'LOBBY') return err('WRONG_PHASE');
  if (findPlayer(state, playerId)) return err('PLAYER_ALREADY_JOINED');
  if (state.players.length >= MAX_PLAYERS) return err('TOO_MANY_PLAYERS');

  const newPlayer: PlayerState = {
    id: playerId as PlayerState['id'],
    displayName,
    connected: true,
    hand: [],
    isCaboCaller: false,
    handLocked: false,
    hasTakenFinalTurn: false,
    ackedInitialPeek: false,
  };

  return ok({ ...state, players: [...state.players, newPlayer] });
}

function handleStartGame(state: GameState, playerId: string, rng: () => number): EngineResult {
  if (state.turn.phase !== 'LOBBY') return err('WRONG_PHASE');
  if (state.hostPlayerId !== playerId) return err('NOT_HOST');
  if (state.players.length < MIN_PLAYERS) return err('NOT_ENOUGH_PLAYERS');
  if (state.players.length > MAX_PLAYERS) return err('TOO_MANY_PLAYERS');

  const shuffledDeck = shuffle(createStandardDeck(), rng);
  const cardsById: Record<CardInstanceId, CardInstance> = {};
  for (const card of shuffledDeck) cardsById[card.id] = card;

  const playerIds = state.players.map((p) => p.id);
  const { hands, remainingDeck } = dealInitialHands(playerIds, shuffledDeck);
  const players = state.players.map((p) => ({ ...p, hand: hands[p.id]! }));

  return ok({
    ...state,
    players,
    deck: { cards: remainingDeck },
    discardPile: [],
    cardsById,
    turn: {
      ...state.turn,
      phase: 'DEALING',
      currentPlayerId: players[0]!.id,
    },
  });
}

function handleAckInitialPeek(state: GameState, playerId: string): EngineResult {
  if (state.turn.phase !== 'DEALING') return err('WRONG_PHASE');
  const player = findPlayer(state, playerId);
  if (!player) return err('UNKNOWN_PLAYER');
  if (player.ackedInitialPeek) return err('ALREADY_ACKED');

  const players = updatePlayer(state.players, playerId, (p) => ({ ...p, ackedInitialPeek: true }));
  const allAcked = players.every((p) => p.ackedInitialPeek);

  return ok({
    ...state,
    players,
    turn: { ...state.turn, phase: allAcked ? 'PLAYING' : 'DEALING' },
  });
}

function handleDrawCard(state: GameState, playerId: string, rng: () => number): EngineResult {
  if (state.turn.phase !== 'PLAYING' || state.turn.awaitingCaboDecision) return err('WRONG_PHASE');
  if (state.turn.currentPlayerId !== playerId) return err('NOT_YOUR_TURN');
  if (state.turn.drawnCard !== null) return err('ALREADY_HOLDING_DRAWN_CARD');

  let deck = state.deck.cards;
  let discardPile = state.discardPile;
  if (deck.length === 0) {
    const reshuffled = reshuffleDiscardIntoDeck(deck, discardPile, rng);
    deck = reshuffled.deck;
    discardPile = reshuffled.discardPile;
  }
  if (deck.length === 0) return err('DECK_EXHAUSTED');

  const [drawn, ...rest] = deck;

  return ok({
    ...state,
    deck: { cards: rest },
    discardPile,
    turn: { ...state.turn, drawnCard: drawn!.id },
  });
}

function handleDiscardCard(state: GameState, playerId: string): EngineResult {
  if (state.turn.phase !== 'PLAYING' || state.turn.awaitingCaboDecision) return err('WRONG_PHASE');
  if (state.turn.currentPlayerId !== playerId) return err('NOT_YOUR_TURN');
  if (state.turn.drawnCard === null) return err('NO_DRAWN_CARD');

  const drawnInstance = state.cardsById[state.turn.drawnCard]!;

  return ok({
    ...state,
    discardPile: [...state.discardPile, drawnInstance],
    turn: { ...state.turn, drawnCard: null, awaitingCaboDecision: true },
  });
}

function handleReplaceCard(state: GameState, playerId: string, position: number): EngineResult {
  if (state.turn.phase !== 'PLAYING' || state.turn.awaitingCaboDecision) return err('WRONG_PHASE');
  if (state.turn.currentPlayerId !== playerId) return err('NOT_YOUR_TURN');
  if (state.turn.drawnCard === null) return err('NO_DRAWN_CARD');

  const player = findPlayer(state, playerId);
  if (!player) return err('UNKNOWN_PLAYER');
  if (position < 0 || position >= player.hand.length) return err('INVALID_POSITION');

  const oldCardId = player.hand[position]!;
  const oldCardInstance = state.cardsById[oldCardId]!;
  const drawnCardId = state.turn.drawnCard;

  const newHand = player.hand.slice();
  newHand[position] = drawnCardId;
  const players = updatePlayer(state.players, playerId, (p) => ({ ...p, hand: newHand }));

  return ok({
    ...state,
    players,
    discardPile: [...state.discardPile, oldCardInstance],
    turn: { ...state.turn, drawnCard: null, awaitingCaboDecision: true },
  });
}

function handleEndTurn(state: GameState, playerId: string): EngineResult {
  if (state.turn.phase !== 'PLAYING' || !state.turn.awaitingCaboDecision) return err('WRONG_PHASE');
  if (state.turn.currentPlayerId !== playerId) return err('NOT_YOUR_TURN');

  const currentIndex = state.players.findIndex((p) => p.id === playerId);
  const nextIndex = (currentIndex + 1) % state.players.length;
  const nextPlayerId = state.players[nextIndex]!.id;

  return ok({
    ...state,
    turn: { ...state.turn, currentPlayerId: nextPlayerId, awaitingCaboDecision: false },
  });
}

// Re-exported so callers/tests don't need to reach into rules/dealing.js directly.
export { CARDS_PER_PLAYER, MIN_PLAYERS, MAX_PLAYERS };
