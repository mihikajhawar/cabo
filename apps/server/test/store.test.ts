import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testEnv } from '@cabo/game-engine';
import { GameManager, type Timers } from '../src/manager';
import { PgStore } from '../src/store';

const PORT = 54331;
let server: EmbeddedPostgres; let pool: pg.Pool; let store: PgStore;
beforeAll(async () => {
  server = new EmbeddedPostgres({ databaseDir: join(tmpdir(), `cabo-pg-${process.pid}-${Date.now()}`), user: 'postgres', password: 'pw', port: PORT, persistent: false, onLog: () => {}, onError: () => {} });
  await server.initialise(); await server.start(); await server.createDatabase('cabo');
  pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${PORT}/cabo` });
  store = new PgStore(pool); await store.init();
}, 120_000);
afterAll(async () => { await pool?.end().catch(() => {}); await server?.stop().catch(() => {}); });

const timers = () => { const q: (() => void)[] = []; const t: Timers & { fire(): void } = { set: (fn) => { q.push(fn); return q.length; }, clear: () => {}, fire() { q.splice(0).forEach((f) => f()); } }; return t; };
let mgrN = 0; // testEnv ids are sequential per instance; prefix them so separate managers never collide in the shared DB
const mgr = (st = store) => { const t = timers(); const env = testEnv(11); const n = env.newId, tag = `m${++mgrN}-`; env.newId = () => tag + n(); return { m: new GameManager(env, t, { send: () => {} }, st), t }; };

/** Drive a whole round through the manager: P1 plays one turn then calls CABO; the others take final turns. */
function playRound(m: GameManager, t: ReturnType<typeof timers>, code: string, ids: string[]) {
  const st = () => m._debug(code).state;
  const act = (pid: string, a: any) => { const r = m.act({ code, playerId: pid }, Math.random().toString(36), a); if (!r.ok) throw new Error(`${a.type}: ${r.code}`); };
  const turn = (pid: string, callCabo = false) => {
    act(pid, { type: 'DRAW_CARD' });
    if (st().turn!.step.kind === 'AWAIT_POWER_DECISION') act(pid, { type: 'SKIP_POWER' });
    act(pid, { type: 'DISCARD_CARD' }); t.fire();
    if (st().turn?.step.kind === 'AWAIT_CABO_DECISION') act(pid, { type: callCabo ? 'CALL_CABO' : 'END_TURN' });
  };
  turn(ids[0]!, true);
  for (const pid of ids.slice(1)) turn(pid);
  expect(st().phase).toBe('ROUND_COMPLETE');
}

describe('PostgreSQL persistence', () => {
  it('saves game, players and round results; leaving and ending are recorded', async () => {
    const { m, t } = mgr();
    const host = m.create('Alice', 's1');
    const b = m.join(host.code, 'Bob', 's2') as any, c = m.join(host.code, 'Cara', 's3') as any;
    const ids = [host.playerId, b.playerId, c.playerId];
    m.act({ code: host.code, playerId: ids[0]! }, 'start', { type: 'START_GAME' });
    for (const [i, id] of ids.entries()) m.act({ code: host.code, playerId: id }, `ack${i}`, { type: 'ACK_INITIAL_PEEK' });
    playRound(m, t, host.code, ids);
    const result = m._debug(host.code).state.result!;
    m.act({ code: host.code, playerId: ids[2]! }, 'bye', { type: 'LEAVE_GAME' });
    await m.flush();

    const gid = m._debug(host.code).state.id;
    const game = (await pool.query('select * from games where id=$1', [gid])).rows[0];
    expect(game).toMatchObject({ code: host.code, status: 'ACTIVE' });
    const players = (await pool.query('select display_name, seat, left_at from players where game_id=$1 order by seat', [gid])).rows;
    expect(players.map((p) => p.display_name)).toEqual(['Alice', 'Bob', 'Cara']);
    expect(players[2].left_at).not.toBeNull(); expect(players[0].left_at).toBeNull();
    const rounds = (await pool.query('select * from rounds where game_id=$1', [gid])).rows;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ round_number: 1, caller_id: ids[0], cabo_succeeded: result.caboSucceeded, tie: result.tie });
    expect(rounds[0].scores).toEqual(result.scores);
    expect(rounds[0].winner_ids).toEqual(result.winnerIds);

    const hist = (await store.recentRounds(50)).find((r) => r.code === host.code)!;
    expect(hist.winners.every((w) => ['Alice', 'Bob', 'Cara'].includes(w))).toBe(true);
    expect(hist.scores.map((x) => x.name).sort()).toEqual(['Alice', 'Bob', 'Cara']);

    // idle sweep marks the game expired
    expect(m.sweep(Date.now() + 3 * 3600_000)).toBe(0); // sockets still registered for Alice/Bob
  });

  it('records a second round, and ABANDONED when too many leave', async () => {
    const { m, t } = mgr();
    const host = m.create('Dana', 's1'); const e = m.join(host.code, 'Eli', 's2') as any;
    const ids = [host.playerId, e.playerId]; const sess = (id: string) => ({ code: host.code, playerId: id });
    m.act(sess(ids[0]!), 'st', { type: 'START_GAME' }); for (const id of ids) m.act(sess(id), 'a' + id, { type: 'ACK_INITIAL_PEEK' });
    playRound(m, t, host.code, ids);
    m.act(sess(ids[0]!), 'n', { type: 'START_NEXT_ROUND' }); for (const id of ids) m.act(sess(id), 'b' + id, { type: 'ACK_INITIAL_PEEK' });
    const first = m._debug(host.code).state.turn!.ownerId; // winner (or presser) starts
    playRound(m, t, host.code, [first, ids.find((x) => x !== first)!]);
    m.act(sess(ids[1]!), 'leave', { type: 'LEAVE_GAME' });
    await m.flush();
    const gid = (await pool.query('select id from games where code=$1 order by created_at desc limit 1', [host.code])).rows[0].id;
    expect((await pool.query('select round_number from rounds where game_id=$1 order by 1', [gid])).rows.map((r) => r.round_number)).toEqual([1, 2]);
    expect((await pool.query('select status from games where id=$1', [gid])).rows[0].status).toBe('ABANDONED'); // one player left of two
  });

  it('abandoned and expired games are marked', async () => {
    const { m } = mgr();
    const host = m.create('Fay', 's1'); const g = m.join(host.code, 'Gus', 's2') as any; const sess = (id: string) => ({ code: host.code, playerId: id });
    m.act(sess(host.playerId), 'st', { type: 'START_GAME' });
    m.act(sess(g.playerId), 'lv', { type: 'LEAVE_GAME' });
    await m.flush();
    const gid = m._debug(host.code).state.id;
    expect((await pool.query('select status, ended_at from games where id=$1', [gid])).rows[0]).toMatchObject({ status: 'ABANDONED' });
    // expiry
    const { m: m2 } = mgr(); const h2 = m2.create('Hal', 's9'); m2.disconnect({ code: h2.code, playerId: h2.playerId }, 's9');
    const gid2 = m2._debug(h2.code).state.id; expect(m2.sweep(Date.now() + 3 * 3600_000)).toBe(1); await m2.flush();
    expect((await pool.query('select status from games where id=$1', [gid2])).rows[0].status).toBe('EXPIRED');
  });

  it('a broken database never breaks the game', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dead = new PgStore(new pg.Pool({ connectionString: 'postgres://nobody:x@127.0.0.1:1/none', connectionTimeoutMillis: 300 }));
    const { m, t } = mgr(dead);
    const host = m.create('Ivy', 's1'); const j = m.join(host.code, 'Jon', 's2') as any; const ids = [host.playerId, j.playerId];
    const sess = (id: string) => ({ code: host.code, playerId: id });
    m.act(sess(ids[0]!), 'st', { type: 'START_GAME' }); for (const id of ids) m.act(sess(id), 'a' + id, { type: 'ACK_INITIAL_PEEK' });
    playRound(m, t, host.code, ids); // full round completes despite every write failing
    await m.flush();
    expect(err).toHaveBeenCalled(); err.mockRestore(); await dead.close().catch(() => {});
  }, 30_000);
});
