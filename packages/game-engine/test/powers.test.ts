import { describe, expect, it } from 'vitest';
import { projectFor } from '../src';
import { G } from './harness';

const ready = () => new G(3).start('P1');

describe('turn flow', () => {
  it('discard / replace, drawn knowledge, window opens', () => {
    const g = ready().rig({ deck: ['5'] });
    const ev = g.do('P1', { type: 'DRAW_CARD' });
    expect(ev.find((e) => e.type === 'PRIVATE_REVEAL')!.to).toBe('P1');
    expect(ev.find((e) => e.type === 'CARD_DRAWN')!.data).not.toHaveProperty('def');
    expect(g.step()).toBe('AWAIT_DISPOSE');
    g.err('P2', { type: 'DRAW_CARD' }, 'NOT_YOUR_TURN');
    const old = g.card('P1', 0);
    g.do('P1', { type: 'REPLACE_CARD', cardId: old });
    expect(g.card('P1', 0)).not.toBe(old);
    expect(g.s.cards[g.s.discard.at(-1)!]!.rank).not.toBe('5'); // displaced card is on top
    expect(g.step()).toBe('CONTEST_WINDOW');
  });
  it('cannot replace someone else’s or unknown card; cannot skip draw', () => {
    const g = ready().rig({ deck: ['5'] });
    g.err('P1', { type: 'DISCARD_CARD' }, 'WRONG_STEP');
    g.do('P1', { type: 'DRAW_CARD' });
    g.err('P1', { type: 'REPLACE_CARD', cardId: g.card('P2', 0) }, 'OWN_CARD_REQUIRED');
    g.err('P1', { type: 'REPLACE_CARD', cardId: g.s.deck[0]! }, 'INVALID_TARGET');
    g.err('P1', { type: 'REPLACE_CARD', cardId: g.s.discard[0]! }, 'INVALID_TARGET');
    g.err('P1', { type: 'CALL_CABO' }, 'CABO_NOT_AVAILABLE');
  });
  it('held cards never trigger powers (P8) - only drawn ones do', () => {
    const g = ready().rig({ hands: { P1: ['7', '9', 'K_RED', 'J'] }, deck: ['2'] });
    g.do('P1', { type: 'DRAW_CARD' });
    expect(g.step()).toBe('AWAIT_DISPOSE'); // drawn 2 has no power
    g.do('P1', { type: 'REPLACE_CARD', cardId: g.card('P1', 0) }); // discarding a held 7 grants nothing
    expect(g.step()).toBe('CONTEST_WINDOW');
  });
  it('final-turn-free normal turn ends via END_TURN only after the window resolves', () => {
    const g = ready();
    g.drawDiscard('P1');
    g.err('P1', { type: 'END_TURN' }, 'WRONG_STEP');
    g.err('P1', { type: 'CALL_CABO' }, 'CABO_NOT_AVAILABLE');
    g.closeWindow();
    expect(g.step()).toBe('AWAIT_CABO_DECISION');
  });
});

