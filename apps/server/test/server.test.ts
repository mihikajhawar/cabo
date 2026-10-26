import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { testEnv } from '@cabo/game-engine';
import { startServer } from '../src/server';
import type { Timers } from '../src/manager';

type Srv = Awaited<ReturnType<typeof startServer>>;
const open: { srv?: Srv; clients: Socket[] } = { clients: [] };
afterEach(async () => { open.clients.forEach((c) => c.close()); open.clients = []; await open.srv?.close(); });

function fakeTimers() {
  const q: { fn: () => void; ms: number; h: number; live: boolean }[] = []; let n = 0;
  const t: Timers & { q: typeof q; fireAll(): void } = {
    q, set: (fn, ms) => { const h = ++n; q.push({ fn, ms, h, live: true }); return h; },
    clear: (h) => { const x = q.find((e) => e.h === h); if (x) x.live = false; },
    fireAll() { for (const e of q.filter((e) => e.live)) { e.live = false; e.fn(); } },
  };
  return t;
}
const setup = async (timers = fakeTimers(), env = testEnv(5)) => {
  open.srv = await startServer({ port: 0, env, timers, corsOrigin: '*' });
  return { srv: open.srv, timers, env };
};

class Client {
  s: Socket; last: any = null; events: any[] = []; n = 0; code = ''; playerId = ''; token = '';
  constructor(port: number) {
    this.s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    open.clients.push(this.s);
    this.s.on('UPDATE', (u: any) => { this.last = u.view; this.events.push(...u.events); });
  }
  ready() { return new Promise<void>((r) => (this.s.connected ? r() : this.s.once('connect', () => r()))); }
  emit(ev: string, payload: unknown): Promise<any> { return new Promise((r) => this.s.emit(ev, payload, r)); }
  async create(name: string) { await this.ready(); const r = await this.emit('CREATE_GAME', { displayName: name }); Object.assign(this, r); return r; }
  async join(code: string, name: string) { await this.ready(); const r = await this.emit('JOIN_GAME', { code, displayName: name }); if (r.ok) Object.assign(this, r); return r; }
  act(action: any, actionId = Math.random().toString(36)) { return this.emit('ACTION', { actionId, action }); }
  async settle() { await new Promise((r) => setTimeout(r, 40)); }
}
const lobby = async (n = 3) => {
  const { srv, timers, env } = await setup();
  const cs: Client[] = [];
  const host = new Client(srv.port); await host.create('Host'); cs.push(host);
  for (let i = 1; i < n; i++) { const c = new Client(srv.port); const r = await c.join(host.code, `Friend${i}`); expect(r.ok).toBe(true); cs.push(c); }
  return { srv, timers, env, cs, host };
};
const startRound = async (cs: Client[]) => {
  expect((await cs[0]!.act({ type: 'START_GAME' })).ok).toBe(true);
  for (const c of cs) expect((await c.act({ type: 'ACK_INITIAL_PEEK' })).ok).toBe(true);
  await cs[0]!.settle();
};

describe('lobby over sockets', () => {
  it('create, join by code (case-insensitive), start; each client sees only its own view', async () => {
    const { cs, host } = await lobby(3);
    await host.settle();
    expect(host.last.players).toHaveLength(3);
    const dup = new Client(open.srv!.port); expect((await dup.join(host.code, 'host')).code).toBe('NAME_TAKEN');
    const nf = new Client(open.srv!.port); expect((await nf.join('ZZZZZ', 'x')).code).toBe('GAME_NOT_FOUND');
    await startRound(cs);
    for (const c of cs) {
      expect(c.last.phase).toBe('PLAYING');
      expect(c.last.you.playerId).toBe(c.playerId);
      expect(c.last.players.flatMap((p: any) => p.hand).every((h: any) => h.def === null)).toBe(true);
    }
  });
  it('wire payloads never contain another player’s card values (X1 over the wire)', async () => {
    const { cs } = await lobby(3);
    await startRound(cs);
    const first = cs.find((c) => c.last.turn.ownerId === c.playerId)!;
    await first.act({ type: 'DRAW_CARD' }); await first.settle();
    for (const c of cs) {
      const mine = c.last.you.drawnCard ? 1 : 0;
      const defs = JSON.stringify(c.last).match(/"rank"/g)?.length ?? 0;
      expect(defs).toBe(mine + (c.last.discardTop ? 1 : 0) + c.last.you.inspecting.length);
      if (c !== first) expect(c.last.you.drawnCard).toBeNull();
    }
    const others = cs.filter((c) => c !== first);
    for (const o of others) expect(o.events.filter((e) => e.type === 'PRIVATE_REVEAL' && e.data.reason === 'DRAW')).toHaveLength(0);
    expect(first.events.filter((e) => e.type === 'PRIVATE_REVEAL' && e.data.reason === 'DRAW')).toHaveLength(1);
  });
});

