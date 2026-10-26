import pg from 'pg';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RoundResult } from '@cabo/game-engine';

/** What gets persisted: identity and outcomes only. Live game state (hands, decks) stays in memory by design. */
export interface Store {
  init(): Promise<void>;
  gameCreated(g: { id: string; code: string }): Promise<void>;
  playerJoined(gameId: string, p: { id: string; name: string; seat: number }): Promise<void>;
  playerLeft(gameId: string, playerId: string): Promise<void>;
  roundFinished(gameId: string, r: RoundResult): Promise<void>;
  gameEnded(gameId: string, status: 'ENDED' | 'ABANDONED' | 'EXPIRED'): Promise<void>;
  /** Most recent finished rounds, newest first (for the History page). */
  recentRounds(limit: number): Promise<HistoryRow[]>;
  close(): Promise<void>;
}

export interface HistoryRow { code: string; roundNumber: number; finishedAt: string; caboSucceeded: boolean; failureReason: string | null; tie: boolean; winners: string[]; scores: { name: string; score: number }[] }

export class NullStore implements Store {
  async init() {} async gameCreated() {} async playerJoined() {} async playerLeft() {}
  async roundFinished() {} async gameEnded() {} async close() {}
  async recentRounds() { return []; }
}

const SCHEMA = `
create table if not exists games (
  id text primary key, code text not null, status text not null default 'ACTIVE',
  created_at timestamptz not null default now(), ended_at timestamptz
);
create index if not exists games_code_idx on games(code);
create table if not exists players (
  id text primary key, game_id text not null references games(id) on delete cascade,
  display_name text not null, seat int not null,
  joined_at timestamptz not null default now(), left_at timestamptz
);
create table if not exists rounds (
  id bigserial primary key, game_id text not null references games(id) on delete cascade,
  round_number int not null, finished_at timestamptz not null default now(),
  caller_id text, cabo_succeeded boolean not null, failure_reason text, tie boolean not null,
  winner_ids jsonb not null, scores jsonb not null,
  unique (game_id, round_number)
);`;

export class PgStore implements Store {
  constructor(private pool: pg.Pool) {}
  static fromUrl(url: string) {
    const ssl = /sslmode=require|render\.com|neon\.tech|supabase\.co/.test(url) ? { rejectUnauthorized: false } : undefined;
    return new PgStore(new pg.Pool({ connectionString: url, max: 5, ssl, connectionTimeoutMillis: 5000 }));
  }
  async init() { await this.pool.query(SCHEMA); }
  async gameCreated(g: { id: string; code: string }) {
    await this.pool.query('insert into games (id, code) values ($1,$2) on conflict (id) do nothing', [g.id, g.code]);
  }
  async playerJoined(gameId: string, p: { id: string; name: string; seat: number }) {
    await this.pool.query('insert into players (id, game_id, display_name, seat) values ($1,$2,$3,$4) on conflict (id) do nothing', [p.id, gameId, p.name, p.seat]);
  }
  async playerLeft(gameId: string, playerId: string) {
    await this.pool.query('update players set left_at = now() where id = $1 and game_id = $2 and left_at is null', [playerId, gameId]);
  }
  async roundFinished(gameId: string, r: RoundResult) {
    await this.pool.query(
      `insert into rounds (game_id, round_number, caller_id, cabo_succeeded, failure_reason, tie, winner_ids, scores)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (game_id, round_number) do nothing`,
      [gameId, r.roundNumber, r.caboCallerId, r.caboSucceeded, r.failureReason, r.tie, JSON.stringify(r.winnerIds), JSON.stringify(r.scores)],
    );
  }
  async gameEnded(gameId: string, status: string) {
    await this.pool.query('update games set status = $2, ended_at = now() where id = $1 and ended_at is null', [gameId, status]);
  }
  async recentRounds(limit: number): Promise<HistoryRow[]> {
    const { rows } = await this.pool.query(
      `select g.code, r.round_number, r.finished_at, r.cabo_succeeded, r.failure_reason, r.tie, r.winner_ids, r.scores
       from rounds r join games g on g.id = r.game_id order by r.finished_at desc limit $1`, [limit]);
    const names = new Map<string, string>();
    const ids = new Set<string>(); for (const r of rows) for (const k of Object.keys(r.scores)) ids.add(k);
    if (ids.size) for (const p of (await this.pool.query('select id, display_name from players where id = any($1)', [[...ids]])).rows) names.set(p.id, p.display_name);
    const nm = (id: string) => names.get(id) ?? 'Player';
    return rows.map((r) => ({ code: r.code, roundNumber: r.round_number, finishedAt: new Date(r.finished_at).toISOString(), caboSucceeded: r.cabo_succeeded, failureReason: r.failure_reason, tie: r.tie,
      winners: (r.winner_ids as string[]).map(nm), scores: Object.entries(r.scores as Record<string, number>).map(([id, score]) => ({ name: nm(id), score })) }));
  }
  async close() { await this.pool.end(); }
}

/** Zero-setup storage: one JSON file on disk. Used when no DATABASE_URL is set. */
interface FileData { games: Record<string, { code: string; status: string; createdAt: string; endedAt?: string }>; players: Record<string, { gameId: string; name: string; seat: number; joinedAt: string; leftAt?: string }>; rounds: (HistoryRow & { gameId: string })[] }
export class FileStore implements Store {
  private d: FileData = { games: {}, players: {}, rounds: [] };
  private pending = false;
  constructor(private path: string) {}
  async init() {
    mkdirSync(dirname(this.path), { recursive: true });
    if (existsSync(this.path)) { try { this.d = JSON.parse(readFileSync(this.path, 'utf8')); } catch { /* corrupt file: start fresh, old file is overwritten on next save */ } }
    this.save();
  }
  private save() {
    try { const tmp = this.path + '.tmp'; writeFileSync(tmp, JSON.stringify(this.d, null, 1)); renameSync(tmp, this.path); } catch (e) { console.error('Could not write data file:', (e as Error).message); }
  }
  async gameCreated(g: { id: string; code: string }) { this.d.games[g.id] ??= { code: g.code, status: 'ACTIVE', createdAt: new Date().toISOString() }; this.save(); }
  async playerJoined(gameId: string, p: { id: string; name: string; seat: number }) { this.d.players[p.id] ??= { gameId, name: p.name, seat: p.seat, joinedAt: new Date().toISOString() }; this.save(); }
  async playerLeft(_g: string, id: string) { const p = this.d.players[id]; if (p && !p.leftAt) p.leftAt = new Date().toISOString(); this.save(); }
  async roundFinished(gameId: string, r: RoundResult) {
    if (this.d.rounds.some((x) => x.gameId === gameId && x.roundNumber === r.roundNumber)) return;
    const nameOf = (id: string) => this.d.players[id]?.name ?? 'Player';
    this.d.rounds.push({
      gameId, code: this.d.games[gameId]?.code ?? '', roundNumber: r.roundNumber, finishedAt: new Date().toISOString(),
      caboSucceeded: r.caboSucceeded, failureReason: r.failureReason ?? null, tie: r.tie,
      winners: r.winnerIds.map(nameOf), scores: Object.entries(r.scores).map(([id, score]) => ({ name: nameOf(id), score: score as number })),
    });
    this.save();
  }
  async gameEnded(gameId: string, status: string) { const g = this.d.games[gameId]; if (g && !g.endedAt) { g.status = status; g.endedAt = new Date().toISOString(); } this.save(); }
  async recentRounds(limit: number) { return this.d.rounds.slice(-limit).reverse().map(({ gameId: _g, ...row }) => row); }
  async close() {}
}
