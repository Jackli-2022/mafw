import {
  createEmbeddingProviderRegistry,
  embeddingProviderIdFromConfig,
} from '../../src/memory/embedding-registry';

describe('embedding provider registry', () => {
  test('maps config to built-in provider id', () => {
    expect(embeddingProviderIdFromConfig({ provider: 'off' })).toBeNull();
    expect(embeddingProviderIdFromConfig({ provider: 'local', engine: 'onnx' })).toBe('local-onnx');
    expect(embeddingProviderIdFromConfig({ provider: 'local', engine: 'llamacpp' })).toBe('local-llamacpp');
    expect(embeddingProviderIdFromConfig({ provider: 'dashscope' })).toBe('dashscope');
  });

  test('creates a registered provider and lists built-ins', () => {
    const registry = createEmbeddingProviderRegistry();
    expect(registry.list()).toEqual(expect.arrayContaining(['dashscope', 'local-onnx', 'local-llamacpp']));
    const provider = {
      name: 'fake',
      dims: 2,
      embed: async () => [[1, 0]],
    };
    registry.register({ id: 'fake', create: () => provider });
    expect(registry.create('fake', { provider: 'local' } as any)).toBe(provider);
  });

  test('unknown / throwing factories return null', () => {
    const registry = createEmbeddingProviderRegistry();
    expect(registry.create('missing', { provider: 'local' } as any)).toBeNull();
    registry.register({
      id: 'boom',
      create: () => {
        throw new Error('boom');
      },
    });
    expect(registry.create('boom', { provider: 'local' } as any)).toBeNull();
  });

  test('dispose calls provider.dispose in reverse creation order', async () => {
    const order: string[] = [];
    const registry = createEmbeddingProviderRegistry();
    registry.register({
      id: 'a',
      create: () => ({
        name: 'a',
        dims: 1,
        embed: async () => [[1]],
        dispose: () => {
          order.push('a');
        },
      }),
    });
    registry.register({
      id: 'b',
      create: () => ({
        name: 'b',
        dims: 1,
        embed: async () => [[1]],
        dispose: () => {
          order.push('b');
        },
      }),
    });
    registry.create('a', { provider: 'local' } as any);
    registry.create('b', { provider: 'local' } as any);
    await registry.dispose();
    expect(order).toEqual(['b', 'a']);
  });
});
