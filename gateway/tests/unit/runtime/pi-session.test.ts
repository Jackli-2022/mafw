import { PiSessionRegistry } from '../../../src/runtime/pi/pi-session';

const fakeSession = (overrides: any = {}) => ({
  prompt: jest.fn(async () => {}),
  waitForIdle: jest.fn(async () => {}),
  abort: jest.fn(async () => {}),
  dispose: jest.fn(),
  get isStreaming() { return overrides.streaming ?? false; },
  sendUserMessage: jest.fn(async () => {}),
  get messages() { return overrides.messages ?? []; },
  get sessionId() { return overrides.id ?? 'fake'; },
  compact: jest.fn(async () => ({})),
  ...overrides,
});

describe('PiSessionRegistry', () => {
  it('create registers a new session and returns pi_ prefixed id', async () => {
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: fakeSession({ id: 'x' }) }) });
    const { id } = await registry.create('/tmp/proj', { provider: 'xiaomi', model: 'm' } as any);
    expect(id.startsWith('pi_')).toBe(true);
    expect(registry.sessionFor(id)).toBeDefined();
  });

  it('promptAsync calls session.prompt and waits idle', async () => {
    const s = fakeSession();
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: s }) });
    const { id } = await registry.create('/tmp/proj', {} as any);
    await registry.promptAsync(id, 'hello');
    expect(s.prompt).toHaveBeenCalledWith('hello', expect.anything());
    expect(s.waitForIdle).toHaveBeenCalled();
  });

  it('promptAsync while streaming uses followUp queue', async () => {
    const s = fakeSession({ streaming: true });
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: s }) });
    const { id } = await registry.create('/tmp/proj', {} as any);
    await registry.promptAsync(id, 'hello');
    expect(s.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining('hello'), expect.objectContaining({ deliverAs: 'followUp' }));
  });

  it('abort and delete dispose the session', async () => {
    const s = fakeSession();
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: s }) });
    const { id } = await registry.create('/tmp/proj', {} as any);
    await registry.abort(id);
    expect(s.abort).toHaveBeenCalled();
    await registry.delete(id);
    expect(s.dispose).toHaveBeenCalled();
    expect(registry.sessionFor(id)).toBeUndefined();
  });

  it('disposeAll disposes every session', async () => {
    const s1 = fakeSession(); const s2 = fakeSession();
    let n = 0;
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: n++ === 0 ? s1 : s2 }) });
    await registry.create('/a', {} as any);
    await registry.create('/b', {} as any);
    await registry.disposeAll();
    expect(s1.dispose).toHaveBeenCalled();
    expect(s2.dispose).toHaveBeenCalled();
  });

  it('todo and children return empty arrays (no pi equivalents)', async () => {
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: fakeSession() }) });
    const { id } = await registry.create('/tmp', {} as any);
    expect(await registry.todo(id)).toEqual([]);
    expect(await registry.children(id)).toEqual([]);
  });
});