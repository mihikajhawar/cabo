import type { CardDef } from '@cabo/game-engine';

export const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const rankLabel = (r: string) => (r === 'K_RED' || r === 'K_BLACK' ? 'K' : r);
export const isRed = (d: CardDef) => d.suit === 'H' || d.suit === 'D';
export const cardLabel = (d: CardDef) => `${rankLabel(d.rank)}${SUIT_GLYPH[d.suit]}`;
export function slotIndex(slot: string): number {
  const m = /^a(\d)(\d)$/.exec(slot);
  if (m) return (Number(m[1]) - 1) * 2 + (Number(m[2]) - 1);
  const x = /^x(\d+)$/.exec(slot);
  return x ? Number(x[1]) - 1 : 99;
}
export const POWER_NAME: Record<string, string> = {
  LOOK_OWN: 'peek at one of your own cards', LOOK_OPPONENT: "peek at another player's card",
  BLIND_SWAP: 'blindly swap any two cards', KING: 'inspect two cards, then decide whether to swap them',
};
export const ERRORS: Record<string, string> = {
  NOT_YOUR_TURN: "It's not your turn.", WRONG_STEP: "You can't do that right now.", WRONG_PHASE: "You can't do that right now.",
  WINDOW_CLOSED: 'Too late — the toss window closed.', TARGET_LOCKED: "That hand is locked — CABO was called.",
  ACTOR_LOCKED: 'Your hand is locked.', INVALID_TARGET: "That isn't a card you can pick.", OWN_CARD_REQUIRED: 'Pick one of your own cards.',
  OPPONENT_CARD_REQUIRED: "Pick another player's card.", TARGETS_NOT_DISTINCT: 'Pick two different cards.',
  GAME_NOT_FOUND: "No game with that code.", GAME_STARTED: 'That game has already started.', GAME_FULL: 'That game is full (6 players).',
  NAME_TAKEN: 'Someone already uses that name.', INVALID_NAME: 'Enter a name (1–20 characters).', NOT_ENOUGH_PLAYERS: 'You need at least 2 players.',
  RATE_LIMITED: 'Slow down a little.', UNAUTHENTICATED: 'Session expired — rejoin the game.', GAME_ABANDONED: 'The game ended.',
  INVALID_PAYLOAD: 'Something went wrong. Try again.', HAND_EMPTY: 'You have no cards to replace.', HAND_NOT_EMPTY: 'You still have cards.',
};
