import { CanonicalObserverRegistry } from '../../src/kernel-v2/observer';
import { toCanonicalEvent } from '../../src/kernel-v2/canonical-event';
import { createToolContributionRegistry } from '../../src/kernel-v2/tools';
import type { MafwToolRegistration } from '../../src/runtime/contract';
import { createPluginToolEcho } from '../fixtures/kernel-v2/plugin-tool-echo';

class FakeRuntime {
  registrations: MafwToolRegistration[] = [];
  tools = {
    registerTools: async (factory: (sessionID: string) => MafwToolRegistration[]) => {
      this.registrations = factory('s1');
    },
    nativeTools: () => [],
  };
}

test('G3: plugin tool is callable through RuntimeTools.registerTools', async () => {
  const tools = createToolContributionRegistry();
  tools.register(createPluginToolEcho());

  const runtime = new FakeRuntime();
  await runtime.tools.registerTools(tools.factory());
  const echo = runtime.registrations.find((item) => item.name === 'plugin:demo:echo');
  expect(echo).toBeDefined();
  await expect(echo!.execute({ text: 'hi' })).resolves.toEqual({ text: 'echo:hi' });
});

test('G3: observer receives tool events and a bad observer cannot block the call', async () => {
  const observers = new CanonicalObserverRegistry({ defaultTimeoutMs: 20 });
  const seen: string[] = [];
  observers.register({
    id: 'bad',
    filter: { types: ['tool.*'] },
    onEvent: () => {
      throw new Error('boom');
    },
  });
  observers.register({
    id: 'good',
    filter: { types: ['tool.*'] },
    onEvent: (event) => {
      seen.push(event.type);
    },
  });

  const start = Date.now();
  for (let i = 0; i < 100; i += 1) {
    observers.dispatch(
      toCanonicalEvent({
        type: 'tool.updated',
        sessionID: 's1',
        properties: { tool: 'plugin:demo:echo' },
      }),
    );
  }
  expect(Date.now() - start).toBeLessThan(100);
  await observers.drain();
  expect(seen).toHaveLength(100);
  expect(observers.diagnostics().find((item) => item.observerId === 'bad')?.failed).toBe(100);
});

test('G3: observer snapshots never carry prompt or credentials', async () => {
  const observers = new CanonicalObserverRegistry();
  const seen: unknown[] = [];
  observers.register({
    id: 'audit',
    filter: { sessionID: 's1' },
    onEvent: (event) => {
      seen.push(event);
    },
  });
  observers.dispatch(
    toCanonicalEvent(
      {
        type: 'tool.updated',
        sessionID: 's1',
        properties: {
          tool: 'plugin:demo:echo',
          prompt: 'secret prompt',
          apiToken: 'sk-live',
          nested: { token: 'nested', ok: 'visible' },
        },
      },
      7,
    ),
  );
  await observers.drain();
  expect(seen).toEqual([
    {
      type: 'tool.updated',
      sessionID: 's1',
      at: 7,
      properties: { tool: 'plugin:demo:echo', nested: { ok: 'visible' } },
    },
  ]);
});