describe('cheating over sockets (X2, X3, X5)', () => {
  it('forged player id / extra fields / server-only actions / junk are rejected', async () => {
    const { cs } = await lobby(3); await startRound(cs);
    const owner = cs.find((c) => c.last.turn.ownerId === c.playerId)!;
    const other = cs.find((c) => c !== owner)!;
    expect((await other.act({ type: 'DRAW_CARD' })).code).toBe('NOT_YOUR_TURN');
    expect((await other.act({ type: 'DRAW_CARD', playerId: owner.playerId })).code).toBe('INVALID_PAYLOAD');
    expect((await owner.act({ type: 'DRAW_CARD', score: -99 })).code).toBe('INVALID_PAYLOAD');
    expect((await other.act({ type: 'EXPIRE_WINDOW', windowId: 1 })).code).toBe('INVALID_PAYLOAD');
    expect((await other.act({ type: 'PEEK_TIMEOUT' })).code).toBe('INVALID_PAYLOAD');
    expect((await other.act({ type: 'JOIN_GAME', displayName: 'x' })).code).toBe('INVALID_PAYLOAD');
    expect((await other.act('DRAW_CARD' as any)).code).toBe('INVALID_PAYLOAD');
    expect((await other.emit('ACTION', { action: { type: 'DRAW_CARD' } })).code).toBe('INVALID_PAYLOAD'); // no actionId
    const stranger = new Client(open.srv!.port); await stranger.ready();
    expect((await stranger.act({ type: 'DRAW_CARD' })).code).toBe('UNAUTHENTICATED');
    expect((await stranger.emit('RECONNECT', { token: 'guess' })).code).toBe('UNAUTHENTICATED');
  });
  it('replayed / duplicate actionId applies once and returns the original reply (X5)', async () => {
    const { cs, srv, host } = await lobby(3); await startRound(cs);
    const owner = cs.find((c) => c.last.turn.ownerId === c.playerId)!;
    const before = srv.manager._debug(host.code).state.deck.length;
    const r1 = await owner.act({ type: 'DRAW_CARD' }, 'same-id');
    const r2 = await owner.act({ type: 'DRAW_CARD' }, 'same-id');
    expect(r1).toEqual({ ok: true }); expect(r2).toEqual({ ok: true });
    expect(srv.manager._debug(host.code).state.deck.length).toBe(before - 1);
    // a failed action is cached too: same id keeps returning the same error
    const f1 = await owner.act({ type: 'DRAW_CARD' }, 'bad-id'); const f2 = await owner.act({ type: 'DRAW_CARD' }, 'bad-id');
    expect(f1).toEqual(f2); expect(f1.ok).toBe(false);
  });
  it('rate limiting kicks in', async () => {
    const { srv } = await setup(); await srv.close();
    open.srv = await startServer({ port: 0, env: testEnv(2), timers: fakeTimers(), maxActionsPerSecond: 5 });
    const c = new Client(open.srv.port); await c.ready();
    const rs = await Promise.all(Array.from({ length: 12 }, () => c.emit('ACTION', { actionId: 'a', action: { type: 'DRAW_CARD' } })));
    expect(rs.some((r) => r.code === 'RATE_LIMITED')).toBe(true);
  });
});

