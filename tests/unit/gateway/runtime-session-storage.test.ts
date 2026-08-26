import { fullCapabilities, minimalCapabilities, type AgentRuntime, type SessionInfo } from '../../../gateway/src/runtime/contract';

describe('sessionStorageApi capability', () => {
  it('fullCapabilities declares sessionStorageApi: true', () => {
    expect(fullCapabilities().sessionStorageApi).toBe(true);
  });

  it('minimalCapabilities declares sessionStorageApi: false', () => {
    expect(minimalCapabilities().sessionStorageApi).toBe(false);
  });

  it('listByDirectory is optional on the session surface', () => {
    const mock: AgentRuntime = {
      name: 'test',
      capabilities: { ...minimalCapabilities(), sessionStorageApi: false },
      getBaseUrl: () => 'http://localhost:4096',
      session: {
        create: jest.fn(), promptAsync: jest.fn(), prompt: jest.fn(),
        messages: jest.fn(), get: jest.fn(), delete: jest.fn(),
        abort: jest.fn(), list: jest.fn(), todo: jest.fn(),
        children: jest.fn(), summarize: jest.fn(),
      },
      global: { event: jest.fn() },
      provider: { list: jest.fn() },
      app: { agents: jest.fn() },
      config: { get: jest.fn(), update: jest.fn() },
    };
    expect(mock.session.listByDirectory).toBeUndefined();
  });
});

describe('listSessions routing via sessionStorageApi', () => {
  const makeRuntime = (opts: {
    hasStorageApi: boolean;
    listByDirectoryFn?: jest.Mock;
    listFn?: jest.Mock;
  }): AgentRuntime => {
    const caps = { ...fullCapabilities(), sessionStorageApi: opts.hasStorageApi };
    const session: any = {
      create: jest.fn(), promptAsync: jest.fn(), prompt: jest.fn(),
      messages: jest.fn(), get: jest.fn(), delete: jest.fn(),
      abort: jest.fn(), list: opts.listFn ?? jest.fn().mockResolvedValue([]),
      todo: jest.fn(), children: jest.fn(), summarize: jest.fn(),
    };
    if (opts.listByDirectoryFn) {
      session.listByDirectory = opts.listByDirectoryFn;
    }
    return {
      name: 'test',
      capabilities: caps,
      getBaseUrl: () => 'http://localhost:4096',
      session,
      global: { event: jest.fn() },
      provider: { list: jest.fn() },
      app: { agents: jest.fn() },
      config: { get: jest.fn(), update: jest.fn() },
    };
  };

  it('when sessionStorageApi=true, listByDirectory is called directly', async () => {
    const fakeSessions: SessionInfo[] = [
      { id: 's1', projectID: 'p1', directory: '/proj', title: 'test', time: { created: 1, updated: 2 } },
    ];
    const listByDirectoryFn = jest.fn().mockResolvedValue(fakeSessions);
    const listFn = jest.fn();
    const rt = makeRuntime({ hasStorageApi: true, listByDirectoryFn, listFn });

    const result = await rt.session.listByDirectory!('/proj', 50);
    expect(result).toEqual(fakeSessions);
    expect(listByDirectoryFn).toHaveBeenCalledWith('/proj', 50);
    expect(listFn).not.toHaveBeenCalled();
  });

  it('when sessionStorageApi=false, falls back to session.list + client filter', async () => {
    const allSessions = [
      { id: 's1', directory: '/proj', title: 'a' },
      { id: 's2', directory: '/other', title: 'b' },
      { id: 's3', directory: '/proj/sub', title: 'c' },
    ];
    const listFn = jest.fn().mockResolvedValue(allSessions);
    const rt = makeRuntime({ hasStorageApi: false, listFn });

    const result = await rt.session.list({ directory: '/proj' });
    expect(listFn).toHaveBeenCalled();
    expect(rt.session.listByDirectory).toBeUndefined();

    const target = '/proj'.replace(/\\/g, '/').toLowerCase();
    const filtered = result.filter((s: any) => {
      const d = (s.directory || '').replace(/\\/g, '/').toLowerCase();
      return d === target || d.startsWith(target + '/');
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((s: any) => s.id)).toEqual(['s1', 's3']);
  });
});
