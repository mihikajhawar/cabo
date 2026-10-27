import { createDeckDefs, ranksMatchForContest, shuffle } from './cards';
import { scoreRound } from './scoring';
import type {
  Action, CardId, Env, ErrorCode, GameEvent, GameState, HandEntry, PlayerId, PlayerState,
  PowerKind, Result, TurnStep,
} from './types';

export const CONTEST_WINDOW_MS = 5000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

class Fail extends Error { constructor(public code: ErrorCode) { super(code); } }
const fail = (c: ErrorCode): never => { throw new Fail(c); };

interface Ctx { s: GameState; env: Env; ev: GameEvent[] }
const emit = (c: Ctx, to: 'ALL' | PlayerId, type: string, data: Record<string, unknown> = {}): void => {
  c.ev.push({ to, type, data });
};

// ---------- creation ----------
export function createGame(id: string, code: string, hostId: PlayerId, hostName: string): GameState {
  return {
    id, code,
    players: [newPlayer(hostId, hostName, 0)],
    phase: 'LOBBY', turn: null, finalTurnQueue: [],
    cards: {}, deck: [], discard: [], outOfPlay: [],
    cabo: { called: false, callerId: null, callerLeft: false },
    roundNumber: 0, starterId: null, nextStarterId: null, windowCounter: 0, turnCounter: 0,
    history: [], knowledge: {}, publicKnowledge: new Set(), result: null,
  };
}
function newPlayer(id: PlayerId, displayName: string, seat: number): PlayerState {
  return { id, displayName, seat, connected: true, hasLeft: false, hand: [], handLocked: false, hasTakenFinalTurn: false, peekAcked: false };
}

/** Connection flag only. The game never advances or auto-plays on disconnect. */
export function setConnected(state: GameState, playerId: PlayerId, connected: boolean): GameState {
  const s = structuredClone(state);
  const p = s.players.find((x) => x.id === playerId);
  if (p && !p.hasLeft) p.connected = connected;
  return s;
}

// ---------- dispatch ----------
export function dispatch(state: GameState, actor: PlayerId | 'SERVER', action: Action, env: Env): Result {
  const s = structuredClone(state); // atomic: any failure discards the clone
  const c: Ctx = { s, env, ev: [] };
  try {
    apply(c, actor, action);
    return { ok: true, state: s, events: c.ev };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, code: e.code };
    throw e;
  }
}

