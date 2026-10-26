import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testEnv } from '@cabo/game-engine';
import { GameManager, type Timers } from '../src/manager';
import { FileStore } from '../src/store';

const timers = () => { const q: (() => void)[] = []; const t: Timers & { fire(): void } = { set: (fn) => { q.push(fn); return q.length; }, clear: () => {}, fire() { q.splice(0).forEach((f) => f()); } }; return t; };
let mgrN = 0; // testEnv ids are sequential per instance; prefix them so separate managers never collide in the shared DB
const mgr = (st: FileStore) => { const t = timers(); const env = testEnv(11); const n = env.newId, tag = `m${++mgrN}-`; env.newId = () => tag + n(); return { m: new GameManager(env, t, { send: () => {} }, st), t }; };

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


describe('local file persistence (no database needed)', () => {
  it('saves a played round to disk, lists it, and survives a restart', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cabo-file-')), 'sub', 'data.json');
    const store = new FileStore(file); await store.init();
    const { m, t } = mgr(store);
    const host = m.create('Alice', 's1'); const b = m.join(host.code, 'Bob', 's2') as any;
    const ids = [host.playerId, b.playerId]; const sess = (id: string) => ({ code: host.code, playerId: id });
    m.act(sess(ids[0]!), 'st', { type: 'START_GAME' }); for (const id of ids) m.act(sess(id), 'a' + id, { type: 'ACK_INITIAL_PEEK' });
    playRound(m, t, host.code, ids); await m.flush();
    expect(existsSync(file)).toBe(true);
    const rows = await store.recentRounds(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: host.code, roundNumber: 1 });
    expect(rows[0]!.scores.map((x) => x.name).sort()).toEqual(['Alice', 'Bob']);
    expect(JSON.parse(readFileSync(file, 'utf8')).rounds).toHaveLength(1);
    const again = new FileStore(file); await again.init(); // "restart"
    expect(await again.recentRounds(10)).toHaveLength(1);
  });
  it('a corrupt data file does not stop the server starting', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cabo-file-')), 'data.json');
    (await import('node:fs')).writeFileSync(file, '{not json');
    const s = new FileStore(file); await s.init(); expect(await s.recentRounds(5)).toEqual([]);
  });
});
