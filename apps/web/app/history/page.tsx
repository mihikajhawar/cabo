'use client';
import { useEffect, useState } from 'react';

interface Row { code: string; roundNumber: number; finishedAt: string; caboSucceeded: boolean; failureReason: string | null; tie: boolean; winners: string[]; scores: { name: string; score: number }[] }
import { serverUrl } from '../../lib/server';

export default function History() {
  const [rows, setRows] = useState<Row[] | null>(null); const [err, setErr] = useState(false);
  useEffect(() => { fetch(`${serverUrl()}/history`).then((r) => r.json()).then(setRows, () => setErr(true)); }, []);
  return (
    <main className="min-h-screen px-4 py-10">
      <div className="w-full max-w-2xl mx-auto rise">
        <div className="flex items-center justify-between mb-6">
          <div className="display text-4xl" style={{ color: 'var(--candle)' }}>Past rounds</div>
          <a className="btn" href="/">← Back</a>
        </div>
        {err && <div className="panel p-5">Can't reach the game server. Make sure it is running.</div>}
        {!err && rows === null && <div className="panel p-5 opacity-70">Loading…</div>}
        {rows?.length === 0 && <div className="panel p-5 opacity-80">No finished rounds yet. Play a round to the end and it will appear here.</div>}
        <div className="space-y-3">
          {rows?.map((r, i) => (
            <div key={i} className="panel p-4">
              <div className="flex flex-wrap justify-between gap-x-4 text-sm opacity-70">
                <span>Table {r.code} · Round {r.roundNumber}</span>
                <span>{new Date(r.finishedAt).toLocaleString()}</span>
              </div>
              <div className="display text-xl mt-1">{r.tie ? `Tie: ${r.winners.join(' & ')}` : `${r.winners.join(' & ')} won`}</div>
              <div className="text-sm opacity-70">{r.caboSucceeded ? 'Cabo call succeeded' : r.failureReason ? `Cabo call failed (${r.failureReason.toLowerCase().replace('_', ' ')})` : ''}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {r.scores.map((s, j) => <span key={j}>{s.name}: <b>{s.score}</b></span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
