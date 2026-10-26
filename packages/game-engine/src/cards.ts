import type { CardDef, Env, Rank, Suit } from './types';

export const RANK_VALUE: Record<Rank, number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K_RED: -1, K_BLACK: 13,
};

/** 52 cards: A..Q x4 suits (48) + 2 red Kings + 2 black Kings. No jokers. */
export function createDeckDefs(): CardDef[] {
  const out: CardDef[] = [];
  const plain: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'];
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  for (const rank of plain) for (const suit of suits) out.push({ rank, suit, value: RANK_VALUE[rank] });
  out.push({ rank: 'K_RED', suit: 'H', value: -1 }, { rank: 'K_RED', suit: 'D', value: -1 });
  out.push({ rank: 'K_BLACK', suit: 'S', value: 13 }, { rank: 'K_BLACK', suit: 'C', value: 13 });
  return out;
}

/** Contest rank rule: equal rank, except Red King and Black King match each other. */
export function ranksMatchForContest(a: Rank, b: Rank): boolean {
  const isK = (r: Rank) => r === 'K_RED' || r === 'K_BLACK';
  return isK(a) && isK(b) ? true : a === b;
}

export function shuffle<T>(arr: T[], env: Env): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(env.rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export function defaultEnv(): Env {
  return {
    rng: () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32,
    newId: () => crypto.randomUUID(),
    now: () => performance.now(),
  };
}

/** Deterministic env for tests: seeded rng, sequential ids, controllable clock. */
export function testEnv(seed = 1): Env & { t: number } {
  let x = seed >>> 0;
  let n = 0;
  const env = {
    t: 0,
    rng: () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; },
    newId: () => `c${++n}`,
    now: () => env.t,
  };
  return env;
}
