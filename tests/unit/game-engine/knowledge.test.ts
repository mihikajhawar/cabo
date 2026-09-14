import { describe, expect, it } from 'vitest';
import { grantKnowledge, knows } from '@cabo/game-engine';
import { asCardInstanceId, asPlayerId } from '@cabo/shared-types';

describe('grantKnowledge / knows', () => {
  it('starts unknown for a player with no entry at all', () => {
    expect(knows({}, asPlayerId('alice'), asCardInstanceId('c1'))).toBe(false);
  });

  it('grants knowledge of a specific card instance to a specific player', () => {
    const alice = asPlayerId('alice');
    const c1 = asCardInstanceId('c1');
    const knowledge = grantKnowledge({}, alice, c1);

    expect(knows(knowledge, alice, c1)).toBe(true);
  });

  it('does not grant knowledge to other players or other cards', () => {
    const alice = asPlayerId('alice');
    const bob = asPlayerId('bob');
    const c1 = asCardInstanceId('c1');
    const c2 = asCardInstanceId('c2');
    const knowledge = grantKnowledge({}, alice, c1);

    expect(knows(knowledge, bob, c1)).toBe(false);
    expect(knows(knowledge, alice, c2)).toBe(false);
  });

  it('does not mutate the input knowledge map or its Sets', () => {
    const alice = asPlayerId('alice');
    const c1 = asCardInstanceId('c1');
    const c2 = asCardInstanceId('c2');
    const before = grantKnowledge({}, alice, c1);
    const beforeSet = before[alice]!;

    const after = grantKnowledge(before, alice, c2);

    expect(beforeSet.has(c2)).toBe(false); // the original Set object is untouched
    expect(before[alice]!.has(c2)).toBe(false);
    expect(after[alice]!.has(c1)).toBe(true);
    expect(after[alice]!.has(c2)).toBe(true);
  });

  it('accumulates multiple grants for the same player', () => {
    const alice = asPlayerId('alice');
    const c1 = asCardInstanceId('c1');
    const c2 = asCardInstanceId('c2');
    let knowledge = grantKnowledge({}, alice, c1);
    knowledge = grantKnowledge(knowledge, alice, c2);

    expect(knows(knowledge, alice, c1)).toBe(true);
    expect(knows(knowledge, alice, c2)).toBe(true);
  });

  it('keeps knowledge independent across players', () => {
    const alice = asPlayerId('alice');
    const bob = asPlayerId('bob');
    const c1 = asCardInstanceId('c1');
    let knowledge = grantKnowledge({}, alice, c1);
    knowledge = grantKnowledge(knowledge, bob, c1);

    expect(knows(knowledge, alice, c1)).toBe(true);
    expect(knows(knowledge, bob, c1)).toBe(true);
  });

  it('is a no-op (same reference) when granting an already-known card', () => {
    const alice = asPlayerId('alice');
    const c1 = asCardInstanceId('c1');
    const knowledge = grantKnowledge({}, alice, c1);
    const again = grantKnowledge(knowledge, alice, c1);

    expect(again).toBe(knowledge);
  });
});
