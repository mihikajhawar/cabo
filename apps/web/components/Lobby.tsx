'use client';
import { useEffect, useState } from 'react';
import { serverUrl } from '../lib/server';
import type { PlayerView } from '@cabo/game-engine';
import { RulesButton } from './Rules';

export function Lobby({ view, act }: { view: PlayerView; act: (a: Record<string, unknown>) => Promise<boolean> }) {
  const [copied, setCopied] = useState(false);
  const [lan, setLan] = useState<string | null>(null);
  useEffect(() => {
    // Opened as localhost? Then a copied localhost link is useless to friends, so offer the Wi-Fi address instead.
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
    fetch(`${serverUrl()}/info`).then((r) => r.json()).then((i) => { if (i?.lan?.[0]) setLan(`${window.location.protocol}//${i.lan[0]}:${window.location.port || 3000}`); }, () => {});
  }, []);
  const link = typeof window !== 'undefined' ? `${lan ?? window.location.origin}/?code=${view.gameCode}` : '';
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} };
  const can = view.you.allowedActions.includes('START_GAME');
  return (
    <main className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-lg rise">
        <h1 className="display text-4xl text-center" style={{ color: 'var(--ivory)' }}>The table is set</h1><div className="rule-gold" />
        <p className="text-center opacity-75 mt-1">Share this code with your friends</p>
        <div className="panel mt-5 p-6 text-center">
          <div className="display text-6xl tracking-[.3em] pl-[.3em]" style={{ color: 'var(--cream)' }} data-testid="game-code">{view.gameCode}</div>
          <button className="btn btn-ghost mt-3" onClick={copy}>{copied ? 'Link copied ✓' : 'Copy invite link'}</button>
          {lan && <p className="text-sm opacity-70 mt-3">Friends on your Wi-Fi can open <b>{lan}</b> and enter the code, or use the link above.</p>}
        </div>
        <div className="panel mt-5 p-5">
          <h2 className="text-xs uppercase tracking-[.18em] mb-3" style={{ color: 'var(--taupe)' }}>Players ({view.players.length}/6)</h2>
          <ul className="space-y-2">
            {view.players.map((p) => (
              <li key={p.playerId} className="flex items-center gap-3">
                <span className="dot" style={{ background: p.connected ? '#7bd88f' : '#8a6a4a' }} />
                <span className="text-lg">{p.displayName}{p.playerId === view.you.playerId && <em className="opacity-60"> (you)</em>}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-5 flex gap-3 justify-center">
          <button className="btn btn-primary" disabled={!can} onClick={() => act({ type: 'START_GAME' })}>Deal the cards</button>
          <RulesButton />
          <button className="btn btn-ghost" onClick={() => act({ type: 'LEAVE_GAME' })}>Leave</button>
        </div>
        {!can && <p className="text-center opacity-60 mt-3 text-sm">Waiting for at least one more player…</p>}
      </div>
    </main>
  );
}
