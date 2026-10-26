# Putting Cabo online (so friends can join from anywhere)

You need two things running on the internet: the **game server** (long-running, keeps games in memory)
and the **website**. They can't be a pure "serverless" host, the server must stay running.

## Easiest: Render (render.yaml in this repo)
1. Push this folder to a GitHub repo.
2. On render.com: New -> Blueprint -> pick the repo. It creates `cabo-server` and `cabo-web`.
3. When `cabo-server` is live, copy its URL (https://....onrender.com).
4. In `cabo-web` -> Environment, set `NEXT_PUBLIC_SERVER_URL` to that URL, then redeploy `cabo-web`.
5. Copy the `cabo-web` URL into `cabo-server` -> Environment as `CORS_ORIGIN`, redeploy the server.
6. Open the `cabo-web` URL, create a table, send friends the invite link.

Notes
- Free instances go to sleep when idle; a sleeping/restarting server drops games in progress
  (games live in memory). Use an always-on instance for game nights.
- The same two services work on Railway or Fly.io (server: `npm run start -w @cabo/server`, port from `PORT`;
  web: `npm run build -w @cabo/web` then `npm run start -w @cabo/web`).
- The server exposes `/health` and removes games nobody has been connected to for 2 hours.

## The database (optional)
Saves games, players, and each finished round's result (who called CABO, scores, winner). Live hands and decks stay in memory.
The game works without it. Tables are created automatically on first start.
- **Hosted:** `render.yaml` creates a Postgres and wires `DATABASE_URL` for you. Any Postgres works (Neon, Supabase, Railway...).
- **Local:** copy `apps/server/.env.example` to `apps/server/.env`, uncomment `DATABASE_URL` and point it at your Postgres
  (e.g. a free Neon database, or `docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres`).
- If the database is unreachable, the server logs it and keeps running; results just aren't saved.
- Look at the data with any SQL tool: `select * from rounds order by finished_at desc;`
