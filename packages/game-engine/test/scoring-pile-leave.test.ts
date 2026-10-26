import { describe, expect, it } from 'vitest';
import { projectFor, scoreRound, type GameState, type Rank } from '../src';
import { G } from './harness';

/** Run a round where P1 calls CABO immediately, with the given final hands, then return the result. */
function round(hands: Record<string, Rank[]>) {
  const n = Object.keys(hands).length;
  const g = new G(n).start('P1');
  g.drawDiscard('P1'); g.closeWindow();
  g.do('P1', { type: 'CALL_CABO' });
  g.rig({ hands });
  for (let i = 2; i <= n; i++) { // others burn a turn by drawing & keeping hands untouched
    g.do(`P${i}`, { type: 'DRAW_CARD' });
    if (g.step() === 'AWAIT_POWER_DECISION') g.do(`P${i}`, { type: 'SKIP_POWER' });
    g.do(`P${i}`, { type: 'DISCARD_CARD' }); g.closeWindow();
  }
  return g;
}
const h = (...r: Rank[]) => r;

describe('CABO scoring (S1-S4)', () => {
  it('caller 2 vs 3,5,7 wins', () => {
    const g = round({ P1: h('2'), P2: h('3'), P3: h('5'), P4: h('7') });
    expect(g.s.result).toMatchObject({ caboSucceeded: true, winnerIds: ['P1'], failureReason: null });
  });
  it('caller 2 vs 2,5,7 loses (tie) and the tied player wins', () => {
    const g = round({ P1: h('2'), P2: h('2'), P3: h('5'), P4: h('7') });
    expect(g.s.result).toMatchObject({ caboSucceeded: false, failureReason: 'TIED', blockers: ['P2'], winnerIds: ['P2'] });
  });
  it('caller 2 vs 1,5,7 loses (beaten)', () => {
    const g = round({ P1: h('2'), P2: h('A'), P3: h('5'), P4: h('7') });
    expect(g.s.result).toMatchObject({ caboSucceeded: false, failureReason: 'BEATEN', winnerIds: ['P2'] });
  });
  it('negative scores: -1 vs 0,2,5 wins; -1 vs -1,2,5 loses; -2 vs -1,0,5 wins', () => {
    expect(round({ P1: h('K_RED'), P2: h(), P3: h('2'), P4: h('5') }).s.result!.caboSucceeded).toBe(true);
    expect(round({ P1: h('K_RED'), P2: h('K_RED'), P3: h('2'), P4: h('5') }).s.result!.caboSucceeded).toBe(false);
    const g = round({ P1: h('K_RED', 'K_RED'), P2: h('K_RED'), P3: h(), P4: h('5') });
    expect(g.s.result).toMatchObject({ caboSucceeded: true, scores: { P1: -2, P2: -1, P3: 0, P4: 5 } });
  });
  it('failed CABO with tied non-callers: all lowest are winners, flagged as tie', () => {
    const g = round({ P1: h('9'), P2: h('3'), P3: h('3'), P4: h('8') });
    expect(g.s.result).toMatchObject({ caboSucceeded: false, winnerIds: ['P2', 'P3'], tie: true });
    expect(g.s.nextStarterId).toBeNull(); // tie: whoever presses Start goes first
    const v = projectFor(g.s, 'P4');
    expect(v.players.every((p) => p.hand.every((c) => c.def !== null))).toBe(true); // reveal at round end
  });
  it('next round: single winner starts; tie lets the presser start; history accumulates', () => {
    const g = round({ P1: h('2'), P2: h('3'), P3: h('5') });
    g.do('P3', { type: 'START_NEXT_ROUND' });
    expect(g.s.roundNumber).toBe(2); expect(g.s.starterId).toBe('P1'); // winner, not presser
    expect(g.s.history).toHaveLength(1);
    expect(g.s.players.every((p) => p.hand.length === 4 && !p.handLocked)).toBe(true);
    const t = round({ P1: h('9'), P2: h('3'), P3: h('3') });
    t.do('P3', { type: 'START_NEXT_ROUND' });
    expect(t.s.starterId).toBe('P3');
  });
  it('no-CABO score helper handles zero-card players', () => {
    const g = new G(2).start(); g.rig({ hands: { P1: [], P2: ['K_RED'] } });
    expect(scoreRound(g.s).scores).toEqual({ P1: 0, P2: -1 });
  });
});

