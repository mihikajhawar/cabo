'use client';
import { Home } from '../components/Home';
import { Lobby } from '../components/Lobby';
import { Table } from '../components/Table';
import { useGame } from '../lib/useGame';

export default function Page() {
  const g = useGame();
  if (g.booting) return <main className="min-h-screen grid place-items-center"><p className="display opacity-70">Lighting the candles…</p></main>;
  if (!g.view) return <Home onCreate={g.create} onJoin={g.join} connected={g.connected} toast={g.toast} />;
  if (g.view.phase === 'LOBBY') return <><Lobby view={g.view} act={g.act} />{g.toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 panel px-5 py-3 z-[60]">{g.toast}</div>}</>;
  if (g.view.phase === 'ABANDONED')
    return <main className="min-h-screen grid place-items-center px-4"><div className="panel p-8 text-center"><h1 className="display text-3xl">The table has emptied</h1><p className="mt-2 opacity-80">Too many players left to continue.</p><button className="btn btn-primary mt-5" onClick={g.reset}>Back to start</button></div></main>;
  return <Table view={g.view} log={g.log} peeks={g.peeks} dismissPeek={g.dismissPeek} flash={g.flash} toast={g.toast} banner={g.banner} windowEnds={g.windowEnds} act={g.act} />;
}
