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
  it('ensureStarted probes the port first; unhealthy -> kills stale, spawns, waits for health', async () => {
    // adopt 语义（bb62abdc）：健康监听者直接收养，绝不 killPort——只有 probe 失败
    // 才走 kill stale + spawn 路径。mock：首次 probe（adopt 检查）失败。
    const { calls, deps } = makeDeps({
      probe: async () => { calls.push('probe'); return calls.filter((c) => c === 'probe').length > 1; },
    });
    const sup = createServeSupervisor(deps);
    const url = await sup.ensureStarted();
    expect(url).toBe('http://127.0.0.1:4096');
    expect(calls).toEqual(['probe', 'kill', 'spawn', 'probe']);
  });

  it('ensureStarted adopts a healthy listener without kill/spawn', async () => {
    const { calls, deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    const url = await sup.ensureStarted();
    expect(url).toBe('http://127.0.0.1:4096');
    expect(calls).toEqual(['probe']); // adopt：无 kill/spawn
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

  it('close() tears down a spawned sidecar (adopted listeners are left alone)', async () => {
    let closed = false;
    let probes = 0;
    const sup = createServeSupervisor({
      port: 4096, external: false, killPort: () => {},
      spawn: async () => ({ url: 'http://x', close: () => { closed = true; } }),
      // 首次 probe（adopt 检查）失败 → 走 spawn；此后健康（health 轮询）
      probe: async () => { probes++; return probes > 1; },
      probeIntervalMs: 1, probeTimeoutMs: 50,
    });
    await sup.ensureStarted();
    sup.close();
    expect(closed).toBe(true);
  });

  it('close() does not kill an adopted listener', async () => {
    let closed = false;
    const sup = createServeSupervisor({
      port: 4096, external: false, killPort: () => {},
      spawn: async () => ({ url: 'http://x', close: () => { closed = true; } }),
      probe: async () => true, probeIntervalMs: 1, probeTimeoutMs: 50,
    });
    await sup.ensureStarted(); // adopt：instance.close 是 no-op
    sup.close();
    expect(closed).toBe(false);
  });

  it('owned property reflects external flag', () => {
    expect(createServeSupervisor(makeDeps().deps).owned).toBe(true);
    expect(createServeSupervisor(makeDeps({ external: true }).deps).owned).toBe(false);
  });
});
