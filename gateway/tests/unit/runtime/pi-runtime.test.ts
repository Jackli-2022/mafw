import { PI_CAPABILITIES, createPiRuntime, partsToPromptInput } from '../../../src/runtime/plugins/pi-runtime';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/config', () => ({
  config: { raw: { paths: { projectDir: '/tmp/proj' } }, server: { apiPort: 3000 } },
}));
jest.mock('../../../src/runtime/auth', () => ({
  DEFAULT_AUTH_PATH: () => '/tmp/nonexistent-auth.json',
  readOpencodeAuth: () => ({}),
}));

const fakeSessionList = [
  {
    id: 'pi-sess-1',
    cwd: '/tmp/proj',
    name: 'Test session',
    firstMessage: 'hello',
    created: new Date('2026-01-01T00:00:00Z'),
    modified: new Date('2026-01-01T01:00:00Z'),
    messageCount: 5,
    path: '/tmp/sessions/pi-sess-1.jsonl',
    allMessagesText: '',
  },
];

const fakePi = {
  ModelRuntime: {
    create: async () => ({
      getModel: (p: string, m: string) => (p === 'xiaomi' ? { id: `${p}/${m}`, baseUrl: 'http://fake' } : undefined),
      getProviders: () => [{ id: 'xiaomi', name: 'Xiaomi' }],
      getModels: () => [{ id: 'mimo-v2.5' }],
      hasConfiguredAuth: () => true,
      setRuntimeApiKey: async () => {},
      complete: async (model: any, ctx: any, opts: any) => {
        (globalThis as any).__piCompleteCalls = [...((globalThis as any).__piCompleteCalls || []), { model, ctx, opts }];
        return {
          stopReason: 'stop',
          content: [{ type: 'text', text: 'pi says hi' }],
          usage: { promptTokens: 10, completionTokens: 2 },
        };
      },
    }),
  },
  createAgentSession: async (sessionOpts: any) => {
    (globalThis as any).__piCwds = [...((globalThis as any).__piCwds || []), sessionOpts?.cwd];
    return {
    session: {
      prompt: async () => {},
      waitForIdle: async () => {},
      abort: async () => {},
      dispose: async () => {},
      compact: async () => ({}),
      subscribe: () => () => {},
      isStreaming: false,
      messages: [],
      setSessionName: (name: string) => {
        (globalThis as any).__piRenames = [...((globalThis as any).__piRenames || []), name];
      },
    },
    };
  },
  SessionManager: {
    list: async (_cwd: string) => fakeSessionList,
    open: (path: string) => ({
      appendSessionInfo: (name: string) => {
        (globalThis as any).__piAppends = [...((globalThis as any).__piAppends || []), { path, name }];
      },
    }),
  },
};

describe('pi-runtime', () => {
  it('declares Tier-2-partial capabilities', () => {
    expect(PI_CAPABILITIES).toMatchObject({
      sessionApi: true, promptWhileBusy: true, eventStream: true,
      nativeApprovals: true, providerConfigApi: true, perLlmCallTransform: true,
      sessionStorageApi: true, agentConfigApi: true, discoveryApi: false, steerApi: true,
    });
  });

  it('createPiRuntime returns AgentRuntime shape with external=true', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    expect(rt.name).toBe('pi');
    expect(rt.external).toBe(true);
    expect(typeof rt.getBaseUrl).toBe('function');
    expect(typeof rt.session.create).toBe('function');
    expect(typeof rt.global.event).toBe('function');
    expect(typeof rt.provider.list).toBe('function');
    expect(typeof rt.app.agents).toBe('function');
    expect(typeof rt.config.get).toBe('function');
    expect(typeof rt.config.update).toBe('function');
    expect(typeof rt.healthCheck).toBe('function');
  });

  it('session.create → promptAsync → messages works through injected pi', async () => {
    let msgCount = 0;
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({ provider: 'xiaomi', model: 'mimo-v2.5' }) } as any,
      { loadPi: async () => fakePi },
    );
    const { id } = await rt.session.create({ directory: '/tmp/proj' });
    expect(id.startsWith('pi_')).toBe(true);
    await rt.session.promptAsync({ sessionID: id, message: 'hello' });
    const { data } = await rt.session.messages({ sessionID: id });
    expect(Array.isArray(data)).toBe(true);
    expect(msgCount).toBe(0);
  });
});

