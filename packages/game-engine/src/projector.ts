import type {
  CardDef, CardId, GameState, PlayerId, PlayerState, RoundPhase, RoundResult, SlotId,
} from './types';

/**
 * The ONLY code that turns server state into something a client may see.
 * Hidden card values are never included; known cards are shown once via
 * PRIVATE_REVEAL events and then face-down again (D2: transient knowledge).
 * Exceptions, all state-derived so a reconnect restores them: your own in-flight drawn card,
 * the cards you are currently inspecting (King / opening peek), and every hand at round end.
 */
export interface ViewCard { cardId: CardId; slot: SlotId; locked: boolean; def: CardDef | null }
export interface PlayerView {
  gameCode: string;
  roundNumber: number;
  phase: RoundPhase;
  you: {
    playerId: PlayerId;
    drawnCard: { cardId: CardId; def: CardDef } | null;
    inspecting: { cardId: CardId; def: CardDef }[];
    allowedActions: string[];
    interaction: null | { purpose: string; eligibleCardIds: CardId[] };
  };
  players: {
    playerId: PlayerId; displayName: string; seat: number; connected: boolean; hasLeft: boolean;
    handLocked: boolean; isCaboCaller: boolean; hand: ViewCard[];
  }[];
  drawPileCount: number;
  discardTop: CardDef | null;
  discardCount: number;
  turn: null | {
    step: string; ownerId: PlayerId; isFinalTurn: boolean;
    window?: { windowId: number; expiresInMs: number };
    give?: { contesterId: PlayerId; targetId: PlayerId };
    finalTurnsRemaining?: PlayerId[];
  };
  caboCallerId: PlayerId | null;
  result: RoundResult | null;
  history: RoundResult[];
  peekWaitingOn?: number;
}

const unlockedCardIds = (s: GameState, pred: (p: PlayerState) => boolean = () => true): CardId[] =>
  s.players.filter((p) => !p.hasLeft && !p.handLocked && pred(p)).flatMap((p) => p.hand.map((h) => h.cardId));

