// §D — Red King and Black King are distinct ranks (different scoring value,
// -1 vs 13) despite counting as the same rank for contest-matching (§H).
export type Rank =
  | 'A'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K_RED'
  | 'K_BLACK';

export interface CardDefinition {
  rank: Rank;
  value: number;
}
