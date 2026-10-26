#!/usr/bin/env bash
# Mac / Linux: ./start.sh   (first time: chmod +x start.sh)
cd "$(dirname "$0")"
[ -d node_modules ] || { echo "First run: installing, this takes a few minutes..."; npm install; }
echo; echo "Starting Cabo. When you see 'Ready', open http://localhost:3000"; echo
( sleep 8; (command -v open >/dev/null && open http://localhost:3000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) || true ) &
npm run dev
