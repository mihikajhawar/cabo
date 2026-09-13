import { describe, expect, it } from 'vitest';

describe('workspace setup', () => {
  it('can import @cabo/game-engine', async () => {
    const engine = await import('@cabo/game-engine');
    expect(engine).toBeDefined();
  });
});