export function projectFor(s: GameState, viewerId: PlayerId, now = 0): PlayerView {
  const me = s.players.find((p) => p.id === viewerId);
  if (!me) throw new Error('unknown viewer');
  const revealAll = s.phase === 'ROUND_COMPLETE';
  const t = s.turn;
  const st = t?.step;
  const mine = t?.ownerId === viewerId;

  let drawnCard: PlayerView['you']['drawnCard'] = null;
  const inspecting: PlayerView['you']['inspecting'] = [];
  if (mine && st && 'drawnCardId' in st) drawnCard = { cardId: st.drawnCardId, def: s.cards[st.drawnCardId]! };
  if (mine && st?.kind === 'AWAIT_KING_DECISION') for (const id of [st.a, st.b]) inspecting.push({ cardId: id, def: s.cards[id]! });
  if (s.phase === 'DEALING' && !me.peekAcked)
    for (const h of me.hand) if (h.slot === 'a21' || h.slot === 'a22') inspecting.push({ cardId: h.cardId, def: s.cards[h.cardId]! });

  const allowed: string[] = [];
  let interaction: PlayerView['you']['interaction'] = null;
  if (s.phase === 'LOBBY') { if (s.players.length >= 2) allowed.push('START_GAME'); allowed.push('LEAVE_GAME'); }
  else if (s.phase === 'DEALING') { if (!me.peekAcked) allowed.push('ACK_INITIAL_PEEK'); allowed.push('LEAVE_GAME'); }
  else if (s.phase === 'ROUND_COMPLETE') allowed.push('START_NEXT_ROUND', 'LEAVE_GAME');
  else if ((s.phase === 'PLAYING' || s.phase === 'FINAL_TURNS') && st && t) {
    allowed.push('LEAVE_GAME');
    if (!me.handLocked) {
      if (st.kind === 'CONTEST_WINDOW' && now < st.window.expiresAt) {
        allowed.push('CONTEST_CARD');
        interaction = { purpose: 'CONTEST', eligibleCardIds: unlockedCardIds(s) };
      }
      if (st.kind === 'AWAIT_GIVE_CARD' && st.contesterId === viewerId) {
        allowed.push('GIVE_CARD');
        interaction = { purpose: 'GIVE', eligibleCardIds: me.hand.map((h) => h.cardId) };
      }
      if (mine) {
        const own = me.hand.map((h) => h.cardId);
        switch (st.kind) {
          case 'AWAIT_DRAW': allowed.push('DRAW_CARD'); break;
          case 'AWAIT_POWER_DECISION':
            allowed.push('SKIP_POWER', 'DISCARD_CARD');
            if (own.length) allowed.push('REPLACE_CARD');
            else allowed.push('ADD_TO_HAND');
            if (st.power === 'LOOK_OWN') { allowed.push('LOOK_AT_OWN_CARD'); interaction = { purpose: 'LOOK_OWN', eligibleCardIds: own }; }
            if (st.power === 'LOOK_OPPONENT') {
              allowed.push('LOOK_AT_OPPONENT_CARD');
              interaction = { purpose: 'LOOK_OPPONENT', eligibleCardIds: unlockedCardIds(s, (p) => p.id !== viewerId) };
            }
            if (st.power === 'BLIND_SWAP') { allowed.push('BLIND_SWAP'); interaction = { purpose: 'BLIND_SWAP', eligibleCardIds: unlockedCardIds(s) }; }
            if (st.power === 'KING') { allowed.push('KING_INSPECT'); interaction = { purpose: 'KING_INSPECT', eligibleCardIds: unlockedCardIds(s) }; }
            break;
          case 'AWAIT_KING_DECISION': allowed.push('KING_SWAP_DECISION'); break;
          case 'AWAIT_DISPOSE':
            allowed.push('DISCARD_CARD');
            if (own.length) { allowed.push('REPLACE_CARD'); interaction = { purpose: 'REPLACE', eligibleCardIds: own }; }
            else allowed.push('ADD_TO_HAND');
            break;
          case 'AWAIT_CABO_DECISION': allowed.push('END_TURN', 'CALL_CABO'); break;
        }
      }
    }
  }

  const topId = s.discard[s.discard.length - 1];
  return {
    gameCode: s.code, roundNumber: s.roundNumber, phase: s.phase,
    you: { playerId: viewerId, drawnCard, inspecting, allowedActions: allowed, interaction },
    players: s.players.map((p) => ({
      playerId: p.id, displayName: p.displayName, seat: p.seat, connected: p.connected, hasLeft: p.hasLeft,
      handLocked: p.handLocked, isCaboCaller: s.cabo.callerId === p.id && s.cabo.called,
      hand: p.hand.map((h) => ({
        cardId: h.cardId, slot: h.slot, locked: p.handLocked,
        def: revealAll ? s.cards[h.cardId]! : null,
      })),
    })),
    drawPileCount: s.deck.length,
    discardTop: topId ? s.cards[topId]! : null,
    discardCount: s.discard.length,
    turn: t && st ? {
      step: st.kind, ownerId: t.ownerId, isFinalTurn: t.isFinalTurn,
      ...(st.kind === 'CONTEST_WINDOW' ? { window: { windowId: st.window.windowId, expiresInMs: Math.max(0, st.window.expiresAt - now) } } : {}),
      ...(st.kind === 'AWAIT_GIVE_CARD' ? { give: { contesterId: st.contesterId, targetId: st.targetId } } : {}),
      ...(t.isFinalTurn ? { finalTurnsRemaining: [...s.finalTurnQueue] } : {}),
    } : null,
    caboCallerId: s.cabo.called ? s.cabo.callerId : null,
    result: s.result,
    history: s.history,
  };
}
