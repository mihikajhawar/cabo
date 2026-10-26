import { existsSync, readFileSync } from 'node:fs';
import { lanAddresses, startServer } from './server';
import { FileStore, PgStore, type Store } from './store';

// Optional apps/server/.env (KEY=value lines) so Windows users don't need to set shell variables.
if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i.exec(line);
  if (m && !line.trim().startsWith('#') && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
}
const port = Number(process.env.PORT ?? 3001);
const url = process.env.DATABASE_URL;
const dataFile = process.env.DATA_FILE ?? 'data/cabo-data.json';
let store: Store = url ? PgStore.fromUrl(url) : new FileStore(dataFile);
if (url) {
  // Persistence is optional: if the database is unreachable the game still runs, results just aren't saved.
    await store.init().then(() => console.log('PostgreSQL connected; saving games and results.'), async (e) => {
    console.error('PostgreSQL unavailable, saving to a local file instead:', e.message);
    store = new FileStore(dataFile); await store.init();
  });
} else { await store.init(); console.log(`Saving games and results to ${dataFile} (set DATABASE_URL to use PostgreSQL instead).`); }

const s = await startServer({ port, store });
console.log(`Cabo server listening on :${s.port}`);
const lan = lanAddresses();
if (lan.length) console.log(`Friends on the same Wi-Fi can play at: ${lan.map((a) => `http://${a}:3000`).join('  or  ')}`);
setInterval(() => { const n = s.manager.sweep(); if (n) console.log(`swept ${n} idle game(s)`); }, 10 * 60 * 1000).unref();
const shutdown = async () => { await s.manager.flush(); await store.close().catch(() => {}); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
