'use client';
import { useEffect, useState } from 'react';
import type { CardDef } from '@cabo/game-engine';
import { Card } from './Card';
import { RulesButton } from './Rules';
import { SoundToggle } from './SoundToggle';

const FAN: { def: CardDef | null; rot: number; lift: number }[] = [
  { def: { rank: 'K_RED', suit: 'H', value: -1 }, rot: -26, lift: 14 },
  { def: { rank: 'Q', suit: 'S', value: 12 }, rot: -13, lift: 4 },
  { def: null, rot: 0, lift: 0 },
  { def: { rank: 'A', suit: 'D', value: 1 }, rot: 13, lift: 4 },
  { def: { rank: '7', suit: 'C', value: 7 }, rot: 26, lift: 14 },
];

export function Home({ onCreate, onJoin, connected, toast }: {
  onCreate: (name: string) => Promise<boolean>; onJoin: (code: string, name: string) => Promise<boolean>; connected: boolean; toast: string | null;
}) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('code'); if (c) setCode(c.toUpperCase().slice(0, 5));
    try { const n = localStorage.getItem('cabo.name'); if (n) setName(n); } catch {}
  }, []);
  const run = async (fn: () => Promise<boolean>) => { setBusy(true); try { localStorage.setItem('cabo.name', name); } catch {} await fn(); setBusy(false); };
  const ok = name.trim().length > 0 && connected && !busy;
  return (
    <main className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-md rise">
        <div className="fan" aria-hidden>
          {FAN.map((c, i) => <Card key={i} def={c.def} size="lg" delay={i * 110} flipIn={!!c.def} vars={{ '--rot': `${c.rot}deg`, '--lift': `${c.lift}px` }} />)}
        </div>
        <div className="text-center mb-8">
          <div className="title text-6xl sm:text-7xl">Cabo</div>
          <div className="rule-gold" />
          <p className="mt-2 text-base italic" style={{ fontFamily: 'var(--serif)', color: 'var(--taupe)' }}>Remember what you saw. Trust no one. Call it at the right moment.</p>
        </div>
        <div className="panel p-6 space-y-5">
          <label className="block">
            <span className="text-xs uppercase tracking-[.18em]" style={{ color: 'var(--taupe)' }}>Your name</span>
            <input className="input mt-1" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maya" autoComplete="off" />
          </label>
          <button className="btn btn-primary w-full" disabled={!ok} onClick={() => run(() => onCreate(name))}>Start a new table</button>
          <div className="flex items-center gap-3 opacity-60"><hr className="flex-1 border-brass/40" /><span className="text-sm">or join friends</span><hr className="flex-1 border-brass/40" /></div>
          <div className="flex gap-2">
            <input className="input uppercase tracking-[.35em] text-center" maxLength={5} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" aria-label="Game code" />
            <button className="btn" disabled={!ok || code.length < 5} onClick={() => run(() => onJoin(code, name))}>Join</button>
          </div>
        </div>
        <div className="text-center mt-5"><RulesButton className="btn" label="📖 How to play" /> <a className="btn ml-2" href="/history">🏆 Past rounds</a> <span className="ml-2"><SoundToggle /></span></div>
        <p className="text-center mt-4 text-sm opacity-60">{connected ? '2–6 players · play in your browser' : 'Connecting to the table…'}</p>
      </div>
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 panel px-5 py-3 z-[60] rise">{toast}</div>}
    </main>
  );
}
