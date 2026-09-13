import type { CardDefinition, CardInstanceId } from '@cabo/shared-types';

export interface CardInstance {
  id: CardInstanceId;
  def: CardDefinition;
}
