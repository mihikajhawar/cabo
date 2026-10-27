import { describe, expect, it } from 'vitest';
import { dispatch, projectFor, CONTEST_WINDOW_MS } from '../src';
import { G } from './harness';

// P1 discards a 7 -> window open with 7 on top.
const open7 = (hands: Record<string, any[]>, g = new G(3).start('P1')) => {
  g.rig({ hands, deck: ['7'] });
  g.drawDiscard('P1');
  return g;
};

describe('contesting', () => {
  it('correct own contest: card to discard, hand may reach 0, window closes (T1)', () => {
    const g = open7({ P2: ['7'] });
    const ev = g.do('P2', { type: 'CONTEST_CARD', cardId: g.card('P2', 0) });
    expect(g.p('P2').hand).toHaveLength(0);
    expect(g.s.cards[g.s.discard.at(-1)!]!.rank).toBe('7');
    expect(g.step()).toBe('AWAIT_CABO_DECISION');
    expect(ev.some((e) => e.type === 'CONTEST_RESOLVED')).toBe(true);
    g.err('P3', { type: 'CONTEST_CARD', cardId: g.card('P3', 0) }, 'WINDOW_CLOSED');
  });
  it('turn owner may contest with their own matching card', () => {
    const g = open7({ P1: ['7', '2'] });
    g.do('P1', { type: 'CONTEST_CARD', cardId: g.card('P1', 0) });
    expect(g.p('P1').hand).toHaveLength(1);
  });
  it('correct opponent contest: target loses card, contester chooses what to give (T2)', () => {
    const g = open7({ P2: ['2', '3'], P3: ['7', '9'] });
    const tgt = g.card('P3', 0);
    g.do('P2', { type: 'CONTEST_CARD', cardId: tgt });
    expect(g.step()).toBe('AWAIT_GIVE_CARD');
    g.err('P1', { type: 'GIVE_CARD', cardId: g.card('P1', 0) }, 'NOT_YOUR_ACTION');
    g.err('P3', { type: 'CONTEST_CARD', cardId: g.card('P3', 0) }, 'WINDOW_CLOSED');
    g.err('P2', { type: 'GIVE_CARD', cardId: g.card('P3', 0) }, 'OWN_CARD_REQUIRED');
    const gift = g.card('P2', 1);
    g.do('P2', { type: 'GIVE_CARD', cardId: gift });
    expect(g.p('P2').hand).toHaveLength(1);
    expect(g.p('P3').hand.map((h) => h.cardId)).toContain(gift);
    expect(g.p('P3').hand).toHaveLength(2); // lost the 7, gained the gift
    expect(g.step()).toBe('AWAIT_CABO_DECISION');
  });
  it('zero-card contester draws a substitute and gives it to the target (T3)', () => {
    const g = open7({ P2: [], P3: ['7', '9'] });
    g.rig({ deck: ['K_RED'] }); // next draw is a red king (deck[0] after the 7 was drawn)
    const nextTop = g.s.deck[0]!;
    const ev = g.do('P2', { type: 'CONTEST_CARD', cardId: g.card('P3', 0) });
    expect(g.p('P2').hand).toHaveLength(0);
    expect(g.p('P3').hand.map((h) => h.cardId)).toContain(nextTop);
    // the substitute card is never seen by anyone: not by the giver, not by the receiver
    expect(g.s.knowledge['P2']?.has(nextTop) ?? false).toBe(false);
    expect(g.s.knowledge['P3']?.has(nextTop) ?? false).toBe(false);
    expect(ev.some((e) => e.type === 'PRIVATE_REVEAL')).toBe(false);
    expect(JSON.stringify(ev)).not.toContain('"def":{"rank":"K_RED"');
    expect(g.step()).toBe('AWAIT_CABO_DECISION');
  });
  it('wrong contest: public reveal, card stays, private penalty draw, window stays open (T4)', () => {
    const g = open7({ P2: ['9'], P3: ['2'] });
    const card = g.card('P2', 0); const before = g.p('P2').hand.length;
    const ev = g.do('P2', { type: 'CONTEST_CARD', cardId: card });
    const wrong = ev.find((e) => e.type === 'WRONG_CONTEST')!;
    expect(wrong.to).toBe('ALL'); expect((wrong.data.def as any).rank).toBe('9');
    expect(g.p('P2').hand.map((h) => h.cardId)).toContain(card);
    expect(g.p('P2').hand).toHaveLength(before + 1);
    // the penalty card goes into the hand face-down and is never revealed to anyone, including its owner
    expect(ev.some((e) => e.type === 'PRIVATE_REVEAL')).toBe(false);
    const penId = ev.find((e) => e.type === 'PENALTY_DRAWN')!.data.cardId as string;
    expect(g.p('P2').hand.map((h) => h.cardId)).toContain(penId);
    expect(g.s.knowledge['P2']?.has(penId) ?? false).toBe(false);
    const seen = projectFor(g.s, 'P2').players.find((p) => p.playerId === 'P2')!.hand.find((h) => h.cardId === penId)!;
    expect(seen.def).toBeNull();
    expect(g.step()).toBe('CONTEST_WINDOW'); // still open
    g.do('P3', { type: 'CONTEST_CARD', cardId: g.card('P3', 0) }); // another wrong one is fine too
  });
  it('wrong contest on an opponent card penalises the contester, not the owner', () => {
    const g = open7({ P2: ['2'], P3: ['9'] });
    g.do('P2', { type: 'CONTEST_CARD', cardId: g.card('P3', 0) });
    expect(g.p('P2').hand).toHaveLength(2); expect(g.p('P3').hand).toHaveLength(1);
  });
  it('Red King <-> Black King contest succeeds (T8)', () => {
    const g = new G(3).start('P1');
    g.rig({ hands: { P2: ['K_BLACK'] }, deck: ['K_RED'] });
    g.do('P1', { type: 'DRAW_CARD' });
    g.do('P1', { type: 'DISCARD_CARD' }); // discard drawn king without using power
    g.do('P2', { type: 'CONTEST_CARD', cardId: g.card('P2', 0) });
    expect(g.p('P2').hand).toHaveLength(0);
  });
  it('the toss window is 5 seconds', () => { expect(CONTEST_WINDOW_MS).toBe(5000); });
  it('expiry: just inside the window accepted, at the deadline rejected; stale timer harmless (T7)', () => {
    const g = open7({ P2: ['7'] });
    const w = (g.s.turn!.step as any).window;
    g.env.t = w.openedAt + CONTEST_WINDOW_MS;
    g.err('P2', { type: 'CONTEST_CARD', cardId: g.card('P2', 0) }, 'WINDOW_CLOSED');
    g.env.t = w.openedAt + CONTEST_WINDOW_MS - 1;
    g.do('P2', { type: 'CONTEST_CARD', cardId: g.card('P2', 0) });
    g.do('SERVER', { type: 'EXPIRE_WINDOW', windowId: w.windowId }); // stale: no-op
    expect(g.step()).toBe('AWAIT_CABO_DECISION');
  });
  it('window expiry moves to CABO decision; a later window is not closed by an old timer', () => {
    const g = new G(3).start('P1');
    g.drawDiscard('P1'); const w1 = (g.s.turn!.step as any).window.windowId;
    g.closeWindow(); g.do('P1', { type: 'END_TURN' });
    g.drawDiscard('P2');
    g.do('SERVER', { type: 'EXPIRE_WINDOW', windowId: w1 });
    expect(g.step()).toBe('CONTEST_WINDOW');
  });
  it('only server may expire windows', () => {
    const g = new G(3).start('P1'); g.drawDiscard('P1');
    g.err('P1', { type: 'EXPIRE_WINDOW', windowId: 1 }, 'NOT_SERVER');
  });
  it('simultaneous contests: exactly one success (T6) - fuzzed orderings', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const g = open7({ P1: ['7', '2'], P2: ['7', '3'], P3: ['7', '4'] });
      const attempts = [['P2', 'P3', 0], ['P3', 'P1', 0], ['P1', 'P2', 0]] as const;
      const order = [...attempts].sort(() => ((seed * 9301 + 49297) % 233280) / 233280 - 0.5);
      let ok = 0;
      for (const [actor, owner, i] of order) {
        const r = dispatch(g.s, actor, { type: 'CONTEST_CARD', cardId: g.card(owner, i) }, g.env);
        if (r.ok && r.events.some((e) => e.type === 'CONTEST_RESOLVED')) { ok++; g.s = r.state; }
      }
      expect(ok).toBe(1);
    }
  });
  it('contest is illegal outside a window', () => {
    const g = new G(3).start('P1');
    g.err('P2', { type: 'CONTEST_CARD', cardId: g.card('P3', 0) }, 'WINDOW_CLOSED');
  });
  it('a successful contest does not open another window (T9)', () => {
    const g = open7({ P2: ['7'] });
    g.do('P2', { type: 'CONTEST_CARD', cardId: g.card('P2', 0) });
    expect(g.s.windowCounter).toBe(1);
  });
});

