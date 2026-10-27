'use client';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Makes cards physically travel between places on the table.
 *
 * Every tracked card carries data-fid (its card id). After each render we compare where each card is now with where it
 * was last time (layout positions, so hover/selection transforms never count). A card that moved glides there; a card that
 * is new flies out of the draw pile (or out of the card an opponent was holding). The server stays the only authority:
 * this only animates what the new view already says.
 */
interface Box { cx: number; cy: number; w: number; kind: string }

function boxOf(el: HTMLElement): Box {
  let x = 0, y = 0; let n: HTMLElement | null = el;
  while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
  return { cx: x + el.offsetWidth / 2, cy: y + el.offsetHeight / 2, w: el.offsetWidth, kind: el.dataset.kind ?? '' };
}

function fly(el: HTMLElement, from: Box, to: Box, delay: number, duration = 520) {
  const dx = from.cx - to.cx, dy = from.cy - to.cy; const s = to.w ? from.w / to.w : 1;
  el.getAnimations().forEach((a) => { if (a.id === 'flip') a.cancel(); }); // restart cleanly if one is already in flight
  const end = getComputedStyle(el).transform; const endT = end === 'none' ? '' : end;
  const far = Math.hypot(dx, dy);
  const lift = Math.min(26, far / 8);
  const mid = `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(${((1 + s) / 2) * 1.06}) ${endT}`;
  el.style.zIndex = '40';
  const a = el.animate(
    [{ transform: `translate(${dx}px, ${dy}px) scale(${s}) ${endT}` }, { transform: mid, offset: 0.55 }, { transform: endT || 'none' }],
    { duration: Math.min(760, duration + far * 0.12), delay, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'backwards', id: 'flip' },
  );
  const done = () => { el.style.zIndex = ''; };
  a.onfinish = done; a.oncancel = done;
}

export function useFlip(root: RefObject<HTMLElement | null>) {
  const prev = useRef<Map<string, Box>>(new Map());
  const skip = useRef(false);
  const everyRender = useRef(0);

  useEffect(() => {
    const on = () => { skip.current = true; };
    window.addEventListener('resize', on); return () => window.removeEventListener('resize', on);
  }, []);

  useLayoutEffect(() => {
    const r = root.current; if (!r) return;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cur = new Map<string, { el: HTMLElement; box: Box }>();
    r.querySelectorAll<HTMLElement>('[data-fid]').forEach((el) => { cur.set(el.dataset.fid!, { el, box: boxOf(el) }); });
    const before = prev.current;
    const pile = cur.get('pile')?.box;
    const vanishedHeld = [...before].find(([id]) => id.startsWith('held:') && !cur.has(id))?.[1];
    const seatBox = (): Box | undefined => {
      const owner = r.dataset.turnOwner; const seat = owner ? r.querySelector<HTMLElement>(`[data-seat-id="${owner}"]`) : null;
      return seat ? boxOf(seat) : undefined;
    };
    const first = before.size === 0;
    // When text above/below changes, everything shifts together. That is layout, not a card moving, so cancel the common shift.
    const median = (xs: number[]) => { if (!xs.length) return 0; const a = [...xs].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]!; };
    const groups = new Map<Element, { dx: number[]; dy: number[] }>();
    const groupOf = (el: HTMLElement): Element => el.closest('.hand') ?? el;
    for (const [id, { el, box }] of cur) {
      const was = before.get(id); if (!was || id === 'pile') continue;
      const g = groups.get(groupOf(el)) ?? { dx: [], dy: [] }; g.dx.push(was.cx - box.cx); g.dy.push(was.cy - box.cy); groups.set(groupOf(el), g);
    }
    const shiftOf = (el: HTMLElement) => { const g = el.closest('.hand') ? groups.get(groupOf(el)) : undefined; return g && g.dx.length >= 3 ? { x: median(g.dx), y: median(g.dy) } : { x: 0, y: 0 }; };
    let n = 0;
    if (!reduce && !skip.current) {
      for (const [id, { el, box }] of cur) {
        if (id === 'pile') continue;
        const was = before.get(id);
        if (was) {
          const sh = shiftOf(el);
          const ex = was.cx - box.cx - sh.x, ey = was.cy - box.cy - sh.y;
          if (Math.abs(ex) > 3 || Math.abs(ey) > 3) fly(el, { ...was, cx: box.cx + ex, cy: box.cy + ey }, box, 0, 460);
        } else {
          const origin = box.kind === 'hand' ? (vanishedHeld ?? pile) : box.kind === 'discard' ? (vanishedHeld ?? seatBox() ?? pile) : pile;
          if (origin && Math.hypot(origin.cx - box.cx, origin.cy - box.cy) > 4) fly(el, origin, box, first ? n++ * 85 : box.kind === 'hand' ? n++ * 110 : 0, first ? 620 : 520);
        }
      }
    }
    skip.current = false;
    prev.current = new Map([...cur].map(([id, v]) => [id, v.box]));
    everyRender.current++;
  });
}
