import type { Action } from '@cabo/game-engine';

type Kind = 'string' | 'boolean';
// Strict allow-list: the client can only ever send these action types with exactly these fields.
// Server-only actions (EXPIRE_WINDOW, PEEK_TIMEOUT) and JOIN_GAME (handled separately) are absent.
const SHAPES: Record<string, Record<string, Kind>> = {
  LEAVE_GAME: {}, START_GAME: {}, ACK_INITIAL_PEEK: {}, START_NEXT_ROUND: {},
  DRAW_CARD: {}, SKIP_POWER: {}, DISCARD_CARD: {}, ADD_TO_HAND: {}, CALL_CABO: {}, END_TURN: {},
  LOOK_AT_OWN_CARD: { cardId: 'string' }, LOOK_AT_OPPONENT_CARD: { cardId: 'string' },
  REPLACE_CARD: { cardId: 'string' }, CONTEST_CARD: { cardId: 'string' }, GIVE_CARD: { cardId: 'string' },
  BLIND_SWAP: { cardIdA: 'string', cardIdB: 'string' }, KING_INSPECT: { cardIdA: 'string', cardIdB: 'string' },
  KING_SWAP_DECISION: { swap: 'boolean' },
};

export function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(SHAPES, type)) return null;
  const shape = SHAPES[type]!;
  const keys = Object.keys(o).filter((k) => k !== 'type');
  if (keys.length !== Object.keys(shape).length) return null; // unknown or forged extra fields
  for (const [k, kind] of Object.entries(shape)) {
    const v = o[k];
    if (typeof v !== kind) return null;
    if (kind === 'string' && (v as string).length > 64) return null;
  }
  for (const k of keys) if (!(k in shape)) return null;
  return o as unknown as Action;
}

export const cleanName = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 20 ? v.trim() : null;
export const isActionId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 64;
