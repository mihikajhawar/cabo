import type { GameState, PlayerState, RoundResult } from './types';

export function scorePlayer(s: GameState, p: PlayerState): number {
  return p.hand.reduce((sum, h) => sum + s.cards[h.cardId]!.value, 0); // empty hand = 0
}

export function scoreRound(s: GameState): RoundResult {
  const active = s.players.filter((p) => !p.hasLeft);
  const scores: Record<string, number> = {};
  const revealedHands: RoundResult['revealedHands'] = {};
  for (const p of active) {
    scores[p.id] = scorePlayer(s, p);
    revealedHands[p.id] = p.hand.map((h) => s.cards[h.cardId]!);
  }
  const lowest = (ids: string[]) => {
    const min = Math.min(...ids.map((i) => scores[i]!));
    return ids.filter((i) => scores[i] === min);
  };
  const callerId = s.cabo.called ? s.cabo.callerId : null;
  const base = { roundNumber: s.roundNumber, scores, revealedHands };

  if (callerId && !s.cabo.callerLeft) {
    const callerScore = scores[callerId]!;
    const others = active.filter((p) => p.id !== callerId).map((p) => p.id);
    const blockers = others.filter((id) => scores[id]! <= callerScore);
    const caboSucceeded = blockers.length === 0; // strict: callerScore < every other
    const failureReason = caboSucceeded ? null : blockers.some((id) => scores[id] === callerScore) ? 'TIED' : 'BEATEN';
    const winnerIds = caboSucceeded ? [callerId] : lowest(others);
    return { ...base, caboCallerId: callerId, caboSucceeded, failureReason, blockers, winnerIds, tie: winnerIds.length > 1 };
  }
  const winnerIds = lowest(active.map((p) => p.id));
  return {
    ...base, caboCallerId: callerId, caboSucceeded: false,
    failureReason: callerId ? 'CALLER_LEFT' : null, blockers: [], winnerIds, tie: winnerIds.length > 1,
  };
}
