import { NullStore, type Store } from './store';
import {
  createGame, defaultEnv, dispatch, projectFor, setConnected, CONTEST_WINDOW_MS,
  type Action, type Env, type ErrorCode, type GameEvent, type GameState, type PlayerId,
} from '@cabo/game-engine';

export interface Timers { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }
export const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export type Reply = { ok: true } | { ok: false; code: ErrorCode | 'INVALID_PAYLOAD' | 'UNAUTHENTICATED' | 'RATE_LIMITED' | 'GAME_NOT_FOUND' };
export interface Transport { send(socketId: string, event: string, payload: unknown): void }

const PEEK_TIMEOUT_MS = 15_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const SEEN_LIMIT = 200;

interface Instance {
  state: GameState;
  sockets: Map<PlayerId, Set<string>>;
  seen: Map<PlayerId, Map<string, Reply>>; // idempotency cache: actionId -> original reply
  windowTimer: { windowId: number; handle: unknown } | null;
  peekTimer: unknown | null;
  lastActive: number;
}
interface Session { code: string; playerId: PlayerId }

/** Owns every live game. All mutation for one game goes through act(), which is fully synchronous. */
export class GameManager {
  private games = new Map<string, Instance>();
  private tokens = new Map<string, Session>();
  private chain: Promise<unknown> = Promise.resolve();
  constructor(public env: Env = defaultEnv(), private timers: Timers = realTimers, private tx: Transport, private store: Store = new NullStore()) {}

