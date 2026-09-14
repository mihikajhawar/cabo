import { describe, expect, it } from 'vitest';
import { createInitialGameState, reduce, type GameState } from '@cabo/game-engine';
import { asCardInstanceId, asGameId, asPlayerId } from '@cabo/shared-types';
import { seededRng, setupPlayingGame, unwrap } from './helpers.js';

describe('createInitialGameState', () => {
  it('starts in LOBBY with the host auto-joined', () => {
    const state = createInitialGameState(asGameId('g1'), {
      id: asPlayerId('host'),
      displayName: 'Host',
    });

    expect(state.turn.phase).toBe('LOBBY');
    expect(state.hostPlayerId).toBe('host');
    expect(state.players).toHaveLength(1);
    expect(state.players[0]).toMatchObject({ id: 'host', connected: true, hand: [] });
  });
});

describe('JOIN_GAME', () => {
  function freshLobby(): GameState {
    return createInitialGameState(asGameId('g1'), { id: asPlayerId('host'), displayName: 'Host' });
  }

  it('adds a new player in LOBBY', () => {
    const result = reduce(freshLobby(), { type: 'JOIN_GAME', playerId: asPlayerId('bob'), displayName: 'Bob' });
    const state = unwrap(result);
    expect(state.players.map((p) => p.id)).toEqual(['host', 'bob']);
  });

  it('rejects a player who already joined', () => {
    let state = freshLobby();
    state = unwrap(reduce(state, { type: 'JOIN_GAME', playerId: asPlayerId('bob'), displayName: 'Bob' }));
    const result = reduce(state, { type: 'JOIN_GAME', playerId: asPlayerId('bob'), displayName: 'Bob' });
    expect(result).toEqual({ ok: false, error: 'PLAYER_ALREADY_JOINED' });
  });

  it('rejects joining once the game has left LOBBY', () => {
    const { state } = setupPlayingGame(2);
    const result = reduce(state, { type: 'JOIN_GAME', playerId: asPlayerId('late'), displayName: 'Late' });
    expect(result).toEqual({ ok: false, error: 'WRONG_PHASE' });
  });
});

