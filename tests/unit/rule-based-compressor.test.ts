import { RuleBasedCompressor } from '../../src/compression/rule-based-compressor';

describe('RuleBasedCompressor', () => {
  it('returns fallback for empty observations', async () => {
    const c = new RuleBasedCompressor();
    const result = await c.compress([]);
    expect(result.type).toBe('fallback');
    expect(result.facts).toHaveLength(0);
  });

  it('returns fallback when all observations have low energy', async () => {
    const c = new RuleBasedCompressor();
    const obs = [
      { id: '1', content: 'test', energy: 0.3 },
      { id: '2', content: 'test2', energy: 0.2 }
    ];
    const result = await c.compress(obs);
    expect(result.type).toBe('fallback');
  });

  it('processes high-energy observations through rule-based path', async () => {
    const c = new RuleBasedCompressor();
    const obs = [
      { id: '1', content: 'Error: JWT token expired in auth middleware', energy: 0.7 },
      { id: '2', content: 'Modified src/auth.ts: fixed token validation', energy: 0.8 }
    ];
    const result = await c.compress(obs);
    expect(result.type).toBe('rule_compressed');
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.concepts).toContain('authentication');
  });

  it('extracts concepts from content patterns', async () => {
    const c = new RuleBasedCompressor();
    const obs = [
      { id: '1', content: 'Test coverage dropped to 45%, need more jest tests', energy: 0.9 }
    ];
    const result = await c.compress(obs);
    expect(result.concepts).toContain('testing');
  });
});