describe('CABO', () => {
  const toCabo = (g: G, pid = 'P1') => { g.drawDiscard(pid); g.closeWindow(); };
  it('only callable at the CABO decision of a normal turn (O1, O2)', () => {
    const g = new G(3).start('P1');
    g.err('P1', { type: 'CALL_CABO' }, 'CABO_NOT_AVAILABLE'); // before draw
    g.rig({ deck: ['9'] }); g.do('P1', { type: 'DRAW_CARD' });
    g.err('P1', { type: 'CALL_CABO' }, 'CABO_NOT_AVAILABLE'); // during power
    g.do('P1', { type: 'SKIP_POWER' });
    g.err('P1', { type: 'CALL_CABO' }, 'CABO_NOT_AVAILABLE'); // dispose
    g.do('P1', { type: 'DISCARD_CARD' });
    g.err('P1', { type: 'CALL_CABO' }, 'CABO_NOT_AVAILABLE'); // window
    g.closeWindow();
    g.err('P2', { type: 'CALL_CABO' }, 'CABO_NOT_AVAILABLE');
    g.do('P1', { type: 'CALL_CABO' });
  });
  it('locks hand immediately; caller excluded from final turns; one turn each (O3, O4)', () => {
    const g = new G(4).start('P1'); toCabo(g);
    g.do('P1', { type: 'CALL_CABO' });
    expect(g.p('P1').handLocked).toBe(true);
    expect(g.s.phase).toBe('FINAL_TURNS');
    expect(g.s.finalTurnQueue).toEqual(['P2', 'P3', 'P4']);
    for (const pid of ['P2', 'P3', 'P4']) {
      expect(g.s.turn!.ownerId).toBe(pid);
      g.drawDiscard(pid); g.closeWindow();
    }
    expect(g.s.phase).toBe('ROUND_COMPLETE');
    expect(g.s.result).not.toBeNull();
  });
  it('final-turn players cannot call CABO or END_TURN (O7)', () => {
    const g = new G(3).start('P1'); toCabo(g); g.do('P1', { type: 'CALL_CABO' });
    g.drawDiscard('P2'); g.closeWindow();
    expect(g.s.turn!.ownerId).toBe('P3'); // advanced automatically
    g.err('P3', { type: 'CALL_CABO' }, 'CABO_NOT_AVAILABLE');
    g.err('P3', { type: 'END_TURN' }, 'WRONG_STEP');
  });
  it('caller can do nothing afterwards, incl. contesting (O6)', () => {
    const g = new G(3).start('P1'); toCabo(g); g.do('P1', { type: 'CALL_CABO' });
    g.rig({ deck: ['7'], hands: { P1: ['7'], P3: ['7'] } });
    g.drawDiscard('P2');
    // wrong or right, own or opponent's, zero-card variant: all blocked
    g.err('P1', { type: 'CONTEST_CARD', cardId: g.card('P1', 0) }, 'ACTOR_LOCKED');
    g.err('P1', { type: 'CONTEST_CARD', cardId: g.card('P3', 0) }, 'ACTOR_LOCKED');
    g.err('P1', { type: 'DRAW_CARD' }, 'ACTOR_LOCKED');
    g.err('P1', { type: 'END_TURN' }, 'ACTOR_LOCKED');
  });
  it('locked cards cannot be targeted by contests or any power (O5, P6)', () => {
    for (const power of ['LOOK_OPPONENT', 'BLIND_SWAP', 'KING'] as const) {
      const g = new G(3).start('P1'); toCabo(g); g.do('P1', { type: 'CALL_CABO' });
      const locked = g.card('P1', 0);
      g.rig({ deck: [power === 'LOOK_OPPONENT' ? '9' : power === 'BLIND_SWAP' ? 'J' : 'K_RED'] });
      g.do('P2', { type: 'DRAW_CARD' });
      if (power === 'LOOK_OPPONENT') g.err('P2', { type: 'LOOK_AT_OPPONENT_CARD', cardId: locked }, 'TARGET_LOCKED');
      if (power === 'BLIND_SWAP') {
        g.err('P2', { type: 'BLIND_SWAP', cardIdA: locked, cardIdB: g.card('P2', 0) }, 'TARGET_LOCKED');
        g.err('P2', { type: 'BLIND_SWAP', cardIdA: g.card('P2', 0), cardIdB: locked }, 'TARGET_LOCKED');
      }
      if (power === 'KING') g.err('P2', { type: 'KING_INSPECT', cardIdA: locked, cardIdB: g.card('P3', 0) }, 'TARGET_LOCKED');
    }
    const g = new G(3).start('P1'); toCabo(g); g.rig({ hands: { P1: ['7'] }, deck: ['7'] });
    g.do('P1', { type: 'CALL_CABO' }); g.drawDiscard('P2');
    g.err('P3', { type: 'CONTEST_CARD', cardId: g.card('P1', 0) }, 'TARGET_LOCKED'); // illegal => no penalty
    expect(g.p('P3').hand).toHaveLength(4);
  });
  it('caller’s hand is unchanged through final turns (O3 property)', () => {
    for (let seed = 1; seed < 15; seed++) {
      const g = new G(4); g.env = (await_env(seed)); g.start('P1'); toCabo(g); g.do('P1', { type: 'CALL_CABO' });
      const snap = JSON.stringify(g.p('P1').hand);
      let guard = 0;
      while (g.s.phase === 'FINAL_TURNS' && guard++ < 50) {
        const owner = g.s.turn!.ownerId;
        const v = projectFor(g.s, owner, g.env.now());
        const a = v.you.allowedActions.find((x) => x === 'DRAW_CARD') ?? 'SKIP_POWER';
        const st = g.s.turn!.step;
        if (st.kind === 'AWAIT_DRAW') g.do(owner, { type: 'DRAW_CARD' });
        else if (st.kind === 'AWAIT_POWER_DECISION') g.do(owner, { type: 'SKIP_POWER' });
        else if (st.kind === 'AWAIT_DISPOSE') g.do(owner, { type: 'DISCARD_CARD' });
        else if (st.kind === 'CONTEST_WINDOW') {
          // everyone hammers the locked caller's cards
          for (const pid of g.ids) for (const h of g.p('P1').hand) {
            const r = dispatch(g.s, pid, { type: 'CONTEST_CARD', cardId: h.cardId }, g.env);
            expect(r.ok).toBe(false);
          }
          g.closeWindow();
        } else if (st.kind === 'AWAIT_GIVE_CARD') g.do(st.contesterId, { type: 'GIVE_CARD', cardId: g.card(st.contesterId, 0) });
        void a;
      }
      expect(JSON.stringify(g.p('P1').hand)).toBe(snap);
    }
  });
  it('zero-card player may call CABO (O8)', () => {
    const g = new G(3).start('P1'); g.rig({ hands: { P1: [] } }); toCabo(g);
    g.do('P1', { type: 'CALL_CABO' });
    expect(g.p('P1').handLocked).toBe(true);
  });
});

import { testEnv } from '../src';
function await_env(seed: number) { return testEnv(seed); }
