import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { toRuntimeDefinition } from '../../../src/runtime/adapter-bridge';
import { createNeutralRuntime } from '../../../src/runtime/neutral-runtime';

function richRuntime() {
  return {
    name: 'opencode',
    capabilities: {},
    session: {
      create: async () => ({ id: 's1' }),
      promptAsync: async () => {},
      abort: async () => {},
      messages: async () => ({ data: [] }),
      list: async () => [],
      get: async () => ({ id: 's1' }),
      delete: async () => {},
      todo: async () => [],
      children: async () => [],
      summarize: async () => ({}),
      instructions: {
        list: async () => [{ key: 'mafw.memory-guide', value: { text: 'guide' } }],
        put: async () => {},
        remove: async () => {},
      },
      background: async () => {},
    },
    global: { event: async () => ({ stream: (async function* () {})() }) },
    provider: { list: async () => ({ all: [], connected: [], default: {} }) },
    app: { agents: async () => [] },
    tools: { registerTools() {}, nativeTools: () => [] },
    config: { get: async () => ({ mcp: {} }), update: async () => ({}) },
    completion: { complete: async () => ({ text: '' }) },
    credentials: { getApiKey: () => null },
    mcp: {
      list: async () => [{ name: 'mafw', status: 'connected', type: 'remote', url: 'http://x/mcp', source: 'opencode.jsonc' }],
      connect: async () => true,
      disconnect: async () => true,
      config: { preview: async () => ({ token: 't', target: '/cfg', diff: '' }) },
    },
    discovery: {
      list: async () => ({ commands: [{ name: 'goal', description: 'make a goal' }], skills: [{ id: 'sk', name: 'skill', contentLength: 3 }], warnings: [] }),
      loadSkill: async () => ({ id: 'sk', name: 'skill', contentLength: 3, content: 'abc' }),
    },
    pty: {
      create: async () => ({ id: 'p1' }),
      connect: async () => ({ id: 'p1', url: 'ws://127.0.0.1/pty/p1', protocol: 'mafw-terminal/1' }),
      resize: async () => {},
      remove: async () => {},
      list: async () => [{ id: 'p1', title: 'shell' }],
    },
    snapshotTree: { locate: async () => '/snap' },
  } as any;
}

function neutralize(runtime: any) {
  const definition = toRuntimeDefinition(runtime, { name: 'opencode', capabilities: {} });
  const bus = new RuntimeBus();
  bus.register(definition);
  return createNeutralRuntime(definition, { bus });
}

describe('opencode v2 surface parity on the neutral path', () => {
  it('exposes MCP list/connect/config', async () => {
    const rt: any = neutralize(richRuntime());
    const servers = await rt.mcp.list({ directory: '/p' });
    expect(servers[0]).toMatchObject({ name: 'mafw', status: 'connected', type: 'remote' });
    expect(await rt.mcp.connect('mafw')).toBe(true);
    expect(typeof rt.mcp.config.preview).toBe('function');
  });

  it('exposes discovery commands and skill content', async () => {
    const rt: any = neutralize(richRuntime());
    const result = await rt.discovery.list({ directory: '/p' });
    expect(result.commands[0].name).toBe('goal');
    const skill = await rt.discovery.loadSkill({ directory: '/p', key: 'sk' });
    expect(skill.content).toBe('abc');
  });

  it('exposes per-session instructions entries', async () => {
    const rt: any = neutralize(richRuntime());
    const entries = await rt.session.instructions.list('s1');
    expect(entries[0].key).toBe('mafw.memory-guide');
    await rt.session.instructions.put('s1', 'k', { text: 'v' });
    await rt.session.instructions.remove('s1', 'k');
  });

  it('exposes PTY metadata and connect info', async () => {
    const rt: any = neutralize(richRuntime());
    expect(await rt.pty.create({ directory: '/p' })).toEqual({ id: 'p1' });
    expect(await rt.pty.connect({ id: 'p1' })).toMatchObject({ protocol: 'mafw-terminal/1' });
    expect(await rt.pty.list()).toEqual([{ id: 'p1', title: 'shell' }]);
  });

  it('exposes the snapshot tree locator and background switch', async () => {
    const rt: any = neutralize(richRuntime());
    expect(await rt.snapshotTree.locate({ start: 'a', end: 'b' })).toBe('/snap');
    await rt.session.background({ sessionID: 's1' });
  });
});
