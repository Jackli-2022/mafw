import { createServeSupervisor } from '../../src/runtime/serve-supervisor';

/**
 * serve 监督契约（runtime 归属重构）：gateway 只做启停编排——
 * 健康检测经 runtime 契约（health()），URL 归 runtime（baseUrl()），
 * kill/spawn 都是 runtime 原语；gateway 不传 host/port。
 * managed 为 late-bound 函数：runtime 可热切换（opencode↔pi），判定必须每次现读。
 */
function makeDeps(overrides: any = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      managed: () => true,
      health: async () => { calls.push('health'); return true; },
      baseUrl: () => 'http://127.0.0.1:4096',
      killServe: () => { calls.push('kill'); },
      spawn: async (opts?: any) => {
        calls.push(`spawn${opts && ('port' in opts) ? ':with-port!' : ''}`);
        return { url: 'http://127.0.0.1:4096', close: () => {} };
      },
      probeIntervalMs: 1,
      probeTimeoutMs: 50,
      ...overrides,
    },
  };
}

describe('serve supervisor (runtime-contract wiring)', () => {
  it('ensureStarted: unhealthy runtime -> killServe + spawn (no host/port from gateway) + wait health', async () => {
    const { calls, deps } = makeDeps({
      // adopt 检查（第1次）失败 → kill+spawn → 轮询第3次起健康
      health: async () => { calls.push('health'); return calls.filter(c => c === 'health').length > 2; },
    });
    const sup = createServeSupervisor(deps);
    const url = await sup.ensureStarted();
    expect(url).toBe('http://127.0.0.1:4096'); // runtime 报告的地址，不是 gateway 构造的
    expect(calls).toEqual(['health', 'kill', 'spawn', 'health', 'health']);
    expect(calls.some(c => c.includes('with-port!'))).toBe(false); // gateway 不传端口
  });

  it('ensureStarted adopts a healthy runtime without kill/spawn', async () => {
    const { calls, deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    const url = await sup.ensureStarted();
    expect(url).toBe('http://127.0.0.1:4096');
    expect(calls).toEqual(['health']); // adopt：无 kill/spawn
  });

  it('ensureStarted is idempotent while healthy', async () => {
    const { calls, deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    await sup.ensureStarted();
    calls.length = 0;
    const url = await sup.ensureStarted();
    expect(url).toBe('http://127.0.0.1:4096');
    expect(calls).toEqual(['health']); // no second kill/spawn
  });

  it('restart always kills and respawns via runtime primitives', async () => {
    const { calls, deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    await sup.ensureStarted();
    calls.length = 0;
    await sup.restart();
    expect(calls.filter(c => c === 'kill')).toHaveLength(1);
    expect(calls.filter(c => c.startsWith('spawn'))).toHaveLength(1);
  });

  it('health() delegates to the runtime contract', async () => {
    const { calls, deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    expect(await sup.health()).toBe(true);
    expect(calls).toEqual(['health']);
  });

  it('unmanaged runtime (external / in-process) refuses start/stop orchestration', async () => {
    const { deps } = makeDeps({ managed: () => false });
    const sup = createServeSupervisor(deps);
    await expect(sup.restart()).rejects.toThrow('unmanaged runtime: gateway holds no start/stop primitives');
    await expect(sup.ensureStarted()).rejects.toThrow('unmanaged runtime: gateway holds no start/stop primitives');
  });

  it('managed() is re-evaluated per call (late-bound: runtime hot-switch)', async () => {
    let managed = true;
    const { deps } = makeDeps({ managed: () => managed });
    const sup = createServeSupervisor(deps);
    await expect(sup.ensureStarted()).resolves.toBe('http://127.0.0.1:4096');
    managed = false; // 热切到无 spawnServe 原语的 runtime（pi / external）
    await expect(sup.ensureStarted()).rejects.toThrow('unmanaged runtime: gateway holds no start/stop primitives');
  });

  it('close() tears down a spawned sidecar (adopted listeners are left alone)', async () => {
    let closed = false;
    let healthy = false;
    const sup = createServeSupervisor({
      managed: () => true,
      health: async () => healthy,
      baseUrl: () => 'http://x',
      killServe: () => {},
      spawn: async () => ({ url: 'http://x', close: () => { closed = true; } }),
      probeIntervalMs: 1, probeTimeoutMs: 50,
    });
    const p = sup.ensureStarted();
    setTimeout(() => { healthy = true; }, 5);
    await p;
    sup.close();
    expect(closed).toBe(true);
  });

  it('close() does not tear down an adopted healthy runtime', async () => {
    let closed = false;
    const sup = createServeSupervisor({
      managed: () => true,
      health: async () => true,
      baseUrl: () => 'http://x',
      killServe: () => {},
      spawn: async () => ({ url: 'http://x', close: () => { closed = true; } }),
      probeIntervalMs: 1, probeTimeoutMs: 50,
    });
    await sup.ensureStarted(); // adopt：instance.close 是 no-op
    sup.close();
    expect(closed).toBe(false);
  });

  it('owned property reflects the runtime contract (managed flag)', () => {
    expect(createServeSupervisor(makeDeps().deps).owned).toBe(true);
    expect(createServeSupervisor(makeDeps({ managed: () => false }).deps).owned).toBe(false);
  });
});
