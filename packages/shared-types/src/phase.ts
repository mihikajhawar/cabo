// §E — canonical home for GamePhase: PlayerView.phase (below) needs this type
// on the wire, and apps/web must be able to import it without depending on
// @cabo/game-engine, which is server/engine-only.
export type GamePhase =
  | 'LOBBY'
  | 'STARTING'
  | 'DEALING'
  | 'PLAYING'
  | 'POWER_RESOLUTION'
  | 'CONTEST_WINDOW'
  | 'CABO_LOCK'
  | 'FINAL_TURNS'
  | 'REVEAL'
  | 'SCORING'
  | 'ROUND_COMPLETE';
