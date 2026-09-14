import { describe, expect, it } from 'vitest';
import { asGameId, asPlayerId } from '@cabo/shared-types';
import { createInitialGameState, grantKnowledge, projectPlayerView, type GameState } from '@cabo/game-engine';
import { card, cardsById } from './helpers.js';

const alice = asPlayerId('alice');
const bob = asPlayerId('bob');

const aliceCard1 = card('a1', 'A', 1);
const aliceCard2 = card('a2', '7', 7);
const bobCard1 = card('b1', 'K_RED', -1);
const bobCard2 = card('b2', 'Q', 12);
const discardTop = card('d1', '5', 5);

function baseFixture(): GameState {
  const base = createInitialGameState(asGameId('g1'), { id: alice, displayName: 'Alice' });
  const bobState = {
    id: bob,
    displayName: 'Bob',
    connected: true,
    hand: [bobCard1.id, bobCard2.id],
    isCaboCaller: false,
    handLocked: false,
    hasTakenFinalTurn: false,
    ackedInitialPeek: false,
  };

  return {
    ...base,
    players: [
      { ...base.players[0]!, hand: [aliceCard1.id, aliceCard2.id] },
      bobState,
    ],
    cardsById: cardsById([aliceCard1, aliceCard2, bobCard1, bobCard2, discardTop]),
    discardPile: [discardTop],
    turn: { ...base.turn, phase: 'PLAYING', currentPlayerId: bob },
  };
}

describe('projectPlayerView', () => {
  it('shows real values only for cards the viewer has a knowledge grant for — self and opponent alike', () => {
    let state = baseFixture();
    state = { ...state, knowledge: grantKnowledge(state.knowledge, alice, aliceCard1.id) };
    state = { ...state, knowledge: grantKnowledge(state.knowledge, alice, bobCard1.id) };

    const view = projectPlayerView(state, alice);

    expect(view.self.hand).toEqual([
      { cardInstanceId: aliceCard1.id, position: 0, value: aliceCard1.def, locked: false },
      { cardInstanceId: aliceCard2.id, position: 1, value: 'hidden', locked: false },
    ]);

    const bobView = view.opponents.find((o) => o.playerId === bob)!;
    expect(bobView.hand).toEqual([
      { cardInstanceId: bobCard1.id, position: 0, value: bobCard1.def, locked: false },
      { cardInstanceId: bobCard2.id, position: 1, value: 'hidden', locked: false },
    ]);
  });

  it("never leaks a card's value to a viewer without a grant for it — even the card's own owner's view is irrelevant", () => {
    const state = baseFixture(); // no knowledge granted to anyone
    const aliceView = projectPlayerView(state, alice);
    const bobView = projectPlayerView(state, bob);

    expect(aliceView.self.hand.every((c) => c.value === 'hidden')).toBe(true);
    expect(bobView.self.hand.every((c) => c.value === 'hidden')).toBe(true);
    expect(aliceView.opponents[0]!.hand.every((c) => c.value === 'hidden')).toBe(true);
  });

  it("bob knowing his own card does not leak it into alice's view of bob", () => {
    let state = baseFixture();
    state = { ...state, knowledge: grantKnowledge(state.knowledge, bob, bobCard1.id) };

    const aliceView = projectPlayerView(state, alice);
    const bobOpponentView = aliceView.opponents.find((o) => o.playerId === bob)!;

    expect(bobOpponentView.hand.every((c) => c.value === 'hidden')).toBe(true);
  });

  it('reflects handLocked on every card in a locked hand', () => {
    let state = baseFixture();
    state = {
      ...state,
      players: state.players.map((p) => (p.id === bob ? { ...p, handLocked: true } : p)),
    };

    const view = projectPlayerView(state, alice);
    const bobView = view.opponents.find((o) => o.playerId === bob)!;
    expect(bobView.hand.every((c) => c.locked === true)).toBe(true);
  });

  it('exposes discardPileTop as a real, public value regardless of viewer knowledge', () => {
    const state = baseFixture();
    const view = projectPlayerView(state, alice);
    expect(view.discardPileTop).toEqual(discardTop.def);
  });

  it('discardPileTop is null when the discard pile is empty', () => {
    const state = { ...baseFixture(), discardPile: [] };
    const view = projectPlayerView(state, alice);
    expect(view.discardPileTop).toBeNull();
  });

  it('passes through public turn/cabo fields unchanged', () => {
    const state: GameState = {
      ...baseFixture(),
      deck: { cards: [card('x1', '2', 2), card('x2', '3', 3)] },
      cabo: { called: true, callerId: bob, calledAfterTurnNumber: 3 },
      turn: { ...baseFixture().turn, contestWindow: { openedAtMs: 100, expiresAtMs: 2100, discardTopCardInstanceId: discardTop.id, resolved: false } },
    };

    const view = projectPlayerView(state, alice);
    expect(view.drawPileCount).toBe(2);
    expect(view.phase).toBe('PLAYING');
    expect(view.currentTurnPlayerId).toBe(bob);
    expect(view.caboCallerId).toBe(bob);
    expect(view.contestWindowExpiresAt).toBe(2100);
  });

  it('contestWindowExpiresAt is null when no contest window is open', () => {
    const state = baseFixture();
    const view = projectPlayerView(state, alice);
    expect(view.contestWindowExpiresAt).toBeNull();
  });

  it('lists every position with the correct index, in hand order', () => {
    const state = baseFixture();
    const view = projectPlayerView(state, alice);
    expect(view.self.hand.map((c) => c.position)).toEqual([0, 1]);
  });

  it('never includes the viewer themself in opponents', () => {
    const state = baseFixture();
    const view = projectPlayerView(state, alice);
    expect(view.opponents.some((o) => o.playerId === alice)).toBe(false);
  });
});