describe('powers', () => {
  it('7/8 looks at own card, privately (P1)', () => {
    const g = ready().rig({ deck: ['8'] });
    g.do('P1', { type: 'DRAW_CARD' });
    expect(g.step()).toBe('AWAIT_POWER_DECISION');
    g.err('P1', { type: 'LOOK_AT_OPPONENT_CARD', cardId: g.card('P2', 0) }, 'POWER_KIND_MISMATCH');
    g.err('P1', { type: 'LOOK_AT_OWN_CARD', cardId: g.card('P2', 0) }, 'OWN_CARD_REQUIRED');
    const ev = g.do('P1', { type: 'LOOK_AT_OWN_CARD', cardId: g.card('P1', 1) });
    expect(ev.find((e) => e.type === 'PRIVATE_REVEAL')!.to).toBe('P1');
    expect(JSON.stringify(ev.filter((e) => e.to !== 'P1' && e.type !== 'CARD_DISCARDED'))).not.toContain('"def"');
    // rule: a used power forces the discard; the toss window opens and replace/keep are not offered
    expect(g.step()).toBe('CONTEST_WINDOW');
    expect(g.s.discard).toHaveLength(1);
    expect(g.p('P1').hand).toHaveLength(4);
    g.err('P1', { type: 'REPLACE_CARD', cardId: g.card('P1', 0) }, 'WRONG_STEP');
  });
  it('skipping a power still allows discard or replace (the drawn card is only forced out when its power is used)', () => {
    const g = ready().rig({ deck: ['8'] });
    g.do('P1', { type: 'DRAW_CARD' });
    g.do('P1', { type: 'SKIP_POWER' });
    expect(g.step()).toBe('AWAIT_DISPOSE');
    g.do('P1', { type: 'REPLACE_CARD', cardId: g.card('P1', 0) });
    expect(g.step()).toBe('CONTEST_WINDOW');
  });
  it('9/10 looks at opponent card only; not own; not locked', () => {
    const g = ready().rig({ deck: ['10'] });
    g.do('P1', { type: 'DRAW_CARD' });
    g.err('P1', { type: 'LOOK_AT_OPPONENT_CARD', cardId: g.card('P1', 0) }, 'OPPONENT_CARD_REQUIRED');
    const ev = g.do('P1', { type: 'LOOK_AT_OPPONENT_CARD', cardId: g.card('P2', 2) });
    expect(ev.filter((e) => e.type === 'PRIVATE_REVEAL').every((e) => e.to === 'P1')).toBe(true);
    expect(JSON.stringify(ev.filter((e) => e.to !== 'P1' && e.type !== 'CARD_DISCARDED'))).not.toContain('"def"');
    expect(g.step()).toBe('CONTEST_WINDOW');
  });
  it('J/Q blind swap: all target combos; distinct required; nothing revealed', () => {
    const combos: [[string, number], [string, number]][] = [
      [['P1', 0], ['P1', 1]], [['P1', 0], ['P2', 0]], [['P2', 0], ['P2', 1]], [['P2', 0], ['P3', 0]],
    ];
    for (const [[pa, ia], [pb, ib]] of combos) {
      const g = ready().rig({ deck: ['Q'] });
      const a = g.card(pa, ia), b = g.card(pb, ib);
      g.do('P1', { type: 'DRAW_CARD' });
      g.err('P1', { type: 'BLIND_SWAP', cardIdA: a, cardIdB: a }, 'TARGETS_NOT_DISTINCT');
      const ev = g.do('P1', { type: 'BLIND_SWAP', cardIdA: a, cardIdB: b });
      expect(g.p(pa).hand[ia]!.cardId).toBe(b);
      expect(g.p(pb).hand[ib]!.cardId).toBe(a);
      expect(JSON.stringify(ev.filter((e) => e.type !== 'CARD_DISCARDED'))).not.toContain('"def"');
      expect(ev.some((e) => e.type === 'PRIVATE_REVEAL')).toBe(false);
      expect(g.step()).toBe('CONTEST_WINDOW'); // forced discard after the power
    }
  });
  it('King: inspect then swap, and inspect then decline; red & black', () => {
    for (const k of ['K_RED', 'K_BLACK'] as const) for (const swap of [true, false]) {
      const g = ready().rig({ deck: [k] });
      const a = g.card('P2', 0), b = g.card('P3', 3);
      g.do('P1', { type: 'DRAW_CARD' });
      const ev = g.do('P1', { type: 'KING_INSPECT', cardIdA: a, cardIdB: b });
      expect(ev.filter((e) => e.type === 'PRIVATE_REVEAL')).toHaveLength(2);
      expect(projectFor(g.s, 'P1').you.inspecting).toHaveLength(2);
      expect(projectFor(g.s, 'P2').you.inspecting).toHaveLength(0);
      g.do('P1', { type: 'KING_SWAP_DECISION', swap });
      expect(g.p('P2').hand[0]!.cardId).toBe(swap ? b : a);
    }
  });
  it('powers with no legal target are skipped automatically (P7)', () => {
    const g = ready().rig({ hands: { P1: [], P2: [], P3: [] }, deck: ['7', '9', 'J'] });
    g.do('P1', { type: 'DRAW_CARD' }); expect(g.step()).toBe('AWAIT_DISPOSE'); // 7: no own card
    g.do('P1', { type: 'DISCARD_CARD' }); g.closeWindow(); g.do('P1', { type: 'END_TURN' });
    g.do('P2', { type: 'DRAW_CARD' }); expect(g.step()).toBe('AWAIT_DISPOSE'); // 9: nobody has cards
    g.do('P2', { type: 'DISCARD_CARD' }); g.closeWindow(); g.do('P2', { type: 'END_TURN' });
    g.rig({ hands: { P3: ['2'] } });
    g.do('P3', { type: 'DRAW_CARD' }); expect(g.step()).toBe('AWAIT_DISPOSE'); // J: only one eligible card
  });
  it('invalid power targets rejected (P5)', () => {
    const g = ready().rig({ deck: ['K_BLACK'] });
    g.do('P1', { type: 'DRAW_CARD' });
    g.err('P1', { type: 'KING_INSPECT', cardIdA: g.s.deck[0]!, cardIdB: g.card('P2', 0) }, 'INVALID_TARGET');
    g.err('P1', { type: 'KING_INSPECT', cardIdA: 'nope', cardIdB: g.card('P2', 0) }, 'INVALID_TARGET');
    g.err('P1', { type: 'KING_INSPECT', cardIdA: g.card('P2', 0), cardIdB: g.card('P2', 0) }, 'TARGETS_NOT_DISTINCT');
  });
  it('empty-handed player may keep drawn card (D1), no contest window', () => {
    const g = ready().rig({ hands: { P1: [] }, deck: ['K_RED'] });
    g.do('P1', { type: 'DRAW_CARD' });
    g.err('P1', { type: 'REPLACE_CARD', cardId: g.card('P2', 0) }, 'HAND_EMPTY');
    g.do('P1', { type: 'ADD_TO_HAND' });
    expect(g.p('P1').hand).toHaveLength(1);
    expect(g.step()).toBe('AWAIT_CABO_DECISION');
    // a player with cards cannot use ADD_TO_HAND
    g.do('P1', { type: 'END_TURN' });
    g.do('P2', { type: 'DRAW_CARD' });
    g.err('P2', { type: 'ADD_TO_HAND' }, 'HAND_NOT_EMPTY');
  });
});
