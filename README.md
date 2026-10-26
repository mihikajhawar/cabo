# Cabo (online multiplayer)

Status: playable locally. Engine + multiplayer server + browser UI are built and tested.
Optional PostgreSQL saves games/players/round results (see DEPLOY.md). Not done: public hosting (config included), game-history screens.

## Play it locally
    npm install
    npm run dev:server     # terminal 1  -> http://localhost:3001
    npm run dev:web        # terminal 2  -> http://localhost:3000
Or run both in ONE terminal:   npm run dev

Open http://localhost:3000 in two or three browser windows (use a private window for the extra players,
each tab keeps its own session). Create a table in one, join with the 5-letter code in the others.

## Tests
    npm test               # 69 engine tests + 15 server tests (real sockets + a real embedded PostgreSQL)
    npm run typecheck

## Layout
    packages/game-engine  pure rules engine (no sockets/DB/UI): reducer, projector, scoring
    apps/server           Socket.IO server: sessions, idempotency, timers, per-player views
    apps/web              Next.js + Tailwind UI; renders the server's PlayerView only

## Putting it online
See DEPLOY.md (render.yaml included).


## Easiest way to run (Windows)
Double-click **start.bat**. It installs on the first run, starts the game server and the website together, and opens http://localhost:3000. Keep the window open while playing.

## Saved results
Finished rounds are saved automatically to `apps/server/data/cabo-data.json`, with no setup. Open http://localhost:3000/history to see them. To use PostgreSQL instead, set `DATABASE_URL` in `apps/server/.env`. If PostgreSQL can't be reached, the server falls back to the file.


## Playing on different computers

| Who is playing | What to do |
|---|---|
| Everyone on the **same Wi-Fi or hotspot** | Host runs `start.bat` (Windows) or `./start.sh` (Mac/Linux). The window prints a line like `Friends on the same Wi-Fi can play at: http://192.168.1.23:3000`. Friends open that address in any browser (phone, laptop, tablet) and enter the table code. The lobby also shows the address and a ready-made invite link. |
| Friends **anywhere on the internet** | The game has to be hosted online. See `DEPLOY.md` (Render, free tier). Then everybody just opens the website address. |

Notes for the same-Wi-Fi option:
- The first time, Windows asks to allow Node.js through the firewall. Choose **Allow** (private networks).
- The host's computer must stay on with the window open.
- Guest/public Wi-Fi often blocks devices from talking to each other. A phone hotspot usually works.
- Works on Windows, Mac and Linux, and players can use any modern browser, including phones.

## Sound
Sound effects are generated in the browser (no downloads). The speaker button on the home screen and table turns them off.
