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

describe('approval integration', () => {
  const makeDeps = (session?: any) => ({
    createSession: async () => ({ session: session ?? fakeSession() }),
  });

  it('should create ApprovalBridge per session', async () => {
    const registry = new PiSessionRegistry(makeDeps());
    const { id } = await registry.create('/tmp', {} as any);

    expect(registry['approvalBridges'].has(id)).toBe(true);
  });

  it('should dispose ApprovalBridge when session is deleted', async () => {
    const registry = new PiSessionRegistry(makeDeps());
    const { id } = await registry.create('/tmp', {} as any);
    const bridge = registry['approvalBridges'].get(id);
    const disposeSpy = jest.spyOn(bridge!, 'dispose');

    await registry.delete(id);

    expect(disposeSpy).toHaveBeenCalled();
    expect(registry['approvalBridges'].has(id)).toBe(false);
  });

  it('should forward permissionReply to bridge', async () => {
    const registry = new PiSessionRegistry(makeDeps());
    const { id } = await registry.create('/tmp', {} as any);
    const bridge = registry['approvalBridges'].get(id);
    const replySpy = jest.spyOn(bridge!, 'reply');

    const requestPromise = bridge!.request('req-1');
    const result = await registry.permissionReply(id, 'req-1', true);

    expect(replySpy).toHaveBeenCalledWith('req-1', true);
    expect(result).toBe(true);
    expect(await requestPromise).toBe(true);
  });

  it('should dispose all ApprovalBridges on disposeAll', async () => {
    const registry = new PiSessionRegistry(makeDeps());
    const { id: id1 } = await registry.create('/tmp', {} as any);
    const { id: id2 } = await registry.create('/tmp', {} as any);
    const bridge1 = registry['approvalBridges'].get(id1)!;
    const bridge2 = registry['approvalBridges'].get(id2)!;
    const spy1 = jest.spyOn(bridge1, 'dispose');
    const spy2 = jest.spyOn(bridge2, 'dispose');

    await registry.disposeAll();

    expect(spy1).toHaveBeenCalled();
    expect(spy2).toHaveBeenCalled();
    expect(registry['approvalBridges'].size).toBe(0);
  });

  it('should clean up bridge when createSession fails', async () => {
    const registry = new PiSessionRegistry({
      createSession: async () => { throw new Error('boom'); },
    });
    await expect(registry.create('/tmp', {} as any)).rejects.toThrow('boom');
    expect(registry['approvalBridges'].size).toBe(0);
  });

  it('should return false when permissionReply called for unknown session', async () => {
    const registry = new PiSessionRegistry(makeDeps());
    const result = await registry.permissionReply('unknown', 'req-1', true);
    expect(result).toBe(false);
  });
  it('promptAsync forwards images to session.prompt options', async () => {
    const s = fakeSession();
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: s }) });
    const { id } = await registry.create('/tmp', {} as any);
    await registry.promptAsync(id, 'describe', { images: [{ data: 'QUJD', mimeType: 'image/png' }] });
    expect(s.prompt).toHaveBeenCalledWith('describe', expect.objectContaining({ images: [{ data: 'QUJD', mimeType: 'image/png' }] }));
  });

  it('promptAsync with images while streaming sends content array via followUp', async () => {
    const s = fakeSession({ streaming: true });
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: s }) });
    const { id } = await registry.create('/tmp', {} as any);
    await registry.promptAsync(id, 'describe', { images: [{ data: 'QUJD', mimeType: 'image/png' }] });
    expect(s.sendUserMessage).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: 'describe' }),
        expect.objectContaining({ type: 'image', data: 'QUJD', mimeType: 'image/png' }),
      ]),
      expect.objectContaining({ deliverAs: 'followUp' }),
    );
  });
});