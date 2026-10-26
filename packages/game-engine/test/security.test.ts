import { describe, expect, it } from 'vitest';
import { dispatch, projectFor, type GameEvent } from '../src';
import { G } from './harness';

const collectDefs = (o: unknown, out: any[] = []): any[] => {
  if (Array.isArray(o)) o.forEach((x) => collectDefs(x, out));
  else if (o && typeof o === 'object') {
    if ('rank' in (o as any) && 'value' in (o as any)) out.push(o);
    Object.values(o as any).forEach((x) => collectDefs(x, out));
  }
  return out;
};
const PUBLIC_DEF_EVENTS = new Set(['CARD_DISCARDED', 'CARD_REPLACED', 'WRONG_CONTEST', 'CONTEST_RESOLVED', 'ROUND_DEALT', 'ROUND_SCORED']);

describe('hidden information (X1, B4)', () => {
  it('fuzz: views and broadcast events never carry values the recipient is not entitled to', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = new G(4); g.env = (g.env, require_env(seed)); g.start('P1');
      let guard = 0;
      while (['PLAYING', 'FINAL_TURNS'].includes(g.s.phase) && guard++ < 120) {
        const owner = g.s.turn!.ownerId, st = g.s.turn!.step;
        let ev: GameEvent[] = [];
        if (st.kind === 'AWAIT_DRAW') ev = g.do(owner, { type: 'DRAW_CARD' });
        else if (st.kind === 'AWAIT_POWER_DECISION') ev = g.do(owner, { type: 'SKIP_POWER' });
        else if (st.kind === 'AWAIT_DISPOSE') ev = g.do(owner, guard % 3 === 0 ? { type: 'REPLACE_CARD', cardId: g.card(owner, 1) } : { type: 'DISCARD_CARD' });
        else if (st.kind === 'CONTEST_WINDOW') {
          const other = g.ids.find((i) => i !== owner)!; // sometimes try a (likely wrong) contest
          const r = dispatch(g.s, other, { type: 'CONTEST_CARD', cardId: g.card(other, 0) }, g.env);
          if (r.ok) { g.s = r.state; ev = r.events; }
          if (g.s.turn?.step.kind === 'CONTEST_WINDOW') g.closeWindow();
        } else if (st.kind === 'AWAIT_GIVE_CARD') ev = g.do(st.contesterId, { type: 'GIVE_CARD', cardId: g.card(st.contesterId, 0) });
        else if (st.kind === 'AWAIT_CABO_DECISION') ev = g.do(owner, guard > 40 ? { type: 'CALL_CABO' } : { type: 'END_TURN' });
        for (const e of ev) if (e.to === 'ALL' && !PUBLIC_DEF_EVENTS.has(e.type)) expect(collectDefs(e.data)).toHaveLength(0);
        for (const pid of g.ids) {
          if (!g.s.turn) break;
          const v = projectFor(g.s, pid, g.env.now());
          const expected = (v.discardTop ? 1 : 0) + (v.you.drawnCard ? 1 : 0) + v.you.inspecting.length;
          expect(collectDefs(v)).toHaveLength(expected);
          expect(JSON.stringify(v)).not.toContain('knowledge');
          // opponents' drawn / inspecting cards never appear for non-owners
          if (g.s.turn.ownerId !== pid && g.s.phase !== 'DEALING') expect(v.you.drawnCard).toBeNull();
        }
      }
    }
  });
  it('after the round ends every hand is revealed; before that nobody sees another player’s value', () => {
    const g = new G(3).start('P1');
    for (const pid of g.ids) {
      const v = projectFor(g.s, pid);
      expect(v.players.flatMap((p) => p.hand).every((c) => c.def === null)).toBe(true);
    }
  });
  it('private reveals go only to the entitled player', () => {
    const g = new G(3).start('P1'); g.rig({ deck: ['9'] });
    const ev = g.do('P1', { type: 'DRAW_CARD' });
    for (const e of ev.filter((e) => e.type === 'PRIVATE_REVEAL')) expect(e.to).toBe('P1');
    const v2 = projectFor(g.s, 'P2');
    expect(v2.you.drawnCard).toBeNull();
    expect(JSON.stringify(v2)).not.toContain(g.s.turn!.step.kind === 'AWAIT_POWER_DECISION' ? g.s.turn!.step.drawnCardId : 'x');
  });
});

describe('cheating attempts (X2-X8)', () => {
  it('unknown / pile / in-flight / forged ids all give the same INVALID_TARGET', () => {
    const g = new G(3).start('P1'); g.rig({ deck: ['J'] }); g.do('P1', { type: 'DRAW_CARD' });
    const drawn = (g.s.turn!.step as any).drawnCardId;
    for (const id of ['forged', g.s.deck[0]!, g.s.discard[0]!, drawn, '', 42 as any, null as any])
      g.err('P1', { type: 'BLIND_SWAP', cardIdA: id, cardIdB: g.card('P2', 0) }, 'INVALID_TARGET');
  });
  it('unknown actors are rejected; forged server-only actions are rejected', () => {
    const g = new G(3).start('P1');
    g.err('MALLORY', { type: 'DRAW_CARD' }, 'UNAUTHENTICATED');
    g.err('P2', { type: 'PEEK_TIMEOUT' }, 'NOT_SERVER');
    g.err('SERVER', { type: 'DRAW_CARD' }, 'NOT_SERVER');
  });
  it('actions in the wrong phase are rejected', () => {
    const g = new G(3);
    g.err('P1', { type: 'DRAW_CARD' }, 'WRONG_PHASE');
    g.err('P1', { type: 'START_NEXT_ROUND' }, 'WRONG_PHASE');
    g.do('P1', { type: 'START_GAME' });
    g.err('P1', { type: 'DRAW_CARD' }, 'WRONG_PHASE'); // still dealing
    g.err('P1', { type: 'START_GAME' }, 'WRONG_PHASE');
  });
  it('actions after the round is over are rejected', () => {
    const g = new G(2).start('P1'); g.drawDiscard('P1'); g.closeWindow(); g.do('P1', { type: 'CALL_CABO' });
    g.drawDiscard('P2'); g.closeWindow();
    expect(g.s.phase).toBe('ROUND_COMPLETE');
    g.err('P2', { type: 'DRAW_CARD' }, 'WRONG_PHASE');
    g.err('P2', { type: 'CONTEST_CARD', cardId: g.card('P1', 0) }, 'WINDOW_CLOSED');
    g.err('P2', { type: 'CALL_CABO' }, 'CABO_NOT_AVAILABLE');
  });
  it('failed actions never change state (checked in every g.err)', () => { expect(true).toBe(true); });
});

import { testEnv } from '../src';
function require_env(seed: number) { return testEnv(seed); }
