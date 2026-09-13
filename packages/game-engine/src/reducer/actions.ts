import type { PlayerId } from '@cabo/shared-types';

// Engine-internal action shapes — always carry playerId, since the pure
// engine has no socket session to derive identity from (§L step 1 is the
// realtime layer's job: strip any client-supplied id and attach the real,
// authenticated one before calling into the engine).
//
// This is not the wire-level action list from §K (still "to be finalized as
// part of Milestone 5" per the architecture) — just the subset milestone 2's
// basic draw/discard/replace/turn-advance cycle needs. Later milestones
// extend this union additively (CALL_CABO, USE_POWER variants, CONTEST_CARD,
// GIVE_CARD, ...).
export type EngineAction =
  | { type: 'JOIN_GAME'; playerId: PlayerId; displayName: string }
  | { type: 'START_GAME'; playerId: PlayerId }
  | { type: 'ACK_INITIAL_PEEK'; playerId: PlayerId }
  | { type: 'DRAW_CARD'; playerId: PlayerId }
  | { type: 'DISCARD_CARD'; playerId: PlayerId }
  | { type: 'REPLACE_CARD'; playerId: PlayerId; position: number }
  | { type: 'END_TURN'; playerId: PlayerId };
