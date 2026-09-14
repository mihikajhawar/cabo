// §E — canonical definition now lives in @cabo/shared-types (PlayerView.phase
// needs it on the wire, without apps/web depending on this engine package).
// Re-exported here so nothing in game-engine that already imports from
// '../state-machine/phases.js' has to change.
export type { GamePhase } from '@cabo/shared-types';
