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
