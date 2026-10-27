'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import type { CardDef, ViewCard } from '@cabo/game-engine';
import { isRed, rankLabel, slotIndex, SUIT_GLYPH } from '../lib/format';

// Classic playing-card pip layouts: [column 0|.5|1, row 0..1] inside the pip box.
const L = 0, C = 0.5, R = 1;
const PIPS: Record<string, [number, number][]> = {
  '2': [[C, 0], [C, 1]], '3': [[C, 0], [C, .5], [C, 1]], '4': [[L, 0], [R, 0], [L, 1], [R, 1]],
  '5': [[L, 0], [R, 0], [C, .5], [L, 1], [R, 1]], '6': [[L, 0], [R, 0], [L, .5], [R, .5], [L, 1], [R, 1]],
  '7': [[L, 0], [R, 0], [C, .25], [L, .5], [R, .5], [L, 1], [R, 1]],
  '8': [[L, 0], [R, 0], [C, .25], [L, .5], [R, .5], [C, .75], [L, 1], [R, 1]],
  '9': [[L, 0], [R, 0], [L, 1 / 3], [R, 1 / 3], [C, .5], [L, 2 / 3], [R, 2 / 3], [L, 1], [R, 1]],
  '10': [[L, 0], [R, 0], [C, 1 / 6], [L, 1 / 3], [R, 1 / 3], [L, 2 / 3], [R, 2 / 3], [C, 5 / 6], [L, 1], [R, 1]],
};
const COURT_ICON: Record<string, string> = { J: '♞', Q: '♛', K_RED: '♚', K_BLACK: '♚' };

function Face({ def }: { def: CardDef }) {
  const rank = rankLabel(def.rank); const glyph = SUIT_GLYPH[def.suit];
  const court = def.rank === 'J' || def.rank === 'Q' || def.rank === 'K_RED' || def.rank === 'K_BLACK';
  return (
    <>
      <div className="idx tl">{rank}<br />{glyph}</div>
      <div className="idx br">{rank}<br />{glyph}</div>
      {court ? (
        <div className="court"><span className="crown">{COURT_ICON[def.rank]}</span><span className="letter">{rank}</span><span className="csuit">{glyph}</span></div>
      ) : def.rank === 'A' ? (
        <div className="ace">{glyph}</div>
      ) : (
        <div className="pipbox">
          {(PIPS[def.rank] ?? []).map(([x, y], i) => (
            <span key={i} className={`pp ${y > 0.5 ? 'inv' : ''}`} style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>{glyph}</span>
          ))}
        </div>
      )}
    </>
  );
}

export function Card({ def, size, eligible, selected, locked, dim, onClick, title, delay, enter, flipIn, shake, className, testId, label, rest, vars, fid, kind }: {
  def: CardDef | null; size?: 'sm' | 'lg'; eligible?: boolean; selected?: boolean; locked?: boolean; dim?: boolean; onClick?: () => void; title?: string;
  delay?: number; enter?: boolean; flipIn?: boolean; shake?: boolean; className?: string; testId?: string; label?: string; rest?: number; vars?: Record<string, string>; fid?: string; kind?: 'hand' | 'held' | 'discard';
}) {
  // Keep the last face on screen while the card turns back over, then drop it so nothing lingers in the page.
  const [shown, setShown] = useState<CardDef | null>(def);
  const [armed, setArmed] = useState(!flipIn);
  useEffect(() => {
    if (def) { setShown(def); return; }
    const t = setTimeout(() => setShown(null), 700); return () => clearTimeout(t);
  }, [def]);
  useEffect(() => { if (!flipIn) return; const t = setTimeout(() => setArmed(true), 380 + (delay ?? 0)); return () => clearTimeout(t); }, [flipIn, delay]);
  const up = !!def && armed;
  const cls = ['card', size ?? '', eligible ? 'eligible' : '', selected ? 'selected' : '', locked ? 'locked' : '', dim ? 'dim' : '', enter ? 'enter' : '', shake ? 'shake' : '', className ?? ''].join(' ');
  const style = { '--d': `${delay ?? 0}ms`, ...(rest !== undefined ? { '--rest': `${rest}deg` } : {}), ...vars } as CSSProperties;
  return (
    <div className={cls} style={style} onClick={eligible ? onClick : undefined} title={title} role={eligible ? 'button' : undefined}
      aria-label={label} data-testid={testId} data-fid={fid} data-kind={kind} data-card={def ? `${def.rank}${def.suit}` : 'hidden'}>
      <div className={`flip ${up ? 'up' : ''}`}>
        <div className="face back card-back" />
        <div className={`face front card-face ${shown && isRed(shown) ? 'red' : ''}`}>{shown && <Face def={shown} />}</div>
      </div>
    </div>
  );
}

export function EmptySlot({ size }: { size?: 'sm' | 'lg' }) { return <div className={`card card-empty ${size ?? ''}`} />; }

/** A hand as a 2x2 grid (a11 a12 / a21 a22), overflow cards continue below. Values only appear if `known` has them. */
export function HandGrid({ cards, size, known, eligible, selected, onPick, locked, shaking, reveal, track, baseDelay = 0 }: {
  cards: ViewCard[]; size?: 'sm' | 'lg'; known: Record<string, CardDef>; eligible: Set<string>; selected: Set<string>;
  onPick: (cardId: string) => void; locked: boolean; shaking?: Set<string>; reveal?: boolean; track?: boolean; baseDelay?: number;
}) {
  const bySlot = new Map(cards.map((c) => [slotIndex(c.slot), c]));
  const max = Math.max(3, ...cards.map((c) => slotIndex(c.slot)));
  const cells = [];
  for (let i = 0; i <= (max % 2 === 0 ? max + 1 : max); i++) {
    const c = bySlot.get(i);
    if (!c) { if (i < 4) cells.push(<EmptySlot key={`e${i}`} size={size} />); continue; }
    cells.push(
      <Card key={c.cardId} def={c.def ?? known[c.cardId] ?? null} size={size} locked={locked} eligible={eligible.has(c.cardId)}
        delay={reveal ? baseDelay + i * 120 : 0} flipIn={reveal} shake={shaking?.has(c.cardId)} fid={track ? c.cardId : undefined} kind={track ? 'hand' : undefined}
        selected={selected.has(c.cardId)} onClick={() => onPick(c.cardId)} />,
    );
  }
  return <div className="hand">{cells}</div>;
}
