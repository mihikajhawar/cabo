'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardDef, PlayerView } from '@cabo/game-engine';
import { Card, EmptySlot, HandGrid } from './Card';
import { SoundToggle } from './SoundToggle';
import { Results } from './Results';
import { RulesButton } from './Rules';
import { cardLabel, POWER_NAME } from '../lib/format';
import type { Banner, Peek } from '../lib/useGame';
import { useFlip } from '../lib/useFlip';

const HOLDING = ['AWAIT_POWER_DECISION', 'AWAIT_DISPOSE', 'AWAIT_KING_DECISION'];
type Act = (a: Record<string, unknown>) => Promise<boolean>;
interface Props {
  view: PlayerView; log: string[]; peeks: Peek[]; dismissPeek: (id: number) => void; flash: Record<string, CardDef>;
  toast: string | null; banner: Banner | null; windowEnds: { id: number; at: number; ms: number } | null; act: Act;
}

function Countdown({ endsAt, total }: { endsAt: number; total: number }) {
  const [p, setP] = useState(1); const raf = useRef(0);
  useEffect(() => {
    const tick = () => { setP(Math.max(0, (endsAt - performance.now()) / total)); raf.current = requestAnimationFrame(tick); };
    tick(); return () => cancelAnimationFrame(raf.current);
  }, [endsAt, total]);
  return <div className="timer w-full"><i style={{ width: `${p * 100}%` }} /></div>;
}