function apply(c: Ctx, actor: PlayerId | 'SERVER', a: Action): void {
  const s = c.s;
  if (a.type === 'EXPIRE_WINDOW' || a.type === 'PEEK_TIMEOUT') {
    if (actor !== 'SERVER') fail('NOT_SERVER');
    if (s.phase === 'ABANDONED') return;
    if (a.type === 'PEEK_TIMEOUT') {
      if (s.phase !== 'DEALING') return;
      for (const p of s.players) if (!p.hasLeft) p.peekAcked = true;
      return beginPlaying(c);
    }
    const t = s.turn;
    if (t && t.step.kind === 'CONTEST_WINDOW' && t.step.window.windowId === a.windowId) {
      emit(c, 'ALL', 'CONTEST_WINDOW_CLOSED', { windowId: a.windowId });
      turnComplete(c);
    }
    return; // stale timers are harmless no-ops
  }
  if (actor === 'SERVER') return fail('NOT_SERVER');
  if (a.type === 'JOIN_GAME') return join(c, actor, a.displayName);

  const me = s.players.find((p) => p.id === actor);
  if (!me || me.hasLeft) return fail('UNAUTHENTICATED');
  if (s.phase === 'ABANDONED') return fail('GAME_ABANDONED');

  switch (a.type) {
    case 'LEAVE_GAME': return leave(c, me);
    case 'START_GAME': {
      if (s.phase !== 'LOBBY') fail('WRONG_PHASE');
      if (s.players.length < MIN_PLAYERS) fail('NOT_ENOUGH_PLAYERS');
      emit(c, 'ALL', 'GAME_STARTED');
      return startRound(c, me.id);
    }
    case 'ACK_INITIAL_PEEK': {
      if (s.phase !== 'DEALING') fail('WRONG_PHASE');
      me.peekAcked = true;
      emit(c, 'ALL', 'PEEK_PROGRESS', { acked: s.players.filter((p) => p.peekAcked).length });
      return checkAllAcked(c);
    }
    case 'START_NEXT_ROUND': {
      if (s.phase !== 'ROUND_COMPLETE') fail('WRONG_PHASE');
      const next = s.nextStarterId && s.players.some((p) => p.id === s.nextStarterId && !p.hasLeft) ? s.nextStarterId : me.id;
      return startRound(c, next);
    }
  }

  // ---- gameplay actions below: a locked (CABO) player can never act ----
  if (me.handLocked) fail('ACTOR_LOCKED');
  switch (a.type) {
    case 'DRAW_CARD': {
      needTurn(c, me.id, ['AWAIT_DRAW']);
      const id = drawFromPile(c);
      if (id === null) { emit(c, 'ALL', 'DRAW_SKIPPED'); return turnComplete(c); }
      know(s, me.id, id);
      const def = s.cards[id]!;
      emit(c, me.id, 'PRIVATE_REVEAL', { cardId: id, def, reason: 'DRAW' });
      emit(c, 'ALL', 'CARD_DRAWN', { playerId: me.id, drawPileCount: s.deck.length });
      const power = powerFor(def.rank);
      s.turn!.step = power && powerAvailable(s, me, power)
        ? { kind: 'AWAIT_POWER_DECISION', drawnCardId: id, power }
        : { kind: 'AWAIT_DISPOSE', drawnCardId: id };
      return;
    }
    case 'SKIP_POWER': {
      const st = needTurn(c, me.id, ['AWAIT_POWER_DECISION']) as Extract<TurnStep, { kind: 'AWAIT_POWER_DECISION' }>;
      emit(c, 'ALL', 'POWER_SKIPPED', { playerId: me.id });
      s.turn!.step = { kind: 'AWAIT_DISPOSE', drawnCardId: st.drawnCardId };
      return;
    }
    case 'LOOK_AT_OWN_CARD': {
      const st = needPower(c, me.id, 'LOOK_OWN');
      const entry = ownEntry(s, me, a.cardId);
      know(s, me.id, entry.cardId);
      emit(c, me.id, 'PRIVATE_REVEAL', { cardId: entry.cardId, def: s.cards[entry.cardId], reason: 'LOOK_OWN' });
      emit(c, 'ALL', 'POWER_USED', { kind: 'LOOK_OWN', playerId: me.id, targets: [entry.cardId] });
      return discardAfterPower(c, me, st.drawnCardId);
    }
    case 'LOOK_AT_OPPONENT_CARD': {
      const st = needPower(c, me.id, 'LOOK_OPPONENT');
      const t = resolveTarget(s, a.cardId);
      if (t.player.id === me.id) fail('OPPONENT_CARD_REQUIRED');
      know(s, me.id, a.cardId);
      emit(c, me.id, 'PRIVATE_REVEAL', { cardId: a.cardId, def: s.cards[a.cardId], reason: 'LOOK_OPPONENT' });
      emit(c, 'ALL', 'POWER_USED', { kind: 'LOOK_OPPONENT', playerId: me.id, targets: [a.cardId] });
      return discardAfterPower(c, me, st.drawnCardId);
    }
    case 'BLIND_SWAP': {
      const st = needPower(c, me.id, 'BLIND_SWAP');
      if (a.cardIdA === a.cardIdB) fail('TARGETS_NOT_DISTINCT');
      const ta = resolveTarget(s, a.cardIdA), tb = resolveTarget(s, a.cardIdB);
      swapEntries(ta.entry, tb.entry);
      emit(c, 'ALL', 'CARDS_SWAPPED', { playerId: me.id, cardIdA: a.cardIdA, cardIdB: a.cardIdB });
      return discardAfterPower(c, me, st.drawnCardId);
    }
    case 'KING_INSPECT': {
      const st = needPower(c, me.id, 'KING');
      if (a.cardIdA === a.cardIdB) fail('TARGETS_NOT_DISTINCT');
      resolveTarget(s, a.cardIdA); resolveTarget(s, a.cardIdB);
      for (const id of [a.cardIdA, a.cardIdB]) {
        know(s, me.id, id);
        emit(c, me.id, 'PRIVATE_REVEAL', { cardId: id, def: s.cards[id], reason: 'KING' });
      }
      emit(c, 'ALL', 'POWER_USED', { kind: 'KING', playerId: me.id, targets: [a.cardIdA, a.cardIdB] });
      s.turn!.step = { kind: 'AWAIT_KING_DECISION', drawnCardId: st.drawnCardId, a: a.cardIdA, b: a.cardIdB };
      return;
    }
    case 'KING_SWAP_DECISION': {
      const st = needTurn(c, me.id, ['AWAIT_KING_DECISION']) as Extract<TurnStep, { kind: 'AWAIT_KING_DECISION' }>;
      if (a.swap) {
        swapEntries(resolveTarget(s, st.a).entry, resolveTarget(s, st.b).entry);
        emit(c, 'ALL', 'CARDS_SWAPPED', { playerId: me.id, cardIdA: st.a, cardIdB: st.b });
      }
      return discardAfterPower(c, me, st.drawnCardId);
    }
    case 'DISCARD_CARD': {
      const st = needDispose(c, me.id);
      return discardDrawn(c, me, st.drawnCardId);
    }
    case 'REPLACE_CARD': {
      const st = needDispose(c, me.id);
      if (me.hand.length === 0) fail('HAND_EMPTY');
      const entry = ownEntry(s, me, a.cardId);
      const old = entry.cardId;
      entry.cardId = st.drawnCardId;
      discardCard(s, old);
      emit(c, 'ALL', 'CARD_REPLACED', { playerId: me.id, slot: entry.slot, newCardId: st.drawnCardId, discarded: s.cards[old] });
      return openWindow(c, old);
    }
    case 'ADD_TO_HAND': {
      const st = needDispose(c, me.id);
      if (me.hand.length !== 0) fail('HAND_NOT_EMPTY');
      me.hand.push({ cardId: st.drawnCardId, slot: freeSlot(me) });
      emit(c, 'ALL', 'CARD_KEPT', { playerId: me.id, cardId: st.drawnCardId });
      return turnComplete(c); // nothing discarded, so no contest window
    }
    case 'CONTEST_CARD': return contest(c, me, a.cardId);
    case 'GIVE_CARD': {
      const t = s.turn;
      if (!t || (s.phase !== 'PLAYING' && s.phase !== 'FINAL_TURNS')) return fail('WRONG_PHASE');
      if (t.step.kind !== 'AWAIT_GIVE_CARD') return fail('WRONG_STEP');
      if (t.step.contesterId !== me.id) return fail('NOT_YOUR_ACTION');
      const entry = ownEntry(s, me, a.cardId);
      const target = s.players.find((p) => p.id === (t.step as { targetId: PlayerId }).targetId)!;
      me.hand.splice(me.hand.indexOf(entry), 1);
      target.hand.push({ cardId: entry.cardId, slot: freeSlot(target) });
      emit(c, 'ALL', 'CARD_GIVEN', { from: me.id, to: target.id, cardId: entry.cardId });
      return turnComplete(c);
    }
    case 'CALL_CABO': {
      const t = s.turn;
      if (!t || (s.phase !== 'PLAYING') || t.ownerId !== me.id || t.isFinalTurn || t.step.kind !== 'AWAIT_CABO_DECISION')
        return fail('CABO_NOT_AVAILABLE');
      me.handLocked = true; // atomic with the call
      s.cabo = { called: true, callerId: me.id, callerLeft: false };
      s.finalTurnQueue = turnOrderAfter(s, me.id).filter((id) => id !== me.id);
      s.phase = 'FINAL_TURNS';
      emit(c, 'ALL', 'CABO_CALLED', { callerId: me.id });
      return startFinalTurnFor(c);
    }
    case 'END_TURN': {
      needTurn(c, me.id, ['AWAIT_CABO_DECISION']);
      if (s.turn!.isFinalTurn) fail('WRONG_STEP');
      return nextNormalTurn(c, me.id);
    }
  }
}

