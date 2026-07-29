import { withMemoryInjection, createMemorySearch, MemoryFact } from '../../../gateway/src/interceptors/memory-injector';

describe('withMemoryInjection', () => {
  let capturedMessage: string;

  const mockFn = async (sessionID: string, message: string) => {
    capturedMessage = message;
    return { ok: true };
  };

  beforeEach(() => {
    capturedMessage = '';
  });

  it('injects facts when results exist', async () => {
    const injector = withMemoryInjection(mockFn, {
      search: async () => [
        { source: 'harmonic', type: 'semantic', content: 'JWT must use RS256', energy: 0.9 },
        { source: 'harmonic', type: 'episodic', content: 'Previous review failed on RS256', energy: 0.7 },
      ],
      enabled: true,
      maxFacts: 5,
      maxTokens: 500,
    });

    await injector('sess-1', 'implement JWT auth');
    expect(capturedMessage).toContain('<mafw-facts>');
    expect(capturedMessage).toContain('JWT must use RS256');
    expect(capturedMessage).toContain('Previous review failed on RS256');
    expect(capturedMessage).toContain('</mafw-facts>');
    expect(capturedMessage).toContain('implement JWT auth');
  });

  it('injects deltas and facts separately', async () => {
    const injector = withMemoryInjection(mockFn, {
      search: async () => [
        { source: 'parametric', type: 'delta', content: 'loop-2: must pass tests', energy: 0.8 },
        { source: 'harmonic', type: 'semantic', content: 'Test coverage target: 80%', energy: 0.6 },
      ],
      enabled: true,
      maxFacts: 5,
      maxTokens: 500,
    });

    await injector('sess-1', 'run tests');
    expect(capturedMessage).toContain('<mafw-deltas>');
    expect(capturedMessage).toContain('[Δ delta] loop-2: must pass tests');
    expect(capturedMessage).toContain('<mafw-facts>');
    expect(capturedMessage).toContain('Test coverage target: 80%');
  });

  it('passes through when no results', async () => {
    const injector = withMemoryInjection(mockFn, {
      search: async () => [],
      enabled: true,
    });

    await injector('sess-1', 'hello');
    expect(capturedMessage).toBe('hello');
    expect(capturedMessage).not.toContain('<mafw-facts>');
  });

  it('respects maxTokens truncation', async () => {
    const injector = withMemoryInjection(mockFn, {
      search: async () => [
        { source: 'harmonic', type: 'semantic', content: 'A'.repeat(200), energy: 0.9 },
        { source: 'harmonic', type: 'semantic', content: 'B'.repeat(200), energy: 0.8 },
        { source: 'harmonic', type: 'semantic', content: 'C'.repeat(200), energy: 0.7 },
      ],
      enabled: true,
      maxFacts: 5,
      maxTokens: 250,
    });

    await injector('sess-1', 'hi');
    // After the <mafw-facts> wrapper, only about 2 facts should fit
    const factLines = capturedMessage.split('\n').filter(l => l.startsWith('•'));
    expect(factLines.length).toBeGreaterThanOrEqual(1);
    expect(factLines.length).toBeLessThanOrEqual(3);
  });

  it('disabled injector passes through unchanged', async () => {
    const injector = withMemoryInjection(mockFn, {
      search: async () => [
        { source: 'harmonic', type: 'semantic', content: 'test', energy: 1.0 },
      ],
      enabled: false,
    });

    await injector('sess-1', 'plain message');
    expect(capturedMessage).toBe('plain message');
  });

  it('no injector options defaults to enabled=false', async () => {
    const injector = withMemoryInjection(mockFn, {
      search: async () => [{ source: 'harmonic', type: 'semantic', content: 'x', energy: 0.5 }],
    });

    await injector('sess-1', 'hello');
    expect(capturedMessage).toBe('hello');
  });
});

describe('createMemorySearch', () => {
  it('returns results sorted by energy descending', async () => {
    const mockParametric = {
      match: () => [{ type: 'delta', content: 'test delta', energy: 0.8 }],
    };
    const mockDeltaInjector = {
      inject: (d: any) => d,
      render: (d: any) => d[0].content,
    };
    const mockHarmonic = {
      search: () => [
        { type: 'semantic', primary_abstraction: 'low energy fact', energy: 0.3 },
        { type: 'episodic', primary_abstraction: 'high energy fact', energy: 0.9 },
      ],
    };

    const search = createMemorySearch(mockParametric as any, mockDeltaInjector as any, mockHarmonic as any);
    const results = await search('test', 10);

    expect(results.length).toBeGreaterThanOrEqual(2);
    // Verify sorted: first should be highest energy
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].energy).toBeGreaterThanOrEqual(results[i].energy);
    }
  });

  it('handles null stores gracefully', async () => {
    const mockHarmonic = {
      search: () => [
        { type: 'semantic', primary_abstraction: 'only harmonic', energy: 0.5 },
      ],
    };
    const search = createMemorySearch(undefined, undefined, mockHarmonic as any);
    const results = await search('test', 10);
    expect(results.length).toBe(1);
    expect(results[0].source).toBe('harmonic');
  });

  it('respects maxFacts limit', async () => {
    const mockHarmonic = {
      search: () => [
        { type: 'a', primary_abstraction: '1', energy: 0.9 },
        { type: 'b', primary_abstraction: '2', energy: 0.8 },
        { type: 'c', primary_abstraction: '3', energy: 0.7 },
        { type: 'd', primary_abstraction: '4', energy: 0.6 },
        { type: 'e', primary_abstraction: '5', energy: 0.5 },
      ],
    };
    const search = createMemorySearch(undefined, undefined, mockHarmonic as any);
    const results = await search('test', 3);
    expect(results.length).toBe(3);
  });
});
