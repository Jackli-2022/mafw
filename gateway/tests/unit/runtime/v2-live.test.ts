import { createKernelV2Live, readKernelV2LiveFlags } from '../../../src/runtime/v2-live';
import type { ToolContribution } from '../../../src/kernel-v2/tools';

function tool(over: Partial<ToolContribution> = {}): ToolContribution {
  return {
    packageName: 'demo',
    name: 'echo',
    description: 'Echo',
    parameters: {},
    execute: async () => ({ text: 'ok' }),
    ...over,
  };
}

test('flags default off and parse 1/true', () => {
  expect(readKernelV2LiveFlags({})).toEqual({ observers: false, tools: false });
  expect(
    readKernelV2LiveFlags({
      MAFW_KERNEL_V2_OBSERVERS: '1',
      MAFW_KERNEL_V2_TOOLS: 'true',
    }),
  ).toEqual({ observers: true, tools: true });
});

test('disabled bridge is null', () => {
  expect(createKernelV2Live({ env: {} })).toBeNull();
});

test('observer bridge sanitizes and dispatches', async () => {
  const live = createKernelV2Live({ env: { MAFW_KERNEL_V2_OBSERVERS: '1' } })!;
  const seen: any[] = [];
  live.registerObserver({
    id: 'a',
    onEvent: (event) => {
      seen.push(event);
    },
  });
  live.observe({
    type: 'tool.updated',
    sessionID: 's1',
    properties: { tool: 'x', prompt: 'secret', apiToken: 'sk' },
  });
  await live.drain();
  expect(seen).toHaveLength(1);
  expect(seen[0].properties).toEqual({ tool: 'x' });
  await live.dispose();
});

test('tool bridge exposes a factory', async () => {
  const live = createKernelV2Live({ env: { MAFW_KERNEL_V2_TOOLS: '1' } })!;
  live.registerTool(tool());
  const registration = live.toolFactory()!('s1').find((item) => item.name === 'plugin:demo:echo');
  expect(registration).toBeDefined();
  await expect(registration!.execute({})).resolves.toEqual({ text: 'ok' });
  await live.dispose();
});

test('syncs package tools/observers, replaces on revision change, clears on removal', async () => {
  const live = createKernelV2Live({
    env: { MAFW_KERNEL_V2_OBSERVERS: '1', MAFW_KERNEL_V2_TOOLS: '1' },
  })!;
  const seen: string[] = [];

  live.syncPluginContributions(
    [
      {
        packageName: 'demo',
        revision: 'r1',
        name: 'echo',
        description: 'Echo',
        inputSchema: { type: 'object' },
        handler: async () => 'v1',
      },
    ],
    [
      {
        packageName: 'demo',
        revision: 'r1',
        id: 'watch',
        filter: { types: ['part.updated'] },
        onEvent: (event) => {
          seen.push(event.type);
        },
      },
    ],
  );

  const tool = live
    .toolFactory()!('s1')
    .find((registration) => registration.name === 'plugin:demo:echo');
  await expect(tool!.execute({})).resolves.toEqual({ text: 'v1' });
  live.observe({ type: 'part.updated', sessionID: 's1' });
  await live.drain();
  expect(seen).toEqual(['part.updated']);

  live.syncPluginContributions(
    [
      {
        packageName: 'demo',
        revision: 'r2',
        name: 'echo',
        description: 'Echo',
        inputSchema: { type: 'object' },
        handler: async () => 'v2',
      },
    ],
    [],
  );
  const next = live
    .toolFactory()!('s1')
    .find((registration) => registration.name === 'plugin:demo:echo');
  await expect(next!.execute({})).resolves.toEqual({ text: 'v2' });
  live.observe({ type: 'part.updated', sessionID: 's1' });
  await live.drain();
  expect(seen).toEqual(['part.updated']);

  live.syncPluginContributions([], []);
  expect(live.toolFactory()!('s1')).toEqual([]);
  await live.dispose();
});

test('disabled feature APIs throw a clear error', () => {
  const observersOnly = createKernelV2Live({
    env: { MAFW_KERNEL_V2_OBSERVERS: '1' },
  })!;
  expect(() => observersOnly.registerTool(tool())).toThrow(/MAFW_KERNEL_V2_TOOLS/);
  expect(observersOnly.toolFactory()).toBeUndefined();

  const toolsOnly = createKernelV2Live({ env: { MAFW_KERNEL_V2_TOOLS: '1' } })!;
  expect(() =>
    toolsOnly.registerObserver({ id: 'a', onEvent: () => {} }),
  ).toThrow(/MAFW_KERNEL_V2_OBSERVERS/);
});