describe('START_GAME', () => {
  function lobbyWith(count: number): GameState {
    let state = createInitialGameState(asGameId('g1'), { id: asPlayerId('p0'), displayName: 'p0' });
    for (let i = 1; i < count; i++) {
      state = unwrap(reduce(state, { type: 'JOIN_GAME', playerId: asPlayerId(`p${i}`), displayName: `p${i}` }));
    }
    return state;
  }

  it('rejects a non-host starter', () => {
    const state = lobbyWith(2);
    const result = reduce(state, { type: 'START_GAME', playerId: asPlayerId('p1') }, seededRng());
    expect(result).toEqual({ ok: false, error: 'NOT_HOST' });
  });

  it('rejects starting with fewer than MIN_PLAYERS', () => {
    const state = lobbyWith(1);
    const result = reduce(state, { type: 'START_GAME', playerId: asPlayerId('p0') }, seededRng());
    expect(result).toEqual({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
  });

  it('rejects starting outside LOBBY', () => {
    const { state, playerIds } = setupPlayingGame(2);
    const result = reduce(state, { type: 'START_GAME', playerId: playerIds[0]! }, seededRng());
    expect(result).toEqual({ ok: false, error: 'WRONG_PHASE' });
  });

  it('deals CARDS_PER_PLAYER cards to every player and moves to DEALING', () => {
    const state = unwrap(
      reduce(lobbyWith(3), { type: 'START_GAME', playerId: asPlayerId('p0') }, seededRng()),
    );

    expect(state.turn.phase).toBe('DEALING');
    expect(state.players.every((p) => p.hand.length === 4)).toBe(true);
    expect(state.deck.cards).toHaveLength(52 - 3 * 4);
    expect(state.discardPile).toHaveLength(0);
    expect(Object.keys(state.cardsById)).toHaveLength(52);
  });

  it('deals disjoint hands — no card dealt to two players', () => {
    const state = unwrap(
      reduce(lobbyWith(4), { type: 'START_GAME', playerId: asPlayerId('p0') }, seededRng()),
    );
    const allDealt = state.players.flatMap((p) => p.hand);
    expect(new Set(allDealt).size).toBe(allDealt.length);
  });
});

describe('ACK_INITIAL_PEEK', () => {
  it('rejects outside DEALING', () => {
    const { state, playerIds } = setupPlayingGame(2);
    const result = reduce(state, { type: 'ACK_INITIAL_PEEK', playerId: playerIds[0]! });
    expect(result).toEqual({ ok: false, error: 'WRONG_PHASE' });
  });

  it('rejects an unknown player', () => {
    let state = createInitialGameState(asGameId('g1'), { id: asPlayerId('p0'), displayName: 'p0' });
    state = unwrap(reduce(state, { type: 'JOIN_GAME', playerId: asPlayerId('p1'), displayName: 'p1' }));
    state = unwrap(reduce(state, { type: 'START_GAME', playerId: asPlayerId('p0') }, seededRng()));

    const result = reduce(state, { type: 'ACK_INITIAL_PEEK', playerId: asPlayerId('ghost') });
    expect(result).toEqual({ ok: false, error: 'UNKNOWN_PLAYER' });
  });

  it('rejects a double ack from the same player', () => {
    let state = createInitialGameState(asGameId('g1'), { id: asPlayerId('p0'), displayName: 'p0' });
    state = unwrap(reduce(state, { type: 'JOIN_GAME', playerId: asPlayerId('p1'), displayName: 'p1' }));
    state = unwrap(reduce(state, { type: 'START_GAME', playerId: asPlayerId('p0') }, seededRng()));
    state = unwrap(reduce(state, { type: 'ACK_INITIAL_PEEK', playerId: asPlayerId('p0') }));

    const result = reduce(state, { type: 'ACK_INITIAL_PEEK', playerId: asPlayerId('p0') });
    expect(result).toEqual({ ok: false, error: 'ALREADY_ACKED' });
  });

  it('stays in DEALING until every player has acked, then moves to PLAYING', () => {
    let state = createInitialGameState(asGameId('g1'), { id: asPlayerId('p0'), displayName: 'p0' });
    state = unwrap(reduce(state, { type: 'JOIN_GAME', playerId: asPlayerId('p1'), displayName: 'p1' }));
    state = unwrap(reduce(state, { type: 'START_GAME', playerId: asPlayerId('p0') }, seededRng()));

    state = unwrap(reduce(state, { type: 'ACK_INITIAL_PEEK', playerId: asPlayerId('p0') }));
    expect(state.turn.phase).toBe('DEALING');

    state = unwrap(reduce(state, { type: 'ACK_INITIAL_PEEK', playerId: asPlayerId('p1') }));
    expect(state.turn.phase).toBe('PLAYING');
  });
});

describe('DRAW_CARD', () => {
  it('rejects a draw from a non-current player', () => {
    const { state, playerIds } = setupPlayingGame(2);
    const other = playerIds.find((id) => id !== state.turn.currentPlayerId)!;
    const result = reduce(state, { type: 'DRAW_CARD', playerId: other }, seededRng());
    expect(result).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('sets drawnCard and shrinks the deck by one', () => {
    const { state } = setupPlayingGame(2);
    const before = state.deck.cards.length;
    const result = unwrap(reduce(state, { type: 'DRAW_CARD', playerId: state.turn.currentPlayerId }, seededRng()));

    expect(result.turn.drawnCard).not.toBeNull();
    expect(result.deck.cards).toHaveLength(before - 1);
  });

  it('rejects drawing twice in a row', () => {
    const { state } = setupPlayingGame(2);
    const afterFirst = unwrap(
      reduce(state, { type: 'DRAW_CARD', playerId: state.turn.currentPlayerId }, seededRng()),
    );
    const result = reduce(afterFirst, { type: 'DRAW_CARD', playerId: state.turn.currentPlayerId }, seededRng());
    expect(result).toEqual({ ok: false, error: 'ALREADY_HOLDING_DRAWN_CARD' });
  });

  it('reshuffles the discard pile into the deck when the deck is empty, and never throws', () => {
    const { state } = setupPlayingGame(2);
    const current = state.turn.currentPlayerId;

    const keptTop = { id: asCardInstanceId('kept-top'), def: { rank: 'A' as const, value: 1 } };
    const reshufflable1 = { id: asCardInstanceId('rs-1'), def: { rank: '2' as const, value: 2 } };
    const reshufflable2 = { id: asCardInstanceId('rs-2'), def: { rank: '3' as const, value: 3 } };

    const emptyDeckState: GameState = {
      ...state,
      deck: { cards: [] },
      discardPile: [reshufflable1, reshufflable2, keptTop],
      cardsById: {
        ...state.cardsById,
        [keptTop.id]: keptTop,
        [reshufflable1.id]: reshufflable1,
        [reshufflable2.id]: reshufflable2,
      },
    };

    const result = unwrap(reduce(emptyDeckState, { type: 'DRAW_CARD', playerId: current }, seededRng()));

    expect(result.discardPile).toEqual([keptTop]);
    expect(result.turn.drawnCard).not.toBeNull();
    // one of the two reshuffled cards was drawn, the other is left in the deck
    expect(result.deck.cards).toHaveLength(1);
    const remaining = new Set([...result.deck.cards.map((c) => c.id), result.turn.drawnCard]);
    expect(remaining).toEqual(new Set([reshufflable1.id, reshufflable2.id]));
  });

  it('returns DECK_EXHAUSTED without throwing when there is nothing left to reshuffle — §S.3', () => {
    const { state } = setupPlayingGame(2);
    const current = state.turn.currentPlayerId;

    const emptyEverything: GameState = { ...state, deck: { cards: [] }, discardPile: [] };
    expect(() =>
      reduce(emptyEverything, { type: 'DRAW_CARD', playerId: current }, seededRng()),
    ).not.toThrow();
    const result = reduce(emptyEverything, { type: 'DRAW_CARD', playerId: current }, seededRng());
    expect(result).toEqual({ ok: false, error: 'DECK_EXHAUSTED' });
  });
});

describe('DISCARD_CARD', () => {
  it('rejects discarding with no drawn card', () => {
    const { state } = setupPlayingGame(2);
    const result = reduce(state, { type: 'DISCARD_CARD', playerId: state.turn.currentPlayerId });
    expect(result).toEqual({ ok: false, error: 'NO_DRAWN_CARD' });
  });

  it('moves the drawn card to the discard pile top and opens the CABO decision', () => {
    const { state } = setupPlayingGame(2);
    const current = state.turn.currentPlayerId;
    const drawn = unwrap(reduce(state, { type: 'DRAW_CARD', playerId: current }, seededRng()));
    const drawnId = drawn.turn.drawnCard!;

    const result = unwrap(reduce(drawn, { type: 'DISCARD_CARD', playerId: current }));

    expect(result.discardPile.at(-1)!.id).toBe(drawnId);
    expect(result.turn.drawnCard).toBeNull();
    expect(result.turn.awaitingCaboDecision).toBe(true);
    expect(result.players.find((p) => p.id === current)!.hand).toHaveLength(4);
  });
});

describe('REPLACE_CARD', () => {
  it('rejects an out-of-range position', () => {
    const { state } = setupPlayingGame(2);
    const current = state.turn.currentPlayerId;
    const drawn = unwrap(reduce(state, { type: 'DRAW_CARD', playerId: current }, seededRng()));

    expect(reduce(drawn, { type: 'REPLACE_CARD', playerId: current, position: -1 })).toEqual({
      ok: false,
      error: 'INVALID_POSITION',
    });
    expect(reduce(drawn, { type: 'REPLACE_CARD', playerId: current, position: 4 })).toEqual({
      ok: false,
      error: 'INVALID_POSITION',
    });
  });

  it('swaps the drawn card into the chosen position and discards the displaced card', () => {
    const { state } = setupPlayingGame(2);
    const current = state.turn.currentPlayerId;
    const drawn = unwrap(reduce(state, { type: 'DRAW_CARD', playerId: current }, seededRng()));
    const drawnId = drawn.turn.drawnCard!;
    const player = drawn.players.find((p) => p.id === current)!;
    const displacedId = player.hand[2]!;
    const untouchedIds = [player.hand[0]!, player.hand[1]!, player.hand[3]!];

    const result = unwrap(reduce(drawn, { type: 'REPLACE_CARD', playerId: current, position: 2 }));
    const newHand = result.players.find((p) => p.id === current)!.hand;

    expect(newHand[2]).toBe(drawnId);
    expect([newHand[0], newHand[1], newHand[3]]).toEqual(untouchedIds);
    expect(result.discardPile.at(-1)!.id).toBe(displacedId);
    expect(result.turn.drawnCard).toBeNull();
    expect(result.turn.awaitingCaboDecision).toBe(true);
  });
});

describe('END_TURN', () => {
  it('rejects ending a turn before the CABO decision point', () => {
    const { state } = setupPlayingGame(2);
    const result = reduce(state, { type: 'END_TURN', playerId: state.turn.currentPlayerId });
    expect(result).toEqual({ ok: false, error: 'WRONG_PHASE' });
  });

  it('advances currentPlayerId to the next player and resets awaitingCaboDecision', () => {
    const { state, playerIds } = setupPlayingGame(2);
    const current = state.turn.currentPlayerId;
    let s = unwrap(reduce(state, { type: 'DRAW_CARD', playerId: current }, seededRng()));
    s = unwrap(reduce(s, { type: 'DISCARD_CARD', playerId: current }));
    s = unwrap(reduce(s, { type: 'END_TURN', playerId: current }));

    const expectedNext = playerIds.find((id) => id !== current)!;
    expect(s.turn.currentPlayerId).toBe(expectedNext);
    expect(s.turn.awaitingCaboDecision).toBe(false);
  });

  it('cycles through all players and wraps back to the first, in array order', () => {
    const { state, playerIds } = setupPlayingGame(3, seededRng(99));
    let s = state;

    for (let i = 0; i < playerIds.length; i++) {
      expect(s.turn.currentPlayerId).toBe(playerIds[i]);
      s = unwrap(reduce(s, { type: 'DRAW_CARD', playerId: s.turn.currentPlayerId }, seededRng()));
      s = unwrap(reduce(s, { type: 'DISCARD_CARD', playerId: s.turn.currentPlayerId }));
      s = unwrap(reduce(s, { type: 'END_TURN', playerId: s.turn.currentPlayerId }));
    }

    expect(s.turn.currentPlayerId).toBe(playerIds[0]);
  });
});

describe('reducer purity', () => {
  it('never mutates the input state object', () => {
    const { state } = setupPlayingGame(2);
    const before = JSON.parse(JSON.stringify(state, (_key, v) => (v instanceof Set ? [...v] : v)));

    reduce(state, { type: 'DRAW_CARD', playerId: state.turn.currentPlayerId }, seededRng());

    const after = JSON.parse(JSON.stringify(state, (_key, v) => (v instanceof Set ? [...v] : v)));
    expect(after).toEqual(before);
  });
});
