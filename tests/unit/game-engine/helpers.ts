import type { PlayerId } from '@cabo/shared-types';
import { asGameId, asPlayerId } from '@cabo/shared-types';
import { createInitialGameState, reduce, type GameState } from '@cabo/game-engine';

// A small, seeded LCG so tests are fully deterministic without depending on
// Math.random — the same sequence every run, no snapshot flakiness.
export function seededRng(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

export function unwrap(result: { ok: true; state: GameState } | { ok: false; error: string }): GameState {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result.state;
}

// Joins `count` players, starts the game, and acks every player's initial
// peek — leaving the returned state in PLAYING with a deterministic deal.
export function setupPlayingGame(
  count: number,
  rng: () => number = seededRng(),
): { state: GameState; playerIds: PlayerId[] } {
  const playerIds: PlayerId[] = Array.from({ length: count }, (_, i) => asPlayerId(`player-${i}`));

  let state = createInitialGameState(asGameId('game-1'), {
    id: playerIds[0]!,
    displayName: 'player-0',
  });

  for (const id of playerIds.slice(1)) {
    state = unwrap(reduce(state, { type: 'JOIN_GAME', playerId: id, displayName: id }));
  }

  state = unwrap(reduce(state, { type: 'START_GAME', playerId: playerIds[0]! }, rng));

  for (const id of playerIds) {
    state = unwrap(reduce(state, { type: 'ACK_INITIAL_PEEK', playerId: id }));
  }

  return { state, playerIds };
}
