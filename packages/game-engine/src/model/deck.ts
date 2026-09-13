import type { CardInstance } from './card.js';

export interface Deck {
  cards: CardInstance[]; // index 0 = current draw-pile top
}
