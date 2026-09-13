import type { PlayerId } from '@cabo/shared-types';

export interface CaboState {
  called: boolean;
  callerId: PlayerId | null;
  calledAfterTurnNumber: number | null;
}
