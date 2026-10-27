import { describe, expect, it } from 'vitest';
import { createDeckDefs, RANK_VALUE, projectFor, scorePlayer, ranksMatchForContest, testEnv, shuffle } from '../src';
import { G, def } from './harness';

describe('cards & deck (B3, C1-C3)', () => {
  it('has 52 cards, 4 of each plain rank, 2 red + 2 black kings, no jokers', () => {
    const d = createDeckDefs();
    expect(d).toHaveLength(52);
    for (const r of ['A','2','3','4','5','6','7','8','9','10','J','Q'] as const) expect(d.filter((c) => c.rank === r)).toHaveLength(4);
    expect(d.filter((c) => c.rank === 'K_RED')).toHaveLength(2);
    expect(d.filter((c) => c.rank === 'K_BLACK')).toHaveLength(2);
  });
  it('card values', () => {
    const exp = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K_RED: -1, K_BLACK: 13 };
    expect(RANK_VALUE).toEqual(exp);
  });
  it('rank matching incl. Red/Black King', () => {
    expect(ranksMatchForContest('7', '7')).toBe(true);
    expect(ranksMatchForContest('K_RED', 'K_BLACK')).toBe(true);
    expect(ranksMatchForContest('K_BLACK', 'K_RED')).toBe(true);
    expect(ranksMatchForContest('7', '8')).toBe(false);
    expect(ranksMatchForContest('J', 'Q')).toBe(false);
    expect(ranksMatchForContest('A', '2')).toBe(false);
  });
  it('shuffle is a permutation', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(a, testEnv(3)).sort()).toEqual(a);
  });
});

describe('lobby & deal (B1-B5)', () => {
  it('join rules', () => {
    const g = new G(2);
    g.err('P3', { type: 'JOIN_GAME', displayName: '' }, 'INVALID_NAME');
    g.err('P3', { type: 'JOIN_GAME', displayName: 'player1' }, 'NAME_TAKEN');
    for (let i = 3; i <= 6; i++) g.do(`P${i}`, { type: 'JOIN_GAME', displayName: `X${i}` });
    g.err('P7', { type: 'JOIN_GAME', displayName: 'X7' }, 'GAME_FULL');
  });
  it('cannot start alone; any player may start; cannot join after start', () => {
    const solo = new G(1);
    solo.err('P1', { type: 'START_GAME' }, 'NOT_ENOUGH_PLAYERS');
    const g = new G(3);
    g.do('P2', { type: 'START_GAME' });
    g.err('P9', { type: 'JOIN_GAME', displayName: 'Late' }, 'GAME_STARTED');
  });
  it('deals 4 each; the discard pile is empty until the first turn; starter goes first; unique ids', () => {
    const g = new G(4);
    g.do('P3', { type: 'START_GAME' });
    const s = g.s;
    expect(s.players.every((p) => p.hand.length === 4)).toBe(true);
    expect(s.discard).toHaveLength(0);
    expect(projectFor(s, 'P1').discardTop).toBeNull();
    expect(s.deck).toHaveLength(52 - 16);
    expect(new Set(Object.keys(s.cards)).size).toBe(52);
    expect(s.phase).toBe('DEALING');
    for (const id of g.ids) g.do(id, { type: 'ACK_INITIAL_PEEK' });
    expect(g.s.phase).toBe('PLAYING');
    expect(g.s.turn!.ownerId).toBe('P3');
  });
  it('initial peek is exactly a21 + a22, private to each player', () => {
    const g = new G(3);
    g.do('P1', { type: 'START_GAME' });
    for (const e of g.events.filter((e) => e.type === 'PRIVATE_REVEAL')) {
      expect(e.to).not.toBe('ALL');
      expect(e.data.reason).toBe('INITIAL_PEEK');
    }
    for (const id of g.ids) {
      const mine = g.events.filter((e) => e.to === id && e.type === 'PRIVATE_REVEAL');
      expect(mine).toHaveLength(2);
      const slots = mine.map((e) => g.p(id).hand.find((h) => h.cardId === e.data.cardId)!.slot).sort();
      expect(slots).toEqual(['a21', 'a22']);
    }
    // the view shows the peek cards only to their owner, and none to others
    const v = projectFor(g.s, 'P1');
    expect(v.you.inspecting).toHaveLength(2);
    expect(v.players.flatMap((p) => p.hand).every((c) => c.def === null)).toBe(true);
    g.do('P1', { type: 'ACK_INITIAL_PEEK' });
    expect(projectFor(g.s, 'P1').you.inspecting).toHaveLength(0);
  });
  it('peek timeout acks everyone', () => {
    const g = new G(2);
    g.do('P1', { type: 'START_GAME' });
    g.do('SERVER', { type: 'PEEK_TIMEOUT' });
    expect(g.s.phase).toBe('PLAYING');
  });
  it('turn order follows seats and wraps', () => {
    const g = new G(3).start('P2');
    expect(g.s.turn!.ownerId).toBe('P2');
    g.endTurn('P2'); expect(g.s.turn!.ownerId).toBe('P3');
    g.endTurn('P3'); expect(g.s.turn!.ownerId).toBe('P1');
    g.endTurn('P1'); expect(g.s.turn!.ownerId).toBe('P2');
  });
});

describe('scoring (C3, C4)', () => {
  it('sums values; empty hand is 0; red kings go negative; >4 cards fine', () => {
    const g = new G(2).start();
    g.rig({ hands: { P1: [], P2: ['K_RED', 'K_RED'] } });
    expect(scorePlayer(g.s, g.p('P1'))).toBe(0);
    expect(scorePlayer(g.s, g.p('P2'))).toBe(-2);
    g.rig({ hands: { P1: ['A', '2', '3', '4', '5', '6'] } });
    expect(scorePlayer(g.s, g.p('P1'))).toBe(21);
    expect(def('K_BLACK').value).toBe(13);
  });
});
