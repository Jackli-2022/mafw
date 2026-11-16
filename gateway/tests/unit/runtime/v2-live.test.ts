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

test('flags default on and accept 0/false as the kill switch', () => {
  expect(readKernelV2LiveFlags({})).toEqual({ observers: true, tools: true });
  expect(
    readKernelV2LiveFlags({ MAFW_KERNEL_V2_TOOLS: '0', MAFW_KERNEL_V2_OBSERVERS: 'false' }),
  ).toEqual({ observers: false, tools: false });
  expect(
    readKernelV2LiveFlags({ MAFW_KERNEL_V2_OBSERVERS: '1', MAFW_KERNEL_V2_TOOLS: 'true' }),
  ).toEqual({ observers: true, tools: true });
});

test('the bridge is live without any env', async () => {
  const live = createKernelV2Live({ env: {} })!;
  expect(live).not.toBeNull();
  expect(live.toolsEnabled).toBe(true);
  expect(live.observersEnabled).toBe(true);
  await live.dispose();
});

test('an explicit 0 disables one plane and keeps the other live', () => {
  const live = createKernelV2Live({ env: { MAFW_KERNEL_V2_TOOLS: '0' } })!;
  expect(live.toolsEnabled).toBe(false);
  expect(live.observersEnabled).toBe(true);
  expect(live.toolFactory()).toBeUndefined();
  expect(() => live.registerTool(tool())).toThrow(/MAFW_KERNEL_V2_TOOLS/);
  return live.dispose();
});

test('events dispatched before registration are not replayed', async () => {
  const live = createKernelV2Live({ env: {} })!;
  const seen: string[] = [];
  live.observe({ type: 'turn.completed', sessionID: 's1' });
  const unregister = live.registerObserver({
    id: 'a',
    onEvent: (event) => { seen.push(event.type); },
  });
  live.observe({ type: 'turn.completed', sessionID: 's1' });
  await live.drain();
  expect(seen).toEqual(['turn.completed']);
  unregister();
  await live.dispose();
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
  const toolsOff = createKernelV2Live({ env: { MAFW_KERNEL_V2_TOOLS: '0' } })!;
  expect(() => toolsOff.registerTool(tool())).toThrow(/MAFW_KERNEL_V2_TOOLS/);
  expect(toolsOff.toolFactory()).toBeUndefined();

  const observersOff = createKernelV2Live({ env: { MAFW_KERNEL_V2_OBSERVERS: '0' } })!;
  expect(() =>
    observersOff.registerObserver({ id: 'a', onEvent: () => {} }),
  ).toThrow(/MAFW_KERNEL_V2_OBSERVERS/);
});