describe('contest race over real sockets (T6)', () => {
  it('many clients fire at once: exactly one wins, the rest are rejected', async () => {
    const { cs, srv, host, timers } = await lobby(4); await startRound(cs);
    const inst = srv.manager._debug(host.code);
    const owner = cs.find((c) => c.last.turn.ownerId === c.playerId)!;
    // rig: everybody holds a 7, top of draw pile is a 7 which the owner discards
    const s = inst.state; const sevens = (id: string) => s.players.find((p) => p.id === id)!.hand;
    for (const p of s.players) s.cards[p.hand[0]!.cardId] = { rank: '7', suit: 'S', value: 7 };
    s.cards[s.deck[0]!] = { rank: '7', suit: 'H', value: 7 };
    await owner.act({ type: 'DRAW_CARD' });
    if (owner.last.turn.step === 'AWAIT_POWER_DECISION') await owner.act({ type: 'SKIP_POWER' });
    await owner.act({ type: 'DISCARD_CARD' });
    await owner.settle();
    expect(owner.last.turn.step).toBe('CONTEST_WINDOW');
    const results = await Promise.all(cs.map((c) => c.act({ type: 'CONTEST_CARD', cardId: sevens(c.playerId)[0]!.cardId })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.code === 'WINDOW_CLOSED')).toBe(true);
    await owner.settle();
    expect(inst.state.windowCounter).toBe(1);
    void timers;
  });
  it('server-owned timer closes the window; client cannot extend it', async () => {
    const { cs, timers } = await lobby(3); await startRound(cs);
    const owner = cs.find((c) => c.last.turn.ownerId === c.playerId)!;
    await owner.act({ type: 'DRAW_CARD' });
    if (owner.last.turn.step === 'AWAIT_POWER_DECISION') await owner.act({ type: 'SKIP_POWER' });
    await owner.act({ type: 'DISCARD_CARD' }); await owner.settle();
    expect(owner.last.turn.step).toBe('CONTEST_WINDOW');
    expect(timers.q.some((t) => t.live && t.ms === 2000)).toBe(true);
    timers.fireAll(); await owner.settle();
    expect(owner.last.turn.step).toBe('AWAIT_CABO_DECISION');
  });
});

describe('idle cleanup', () => {
  it('sweeps games nobody is connected to after the TTL, keeps active ones', async () => {
    const { cs, srv, host } = await lobby(2);
    expect(srv.manager.sweep(Date.now() + 10 * 3600_000)).toBe(0); // still connected: kept
    cs.forEach((c) => c.s.close()); await new Promise((r) => setTimeout(r, 80));
    expect(srv.manager.sweep(Date.now() + 60_000)).toBe(0); // idle but within TTL
    expect(srv.manager.sweep(Date.now() + 3 * 3600_000)).toBe(1);
    expect(srv.manager.gameCount).toBe(0);
    expect((await new Client(srv.port).join(host.code, 'late')).code).toBe('GAME_NOT_FOUND');
  });
});

describe('disconnect / reconnect (N)', () => {
  it('game waits for a disconnected player; reconnect restores their private view', async () => {
    const { cs, srv, host } = await lobby(3); await startRound(cs);
    const owner = cs.find((c) => c.last.turn.ownerId === c.playerId)!;
    await owner.act({ type: 'DRAW_CARD' }); await owner.settle();
    const hadDrawn = owner.last.you.drawnCard;
    expect(hadDrawn).not.toBeNull();
    owner.s.close(); await new Promise((r) => setTimeout(r, 60));
    const watcher = cs.find((c) => c !== owner)!;
    expect(watcher.last.players.find((p: any) => p.playerId === owner.playerId).connected).toBe(false);
    expect(watcher.last.turn.ownerId).toBe(owner.playerId); // still their turn: no auto-play
    const back = new Client(srv.port); await back.ready();
    const r = await back.emit('RECONNECT', { token: owner.token }); expect(r.ok).toBe(true);
    await back.settle();
    expect(back.last.you.playerId).toBe(owner.playerId);
    expect(back.last.you.drawnCard).toEqual(hadDrawn);
    expect(srv.manager._debug(host.code).state.players.find((p) => p.id === owner.playerId)!.connected).toBe(true);
    // and the old token cannot be used by someone who just guesses another one
    expect((await new Client(srv.port).emit('RECONNECT', { token: owner.token + 'x' })).ok).toBe(false);
  });
  it('explicit LEAVE_GAME mid-round is permanent; token stops working', async () => {
    const { cs, srv } = await lobby(3); await startRound(cs);
    const leaver = cs[2]!;
    expect((await leaver.act({ type: 'LEAVE_GAME' })).ok).toBe(true);
    await leaver.settle();
    const r = await new Client(srv.port).emit('RECONNECT', { token: leaver.token });
    expect(r.ok).toBe(false);
    expect(cs[0]!.last.players.find((p: any) => p.playerId === leaver.playerId).hasLeft).toBe(true);
  });
  it('peek timeout starts the round even if someone never acks', async () => {
    const { cs, timers } = await lobby(3);
    await cs[0]!.act({ type: 'START_GAME' }); await cs[0]!.act({ type: 'ACK_INITIAL_PEEK' }); await cs[0]!.settle();
    expect(cs[0]!.last.phase).toBe('DEALING');
    timers.fireAll(); await cs[0]!.settle();
    expect(cs[0]!.last.phase).toBe('PLAYING');
  });
});