describe('draw pile exhaustion (D1-D5)', () => {
  const drain = (g: G, keep = 0) => { g.s.deck.splice(0, g.s.deck.length - keep); };
  it('reshuffles discard (keeping top) when the pile is empty, re-minting ids', () => {
    const g = new G(3).start('P1');
    g.s.discard.unshift(...g.s.deck.splice(0, 10)); // 10 extra under the top
    for (const id of g.s.discard) g.s.publicKnowledge.add(id);
    drain(g); const top = g.s.discard.at(-1)!; const old = [...g.s.discard.slice(0, -1)];
    const ev = g.do('P1', { type: 'DRAW_CARD' });
    expect(ev.some((e) => e.type === 'DRAW_PILE_RESHUFFLED')).toBe(true);
    expect(g.s.discard).toEqual([top]);
    expect(g.s.deck.length + 1).toBe(old.length);
    for (const o of old) { expect(g.s.deck).not.toContain(o); expect(g.s.cards[o]).toBeUndefined(); expect(g.s.publicKnowledge.has(o)).toBe(false); }
  });
  it('penalty draw and zero-card substitute draw also reshuffle', () => {
    const g = new G(3).start('P1');
    g.s.discard.unshift(...g.s.deck.splice(0, 6));
    g.rig({ hands: { P2: ['9'], P3: ['7'] }, deck: ['7'] });
    g.drawDiscard('P1'); drain(g);
    g.do('P2', { type: 'CONTEST_CARD', cardId: g.card('P2', 0) }); // wrong -> penalty after reshuffle
    expect(g.p('P2').hand).toHaveLength(2);
    expect(g.s.discard.length).toBe(1 + 0);
    const g2 = new G(3).start('P1');
    g2.s.discard.unshift(...g2.s.deck.splice(0, 6));
    g2.rig({ hands: { P2: [], P3: ['7'] }, deck: ['7'] });
    g2.drawDiscard('P1'); drain(g2);
    g2.do('P2', { type: 'CONTEST_CARD', cardId: g2.card('P3', 0) });
    expect(g2.p('P3').hand).toHaveLength(1); expect(g2.p('P2').hand).toHaveLength(0);
  });
  it('total exhaustion: draw is skipped without crashing (D7)', () => {
    const g = new G(3).start('P1');
    g.s.deck.length = 0;
    const ev = g.do('P1', { type: 'DRAW_CARD' });
    expect(ev.some((e) => e.type === 'DRAW_SKIPPED')).toBe(true);
    expect(g.step()).toBe('AWAIT_CABO_DECISION');
  });
  it('all 52 cards are accounted for exactly once at every step of a long random game', () => {
    const g = new G(4).start('P1'); let guard = 0;
    while (g.s.phase === 'PLAYING' && guard++ < 300) {
      const owner = g.s.turn!.ownerId, st = g.s.turn!.step;
      if (st.kind === 'AWAIT_DRAW') g.do(owner, { type: 'DRAW_CARD' });
      else if (st.kind === 'AWAIT_POWER_DECISION') g.do(owner, { type: 'SKIP_POWER' });
      else if (st.kind === 'AWAIT_DISPOSE') g.do(owner, { type: guard % 2 ? 'REPLACE_CARD' : 'DISCARD_CARD', cardId: g.card(owner, 0) } as any);
      else if (st.kind === 'CONTEST_WINDOW') g.closeWindow();
      else if (st.kind === 'AWAIT_CABO_DECISION') g.do(owner, { type: 'END_TURN' });
      const s = g.s; const all = [...s.deck, ...s.discard, ...s.outOfPlay, ...s.players.flatMap((p) => p.hand.map((x) => x.cardId)),
        ...(s.turn && 'drawnCardId' in s.turn.step ? [s.turn.step.drawnCardId] : [])];
      expect(all).toHaveLength(52); expect(new Set(all).size).toBe(52);
      for (const id of all) expect(s.cards[id]).toBeDefined();
    }
  });
});

