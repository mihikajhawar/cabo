import type { GameState } from '../model/game-state.js';

export type EngineErrorCode =
  | 'UNKNOWN_PLAYER'
  | 'PLAYER_ALREADY_JOINED'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'TOO_MANY_PLAYERS'
  | 'ALREADY_ACKED'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'CABO_NOT_AVAILABLE_YET'
  | 'ALREADY_HOLDING_DRAWN_CARD'
  | 'NO_DRAWN_CARD'
  | 'INVALID_POSITION'
  | 'DECK_EXHAUSTED';

export type EngineResult =
  | { ok: true; state: GameState }
  | { ok: false; error: EngineErrorCode };

export function err(error: EngineErrorCode): EngineResult {
  return { ok: false, error };
}

export function ok(state: GameState): EngineResult {
  return { ok: true, state };
}