// ---------- lobby / leave ----------
function join(c: Ctx, actor: PlayerId, rawName: string): void {
  const s = c.s;
  if (s.phase !== 'LOBBY') fail('GAME_STARTED');
  if (s.players.length >= MAX_PLAYERS) fail('GAME_FULL');
  const name = String(rawName ?? '').trim();
  if (name.length < 1 || name.length > 20) fail('INVALID_NAME');
  if (s.players.some((p) => p.displayName.toLowerCase() === name.toLowerCase())) fail('NAME_TAKEN');
  if (s.players.some((p) => p.id === actor)) fail('UNAUTHENTICATED');
  s.players.push(newPlayer(actor, name, s.players.length));
  emit(c, 'ALL', 'LOBBY_UPDATED');
}

function leave(c: Ctx, me: PlayerState): void {
  const s = c.s;
  if (s.phase === 'LOBBY') {
    s.players = s.players.filter((p) => p.id !== me.id);
    s.players.forEach((p, i) => (p.seat = i));
    return emit(c, 'ALL', 'LOBBY_UPDATED');
  }
  me.hasLeft = true; me.connected = false;
  s.outOfPlay.push(...me.hand.map((h) => h.cardId));
  me.hand = [];
  emit(c, 'ALL', 'PLAYER_LEFT', { playerId: me.id });
  if (s.cabo.called && s.cabo.callerId === me.id) s.cabo.callerLeft = true;
  if (s.players.filter((p) => !p.hasLeft).length < MIN_PLAYERS) {
    s.phase = 'ABANDONED'; s.turn = null;
    return emit(c, 'ALL', 'GAME_ABANDONED');
  }
  if (s.phase === 'DEALING') return checkAllAcked(c);
  if (s.phase !== 'PLAYING' && s.phase !== 'FINAL_TURNS') return;
  const t = s.turn!;
  const inQueue = s.finalTurnQueue.indexOf(me.id);
  if (inQueue >= 0) s.finalTurnQueue.splice(inQueue, 1);
  const st = t.step;
  if (t.ownerId === me.id) {
    if ('drawnCardId' in st) s.outOfPlay.push(st.drawnCardId); // in-flight card leaves play
    if (st.kind === 'CONTEST_WINDOW' || st.kind === 'AWAIT_GIVE_CARD') {
      if (st.kind === 'AWAIT_GIVE_CARD') turnComplete(c); // window keeps running otherwise
      return;
    }
    return t.isFinalTurn ? startFinalTurnFor(c) : nextNormalTurn(c, me.id);
  }
  if (st.kind === 'AWAIT_GIVE_CARD' && (st.contesterId === me.id || st.targetId === me.id)) turnComplete(c);
}

