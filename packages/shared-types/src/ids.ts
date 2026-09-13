// Branded string ids — kept as plain strings at runtime, distinguished at the
// type level so a GameId can never be passed where a PlayerId is expected.
export type PlayerId = string & { readonly __brand: 'PlayerId' };
export type GameId = string & { readonly __brand: 'GameId' };
export type CardInstanceId = string & { readonly __brand: 'CardInstanceId' };

export function asPlayerId(id: string): PlayerId {
  return id as PlayerId;
}

export function asGameId(id: string): GameId {
  return id as GameId;
}

export function asCardInstanceId(id: string): CardInstanceId {
  return id as CardInstanceId;
}
