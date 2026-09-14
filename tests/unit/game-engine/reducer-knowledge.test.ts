import { describe, expect, it } from 'vitest';
import { INITIAL_PEEK_POSITIONS, knows, reduce } from '@cabo/game-engine';
import { seededRng, setupPlayingGame, unwrap } from './helpers.js';

describe('ACK_INITIAL_PEEK grants knowledge (§J)', () => {
  it("grants each player knowledge of their own INITIAL_PEEK_POSITIONS cards, and no one else's", () => {
    const { state, playerIds } = setupPlayingGame(2);
    const aliceId = playerIds[0]!;
    const bobId = playerIds[1]!;
    const aliceHand = state.players.find((p) => p.id === aliceId)!.hand;
    const bobHand = state.players.find((p) => p.id === bobId)!.hand;

    for (const position of INITIAL_PEEK_POSITIONS) {
      expect(knows(state.knowledge, aliceId, aliceHand[position]!)).toBe(true);
      expect(knows(state.knowledge, bobId, bobHand[position]!)).toBe(true);
      // bob doesn't know alice's peeked cards, and vice versa
      expect(knows(state.knowledge, bobId, aliceHand[position]!)).toBe(false);
      expect(knows(state.knowledge, aliceId, bobHand[position]!)).toBe(false);
    }
  });

  it('does not grant knowledge of the non-peeked positions', () => {
    const { state, playerIds } = setupPlayingGame(2);
    const aliceId = playerIds[0]!;
    const aliceHand = state.players.find((p) => p.id === aliceId)!.hand;
    const nonPeeked = aliceHand
      .map((_, i) => i)
      .filter((i) => !(INITIAL_PEEK_POSITIONS as readonly number[]).includes(i));

    for (const position of nonPeeked) {
      expect(knows(state.knowledge, aliceId, aliceHand[position]!)).toBe(false);
    }
  });
});

describe('DRAW_CARD grants knowledge (§J)', () => {
  it('grants the drawer knowledge of the drawn card, and no one else', () => {
    const { state, playerIds } = setupPlayingGame(2);
    const current = state.turn.currentPlayerId;
    const other = playerIds.find((id) => id !== current)!;

    const result = unwrap(reduce(state, { type: 'DRAW_CARD', playerId: current }, seededRng()));
    const drawnId = result.turn.drawnCard!;

    expect(knows(result.knowledge, current, drawnId)).toBe(true);
    expect(knows(result.knowledge, other, drawnId)).toBe(false);
  });

  it('grants knowledge unconditionally even though the card will immediately be discarded', () => {
    const { state } = setupPlayingGame(2);
    const current = state.turn.currentPlayerId;

    const drawn = unwrap(reduce(state, { type: 'DRAW_CARD', playerId: current }, seededRng()));
    const drawnId = drawn.turn.drawnCard!;
    const afterDiscard = unwrap(reduce(drawn, { type: 'DISCARD_CARD', playerId: current }));

    // §J: the draw grant is permanent — discarding the card doesn't revoke it.
    expect(knows(afterDiscard.knowledge, current, drawnId)).toBe(true);
  });
});
