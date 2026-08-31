import { createServeSupervisor } from '../../src/runtime/serve-supervisor';

function makeDeps(overrides: any = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      port: 4096,
      external: false,
      killPort: () => { calls.push('kill'); },
      spawn: async () => { calls.push('spawn'); return { url: 'http://127.0.0.1:4096', close: () => {} }; },
      probe: async () => { calls.push('probe'); return true; },
      probeIntervalMs: 1,
      probeTimeoutMs: 50,
      ...overrides,
    },
  };
}

describe('serve supervisor', () => {
  it('ensureStarted kills stale process, spawns, waits for health', async () => {
    const { calls, deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    const url = await sup.ensureStarted();
    expect(url).toBe('http://127.0.0.1:4096');
    expect(calls).toEqual(['kill', 'spawn', 'probe']);
  });

  it('ensureStarted is idempotent while healthy', async () => {
    const { calls, deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    await sup.ensureStarted();
    calls.length = 0;
    const url = await sup.ensureStarted();
    expect(url).toBe('http://127.0.0.1:4096');
    expect(calls).toEqual(['probe']); // no second kill/spawn
  });

  it('restart always kills and respawns', async () => {
    const { calls, deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    await sup.ensureStarted();
    calls.length = 0;
    await sup.restart();
    expect(calls.filter(c => c === 'kill')).toHaveLength(1);
    expect(calls.filter(c => c === 'spawn')).toHaveLength(1);
  });

  it('health() returns false when no instance started', async () => {
    const { deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    expect(await sup.health()).toBe(false);
  });

  it('health() delegates to probe when instance exists', async () => {
    const { calls, deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    await sup.ensureStarted();
    calls.length = 0;
    expect(await sup.health()).toBe(true);
    expect(calls).toEqual(['probe']);
  });

  it('external supervisor refuses to manage the process', async () => {
    const { deps } = makeDeps({ external: true, killPort: () => {}, spawn: async () => ({ url: '', close: () => {} }), probe: async () => false });
    const sup = createServeSupervisor(deps);
    await expect(sup.restart()).rejects.toThrow('not managed by the gateway');
    await expect(sup.ensureStarted()).rejects.toThrow('not managed by the gateway');
  });

  it('close() tears down the sidecar', async () => {
    let closed = false;
    const sup = createServeSupervisor({
      port: 4096, external: false, killPort: () => {},
      spawn: async () => ({ url: 'http://x', close: () => { closed = true; } }),
      probe: async () => true, probeIntervalMs: 1, probeTimeoutMs: 50,
    });
    await sup.ensureStarted();
    sup.close();
    expect(closed).toBe(true);
  });

  it('owned property reflects external flag', () => {
    expect(createServeSupervisor(makeDeps().deps).owned).toBe(true);
    expect(createServeSupervisor(makeDeps({ external: true }).deps).owned).toBe(false);
  });
});