describe('leaving mid-round (D6)', () => {
  it('disconnect never advances the game', () => {
    const g = new G(3).start('P1');
    g.s.players[0]!.connected = false;
    expect(g.s.turn!.ownerId).toBe('P1'); expect(g.step()).toBe('AWAIT_DRAW');
  });
  it('leaver on their turn: cards out of play, next player up, drawn card forfeited', () => {
    const g = new G(3).start('P1'); g.do('P1', { type: 'DRAW_CARD' });
    g.do('P1', { type: 'LEAVE_GAME' });
    expect(g.s.turn!.ownerId).toBe('P2'); expect(g.p('P1').hand).toHaveLength(0);
    expect(g.s.outOfPlay.length).toBe(5);
    g.err('P1', { type: 'DRAW_CARD' }, 'UNAUTHENTICATED');
  });
  it('leaver during a contest window: window runs, then turn passes on', () => {
    const g = new G(3).start('P1'); g.drawDiscard('P1');
    g.do('P1', { type: 'LEAVE_GAME' });
    expect(g.step()).toBe('CONTEST_WINDOW'); g.closeWindow();
    expect(g.s.turn!.ownerId).toBe('P2'); expect(g.step()).toBe('AWAIT_DRAW');
  });
  it('leaver is dropped from the final-turn queue; round still ends', () => {
    const g = new G(4).start('P1'); g.drawDiscard('P1'); g.closeWindow(); g.do('P1', { type: 'CALL_CABO' });
    g.do('P3', { type: 'LEAVE_GAME' });
    expect(g.s.finalTurnQueue).toEqual(['P2', 'P4']);
    g.drawDiscard('P2'); g.closeWindow(); g.drawDiscard('P4'); g.closeWindow();
    expect(g.s.phase).toBe('ROUND_COMPLETE'); expect(Object.keys(g.s.result!.scores)).toEqual(['P1', 'P2', 'P4']);
  });
  it('leaver who is the current final-turn player hands over to the next', () => {
    const g = new G(3).start('P1'); g.drawDiscard('P1'); g.closeWindow(); g.do('P1', { type: 'CALL_CABO' });
    g.do('P2', { type: 'LEAVE_GAME' });
    expect(g.s.turn!.ownerId).toBe('P3');
  });
  it('CABO caller leaving cancels that CABO; final turns still finish', () => {
    const g = new G(3).start('P1'); g.drawDiscard('P1'); g.closeWindow(); g.do('P1', { type: 'CALL_CABO' });
    g.do('P1', { type: 'LEAVE_GAME' });
    g.drawDiscard('P2'); g.closeWindow(); g.drawDiscard('P3'); g.closeWindow();
    expect(g.s.result).toMatchObject({ caboSucceeded: false, failureReason: 'CALLER_LEFT' });
  });
  it('contester leaving during the give step does not stall the game', () => {
    const g = new G(3).start('P1'); g.rig({ hands: { P2: ['2'], P3: ['7'] }, deck: ['7'] });
    g.drawDiscard('P1'); g.do('P2', { type: 'CONTEST_CARD', cardId: g.card('P3', 0) });
    g.do('P2', { type: 'LEAVE_GAME' });
    expect(g.step()).toBe('AWAIT_CABO_DECISION');
  });
  it('one player left => game abandoned; lobby leave just removes', () => {
    const g = new G(2).start('P1'); g.do('P2', { type: 'LEAVE_GAME' });
    expect(g.s.phase).toBe('ABANDONED'); g.err('P1', { type: 'DRAW_CARD' }, 'GAME_ABANDONED');
    const l = new G(3); l.do('P2', { type: 'LEAVE_GAME' }); expect(l.s.players.map((p) => p.id)).toEqual(['P1', 'P3']);
  });
});
