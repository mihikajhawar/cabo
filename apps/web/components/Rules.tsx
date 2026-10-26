'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const VALUES: [string, string][] = [['Red King', '−1'], ['Ace', '1'], ['2 – 10', 'face value'], ['Jack', '11'], ['Queen', '12'], ['Black King', '13']];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (<section className="mt-5"><h3 className="display text-xl" style={{ color: 'var(--candle)' }}>{title}</h3><div className="mt-1 space-y-2 opacity-90">{children}</div></section>);
}

export function RulesModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto" style={{ background: 'rgba(8,5,3,.88)' }} onClick={onClose} role="dialog" aria-label="How to play" data-testid="rules">
      <div className="min-h-full grid place-items-center p-3 sm:p-6">
        <div className="panel-solid w-full max-w-2xl p-5 sm:p-8 rise text-left" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <h2 className="display text-3xl sm:text-4xl" style={{ color: 'var(--candle)' }}>How to play Cabo</h2>
            <button className="btn btn-ghost" onClick={onClose} aria-label="Close rules">Close ✕</button>
          </div>
          <p className="mt-2 italic opacity-80">Finish the round with the lowest total. Your cards are hidden — even from you — so memory is the game.</p>

          <Section title="The goal">
            <p>Each player holds cards face down. Your score is the sum of the cards in your hand when the round ends. <b>Lowest score wins.</b> You can have more than four cards, and you can even have none (a score of 0) — but a Red King can take you below zero.</p>
          </Section>

          <Section title="Card values">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {VALUES.map(([n, v]) => (<div key={n} className="seat flex justify-between" style={{ border: '1px solid rgba(184,147,90,.25)' }}><span>{n}</span><b style={{ color: 'var(--candle)' }}>{v}</b></div>))}
            </div>
            <p className="text-sm opacity-75">There are two red Kings (−1 each) and two black Kings (13 each).</p>
          </Section>

          <Section title="The deal">
            <p>Everyone gets 4 cards in a 2×2 grid, face down. You may look at your <b>two bottom cards</b> once, then they turn face down again. One card starts the discard pile. You never see anyone else&apos;s cards unless a power shows you.</p>
          </Section>

          <Section title="On your turn">
            <ol className="list-decimal pl-6 space-y-1">
              <li><b>Draw</b> one card from the draw pile. You can never take from the discard pile. You see what you drew.</li>
              <li><b>Use its power</b> if it has one (below) — or skip it.</li>
              <li><b>Discard</b> the drawn card, <i>or</i> <b>replace</b> one of your own cards with it (the replaced card is discarded face up).</li>
              <li>A <b>2-second toss window</b> opens (below).</li>
              <li>Then you may <b>call CABO</b> or <b>end your turn</b>.</li>
            </ol>
            <p className="text-sm opacity-75">If you have no cards, you can&apos;t replace — you may keep the drawn card instead.</p>
          </Section>

          <Section title="Card powers">
            <p className="text-sm opacity-75">Only a card you <b>just drew</b> has a power — never a card already in a hand. If a power has nothing legal to target, it&apos;s skipped.</p>
            <ul className="space-y-1 pl-1">
              <li><b>7 or 8</b> — peek at one of your own cards.</li>
              <li><b>9 or 10</b> — peek at any one card belonging to another player.</li>
              <li><b>Jack or Queen</b> — blind swap: pick any two cards in the game (yours, theirs, any mix) and swap them without looking.</li>
              <li><b>King (red or black)</b> — pick any two cards, look at both, then choose whether to swap them.</li>
            </ul>
            <p className="text-sm opacity-75">Only you see what a power shows you. Afterwards the card is face down again, so remember it.</p>
          </Section>

          <Section title="Tossing (contesting)">
            <p>Whenever a card lands on the discard pile, <b>anyone</b> gets 2 seconds to toss a card of the <b>same rank</b> onto it — one of their own, or even someone else&apos;s. A red King and a black King count as the same rank. The first correct toss wins; the window then closes.</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><b>Your own card:</b> it leaves your hand (your hand gets smaller).</li>
              <li><b>Someone else&apos;s card:</b> it&apos;s removed from their hand, and you give them one of your cards. If you have no cards, you draw one from the pile and give them that instead.</li>
              <li><b>Wrong guess:</b> the card you tossed is shown to everyone and stays where it was, and you draw one penalty card (only you see it).</li>
            </ul>
          </Section>

          <Section title="Calling CABO">
            <p>After completing your turn you may call <b>CABO</b>. Your hand locks immediately — nobody can swap, replace, peek at, or toss any of your cards, and you take no more actions. <b>Every other player gets exactly one final turn.</b> Then all cards are revealed.</p>
            <p>Final turns work like normal turns, except nobody can call CABO again.</p>
          </Section>

          <Section title="Who wins?">
            <p>The CABO caller wins <b>only if their score is strictly lower than every other player&apos;s</b>. A tie is a loss for the caller, and so is anyone scoring lower. If the caller fails, the lowest-scoring other player wins (equal lowest scores tie). Each round stands alone.</p>
          </Section>

          <Section title="Good to know">
            <ul className="list-disc pl-6 space-y-1">
              <li>Glowing cards are the ones you can tap right now.</li>
              <li>If someone disconnects, the game waits for them. Pressing <b>Leave</b> removes you for good and your cards leave play.</li>
              <li>The winner of a round starts the next one (after a tie, whoever presses deal).</li>
            </ul>
          </Section>
          <div className="mt-6 text-center"><button className="btn btn-primary" onClick={onClose}>Got it</button></div>
        </div>
      </div>
    </div>
  );
}

export function RulesButton({ className = 'btn btn-ghost', label = 'How to play' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (<><button className={className} onClick={() => setOpen(true)} data-testid="rules-button">{label}</button>{open && createPortal(<RulesModal onClose={() => setOpen(false)} />, document.body)}</>);
}