describe('pi session.create directory contract', () => {
  afterEach(() => { delete (globalThis as any).__piCwds; });

  it('missing directory (and no ctx.projectDir) → fail-loud', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    await expect((rt.session as any).create({})).rejects.toThrow(/directory is required/);
  });

  it('ctx.projectDir is the defensive fallback when opts.directory is missing', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}), projectDir: '/proj/from-ctx' } as any,
      { loadPi: async () => fakePi },
    );
    const { id } = await (rt.session as any).create({});
    expect(id.startsWith('pi_')).toBe(true);
    expect((globalThis as any).__piCwds.at(-1)).toBe('/proj/from-ctx');
  });
});

describe('pi session.update (rename)', () => {
  afterEach(() => {
    delete (globalThis as any).__piRenames;
    delete (globalThis as any).__piAppends;
  });

  it('implements session.update (validateRuntime must not warn)', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    expect(typeof (rt.session as any).update).toBe('function');
  });

  it('live session → setSessionName', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    const { id } = await rt.session.create({ directory: '/tmp/proj' });
    await (rt.session as any).update({ sessionID: id, title: '新标题' });
    expect((globalThis as any).__piRenames).toEqual(['新标题']);
  });

  it('persisted session → SessionManager.open + appendSessionInfo', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    await (rt.session as any).update({ sessionID: 'pi-sess-1', title: '改名' });
    expect((globalThis as any).__piAppends).toEqual([{ path: '/tmp/sessions/pi-sess-1.jsonl', name: '改名' }]);
  });

  it('unknown session → throws a diagnosable error', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    await expect((rt.session as any).update({ sessionID: 'nope', title: 'x' }))
      .rejects.toThrow(/not found/);
  });
});

describe('completion channel', () => {
  afterEach(() => {
    delete (globalThis as any).__piCompleteCalls;
  });

  it('declares completionApi and complete() routes through ModelRuntime.complete', async () => {
    (globalThis as any).__piCompleteCalls = [];
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}), credentials: { getApiKey: () => 'sk-test' } } as any,
      { loadPi: async () => fakePi },
    );
    expect(rt.capabilities.completionApi).toBe(true);
    const res = await rt.completion!.complete({
      model: { providerID: 'xiaomi', modelID: 'mimo-v2.5' },
      system: [{ text: 'sys' }],
      user: [
        { type: 'text', text: 'describe' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'video/mp4' },
      ],
    });
    expect(res.text).toBe('pi says hi');
    expect(res.usage).toEqual({ input: 10, cached: 0, output: 2 });
    const call = (globalThis as any).__piCompleteCalls[0];
    expect(call.ctx.systemPrompt).toBe('sys');
    expect(call.ctx.messages[0].content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'video/mp4' },
    ]);
    expect(typeof call.opts.onPayload).toBe('function');
  });

  it('complete() returns usage undefined when pi omits it', async () => {
    const noUsagePi = {
      ...fakePi,
      ModelRuntime: {
        create: async () => ({
          getModel: () => ({ id: 'm' }),
          setRuntimeApiKey: async () => {},
          complete: async () => ({ stopReason: 'stop', content: [{ type: 'text', text: 'x' }] }),
        }),
      },
    };
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}), credentials: { getApiKey: () => 'sk-test' } } as any,
      { loadPi: async () => noUsagePi },
    );
    const res = await rt.completion!.complete({
      model: { providerID: 'xiaomi', modelID: 'mimo-v2.5' },
      user: [{ type: 'text', text: 'q' }],
    });
    expect(res.usage).toBeUndefined();
  });

  it('complete() throws when model is not in the pi registry', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    await expect(rt.completion!.complete({
      model: { providerID: 'nope', modelID: 'nope' },
      user: [{ type: 'text', text: 'q' }],
    })).rejects.toThrow('not found');
  });
});