// ---------- round flow ----------
function startRound(c: Ctx, starterId: PlayerId): void {
  const { s, env } = c;
  s.roundNumber += 1;
  s.cards = {}; s.deck = []; s.discard = []; s.outOfPlay = [];
  s.knowledge = {}; s.publicKnowledge = new Set();
  s.cabo = { called: false, callerId: null, callerLeft: false };
  s.finalTurnQueue = []; s.turn = null; s.result = null; s.nextStarterId = null;
  const ids: CardId[] = [];
  for (const def of createDeckDefs()) { const id = env.newId(); s.cards[id] = def; ids.push(id); }
  s.deck = shuffle(ids, env);
  const active = s.players.filter((p) => !p.hasLeft);
  for (const p of active) {
    p.hand = []; p.handLocked = false; p.hasTakenFinalTurn = false; p.peekAcked = false;
    s.knowledge[p.id] = new Set();
    for (let i = 0; i < 4; i++) p.hand.push({ cardId: s.deck.shift()!, slot: freeSlot(p) });
    for (const slot of ['a21', 'a22']) { // fixed-slot opening peek
      const e = p.hand.find((h) => h.slot === slot)!;
      know(s, p.id, e.cardId);
      emit(c, p.id, 'PRIVATE_REVEAL', { cardId: e.cardId, def: s.cards[e.cardId], reason: 'INITIAL_PEEK' });
    }
  }
  s.starterId = starterId;
  s.phase = 'DEALING';
  emit(c, 'ALL', 'ROUND_DEALT', { roundNumber: s.roundNumber, starterId });
}

