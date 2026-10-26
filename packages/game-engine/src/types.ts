// Core types for the Cabo engine. Pure data: no I/O, no framework imports.
export type CardId = string;
export type PlayerId = string;
export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K_RED' | 'K_BLACK';
export type Suit = 'S' | 'H' | 'D' | 'C'; // cosmetic only; no rule reads it

export interface CardDef { rank: Rank; suit: Suit; value: number }
export type SlotId = string; // presentation only: a11 a12 a21 a22 then x5, x6...
export interface HandEntry { cardId: CardId; slot: SlotId }

export interface PlayerState {
  id: PlayerId;
  displayName: string;
  seat: number;
  connected: boolean;
  hasLeft: boolean;
  hand: HandEntry[]; // 0..N cards, no min, no max
  handLocked: boolean;
  hasTakenFinalTurn: boolean;
  peekAcked: boolean;
}

export type PowerKind = 'LOOK_OWN' | 'LOOK_OPPONENT' | 'BLIND_SWAP' | 'KING';

export interface ContestWindow { windowId: number; openedAt: number; expiresAt: number; topCardId: CardId }

export type TurnStep =
  | { kind: 'AWAIT_DRAW' }
  | { kind: 'AWAIT_POWER_DECISION'; drawnCardId: CardId; power: PowerKind }
  | { kind: 'AWAIT_KING_DECISION'; drawnCardId: CardId; a: CardId; b: CardId }
  | { kind: 'AWAIT_DISPOSE'; drawnCardId: CardId }
  | { kind: 'CONTEST_WINDOW'; window: ContestWindow }
  | { kind: 'AWAIT_GIVE_CARD'; contesterId: PlayerId; targetId: PlayerId }
  | { kind: 'AWAIT_CABO_DECISION' };

export interface Turn { ownerId: PlayerId; isFinalTurn: boolean; turnNumber: number; step: TurnStep }

export type RoundPhase =
  | 'LOBBY' | 'DEALING' | 'PLAYING' | 'FINAL_TURNS' | 'ROUND_COMPLETE' | 'ABANDONED';

export interface CaboState { called: boolean; callerId: PlayerId | null; callerLeft: boolean }

export interface RoundResult {
  roundNumber: number;
  scores: Record<PlayerId, number>; // negative and zero are valid
  caboCallerId: PlayerId | null;
  caboSucceeded: boolean;
  failureReason: 'TIED' | 'BEATEN' | 'CALLER_LEFT' | null;
  blockers: PlayerId[]; // non-callers tied with or below the caller
  winnerIds: PlayerId[];
  tie: boolean; // more than one winner
  revealedHands: Record<PlayerId, CardDef[]>;
}

export interface GameState {
  id: string;
  code: string;
  players: PlayerState[];
  phase: RoundPhase;
  turn: Turn | null;
  finalTurnQueue: PlayerId[]; // head is the player currently on a final turn
  cards: Record<CardId, CardDef>; // server-only registry; never sent to clients
  deck: CardId[]; // index 0 = top of draw pile
  discard: CardId[]; // last = top
  outOfPlay: CardId[]; // cards of players who left
  cabo: CaboState;
  roundNumber: number;
  starterId: PlayerId | null;
  nextStarterId: PlayerId | null;
  windowCounter: number;
  turnCounter: number;
  history: RoundResult[]; // standalone rounds, never fed back into rules
  knowledge: Record<PlayerId, Set<CardId>>;
  publicKnowledge: Set<CardId>;
  result: RoundResult | null;
}

export interface Env { rng(): number; newId(): string; now(): number }

export type Action =
  | { type: 'JOIN_GAME'; displayName: string }
  | { type: 'LEAVE_GAME' }
  | { type: 'START_GAME' }
  | { type: 'ACK_INITIAL_PEEK' }
  | { type: 'START_NEXT_ROUND' }
  | { type: 'DRAW_CARD' }
  | { type: 'LOOK_AT_OWN_CARD'; cardId: CardId }
  | { type: 'LOOK_AT_OPPONENT_CARD'; cardId: CardId }
  | { type: 'BLIND_SWAP'; cardIdA: CardId; cardIdB: CardId }
  | { type: 'KING_INSPECT'; cardIdA: CardId; cardIdB: CardId }
  | { type: 'KING_SWAP_DECISION'; swap: boolean }
  | { type: 'SKIP_POWER' }
  | { type: 'DISCARD_CARD' }
  | { type: 'REPLACE_CARD'; cardId: CardId }
  | { type: 'ADD_TO_HAND' }
  | { type: 'CONTEST_CARD'; cardId: CardId }
  | { type: 'GIVE_CARD'; cardId: CardId }
  | { type: 'CALL_CABO' }
  | { type: 'END_TURN' }
  | { type: 'EXPIRE_WINDOW'; windowId: number } // server only
  | { type: 'PEEK_TIMEOUT' }; // server only

export type ErrorCode =
  | 'UNAUTHENTICATED' | 'NOT_SERVER' | 'GAME_ABANDONED'
  | 'GAME_STARTED' | 'GAME_FULL' | 'NAME_TAKEN' | 'INVALID_NAME' | 'NOT_ENOUGH_PLAYERS'
  | 'WRONG_PHASE' | 'WRONG_STEP' | 'NOT_YOUR_TURN' | 'NOT_YOUR_ACTION'
  | 'INVALID_TARGET' | 'TARGET_LOCKED' | 'ACTOR_LOCKED'
  | 'TARGETS_NOT_DISTINCT' | 'OWN_CARD_REQUIRED' | 'OPPONENT_CARD_REQUIRED'
  | 'HAND_EMPTY' | 'HAND_NOT_EMPTY' | 'POWER_KIND_MISMATCH'
  | 'WINDOW_CLOSED' | 'CABO_NOT_AVAILABLE';

export interface GameEvent { to: 'ALL' | PlayerId; type: string; data: Record<string, unknown> }
export type Result =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; code: ErrorCode };
