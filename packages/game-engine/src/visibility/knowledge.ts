import type { CardInstanceId, PlayerId } from '@cabo/shared-types';

export type KnowledgeMap = Record<PlayerId, Set<CardInstanceId>>;

// §J: knowledge attaches to the stable CardInstanceId, never to a hand
// position — immutable update, never mutates an existing player's Set.
export function grantKnowledge(
  knowledge: KnowledgeMap,
  playerId: PlayerId,
  cardInstanceId: CardInstanceId,
): KnowledgeMap {
  const existing = knowledge[playerId];
  if (existing?.has(cardInstanceId)) return knowledge;

  const updated = new Set(existing);
  updated.add(cardInstanceId);
  return { ...knowledge, [playerId]: updated };
}

export function knows(knowledge: KnowledgeMap, playerId: PlayerId, cardInstanceId: CardInstanceId): boolean {
  return knowledge[playerId]?.has(cardInstanceId) ?? false;
}
