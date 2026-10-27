# Putting Cabo online (so friends can join from anywhere)

You need two things running on the internet: the **game server** (long-running, keeps games in memory)
and the **website**. They can't be a pure "serverless" host, the server must stay running.

## Easiest: Render (render.yaml in this repo)
1. Push this project to a GitHub repo (done if you are reading this on GitHub).
2. On render.com: sign in with GitHub, then New -> Blueprint -> pick the repo -> Apply. It creates the server, the website and a database.
3. Wait for both services to show "Live" (the first build takes a few minutes).
4. Open https://mihika-cabo-web.onrender.com, create a table, and send friends the invite link.

If Render renames a service (name already taken), set `NEXT_PUBLIC_SERVER_URL` on the website to the server's real address
and redeploy the website, and set `CORS_ORIGIN` on the server to the website's real address.

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