function checkAllAcked(c: Ctx): void {
  if (c.s.players.filter((p) => !p.hasLeft).every((p) => p.peekAcked)) beginPlaying(c);
}
function beginPlaying(c: Ctx): void {
  const s = c.s;
  let starter = s.players.find((p) => p.id === s.starterId && !p.hasLeft);
  if (!starter) starter = s.players.find((p) => !p.hasLeft)!;
  s.phase = 'PLAYING';
  s.turn = { ownerId: starter.id, isFinalTurn: false, turnNumber: ++s.turnCounter, step: { kind: 'AWAIT_DRAW' } };
  emit(c, 'ALL', 'TURN_CHANGED', { ownerId: starter.id, isFinalTurn: false });
}

function turnOrderAfter(s: GameState, fromId: PlayerId): PlayerId[] {
  const ordered = [...s.players].filter((p) => !p.hasLeft).sort((a, b) => a.seat - b.seat);
  const i = ordered.findIndex((p) => p.id === fromId);
  const rotated = i >= 0 ? [...ordered.slice(i + 1), ...ordered.slice(0, i + 1)] : ordered;
  return rotated.map((p) => p.id); // ends with fromId (if active)
}
function nextNormalTurn(c: Ctx, fromId: PlayerId): void {
  const s = c.s;
  const next = turnOrderAfter(s, fromId)[0]!;
  s.turn = { ownerId: next, isFinalTurn: false, turnNumber: ++s.turnCounter, step: { kind: 'AWAIT_DRAW' } };
  emit(c, 'ALL', 'TURN_CHANGED', { ownerId: next, isFinalTurn: false });
}
function startFinalTurnFor(c: Ctx): void {
  const s = c.s;
  if (s.finalTurnQueue.length === 0) return endRound(c);
  const owner = s.finalTurnQueue[0]!;
  s.turn = { ownerId: owner, isFinalTurn: true, turnNumber: ++s.turnCounter, step: { kind: 'AWAIT_DRAW' } };
  emit(c, 'ALL', 'FINAL_TURN_STARTED', { ownerId: owner, remaining: [...s.finalTurnQueue] });
}
/** A turn's contest/give is done. Normal turns reach the CABO decision; final turns leave the queue. */
function turnComplete(c: Ctx): void {
  const s = c.s;
  const t = s.turn!;
  const owner = s.players.find((p) => p.id === t.ownerId)!;
  if (t.isFinalTurn) {
    if (!owner.hasLeft) {
      owner.hasTakenFinalTurn = true;
      if (s.finalTurnQueue[0] === owner.id) s.finalTurnQueue.shift();
    }
    return startFinalTurnFor(c);
  }
  if (owner.hasLeft) return nextNormalTurn(c, owner.id);
  t.step = { kind: 'AWAIT_CABO_DECISION' };
}
function endRound(c: Ctx): void {
  const s = c.s;
  const result = scoreRound(s);
  s.result = result; s.history.push(result);
  s.nextStarterId = result.winnerIds.length === 1 ? result.winnerIds[0]! : null; // tie: whoever presses Start
  s.phase = 'ROUND_COMPLETE'; s.turn = null;
  emit(c, 'ALL', 'ROUND_SCORED', { result });
}

