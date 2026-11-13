import { createRerankerProviderRegistry } from '../../src/memory/reranker-registry';

describe('reranker provider registry', () => {
  test('lists built-ins and resolves a known id', () => {
    const registry = createRerankerProviderRegistry();
    expect(registry.list()).toEqual(['heuristic', 'cross-encoder', 'llamacpp']);
    expect(registry.create('heuristic')?.strategy).toBe('heuristic');
    expect(registry.create('missing')).toBeNull();
  });

  test('disposes created providers in reverse order', () => {
    const order: string[] = [];
    const registry = createRerankerProviderRegistry();
    registry.register({
      id: 'a' as any,
      create: () => ({
        name: 'a',
        strategy: 'a',
        rerank: () => [],
        dispose: () => {
          order.push('a');
        },
      }),
    });
    registry.register({
      id: 'b' as any,
      create: () => ({
        name: 'b',
        strategy: 'b',
        rerank: () => [],
        dispose: () => {
          order.push('b');
        },
      }),
    });
    registry.create('a');
    registry.create('b');
    registry.dispose();
    expect(order).toEqual(['b', 'a']);
  });

  test('retainCreated:false lets the owner drop instances', () => {
    const order: string[] = [];
    const registry = createRerankerProviderRegistry({ retainCreated: false });
    registry.register({
      id: 'live' as any,
      create: () => ({
        name: 'live',
        strategy: 'live',
        rerank: () => [],
        dispose: () => {
          order.push('live');
        },
      }),
    });
    registry.create('live');
    registry.dispose();
    expect(order).toEqual([]);
  });

  test('unknown / throwing factories return null', () => {
    const registry = createRerankerProviderRegistry();
    registry.register({
      id: 'boom' as any,
      create: () => {
        throw new Error('boom');
      },
    });
    expect(registry.create('boom')).toBeNull();
  });
});
