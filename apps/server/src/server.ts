import { createServer, type Server as HttpServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { Server, type Socket } from 'socket.io';
import { defaultEnv, type Env } from '@cabo/game-engine';
import { GameManager, realTimers, type Timers } from './manager';
import { NullStore, type Store } from './store';
import { cleanName, isActionId, parseAction } from './validate';

/** Private-network IPv4 addresses of this computer, so friends on the same Wi-Fi know where to connect. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) {
    if (i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) out.push(i.address);
  }
  return out;
}

export interface Options { port?: number; env?: Env; timers?: Timers; corsOrigin?: string; maxActionsPerSecond?: number; store?: Store }

export function startServer(opts: Options = {}) {
  const http: HttpServer = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/health') { res.writeHead(200); res.end('ok'); }
    else if (path === '/info') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ lan: lanAddresses() })); }
    else if (path === '/history') {
      // Public-by-design: only names, scores and outcomes of finished rounds; never cards or tokens.
      (opts.store ?? new NullStore()).recentRounds(50).then(
        (rows) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': opts.corsOrigin ?? process.env.CORS_ORIGIN ?? '*' }); res.end(JSON.stringify(rows)); },
        () => { res.writeHead(500); res.end(); });
    } else { res.writeHead(404); res.end(); }
  });
  const io = new Server(http, { cors: { origin: opts.corsOrigin ?? process.env.CORS_ORIGIN ?? '*' }, maxHttpBufferSize: 10_000 });
  const manager = new GameManager(opts.env ?? defaultEnv(), opts.timers ?? realTimers, {
    send: (sid, ev, payload) => io.to(sid).emit(ev, payload),
  }, opts.store);
  const limit = opts.maxActionsPerSecond ?? 30;

  io.on('connection', (socket: Socket) => {
    let sess: { code: string; playerId: string } | null = null;
    let windowStart = Date.now(), count = 0;
    const rateLimited = () => {
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; count = 0; }
      return ++count > limit;
    };
    const bind = (s: { code: string; playerId: string }) => { sess = s; };

    socket.on('CREATE_GAME', (p: unknown, ack: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
      if (rateLimited()) return reply({ ok: false, code: 'RATE_LIMITED' });
      const name = cleanName((p as { displayName?: unknown } | null)?.displayName);
      if (!name || sess) return reply({ ok: false, code: 'INVALID_PAYLOAD' });
      const r = manager.create(name, socket.id);
      bind(r); reply({ ok: true, ...r });
    });
    socket.on('JOIN_GAME', (p: unknown, ack: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
      if (rateLimited()) return reply({ ok: false, code: 'RATE_LIMITED' });
      const o = p as { code?: unknown; displayName?: unknown } | null;
      const name = cleanName(o?.displayName);
      if (!name || typeof o?.code !== 'string' || o.code.length > 10 || sess) return reply({ ok: false, code: 'INVALID_PAYLOAD' });
      const r = manager.join(o.code, name, socket.id);
      if (r.ok) bind(r);
      reply(r);
    });
    socket.on('RECONNECT', (p: unknown, ack: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
      if (rateLimited()) return reply({ ok: false, code: 'RATE_LIMITED' });
      const token = (p as { token?: unknown } | null)?.token;
      const s = typeof token === 'string' ? manager.reconnect(token, socket.id) : null;
      if (!s) return reply({ ok: false, code: 'UNAUTHENTICATED' });
      bind(s); reply({ ok: true, code: s.code, playerId: s.playerId });
    });
    socket.on('ACTION', (p: unknown, ack: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
      if (rateLimited()) return reply({ ok: false, code: 'RATE_LIMITED' });
      if (!sess) return reply({ ok: false, code: 'UNAUTHENTICATED' }); // identity only ever comes from the session
      const o = p as { actionId?: unknown; action?: unknown } | null;
      const action = parseAction(o?.action);
      if (!isActionId(o?.actionId) || !action) return reply({ ok: false, code: 'INVALID_PAYLOAD' });
      reply(manager.act(sess, o.actionId as string, action));
    });
    socket.on('disconnect', () => { if (sess) manager.disconnect(sess, socket.id); });
  });

  return new Promise<{ io: Server; manager: GameManager; port: number; close(): Promise<void> }>((resolve) => {
    http.listen(opts.port ?? 0, () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ io, manager, port, close: () => new Promise((r) => { io.close(() => r()); }) });
    });
  });
}