  /** Persistence runs strictly AFTER the in-memory state change, in order, and can never block or break gameplay. */
  private persist(fn: () => Promise<unknown>) {
    this.chain = this.chain.then(fn).catch((e) => console.error('[store]', e instanceof Error ? e.message : e));
  }
  /** Resolves when all queued writes finished (used by tests and graceful shutdown). */
  flush(): Promise<unknown> { return this.chain; }

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_ALPHABET[Math.floor(this.env.rng() * CODE_ALPHABET.length)];
      if (!this.games.has(c)) return c;
    }
  }

  create(name: string, socketId: string) {
    const code = this.newCode();
    const playerId = this.env.newId();
    const inst: Instance = {
      state: createGame(this.env.newId(), code, playerId, name),
      sockets: new Map([[playerId, new Set([socketId])]]), seen: new Map(),
      windowTimer: null, peekTimer: null, lastActive: Date.now(),
    };
    this.games.set(code, inst);
    const gid = inst.state.id;
    this.persist(async () => { await this.store.gameCreated({ id: gid, code }); await this.store.playerJoined(gid, { id: playerId, name, seat: 0 }); });
    const token = this.issueToken(code, playerId);
    this.broadcast(inst, []);
    return { code, playerId, token };
  }

  join(code: string, name: string, socketId: string): { ok: true; code: string; playerId: PlayerId; token: string } | Extract<Reply, { ok: false }> {
    const inst = this.games.get(String(code).toUpperCase());
    if (!inst) return { ok: false, code: 'GAME_NOT_FOUND' };
    const playerId = this.env.newId();
    const r = dispatch(inst.state, playerId, { type: 'JOIN_GAME', displayName: name }, this.env);
    if (!r.ok) return { ok: false, code: r.code };
    inst.state = r.state;
    inst.sockets.set(playerId, new Set([socketId]));
    const me = inst.state.players.find((p) => p.id === playerId)!, gid = inst.state.id;
    this.persist(() => this.store.playerJoined(gid, { id: playerId, name: me.displayName, seat: me.seat }));
    const token = this.issueToken(inst.state.code, playerId);
    this.broadcast(inst, r.events);
    return { ok: true, code: inst.state.code, playerId, token };
  }

  reconnect(token: string, socketId: string): Session | null {
    const sess = typeof token === 'string' ? this.tokens.get(token) : undefined;
    const inst = sess && this.games.get(sess.code);
    if (!sess || !inst) return null;
    let set = inst.sockets.get(sess.playerId);
    if (!set) inst.sockets.set(sess.playerId, (set = new Set()));
    set.add(socketId);
    inst.state = setConnected(inst.state, sess.playerId, true);
    this.broadcast(inst, []);
    return sess;
  }

  disconnect(sess: Session, socketId: string) {
    const inst = this.games.get(sess.code);
    const set = inst?.sockets.get(sess.playerId);
    if (!inst || !set) return;
    set.delete(socketId);
    if (set.size === 0) {
      inst.state = setConnected(inst.state, sess.playerId, false);
      this.broadcast(inst, []); // the game waits; it never auto-plays for a disconnected player
    }
  }

  /** The single mutation path for client actions. */
  act(sess: Session, actionId: string, action: Action): Reply {
    const inst = this.games.get(sess.code);
    if (!inst) return { ok: false, code: 'GAME_NOT_FOUND' };
    let seen = inst.seen.get(sess.playerId);
    if (!seen) inst.seen.set(sess.playerId, (seen = new Map()));
    const cached = seen.get(actionId);
    if (cached) return cached; // replay / duplicate: return original reply, apply nothing
    const r = dispatch(inst.state, sess.playerId, action, this.env);
    const reply: Reply = r.ok ? { ok: true } : { ok: false, code: r.code };
    seen.set(actionId, reply);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value!);
    if (r.ok) {
      inst.state = r.state; inst.lastActive = Date.now();
      const gid = inst.state.id;
      this.persistEvents(gid, r.events);
      if (action.type === 'LEAVE_GAME') this.persist(() => this.store.playerLeft(gid, sess.playerId));
      this.broadcast(inst, r.events);
      this.schedule(inst);
      if (action.type === 'LEAVE_GAME') this.release(inst, sess);
    }
    return reply;
  }

  private release(inst: Instance, sess: Session) {
    inst.sockets.delete(sess.playerId);
    for (const [t, s] of this.tokens) if (s.playerId === sess.playerId && s.code === sess.code) this.tokens.delete(t);
    if (inst.state.players.every((p) => p.hasLeft) || inst.state.players.length === 0) this.drop(sess.code, 'ENDED');
  }
  private drop(code: string, status: 'ENDED' | 'ABANDONED' | 'EXPIRED' = 'ENDED') {
    const inst = this.games.get(code);
    if (inst) { const gid = inst.state.id; this.persist(() => this.store.gameEnded(gid, status)); }
    if (inst?.windowTimer) this.timers.clear(inst.windowTimer.handle);
    if (inst?.peekTimer) this.timers.clear(inst.peekTimer);
    this.games.delete(code);
  }
  private issueToken(code: string, playerId: PlayerId): string {
    const t = this.env.newId() + this.env.newId(); // opaque, unguessable with the default (crypto) env
    this.tokens.set(t, { code, playerId });
    return t;
  }

  /** Server-owned timers: contest-window expiry and the opening-peek timeout. */
  private schedule(inst: Instance) {
    const st = inst.state;
    const step = st.turn?.step;
    if (step?.kind === 'CONTEST_WINDOW' && inst.windowTimer?.windowId !== step.window.windowId) {
      if (inst.windowTimer) this.timers.clear(inst.windowTimer.handle);
      const windowId = step.window.windowId;
      const handle = this.timers.set(() => this.serverAct(inst, { type: 'EXPIRE_WINDOW', windowId }), CONTEST_WINDOW_MS);
      inst.windowTimer = { windowId, handle };
    }
    if (st.phase === 'DEALING' && !inst.peekTimer) {
      inst.peekTimer = this.timers.set(() => { inst.peekTimer = null; this.serverAct(inst, { type: 'PEEK_TIMEOUT' }); }, PEEK_TIMEOUT_MS);
    }
    if (st.phase !== 'DEALING' && inst.peekTimer) { this.timers.clear(inst.peekTimer); inst.peekTimer = null; }
  }
  private serverAct(inst: Instance, action: Action) {
    const r = dispatch(inst.state, 'SERVER', action, this.env);
    if (r.ok) { inst.state = r.state; this.persistEvents(inst.state.id, r.events); this.broadcast(inst, r.events); this.schedule(inst); }
  }
  /** Rounds usually END via the server's window-expiry timer, so this must run for server actions too. */
  private persistEvents(gid: string, events: GameEvent[]) {
    for (const e of events) {
      if (e.type === 'ROUND_SCORED') this.persist(() => this.store.roundFinished(gid, e.data.result as never));
      if (e.type === 'GAME_ABANDONED') this.persist(() => this.store.gameEnded(gid, 'ABANDONED'));
    }
  }

  /** Per-player filtering: every socket gets its own projected view plus only the events meant for it. */
  private broadcast(inst: Instance, events: GameEvent[]) {
    for (const [pid, sockets] of inst.sockets) {
      if (sockets.size === 0) continue;
      const payload = {
        view: projectFor(inst.state, pid, this.env.now()),
        events: events.filter((e) => e.to === 'ALL' || e.to === pid).map((e) => ({ type: e.type, data: e.data })),
      };
      for (const sid of sockets) this.tx.send(sid, 'UPDATE', payload);
    }
  }

  /** Drop abandoned games: nobody connected and idle past the TTL. Returns how many were removed. */
  sweep(nowMs = Date.now(), idleTtlMs = 2 * 60 * 60 * 1000): number {
    let n = 0;
    for (const [code, inst] of [...this.games]) {
      const anyone = [...inst.sockets.values()].some((s) => s.size > 0);
      if (!anyone && nowMs - inst.lastActive > idleTtlMs) {
        for (const [t, s] of this.tokens) if (s.code === code) this.tokens.delete(t);
        this.drop(code, 'EXPIRED'); n++;
      }
    }
    return n;
  }

  // test/ops helpers
  get gameCount() { return this.games.size; }
  _debug(code: string) { return this.games.get(code)!; }
}
