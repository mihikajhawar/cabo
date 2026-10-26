import { expect } from 'vitest';
import {
  Action, CardDef, ErrorCode, GameEvent, GameState, PlayerId, RANK_VALUE, Rank,
  createGame, dispatch, testEnv,
} from '../src';

export const def = (rank: Rank): CardDef => ({ rank, suit: rank === 'K_RED' ? 'H' : 'S', value: RANK_VALUE[rank] });

export class G {
  env = testEnv(7);
  s!: GameState;
  events: GameEvent[] = [];
  ids: PlayerId[] = [];
  constructor(n = 3) {
    this.ids = Array.from({ length: n }, (_, i) => `P${i + 1}`);
    this.s = createGame('g1', 'ABCD', 'P1', 'Player1');
    for (let i = 1; i < n; i++) this.do(`P${i + 1}`, { type: 'JOIN_GAME', displayName: `Player${i + 1}` });
  }
  do(actor: PlayerId | 'SERVER', a: Action): GameEvent[] {
    const r = dispatch(this.s, actor, a, this.env);
    if (!r.ok) throw new Error(`${a.type} by ${actor} failed: ${r.code}`);
    this.s = r.state; this.events.push(...r.events);
    return r.events;
  }
  err(actor: PlayerId | 'SERVER', a: Action, code: ErrorCode) {
    const before = JSON.stringify([this.s, [...(this.s.publicKnowledge)]]);
    const r = dispatch(this.s, actor, a, this.env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
    expect(JSON.stringify([this.s, [...this.s.publicKnowledge]])).toBe(before); // failed action never mutates
  }
  start(starter = 'P1') {
    this.do(starter, { type: 'START_GAME' });
    for (const id of this.ids) this.do(id, { type: 'ACK_INITIAL_PEEK' });
    return this;
  }
  p(id: PlayerId) { return this.s.players.find((x) => x.id === id)!; }
  /** Card id at hand index i of player id. */
  card(id: PlayerId, i: number) { return this.p(id).hand[i]!.cardId; }
  /** Rig hands (ranks per player), top of draw pile, and discard top. */
  rig(o: { hands?: Record<PlayerId, Rank[]>; deck?: Rank[]; discard?: Rank }) {
    const s = this.s;
    for (const [pid, ranks] of Object.entries(o.hands ?? {})) {
      const p = this.p(pid);
      // trim or extend hand to rigged length using spare deck cards
      while (p.hand.length > ranks.length) s.outOfPlay.push(p.hand.pop()!.cardId);
      while (p.hand.length < ranks.length) p.hand.push({ cardId: s.deck.pop()!, slot: `a${p.hand.length}` });
      ranks.forEach((r, i) => { s.cards[p.hand[i]!.cardId] = def(r); });
    }
    (o.deck ?? []).forEach((r, i) => { s.cards[s.deck[i]!] = def(r); });
    if (o.discard) s.cards[s.discard[s.discard.length - 1]!] = def(o.discard);
    return this;
  }
  step() { return this.s.turn!.step.kind; }
  /** Draw then discard, leaving the contest window open. */
  drawDiscard(pid: PlayerId) {
    this.do(pid, { type: 'DRAW_CARD' });
    if (this.step() === 'AWAIT_POWER_DECISION') this.do(pid, { type: 'SKIP_POWER' });
    this.do(pid, { type: 'DISCARD_CARD' });
  }
  closeWindow() {
    const st = this.s.turn!.step;
    if (st.kind !== 'CONTEST_WINDOW') throw new Error('no window');
    this.do('SERVER', { type: 'EXPIRE_WINDOW', windowId: st.window.windowId });
  }
  /** Full no-op normal turn for the current owner. */
  endTurn(pid: PlayerId) { this.drawDiscard(pid); this.closeWindow(); this.do(pid, { type: 'END_TURN' }); }
}