export function Table({ view, log, peeks, dismissPeek, flash, toast, banner, windowEnds, act }: Props) {
  const me = view.you.playerId;
  const rootRef = useRef<HTMLDivElement>(null);
  useFlip(rootRef);
  const nameOf = (id: string) => view.players.find((p) => p.playerId === id)?.displayName ?? 'Someone';
  const mine = view.players.find((p) => p.playerId === me)!;
  const opponents = view.players.filter((p) => p.playerId !== me && !p.hasLeft);
  const t = view.turn; const allowed = new Set(view.you.allowedActions);
  const isMyTurn = t?.ownerId === me;

  const [replaceMode, setReplaceMode] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const stepKey = `${t?.step}:${t?.window?.windowId}:${t?.ownerId}:${view.phase}`;
  useEffect(() => { setReplaceMode(false); setSel([]); }, [stepKey]);

  const known: Record<string, CardDef> = useMemo(() => {
    const k: Record<string, CardDef> = { ...flash };
    for (const c of view.you.inspecting) k[c.cardId] = c.def;
    return k;
  }, [flash, view.you.inspecting]);

  const eff = replaceMode ? { purpose: 'REPLACE', eligibleCardIds: mine.hand.map((h) => h.cardId) } : view.you.interaction;
  const eligible = new Set(eff?.eligibleCardIds ?? []);
  const selected = new Set(sel);
  const shaking = useMemo(() => new Set(Object.keys(flash)), [flash]);

  const pick = async (cardId: string) => {
    if (!eff || !eligible.has(cardId)) return;
    switch (eff.purpose) {
      case 'LOOK_OWN': return void act({ type: 'LOOK_AT_OWN_CARD', cardId });
      case 'LOOK_OPPONENT': return void act({ type: 'LOOK_AT_OPPONENT_CARD', cardId });
      case 'REPLACE': return void act({ type: 'REPLACE_CARD', cardId });
      case 'CONTEST': return void act({ type: 'CONTEST_CARD', cardId });
      case 'GIVE': return void act({ type: 'GIVE_CARD', cardId });
      case 'BLIND_SWAP': case 'KING_INSPECT':
        return setSel((s) => (s.includes(cardId) ? s.filter((x) => x !== cardId) : s.length >= 2 ? [s[1]!, cardId] : [...s, cardId]));
    }
  };

  const status = (() => {
    if (view.phase === 'DEALING') return view.you.inspecting.length ? 'Memorise your two bottom cards — they will be hidden again.' : 'Waiting for the others to look at their cards…';
    if (!t) return '';
    const owner = isMyTurn ? 'You' : nameOf(t.ownerId);
    const fin = t.isFinalTurn ? ' (final turn)' : '';
    switch (t.step) {
      case 'AWAIT_DRAW': return isMyTurn ? `Your turn${fin} — draw a card.` : `${owner} is about to draw${fin}.`;
      case 'AWAIT_POWER_DECISION': {
        const pw = view.you.interaction?.purpose;
        return isMyTurn ? `You drew a power card — ${pw ? 'pick a card to use it, or skip it.' : 'use it or skip.'}` : `${owner} is deciding what to do with a power card.`;
      }
      case 'AWAIT_KING_DECISION': return isMyTurn ? 'Swap the two cards you inspected, or leave them?' : `${owner} is deciding whether to swap.`;
      case 'AWAIT_DISPOSE': return isMyTurn ? 'Discard the drawn card, or replace one of your cards with it.' : `${owner} is choosing what to do with their card.`;
      case 'CONTEST_WINDOW': return `Toss window — match the ${view.discardTop ? cardLabel(view.discardTop) : 'top card'} by rank to toss it! A wrong guess draws you a penalty card.`;
      case 'AWAIT_GIVE_CARD': return t.give?.contesterId === me ? `Choose one of your cards to give to ${nameOf(t.give.targetId)}.` : `${nameOf(t.give!.contesterId)} is choosing a card to give to ${t.give!.targetId === me ? 'you' : nameOf(t.give!.targetId)}.`;
      case 'AWAIT_CABO_DECISION': return isMyTurn ? 'Turn done. Call CABO, or end your turn.' : `${owner} is deciding whether to call CABO.`;
    }
    return '';
  })();

  const power = (() => { const p = view.you.interaction?.purpose; return p && POWER_NAME[p === 'KING_INSPECT' ? 'KING' : p] ? POWER_NAME[p === 'KING_INSPECT' ? 'KING' : p] : null; })();
  const purpose = eff?.purpose;
  const drawn = view.you.drawnCard;

  return (
    <div className="min-h-screen flex flex-col" ref={rootRef} data-turn-owner={view.turn?.ownerId ?? ''}>
      <header className="flex flex-wrap items-center justify-between px-4 py-3 gap-2">
        <div className="display text-xl tracking-[.25em] uppercase" style={{ color: 'var(--ivory)' }}>Cabo <span className="opacity-60 text-sm ml-2 whitespace-nowrap">table {view.gameCode} · round {view.roundNumber}</span></div>
        <div className="flex gap-2"><SoundToggle /><RulesButton label="Rules" />
        <button className="btn btn-ghost" onClick={() => { if (confirm('Leave this game for good? Your cards leave play.')) act({ type: 'LEAVE_GAME' }); }}>Leave</button></div>
      </header>

      <div className="felt mx-2 sm:mx-6 mb-3 p-3 sm:p-5 flex-1 flex flex-col gap-4">
        <section className="flex flex-wrap justify-center gap-3" aria-label="Opponents">
          {opponents.map((p) => (
            <div key={p.playerId} className={`seat relative ${t?.ownerId === p.playerId ? 'turn' : ''}`} data-testid={`seat-${p.displayName}`} data-seat-id={p.playerId}>
              <div className="flex items-center gap-2 justify-center mb-2 display text-base">
                <span className="dot" style={{ background: p.connected ? '#7bd88f' : '#8a6a4a' }} />
                {p.displayName}{p.isCaboCaller && <span className="px-2 rounded-full text-xs" style={{ background: 'var(--oxblood)' }}>CABO</span>}
              </div>
              <HandGrid cards={p.hand} size="sm" known={known} eligible={eligible} selected={selected} onPick={pick} locked={p.handLocked} shaking={shaking} track />
              {t?.ownerId === p.playerId && HOLDING.includes(t.step) && (
                <div className="held-slot"><Card def={null} size="sm" fid={`held:${p.playerId}`} kind="held" className="held" /></div>
              )}
            </div>
          ))}
        </section>

        <section className="flex flex-col items-center gap-3">
          <div className="flex items-end justify-center gap-5 sm:gap-8">
            <div className="text-center">
              {view.drawPileCount > 0
                ? <Card def={null} className={`pile ${view.drawPileCount < 6 ? 'p1' : view.drawPileCount < 20 ? 'p2' : ''}`} eligible={allowed.has('DRAW_CARD')} onClick={() => act({ type: 'DRAW_CARD' })} label="Draw pile" testId="draw-pile" fid="pile" />
                : <EmptySlot />}
              <div className="text-sm mt-1 opacity-70">draw · {view.drawPileCount}</div>
            </div>
            <div className="text-center">
              {view.discardTop ? <Card key={view.discardTopId ?? view.discardCount} def={view.discardTop} fid={view.discardTopId ?? undefined} kind="discard" className={`rested ${view.discardCount > 1 ? 'stack' : ''} ${t?.step === 'CONTEST_WINDOW' ? 'window' : ''}`} rest={((view.discardCount * 37) % 9) - 4} /> : <EmptySlot />}
              <div className="text-sm mt-1 opacity-70">discard · {view.discardCount}</div>
            </div>
            {view.phase !== 'DEALING' && view.you.inspecting.length > 0 && (
              <div className="text-center">
                <div className="flex gap-2">{view.you.inspecting.map((c) => <Card key={c.cardId} def={c.def} flipIn />)}</div>
                <div className="text-sm mt-1" style={{ color: 'var(--candle)' }}>you are inspecting</div>
              </div>
            )}
            {drawn && (
              <div className="text-center">
                <Card key={drawn.cardId} def={drawn.def} size="lg" fid={drawn.cardId} kind="held" flipIn />
                <div className="text-sm mt-1" style={{ color: 'var(--candle)' }}>you drew</div>
              </div>
            )}
          </div>
          {t?.step === 'CONTEST_WINDOW' && windowEnds && <div className="w-48"><Countdown endsAt={windowEnds.at} total={windowEnds.ms} /></div>}
          <p className={`status-line text-center max-w-xl min-h-[2.4em] text-lg ${isMyTurn && view.phase !== 'DEALING' ? 'mine' : ''}`} key={stepKey} data-testid="status">{status}</p>
          {power && isMyTurn && t?.step === 'AWAIT_POWER_DECISION' && <p className="text-center text-sm opacity-75">Power: {power}.</p>}
          {t?.isFinalTurn && t.finalTurnsRemaining && <p className="text-sm opacity-75">Final turns left: {t.finalTurnsRemaining.map(nameOf).join(', ')}</p>}
        </section>

        <section className={`seat self-center ${isMyTurn ? 'turn' : ''}`} aria-label="Your cards" data-testid="my-seat">
          <div className="flex items-center gap-2 justify-center mb-2 display text-lg">
            {mine.displayName} <span className="opacity-60 text-sm">(you)</span>
            {mine.isCaboCaller && <span className="px-2 rounded-full text-xs" style={{ background: 'var(--oxblood)' }}>CABO</span>}
          </div>
          <HandGrid cards={mine.hand} known={known} eligible={eligible} selected={selected} onPick={pick} locked={mine.handLocked} shaking={shaking} track />
          {mine.hand.length === 0 && <p className="text-center opacity-70 mt-2">No cards — you score 0.</p>}
        </section>
      </div>

      <div className="px-3 pb-4 flex flex-col items-center gap-3">
        <div className="flex flex-wrap justify-center gap-2" data-testid="actions">
          {allowed.has('ACK_INITIAL_PEEK') && <button className="btn btn-primary" onClick={() => act({ type: 'ACK_INITIAL_PEEK' })}>Got it — hide my cards</button>}
          {allowed.has('DRAW_CARD') && <button className="btn btn-primary" onClick={() => act({ type: 'DRAW_CARD' })}>Draw a card</button>}
          {allowed.has('SKIP_POWER') && <button className="btn" onClick={() => act({ type: 'SKIP_POWER' })}>Skip power</button>}
          {(purpose === 'BLIND_SWAP') && <button className="btn btn-primary" disabled={sel.length !== 2} onClick={() => act({ type: 'BLIND_SWAP', cardIdA: sel[0], cardIdB: sel[1] })}>Swap these two</button>}
          {(purpose === 'KING_INSPECT') && <button className="btn btn-primary" disabled={sel.length !== 2} onClick={() => act({ type: 'KING_INSPECT', cardIdA: sel[0], cardIdB: sel[1] })}>Inspect these two</button>}
          {allowed.has('KING_SWAP_DECISION') && (<>
            <button className="btn btn-primary" onClick={() => act({ type: 'KING_SWAP_DECISION', swap: true })}>Swap them</button>
            <button className="btn" onClick={() => act({ type: 'KING_SWAP_DECISION', swap: false })}>Leave them</button>
          </>)}
          {allowed.has('DISCARD_CARD') && <button className="btn" onClick={() => act({ type: 'DISCARD_CARD' })}>Discard it</button>}
          {allowed.has('REPLACE_CARD') && !replaceMode && purpose !== 'REPLACE' && <button className="btn" onClick={() => setReplaceMode(true)}>Replace one of my cards…</button>}
          {replaceMode && <button className="btn btn-ghost" onClick={() => setReplaceMode(false)}>Cancel</button>}
          {allowed.has('ADD_TO_HAND') && <button className="btn" onClick={() => act({ type: 'ADD_TO_HAND' })}>Keep it</button>}
          {allowed.has('CALL_CABO') && <button className="btn btn-primary" onClick={() => act({ type: 'CALL_CABO' })}>Call CABO</button>}
          {allowed.has('END_TURN') && <button className="btn" onClick={() => act({ type: 'END_TURN' })}>End turn</button>}
        </div>
        {purpose === 'REPLACE' && <p className="text-sm opacity-80">Tap the card you want to replace.</p>}
        {(purpose === 'LOOK_OWN' || purpose === 'LOOK_OPPONENT') && <p className="text-sm opacity-80">Tap a glowing card to look at it.</p>}
        {(purpose === 'BLIND_SWAP' || purpose === 'KING_INSPECT') && <p className="text-sm opacity-80">Tap any two glowing cards ({sel.length}/2 chosen).</p>}
        {purpose === 'GIVE' && <p className="text-sm opacity-80">Tap one of your cards to give it.</p>}
        <details className="w-full max-w-xl panel px-4 py-2" open>
          <summary className="cursor-pointer display text-sm opacity-80">Table talk</summary>
          <div className="log mt-2 max-h-36 overflow-y-auto" data-testid="log">{log.length ? [...log].reverse().map((l, i) => <div key={log.length - i}>{l}</div>) : <em>Nothing yet.</em>}</div>
        </details>
      </div>

      <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[55] flex flex-col gap-3 items-center">
        {peeks.map((p) => (
          <div key={p.id} className="panel-solid p-4 flex items-center gap-4 rise cursor-pointer" onClick={() => dismissPeek(p.id)} data-testid="peek">
            <Card def={p.def} size="lg" flipIn />
            <div><div className="display text-lg" style={{ color: 'var(--candle)' }}>{p.caption}</div><div className="opacity-70 text-sm">Remember it — tap to hide</div></div>
          </div>
        ))}
      </div>
      {banner && <div className="banner" key={banner.id}><div><div className="big">{banner.text}</div><div className="rule" />{banner.sub && <div className="display text-lg sm:text-xl" style={{ color: 'var(--taupe)' }}>{banner.sub}</div>}</div></div>}
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 panel px-5 py-3 z-[60] rise">{toast}</div>}
      {view.phase === 'ROUND_COMPLETE' && <Results view={view} act={act} />}
    </div>
  );
}
