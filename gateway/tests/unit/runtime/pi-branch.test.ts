import { PiSessionRegistry } from '../../../src/runtime/pi/pi-session';

function fakeSession(over: any = {}) {
  return {
    isStreaming: false,
    messages: [],
    sessionManager: {
      getCwd: () => '/cwd',
      getLeafId: () => 'leaf_1',
      createBranchedSession: jest.fn((leaf: string) => `/tmp/pi-fork-${leaf}.jsonl`),
      branch: jest.fn(),
    },
    prompt: jest.fn(async () => {}),
    waitForIdle: jest.fn(async () => {}),
    dispose: jest.fn(async () => {}),
    ...over,
  };
}

function makeRegistry(createSessionImpl?: (opts: any) => Promise<{ session: any }>) {
  return new PiSessionRegistry({
    createSession: createSessionImpl ?? (async () => ({ session: fakeSession() })),
  });
}

describe('PiSessionRegistry branch primitives', () => {
  it('fork creates a new session from the branched file', async () => {
    const src = fakeSession();
    const forked = fakeSession();
    const createSession = jest.fn(async (opts: any) => ({ session: opts.fromFile ? forked : src }));
    const registry = makeRegistry(createSession);
    const { id } = await registry.create('/cwd', {});
    const out = await registry.fork(id, 'entry_42');
    expect(src.sessionManager.createBranchedSession).toHaveBeenCalledWith('entry_42');
    expect(createSession).toHaveBeenLastCalledWith(expect.objectContaining({ fromFile: '/tmp/pi-fork-entry_42.jsonl' }));
    expect(out.id).not.toBe(id);
    expect(registry.sessionFor(out.id)).toBe(forked);
  });

  it('fork without messageID uses current leaf', async () => {
    const src = fakeSession();
    const registry = makeRegistry(async () => ({ session: src }));
    const { id } = await registry.create('/cwd', {});
    await registry.fork(id);
    expect(src.sessionManager.createBranchedSession).toHaveBeenCalledWith('leaf_1');
  });

  it('revert maps to sessionManager.branch; rejects while streaming', async () => {
    const src = fakeSession();
    const registry = makeRegistry(async () => ({ session: src }));
    const { id } = await registry.create('/cwd', {});
    await registry.revert(id, 'entry_7');
    expect(src.sessionManager.branch).toHaveBeenCalledWith('entry_7');
    src.isStreaming = true;
    await expect(registry.revert(id, 'entry_8')).rejects.toThrow(/busy|streaming/i);
  });

  it('prompt returns envelope with usage/finish from last assistant message', async () => {
    const src = fakeSession({
      messages: [],
      prompt: jest.fn(async function (this: any) {
        src.messages.push({ role: 'user', content: [{ type: 'text', text: 'q' }] });
        src.messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: 'a' }],
          stopReason: 'stop',
          usage: { input: 10, output: 5, cacheRead: 3, totalCost: 0.001 },
        });
      }),
    });
    const registry = makeRegistry(async () => ({ session: src }));
    const { id } = await registry.create('/cwd', {});
    const res: any = await registry.prompt(id, 'q');
    expect(res.parts).toEqual([{ type: 'text', text: 'a' }]);
    expect(res.finish).toBe('stop');
    expect(res.usage).toEqual({ input: 10, output: 5, cached: 3, reasoning: undefined, costUsd: 0.001 });
  });

  it('registers a compaction extension that emits normalized events', async () => {
    const handlers: Record<string, Function> = {};
    const emitted: any[] = [];
    const fakePi = { on: (name: string, fn: Function) => { handlers[name] = fn; } };
    let capturedFactories: any[] = [];
    const registry = new PiSessionRegistry(
      {
        createSession: async (opts: any) => {
          capturedFactories = opts.extensionFactories ?? [];
          return { session: fakeSession() };
        },
      },
      { emitEvent: (e) => emitted.push(e) },
    );
    const { id } = await registry.create('/cwd', {});
    const ext = capturedFactories.find((f) => f.name === 'mafw-compaction');
    expect(ext).toBeDefined();
    ext.factory(fakePi);
    handlers['session_before_compact']();
    handlers['session_compact']();
    expect(emitted).toEqual([
      { payload: { type: 'session.compacting', properties: { sessionID: id } } },
      { payload: { type: 'session.compacted', properties: { sessionID: id } } },
    ]);
  });
});