/** Discard the drawn card face-up and open the toss window. */
function discardDrawn(c: Ctx, me: PlayerState, cardId: CardId): void {
  discardCard(c.s, cardId);
  emit(c, 'ALL', 'CARD_DISCARDED', { playerId: me.id, cardId, def: c.s.cards[cardId] });
  return openWindow(c, cardId);
}
/** Rule: once a card's power has been used, the card must be discarded (no replace, no keep). */
function discardAfterPower(c: Ctx, me: PlayerState, cardId: CardId): void { return discardDrawn(c, me, cardId); }

// ---------- contest ----------
function openWindow(c: Ctx, topCardId: CardId): void {
  const s = c.s;
  const windowId = ++s.windowCounter;
  const openedAt = c.env.now();
  s.turn!.step = { kind: 'CONTEST_WINDOW', window: { windowId, openedAt, expiresAt: openedAt + CONTEST_WINDOW_MS, topCardId } };
  emit(c, 'ALL', 'CONTEST_WINDOW_OPENED', { windowId, durationMs: CONTEST_WINDOW_MS });
}

function contest(c: Ctx, me: PlayerState, cardId: CardId): void {
  const { s, env } = c;
  const t = s.turn;
  if (!t || (s.phase !== 'PLAYING' && s.phase !== 'FINAL_TURNS') || t.step.kind !== 'CONTEST_WINDOW') return fail('WINDOW_CLOSED');
  const w = t.step.window;
  if (env.now() >= w.expiresAt) return fail('WINDOW_CLOSED');
  const target = resolveTarget(s, cardId); // illegal target => error, no penalty, no reveal
  const topDef = s.cards[s.discard[s.discard.length - 1]!]!;
  const def = s.cards[cardId]!;

  if (!ranksMatchForContest(def.rank, topDef.rank)) {
    // WRONG CONTEST: reveal to everyone, card stays, contester draws a private penalty card, window stays open
    s.publicKnowledge.add(cardId);
    emit(c, 'ALL', 'WRONG_CONTEST', { playerId: me.id, cardId, def });
    const pen = drawFromPile(c);
    if (pen !== null) {
      me.hand.push({ cardId: pen, slot: freeSlot(me) }); // arrives face-down: the penalty card is never seen
    }
    emit(c, 'ALL', 'PENALTY_DRAWN', { playerId: me.id, cardId: pen, drawn: pen !== null, drawPileCount: s.deck.length });
    return;
  }

  // CORRECT CONTEST: closes the window atomically (step changes in this same synchronous call)
  target.player.hand.splice(target.player.hand.indexOf(target.entry), 1);
  discardCard(s, cardId);
  const own = target.player.id === me.id;
  emit(c, 'ALL', 'CONTEST_RESOLVED', { playerId: me.id, targetPlayerId: target.player.id, cardId, def, own });
  if (own) return turnComplete(c);
  if (me.hand.length > 0) {
    t.step = { kind: 'AWAIT_GIVE_CARD', contesterId: me.id, targetId: target.player.id };
    return;
  }
  // zero-card contester: draw a card and hand it straight to the target
  const sub = drawFromPile(c);
  if (sub !== null) {
    target.player.hand.push({ cardId: sub, slot: freeSlot(target.player) });
    emit(c, 'ALL', 'CARD_GIVEN', { from: me.id, to: target.player.id, cardId: sub, substitute: true });
  }
  turnComplete(c);
}

// ---------- helpers ----------
function know(s: GameState, pid: PlayerId, id: CardId): void { (s.knowledge[pid] ??= new Set()).add(id); }
function discardCard(s: GameState, id: CardId): void { s.discard.push(id); s.publicKnowledge.add(id); }

const SLOTS = ['a11', 'a12', 'a21', 'a22'];
export const slotName = (i: number) => (i < 4 ? SLOTS[i]! : `x${i + 1}`);
function freeSlot(p: PlayerState): string {
  const used = new Set(p.hand.map((h) => h.slot));
  for (let i = 0; ; i++) if (!used.has(slotName(i))) return slotName(i);
}

