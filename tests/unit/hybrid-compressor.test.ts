import { HybridCompressor } from '../../src/compression/hybrid-compressor';

describe('HybridCompressor', () => {
  it('returns fallback for empty observations', async () => {
    const c = new HybridCompressor('http://localhost:19999');
    const result = await c.compress([]);
    expect(result.type).toBe('fallback');
    expect(result.facts).toHaveLength(0);
  });

  it('returns fallback when all observations have low energy', async () => {
    const c = new HybridCompressor('http://localhost:19999');
    const obs = [
      { id: '1', content: 'test', energy: 0.3 },
      { id: '2', content: 'test2', energy: 0.2 }
    ];
    const result = await c.compress(obs);
    expect(result.type).toBe('fallback');
  });

  it('falls back to rules when Gateway is unreachable', async () => {
    const c = new HybridCompressor('http://localhost:19999');
    const obs = [
      { id: '1', content: 'Error: JWT token expired in auth middleware', energy: 0.7 },
      { id: '2', content: 'Modified src/auth.ts: fixed token validation', energy: 0.8 }
    ];
    const result = await c.compress(obs);
    expect(result.type).toBe('fallback');
    expect(result.concepts).toContain('authentication');
  });
});
