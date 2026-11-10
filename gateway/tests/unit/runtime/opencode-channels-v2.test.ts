/**
 * Phase 4 W3 — every v1/v2 channel block reaches the neutral runtime.
 *
 * The definition is built by `createOpencodeDefinition` (native, no legacy
 * bridge) over a fake opencode client; `createNeutralRuntime` then exposes the
 * same surfaces the gateway routes consume.
 */
import { createOpencodeDefinition } from '../../../../adapters/opencode/src/definition';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { createNeutralRuntime } from '../../../src/runtime/neutral-runtime';
import type { RuntimeFactoryContext } from '@mafw/runtime-contract';

const ctx = { pluginConfig: () => ({}) } as RuntimeFactoryContext;

function fakeRuntime() {
  const calls: string[] = [];
  const runtime: any = {
    name: 'opencode',
    capabilities: {},
    getBaseUrl: () => 'http://x',
    proxyHeaders: () => ({ Authorization: 'Basic dGVzdA==' }),
    resolveProviderTransport: async () => ({ baseUrl: 'https://p.example/v1', apiKey: 'sk-x' }),
    session: {
      create: async () => ({ id: 's1' }),
      promptAsync: async () => {},
      abort: async () => {},
      messages: async () => ({ data: [] }),
      list: async (opts: any) => { calls.push(`session.list:${opts?.directory ?? ''}`); return []; },
      listByDirectory: async () => [],
      get: async () => ({ id: 's1' }),
      update: async () => ({}),
      delete: async () => {},
      todo: async () => [],
      children: async () => [],
      summarize: async () => ({}),
      permissionList: async () => [],
      permissionReply: async () => true,
      instructions: {
        list: async () => [{ key: 'k', value: 'v' }],
        put: async () => {},
        remove: async () => {},
      },
      background: async (opts: any) => { calls.push(`background:${opts.sessionID}`); },
      question: { list: async () => [], reply: async () => {}, reject: async () => {} },
      fork: async () => ({ id: 's2' }),
      revert: async () => {},
      unrevert: async () => {},
      diff: async () => [],
      vcs: { diff: async () => [], apply: async () => {} },
    },
    global: { event: async () => ({ stream: (async function* () {})() }) },
    provider: { list: async () => ({ all: [], connected: [], default: {} }) },
    app: { agents: async () => [] },
    tools: { registerTools() {}, nativeTools: () => [] },
    config: { get: async () => ({}), update: async () => ({}) },
    completion: { complete: async () => ({ text: '' }) },
    credentials: { getApiKey: () => null },
    mcp: {
      list: async () => [{ name: 'm1', status: 'connected' }],
      connect: async () => true,
      disconnect: async () => true,
      config: {
        preview: async (input: any) => { calls.push(`mcp.preview:${input.name}`); return { token: 't', target: '/tmp/x', diff: '' }; },
        previewRemove: async () => ({ token: 't', target: '/tmp/x', diff: '' }),
        apply: async () => ({ applied: true, runtimeApplied: true }),
        remove: async () => ({ applied: true, runtimeApplied: true }),
        restore: async () => ({ applied: true, runtimeApplied: true }),
      },
    },
    discovery: {
      roots: () => ({ skillRoots: ['/home/u/.config/opencode/skills'], instructionRoots: ['/home/u/.config/opencode'] }),
      list: async () => ({ commands: [], skills: [], warnings: [] }),
      loadSkill: async () => null,
    },
    pty: {
      create: async () => ({ id: 'p1' }),
      connect: async () => ({ url: 'ws://pty', headers: { Authorization: 'Basic x' } }),
      resize: async () => {},
      remove: async () => {},
      list: async () => [{ id: 'p1' }],
    },
    snapshotTree: { locate: async () => '/snap' },
    agents: { install: async () => {} },
    agentProcess: {
      restart: async () => {},
      spawnServe: async () => ({ url: 'http://serve', close: () => {} }),
      killServe: () => {},
    },
  };
  return { runtime, calls };
}

describe('native opencode v1/v2 channels through the neutral runtime', () => {
  it('exposes mcp, discovery, instructions, pty, checkpoint and background', async () => {
    const { runtime: opencode, calls } = fakeRuntime();
    const def = await createOpencodeDefinition(
      ctx,
      { variant: 'v21', baseUrl: 'http://x' },
      { runtime: opencode },
    );
    expect(def.channelApi).toBe(2);

    const bus = new RuntimeBus();
    bus.register(def);
    const runtime = createNeutralRuntime(def, { bus }) as any;

    await expect(runtime.mcp.list({})).resolves.toEqual([{ name: 'm1', status: 'connected' }]);
    await expect(runtime.mcp.config.preview({ name: 'm2' })).resolves.toMatchObject({ token: 't' });
    expect(calls).toContain('mcp.preview:m2');

    await expect(runtime.discovery.list({ directory: '/p' })).resolves.toMatchObject({ commands: [], skills: [] });
    expect(runtime.discovery.roots()).toEqual({
      skillRoots: ['/home/u/.config/opencode/skills'],
      instructionRoots: ['/home/u/.config/opencode'],
    });

    await expect(runtime.session.instructions.list('s1')).resolves.toEqual([{ key: 'k', value: 'v' }]);
    await expect(runtime.pty.connect({ id: 'p1' })).resolves.toMatchObject({ url: 'ws://pty' });
    await expect(runtime.snapshotTree.locate({ start: 'a', end: 'b' })).resolves.toBe('/snap');
    await runtime.session.background({ sessionID: 's1' });
    expect(calls).toContain('background:s1');
  });

  it('honours the directory argument on the v1 session list', async () => {
    const { runtime: opencode, calls } = fakeRuntime();
    const def = await createOpencodeDefinition(
      ctx,
      { variant: 'v21', baseUrl: 'http://x' },
      { runtime: opencode },
    );
    const bus = new RuntimeBus();
    bus.register(def);
    const runtime = createNeutralRuntime(def, { bus }) as any;
    await runtime.session.list({ directory: '/project' });
    expect(calls).toContain('session.list:/project');
  });
});
