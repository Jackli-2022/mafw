/**
 * Tool contribution conformance kit.
 *
 * The factory returns a fresh registry. The kit asserts namespacing, session
 * visibility, replacement, failure isolation and dispose.
 */

import type {
  ToolContribution,
  ToolContributionRegistry,
} from '../../../src/kernel-v2/tools';

export interface ToolsConformanceFactory {
  create(): ToolContributionRegistry;
}

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

export function runToolsConformance(
  name: string,
  factory: ToolsConformanceFactory,
): void {
  describe(`${name} conformance`, () => {
    test('namespaces tools and exposes a runtime factory', () => {
      const registry = factory.create();
      registry.register(tool());
      const registrations = registry.factory()('s1');
      expect(registrations.map((item) => item.name)).toEqual(['plugin:demo:echo']);
    });

    test('session-scoped tools are only visible in their session', () => {
      const registry = factory.create();
      registry.register(tool({ name: 'global' }));
      registry.register(tool({ name: 'local', scope: 'session', sessionID: 's1' }));
      expect(registry.list('s1').map((item) => item.name)).toEqual(['global', 'local']);
      expect(registry.list('s2').map((item) => item.name)).toEqual(['global']);
    });

    test('re-registration replaces the handler and old unregister is safe', async () => {
      const registry = factory.create();
      const unregisterOld = registry.register(
        tool({ execute: async () => ({ text: 'old' }) }),
      );
      registry.register(tool({ execute: async () => ({ text: 'new' }) }));
      unregisterOld();
      await expect(
        registry.invoke('plugin:demo:echo', {}, { sessionID: 's1' }),
      ).resolves.toEqual({ text: 'new' });
    });

    test('handler error and timeout become tool errors', async () => {
      const registry = factory.create();
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
      ).resolves.toMatchObject({ isError: true });
      await expect(
        registry.invoke('plugin:demo:slow', {}, { sessionID: 's1' }),
      ).resolves.toMatchObject({ isError: true, text: expect.stringContaining('timed out') });
    });

    test('unknown and unhealthy tools fail closed', async () => {
      const registry = factory.create();
      registry.register(tool({ name: 'sick', health: () => 'failed' }));
      await expect(
        registry.invoke('plugin:demo:missing', {}, { sessionID: 's1' }),
      ).resolves.toMatchObject({ isError: true });
      await expect(
        registry.invoke('plugin:demo:sick', {}, { sessionID: 's1' }),
      ).resolves.toMatchObject({ isError: true });
    });

    test('dispose is reverse-order and idempotent', async () => {
      const order: string[] = [];
      const registry = factory.create();
      registry.register(tool({ name: 'a', dispose: async () => { order.push('a'); } }));
      registry.register(tool({ name: 'b', dispose: async () => { order.push('b'); } }));
      await registry.dispose();
      await registry.dispose();
      expect(order).toEqual(['b', 'a']);
    });
  });
}