function needTurn(c: Ctx, actor: PlayerId, kinds: TurnStep['kind'][]): TurnStep {
  const { s } = c;
  if ((s.phase !== 'PLAYING' && s.phase !== 'FINAL_TURNS') || !s.turn) return fail('WRONG_PHASE');
  if (s.turn.ownerId !== actor) return fail('NOT_YOUR_TURN');
  if (!kinds.includes(s.turn.step.kind)) return fail('WRONG_STEP');
  return s.turn.step;
}
function needDispose(c: Ctx, actor: PlayerId) {
  return needTurn(c, actor, ['AWAIT_POWER_DECISION', 'AWAIT_DISPOSE']) as Extract<TurnStep, { drawnCardId: CardId }>;
}
function needPower(c: Ctx, actor: PlayerId, power: PowerKind) {
  const st = needTurn(c, actor, ['AWAIT_POWER_DECISION']) as Extract<TurnStep, { kind: 'AWAIT_POWER_DECISION' }>;
  if (st.power !== power) fail('POWER_KIND_MISMATCH');
  return st;
}

function findCard(s: GameState, id: CardId): { player: PlayerState; entry: HandEntry } | null {
  for (const p of s.players) { const entry = p.hand.find((h) => h.cardId === id); if (entry) return { player: p, entry }; }
  return null;
}
/** Target guard: card must be in the hand of an unlocked player. One error for every non-hand id. */
function resolveTarget(s: GameState, id: CardId): { player: PlayerState; entry: HandEntry } {
  const f = typeof id === 'string' ? findCard(s, id) : null;
  if (!f) return fail('INVALID_TARGET');
  if (f.player.handLocked) return fail('TARGET_LOCKED');
  return f;
}
function ownEntry(s: GameState, me: PlayerState, id: CardId): HandEntry {
  const e = me.hand.find((h) => h.cardId === id);
  if (e) return e;
  return findCard(s, id) ? fail('OWN_CARD_REQUIRED') : fail('INVALID_TARGET');
}
function swapEntries(a: HandEntry, b: HandEntry): void { const t = a.cardId; a.cardId = b.cardId; b.cardId = t; }

export function powerFor(rank: string): PowerKind | null {
  if (rank === '7' || rank === '8') return 'LOOK_OWN';
  if (rank === '9' || rank === '10') return 'LOOK_OPPONENT';
  if (rank === 'J' || rank === 'Q') return 'BLIND_SWAP';
  if (rank === 'K_RED' || rank === 'K_BLACK') return 'KING';
  return null;
}
/** Computed once at draw time; hands cannot change before the owner acts. */
export function powerAvailable(s: GameState, owner: PlayerState, power: PowerKind): boolean {
  const eligible = s.players.filter((p) => !p.hasLeft && !p.handLocked);
  const total = eligible.reduce((n, p) => n + p.hand.length, 0);
  if (power === 'LOOK_OWN') return owner.hand.length >= 1;
  if (power === 'LOOK_OPPONENT') return eligible.some((p) => p.id !== owner.id && p.hand.length >= 1);
  return total >= 2;
}

/** Draw with authoritative reshuffle. Returns null only if no card exists anywhere to draw. */
function drawFromPile(c: Ctx): CardId | null {
  const s = c.s;
  if (s.deck.length === 0) reshuffle(c);
  return s.deck.shift() ?? null;
}
function reshuffle(c: Ctx): void {
  const { s, env } = c;
  if (s.discard.length <= 1) return;
  const top = s.discard[s.discard.length - 1]!;
  const rest = s.discard.slice(0, -1);
  const fresh: CardId[] = rest.map((old) => {
    const id = env.newId(); // re-mint ids so previously seen faces can't be recognised
    s.cards[id] = s.cards[old]!; delete s.cards[old];
    s.publicKnowledge.delete(old);
    for (const k of Object.values(s.knowledge)) k.delete(old);
    return id;
  });
  s.deck = shuffle(fresh, env);
  s.discard = [top];
  emit(c, 'ALL', 'DRAW_PILE_RESHUFFLED', { drawPileCount: s.deck.length });
}
