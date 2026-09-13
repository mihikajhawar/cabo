// §E — full phase enum declared up front even though this milestone's reducer
// only drives LOBBY → STARTING → DEALING → PLAYING; later milestones add
// handling for the remaining phases without changing this type.
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
