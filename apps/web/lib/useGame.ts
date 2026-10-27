'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { CardDef, PlayerView } from '@cabo/game-engine';
import { cardLabel, ERRORS } from './format';
import { sfx } from './sound';
import { serverUrl } from './server';

export interface Peek { id: number; cardId: string; def: CardDef; reason: string; caption: string }
export interface Banner { id: number; text: string; sub?: string }
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
const TOKEN_KEY = 'cabo.token';
const store = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v: string) => { try { sessionStorage.setItem(TOKEN_KEY, v); } catch {} },
  clear: () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch {} },
};

export function useGame() {
  const sock = useRef<Socket | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const peekId = useRef(0);
  const [connected, setConnected] = useState(false);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<PlayerView | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [peeks, setPeeks] = useState<Peek[]>([]);
  const [flash, setFlash] = useState<Record<string, CardDef>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const lastTurn = useRef('');
  const [windowEnds, setWindowEnds] = useState<{ id: number; at: number; ms: number } | null>(null);

  const say = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500); }, []);
  const addLog = (lines: string[]) => lines.length && setLog((l) => [...l, ...lines].slice(-80));

  const handle = useCallback((v: PlayerView, events: { type: string; data: any }[]) => {
    const name = (id: string) => v.players.find((p) => p.playerId === id)?.displayName ?? 'Someone';
    const me = v.you.playerId;
    const who = (id: string) => (id === me ? 'You' : name(id));
    const lines: string[] = [];
    for (const e of events) {
      const d = e.data;
      switch (e.type) {
        case 'PRIVATE_REVEAL': {
          if (!['LOOK_OWN', 'LOOK_OPPONENT', 'PENALTY', 'SUBSTITUTE_DRAW'].includes(d.reason)) break;
          const owner = v.players.find((p) => p.hand.some((h) => h.cardId === d.cardId));
          const caption = d.reason === 'LOOK_OWN' ? 'One of your cards' : d.reason === 'LOOK_OPPONENT' ? `${owner ? name(owner.playerId) + "'s" : 'Their'} card`
            : d.reason === 'PENALTY' ? 'Your penalty card' : 'The card you drew for them';
          sfx.flip();
          const id = ++peekId.current;
          setPeeks((p) => [...p, { id, cardId: d.cardId, def: d.def, reason: d.reason, caption }]);
          setTimeout(() => setPeeks((p) => p.filter((x) => x.id !== id)), 7000);
          break;
        }
        case 'CARD_DRAWN': sfx.deal(); lines.push(`${who(d.playerId)} drew a card.`); break;
        case 'PENALTY_DRAWN': if (d.drawn) { sfx.deal(); lines.push(`${who(d.playerId)} drew a penalty card.`); } break;
        case 'DRAW_SKIPPED': lines.push('The deck is empty — nothing to draw.'); break;
        case 'CARD_DISCARDED': sfx.toss(); lines.push(`${who(d.playerId)} discarded ${cardLabel(d.def)}.`); break;
        case 'CARD_REPLACED': sfx.toss(); lines.push(`${who(d.playerId)} swapped in the drawn card, discarding ${cardLabel(d.discarded)}.`); break;
        case 'CARD_KEPT': lines.push(`${who(d.playerId)} kept the drawn card.`); break;
        case 'POWER_USED': lines.push(`${who(d.playerId)} used a power.`); break;
        case 'POWER_SKIPPED': lines.push(`${who(d.playerId)} skipped the power.`); break;
        case 'CARDS_SWAPPED': sfx.flip(); lines.push(`${who(d.playerId)} swapped two cards.`); break;
        case 'WRONG_CONTEST': {
          sfx.wrong();
          lines.push(`${who(d.playerId)} tossed ${cardLabel(d.def)} — wrong! Penalty card.`);
          setFlash((f) => ({ ...f, [d.cardId]: d.def }));
          setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[d.cardId]; return n; }), 3500);
          break;
        }
        case 'CONTEST_RESOLVED':
          sfx.toss();
          lines.push(d.own ? `${who(d.playerId)} tossed their own ${cardLabel(d.def)}!` : `${who(d.playerId)} tossed ${name(d.targetPlayerId)}'s ${cardLabel(d.def)}!`);
          break;
        case 'CARD_GIVEN': sfx.deal(); lines.push(`${who(d.from)} gave a card to ${who(d.to)}.`); break;
        case 'DRAW_PILE_RESHUFFLED': lines.push('The discard pile was reshuffled into a new draw pile.'); break;
        case 'CABO_CALLED': {
          lines.push(`★ ${who(d.callerId)} called CABO! Everyone else gets one last turn.`);
          sfx.cabo(); const bid = ++peekId.current;
          setBanner({ id: bid, text: 'CABO!', sub: `${who(d.callerId)} called it — everyone else gets one last turn` });
          setTimeout(() => setBanner((b) => (b?.id === bid ? null : b)), 2600);
          break;
        }
        case 'ROUND_SCORED': (d.result?.winnerIds ?? []).includes(me) ? sfx.win() : sfx.flip(); break;
        case 'PLAYER_LEFT': lines.push(`${who(d.playerId)} left the game.`); break;
        case 'ROUND_DEALT': sfx.dealMany(8); lines.push(`Round ${d.roundNumber} — cards dealt.`); break;
      }
    }
    addLog(lines);
  }, [say]);

  useEffect(() => {
    const s = io(serverUrl(), { transports: ['websocket', 'polling'] });
    sock.current = s;
    s.on('connect', () => {
      setConnected(true);
      const token = store.get();
      if (!token) return setBooting(false);
      s.emit('RECONNECT', { token }, (r: any) => { if (!r?.ok) store.clear(); setBooting(false); });
    });
    s.on('disconnect', () => setConnected(false));
    s.on('UPDATE', (u: { view: PlayerView; events: { type: string; data: any }[] }) => {
      viewRef.current = u.view;
      setView(u.view);
      const w = u.view.turn?.window;
      if (w) setWindowEnds((cur) => (cur?.id === w.windowId ? cur : { id: w.windowId, at: performance.now() + w.expiresInMs, ms: w.expiresInMs }));
      const tk = u.view.turn && u.view.turn.ownerId === u.view.you.playerId && u.view.turn.step === 'AWAIT_DRAW' ? `${u.view.roundNumber}:${u.view.turn.ownerId}:${u.view.discardCount}:${u.view.drawPileCount}` : '';
      if (tk && tk !== lastTurn.current) sfx.turn();
      lastTurn.current = tk;
      handle(u.view, u.events);
    });
    s.on('connect_error', () => setBooting(false));
    return () => { s.close(); };
  }, [handle]);

  const request = useCallback(<T,>(event: string, payload: unknown) => new Promise<T>((resolve) => {
    if (!sock.current) return resolve({ ok: false, code: 'INVALID_PAYLOAD' } as T);
    sock.current.timeout(8000).emit(event, payload, (err: unknown, r: T) => resolve(err ? ({ ok: false, code: 'INVALID_PAYLOAD' } as T) : r));
  }), []);

  const create = useCallback(async (displayName: string) => {
    const r: any = await request('CREATE_GAME', { displayName });
    if (r.ok) store.set(r.token); else say(ERRORS[r.code] ?? 'Could not create the game.');
    return r.ok as boolean;
  }, [request, say]);
  const join = useCallback(async (code: string, displayName: string) => {
    const r: any = await request('JOIN_GAME', { code: code.trim().toUpperCase(), displayName });
    if (r.ok) store.set(r.token); else say(ERRORS[r.code] ?? 'Could not join.');
    return r.ok as boolean;
  }, [request, say]);
  const act = useCallback(async (action: Record<string, unknown>) => {
    const r: any = await request('ACTION', { actionId: uid(), action });
    if (!r.ok) say(ERRORS[r.code] ?? 'That did not work.');
    if (r.ok && action.type === 'LEAVE_GAME') { store.clear(); viewRef.current = null; setView(null); setLog([]); }
    return r.ok as boolean;
  }, [request, say]);
  const reset = useCallback(() => { store.clear(); viewRef.current = null; setView(null); setLog([]); }, []);

  return { connected, booting, view, log, peeks, dismissPeek: (id: number) => setPeeks((p) => p.filter((x) => x.id !== id)), flash, toast, banner, windowEnds, create, join, act, reset, say };
}
