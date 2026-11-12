import {
  createToolContributionRegistry,
  type ToolContribution,
} from '../../../src/kernel-v2/tools';

function tool(over: Partial<ToolContribution> = {}): ToolContribution {
  return {
    packageName: 'demo',
    name: 'echo',
    description: 'Echo',
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    execute: async (input: any) => ({ text: String(input?.text ?? '') }),
    ...over,
  };
}

describe('ToolContributionRegistry', () => {
  test('namespaces tools and exposes a runtime factory', () => {
    const registry = createToolContributionRegistry();
    registry.register(tool());
    const registrations = registry.factory()('s1');
    expect(registrations.map((r) => r.name)).toEqual(['plugin:demo:echo']);
    expect(registrations[0].parameters).toEqual(tool().parameters);
  });

  test('session-scoped tools are only visible in their session', () => {
    const registry = createToolContributionRegistry();
    registry.register(tool({ name: 'global' }));
    registry.register(tool({ name: 'local', scope: 'session', sessionID: 's1' }));
    expect(registry.list('s1').map((t) => t.name)).toEqual(['global', 'local']);
    expect(registry.list('s2').map((t) => t.name)).toEqual(['global']);
  });

  test('re-registration replaces the handler and the old unregister is safe', async () => {
    const registry = createToolContributionRegistry();
    const unregisterOld = registry.register(
      tool({ execute: async () => ({ text: 'old' }) }),
    );
    registry.register(tool({ execute: async () => ({ text: 'new' }) }));
    unregisterOld();
    await expect(
      registry.invoke('plugin:demo:echo', {}, { sessionID: 's1' }),
    ).resolves.toEqual({ text: 'new' });
  });

  test('handler errors and timeouts become tool errors', async () => {
    const registry = createToolContributionRegistry({ defaultTimeoutMs: 10 });
    registry.register(
      tool({
        name: 'boom',
        execute: async () => {
          throw new Error('boom');
        },
      }),
    );
    registry.register(tool({ name: 'slow', execute: () => new Promise(() => {}) }));
    await expect(
      registry.invoke('plugin:demo:boom', {}, { sessionID: 's1' }),
    ).resolves.toMatchObject({ isError: true, text: expect.stringContaining('boom') });
    await expect(
      registry.invoke('plugin:demo:slow', {}, { sessionID: 's1' }),
    ).resolves.toMatchObject({ isError: true, text: expect.stringContaining('timed out') });
  });

  test('unknown and unhealthy tools fail closed without throwing', async () => {
    const registry = createToolContributionRegistry();
    registry.register(tool({ name: 'sick', health: () => 'failed' }));
    await expect(
      registry.invoke('plugin:demo:missing', {}, { sessionID: 's1' }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      registry.invoke('plugin:demo:sick', {}, { sessionID: 's1' }),
    ).resolves.toMatchObject({ isError: true });
  });

  test('rejects bad names and session scope without sessionID', () => {
    const registry = createToolContributionRegistry();
    expect(() => registry.register(tool({ name: 'a:b' }))).toThrow(/name/);
    expect(() => registry.register(tool({ scope: 'session' }))).toThrow(/sessionID/);
  });

  test('dispose calls contribution dispose in reverse order and is idempotent', async () => {
    const order: string[] = [];
    const registry = createToolContributionRegistry();
    registry.register(tool({ name: 'a', dispose: async () => { order.push('a'); } }));
    registry.register(tool({ name: 'b', dispose: async () => { order.push('b'); } }));
    await registry.dispose();
    await registry.dispose();
    expect(order).toEqual(['b', 'a']);
    await expect(
      registry.invoke('plugin:demo:a', {}, { sessionID: 's1' }),
    ).resolves.toMatchObject({ isError: true });
  });
});
