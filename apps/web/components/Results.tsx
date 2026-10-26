'use client';
import type { PlayerView } from '@cabo/game-engine';
import { HandGrid } from './Card';

export function Results({ view, act }: { view: PlayerView; act: (a: Record<string, unknown>) => Promise<boolean> }) {
  const r = view.result; if (!r) return null;
  const name = (id: string) => (id === view.you.playerId ? 'You' : view.players.find((p) => p.playerId === id)?.displayName ?? 'Someone');
  const nameList = (ids: string[]) => ids.map(name).join(' & ');
  const caller = r.caboCallerId ? name(r.caboCallerId) : null;
  const callerScore = r.caboCallerId ? r.scores[r.caboCallerId] : null;

  let headline = ''; let sub = '';
  if (r.caboCallerId && r.failureReason !== 'CALLER_LEFT') {
    if (r.caboSucceeded) { headline = 'CABO SUCCEEDED'; sub = `${caller} had the lowest score, alone.`; }
    else {
      const tied = r.blockers.filter((id) => r.scores[id] === callerScore), lower = r.blockers.filter((id) => r.scores[id]! < callerScore!);
      headline = 'CABO FAILED';
      const parts = [];
      if (tied.length) parts.push(`${nameList(tied)} matched ${caller === 'You' ? 'your' : caller + "'s"} score`);
      if (lower.length) parts.push(`${nameList(lower)} scored lower`);
      sub = parts.join(' · ');
    }
  } else if (r.failureReason === 'CALLER_LEFT') { headline = 'CABO CANCELLED'; sub = 'The player who called CABO left the game.'; }
  const totals: Record<string, number> = {};
  for (const h of view.history) for (const [id, s] of Object.entries(h.scores)) totals[id] = (totals[id] ?? 0) + s;
  const ok = r.caboSucceeded;

  return (
    <>
    <div className="fixed inset-0 z-[58] overflow-y-auto" style={{ background: 'rgba(8,5,3,.82)' }} data-testid="results">
      <div className="min-h-full grid place-items-center p-4">
        <div className="panel p-5 sm:p-7 w-full max-w-3xl rise">
          <div className="text-center">
            {headline && <div className="display text-4xl sm:text-5xl" style={{ color: ok ? 'var(--candle)' : '#e0707f' }}>{headline}</div>}
            {sub && <p className="text-xl mt-1 opacity-90">— {sub}</p>}
            <p className="display text-2xl mt-3">{r.tie ? `A tie between ${nameList(r.winnerIds)}` : `${nameList(r.winnerIds)} ${r.winnerIds[0] === view.you.playerId ? 'win' : 'wins'} the round`}</p>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {view.players.filter((p) => !p.hasLeft).map((p, i) => (
              <div key={p.playerId} className={`seat ${r.winnerIds.includes(p.playerId) ? 'turn' : ''}`}>
                <div className="flex justify-between display mb-2"><span>{p.displayName}{p.isCaboCaller && ' ★'}</span><span style={{ color: 'var(--candle)' }}>{r.scores[p.playerId]}</span></div>
                {p.hand.length ? <HandGrid cards={p.hand} size="sm" known={{}} eligible={new Set()} selected={new Set()} onPick={() => {}} locked={false} reveal baseDelay={i * 250} /> : <em className="opacity-70">no cards</em>}
              </div>
            ))}
          </div>
          {view.history.length > 0 && (
            <p className="mt-4 text-sm opacity-70 text-center">Running tally (information only): {view.players.filter((p) => !p.hasLeft).map((p) => `${p.displayName} ${totals[p.playerId] ?? 0}`).join(' · ')}</p>
          )}
          <div className="mt-5 flex justify-center gap-3">
            <button className="btn btn-primary" onClick={() => act({ type: 'START_NEXT_ROUND' })}>Deal another round</button>
            <button className="btn btn-ghost" onClick={() => act({ type: 'LEAVE_GAME' })}>Leave table</button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