describe('permissionReply', () => {
  it('should expose permissionReply on session API', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    expect(rt.session.permissionReply).toBeDefined();
  });

  it('should forward permissionReply to registry', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    const { id } = await rt.session.create({ directory: '/tmp' });
    const registry = (rt as any).registry;
    const replySpy = jest.spyOn(registry, 'permissionReply');

    await rt.session.permissionReply!(id, 'req-1', true as any);

    expect(replySpy).toHaveBeenCalledWith(id, 'req-1', true, undefined);
  });

  it('permissionList aggregates pending approvals across sessions (contract)', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    expect(rt.session.permissionList).toBeDefined();
    const { id } = await rt.session.create({ directory: '/tmp' });
    const registry = (rt as any).registry;
    // 直接向 registry 的 approvalBridge 注册一个 pending（模拟 extension tool_call）
    const bridge = (registry as any).approvalBridges.get(id);
    bridge.request('req-9', { sessionID: id, permission: 'bash', patterns: [], metadata: { args: { cmd: 'ls' } } });
    const items = await rt.session.permissionList!();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'req-9', sessionID: id, permission: 'bash' });
    bridge.reply('req-9', true);
    expect(await rt.session.permissionList!()).toHaveLength(0);
  });
});

describe('approval policy configuration', () => {
  it('should use default policy when not configured', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    const registry = (rt as any).registry;
    expect(registry).toBeDefined();
    expect(registry['policy']).toBeUndefined();
  });

  it('should use custom policy from pluginConfig', async () => {
    const rt = await createPiRuntime(
      {
        fetch,
        log: console,
        pluginConfig: () => ({
          approvalPolicy: {
            autoApprove: ['read', 'grep'],
            autoDeny: ['bash'],
          },
        }),
      } as any,
      { loadPi: async () => fakePi },
    );
    const registry = (rt as any).registry;
    expect(registry).toBeDefined();
    expect(registry['policy']).toEqual({
      autoApprove: ['read', 'grep'],
      autoDeny: ['bash'],
    });
  });
  it('partsToPromptInput converts image data URLs to ImageContent', () => {
    const out = partsToPromptInput([
      { type: 'file', url: 'data:image/png;base64,QUJD', mime: 'image/png', text: '' },
      { type: 'text', text: 'describe this' },
    ]);
    expect(out.images).toEqual([{ type: 'image', mimeType: 'image/png', data: 'QUJD' }]);
    expect(out.text).toBe('describe this');
  });

  it('partsToPromptInput drops non-image media and keeps raw base64 with mime', () => {
    const out = partsToPromptInput([
      { type: 'file', url: 'data:video/mp4;base64,AAAA' },
      { type: 'file', url: 'QUJD', mime: 'image/jpeg' },
    ]);
    expect(out.images).toEqual([{ type: 'image', mimeType: 'image/jpeg', data: 'QUJD' }]);
    expect(out.text).toBeUndefined();
  });

  it('partsToPromptInput handles empty parts', () => {
    expect(partsToPromptInput(undefined)).toEqual({});
    expect(partsToPromptInput([])).toEqual({});
  });
});

describe('pi-runtime tools 通道（Tier-0 必选）', () => {
  it('registerTools stash 进 registry + nativeTools 声明 pi 清单', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    const factory = (_sid: string) => [];
    await rt.tools.registerTools(factory);
    expect(((rt as any).registry as any).opts.toolFactory).toBe(factory);
    const decls = rt.tools.nativeTools();
    expect(decls.map((d: any) => d.name).sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
    for (const d of decls) {
      expect(['readonly', 'search', 'file-edit', 'shell', 'subagent', 'web', 'plan', 'other']).toContain(d.toolClass);
    }
  });
});

