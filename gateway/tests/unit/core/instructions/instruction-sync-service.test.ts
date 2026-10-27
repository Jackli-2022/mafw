import { InstructionSyncService } from '../../../../src/core/instructions/instruction-sync-service';
import { INSTRUCTION_KEYS, InstructionBlocks } from '../../../../src/recall/instruction-blocks';

function blocks(over: Partial<InstructionBlocks> = {}): InstructionBlocks {
  return {
    memoryGuide: '<memory-guide>G</memory-guide>',
    userProfile: '<user-profile>P</user-profile>',
    agentPriors: '<agent-priors>A</agent-priors>',
    revision: 'r1',
    ...over,
  };
}

function makeRt(store = new Map<string, unknown>(), over: any = {}) {
  const calls: string[] = [];
  const instructions = {
    list: jest.fn(async (_sid: string, _opts?: any) => {
      calls.push('list');
      return [...store].map(([key, value]) => ({ key, value }));
    }),
    put: jest.fn(async (_sid: string, key: string, value: unknown, _opts?: any) => {
      calls.push('put:' + key);
      store.set(key, value);
    }),
    remove: jest.fn(async (_sid: string, key: string, _opts?: any) => {
      calls.push('remove:' + key);
      store.delete(key);
    }),
    ...over,
  };
  const rt: any = {
    name: 'opencode',
    activeDialect: 'v21',
    capabilities: { instructionsApi: true },
    session: { instructions },
  };
  return { rt, calls, store, instructions };
}

function makeSvc(rt: any, over: any = {}) {
  let now = 1000;
  const rendered = jest.fn(async () => blocks());
  const svc = new InstructionSyncService({
    render: rendered,
    getRuntime: () => rt,
    isEnabled: () => true,
    now: () => now,
    log: { info: jest.fn(), warn: jest.fn() },
    ...over,
  });
  return { svc, rendered, advance: (ms: number) => { now += ms; } };
}

describe('InstructionSyncService.sync', () => {
  it('first sync puts all three; second sync makes no writes', async () => {
    const { rt, calls } = makeRt();
    const { svc } = makeSvc(rt);
    expect(await svc.sync('s1')).toEqual({ managed: true, revision: 'r1' });
    expect(calls).toEqual([
      'list',
      `put:${INSTRUCTION_KEYS.memoryGuide}`,
      `put:${INSTRUCTION_KEYS.userProfile}`,
      `put:${INSTRUCTION_KEYS.agentPriors}`,
    ]);
    calls.length = 0;
    expect(await svc.sync('s1')).toEqual({ managed: true, revision: 'r1' });
    expect(calls).toEqual([]);
  });

  it('changed profile only puts profile', async () => {
    const { rt, calls } = makeRt();
    const { svc, rendered } = makeSvc(rt);
    await svc.sync('s1');
    calls.length = 0;
    rendered.mockResolvedValue(blocks({ userProfile: '<user-profile>P2</user-profile>', revision: 'r2' }));
    expect(await svc.sync('s1')).toEqual({ managed: true, revision: 'r2' });
    expect(calls).toEqual([`put:${INSTRUCTION_KEYS.userProfile}`]);
  });

  it('null profile and priors delete their entries', async () => {
    const { rt, calls, store } = makeRt();
    const { svc, rendered } = makeSvc(rt);
    await svc.sync('s1');
    calls.length = 0;
    rendered.mockResolvedValue(blocks({ userProfile: null, agentPriors: null, revision: 'r2' }));
    await svc.sync('s1');
    expect(calls.sort()).toEqual([
      `remove:${INSTRUCTION_KEYS.agentPriors}`,
      `remove:${INSTRUCTION_KEYS.userProfile}`,
    ].sort());
    expect(store.has(INSTRUCTION_KEYS.userProfile)).toBe(false);
    expect(store.has(INSTRUCTION_KEYS.agentPriors)).toBe(false);
  });

  it('render error keeps the old entry and does not delete it', async () => {
    const { rt, calls, store } = makeRt(new Map([[INSTRUCTION_KEYS.userProfile, '<user-profile>OLD</user-profile>']]));
    const { svc, rendered } = makeSvc(rt);
    rendered.mockResolvedValue(blocks({
      userProfile: null,
      errors: { userProfile: 'disk' },
      revision: 'r2',
    }));
    await svc.sync('s1');
    expect(calls).not.toContain(`put:${INSTRUCTION_KEYS.userProfile}`);
    expect(calls).not.toContain(`remove:${INSTRUCTION_KEYS.userProfile}`);
    expect(store.get(INSTRUCTION_KEYS.userProfile)).toBe('<user-profile>OLD</user-profile>');
  });

  it('seeds from list and avoids redundant puts when values already match', async () => {
    const store = new Map<string, unknown>([
      [INSTRUCTION_KEYS.memoryGuide, blocks().memoryGuide],
      [INSTRUCTION_KEYS.userProfile, blocks().userProfile],
      [INSTRUCTION_KEYS.agentPriors, blocks().agentPriors],
    ]);
    const { rt, calls } = makeRt(store);
    const { svc } = makeSvc(rt);
    expect(await svc.sync('s1')).toEqual({ managed: true, revision: 'r1' });
    expect(calls).toEqual(['list']);
  });

  it('aborts the whole sync on timeout, returns unmanaged, and retries next time', async () => {
    const store = new Map<string, unknown>();
    const { rt, calls } = makeRt(store, {
      put: jest.fn(async (_sid: string, _key: string, _value: unknown, opts?: any) => {
        await new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }),
    });
    const { svc } = makeSvc(rt, { syncTimeoutMs: 20 });
    const r = await svc.sync('s1');
    expect(r.managed).toBe(false);
    expect(r.error).toBe('timeout');
    calls.length = 0;
    const r2 = await svc.sync('s1');
    expect(r2.managed).toBe(false);
    expect(calls[0]).toBe('list');
  });

  it('single-flights concurrent syncs for one session', async () => {
    const { rt, instructions } = makeRt();
    const { svc } = makeSvc(rt);
    const [a, b] = await Promise.all([svc.sync('s1'), svc.sync('s1')]);
    expect(a.managed).toBe(true);
    expect(b.managed).toBe(true);
    expect(instructions.list).toHaveBeenCalledTimes(1);
  });

  it('opens a 60s breaker on 404 and retries after the cooldown', async () => {
    let fail = true;
    const store = new Map<string, unknown>();
    const { rt } = makeRt(store, {
      put: jest.fn(async (_sid: string, key: string, value: unknown) => {
        if (fail) {
          fail = false;
          throw Object.assign(new Error('404'), { status: 404 });
        }
        store.set(key, value);
      }),
    });
    const { svc, advance } = makeSvc(rt);
    expect((await svc.sync('s1')).managed).toBe(false);
    advance(61_000);
    expect((await svc.sync('s1')).managed).toBe(true);
  });

  it('reset clears the breaker', async () => {
    const { rt } = makeRt(new Map(), {
      put: jest.fn(async () => { throw Object.assign(new Error('404'), { status: 404 }); }),
    });
    const { svc } = makeSvc(rt);
    expect((await svc.sync('s1')).managed).toBe(false);
    svc.reset();
    // Still failing, but the call reaches the adapter again rather than short-circuiting.
    const listSpy = rt.session.instructions.list as jest.Mock;
    const before = listSpy.mock.calls.length;
    await svc.sync('s1');
    expect(listSpy.mock.calls.length).toBe(before + 1);
  });

  it('enabled=false removes the three keys and does not render/put', async () => {
    const { rt, calls } = makeRt(new Map([
      [INSTRUCTION_KEYS.memoryGuide, 'g'],
      [INSTRUCTION_KEYS.userProfile, 'p'],
      [INSTRUCTION_KEYS.agentPriors, 'a'],
    ]));
    const { svc, rendered } = makeSvc(rt, { isEnabled: () => false });
    const r = await svc.sync('s1');
    expect(r).toEqual({ managed: false, error: 'disabled' });
    expect(rendered).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.startsWith('remove:'))).toHaveLength(3);
    expect(calls.some((c) => c.startsWith('put:'))).toBe(false);
  });

  it('truncates a block that exceeds maxBlockBytes', async () => {
    const { rt, store } = makeRt();
    const { svc, rendered } = makeSvc(rt, { maxBlockBytes: 10 });
    rendered.mockResolvedValue(blocks({ memoryGuide: 'x'.repeat(50) }));
    await svc.sync('s1');
    expect(String(store.get(INSTRUCTION_KEYS.memoryGuide)).length).toBeLessThanOrEqual(10);
  });

  it('expires a session cache after 24h and re-lists', async () => {
    const { rt, instructions } = makeRt();
    const { svc, advance } = makeSvc(rt);
    await svc.sync('s1');
    const before = (instructions.list as jest.Mock).mock.calls.length;
    advance(24 * 60 * 60 * 1000 + 1);
    await svc.sync('s1');
    expect((instructions.list as jest.Mock).mock.calls.length).toBe(before + 1);
  });

  it('caps the session cache and evicts the oldest', async () => {
    const { rt, instructions } = makeRt();
    const { svc } = makeSvc(rt, { maxSessions: 2 });
    await svc.sync('s1');
    await svc.sync('s2');
    await svc.sync('s3');
    const before = (instructions.list as jest.Mock).mock.calls.length;
    await svc.sync('s1');
    expect((instructions.list as jest.Mock).mock.calls.length).toBe(before + 1);
  });

  it('does not gate on the lagging event dialect when the capability is declared', async () => {
    const { rt, calls } = makeRt();
    rt.activeDialect = 'v1'; // gateway restart probe fail-safe; serve is still 2.1
    const { svc } = makeSvc(rt);
    expect((await svc.sync('s1')).managed).toBe(true);
    expect(calls[0]).toBe('list');
  });
});

describe('InstructionSyncService.inspect', () => {
  it('all desired entries present -> managed true', async () => {
    const store = new Map<string, unknown>([
      [INSTRUCTION_KEYS.memoryGuide, blocks().memoryGuide],
      [INSTRUCTION_KEYS.userProfile, blocks().userProfile],
      [INSTRUCTION_KEYS.agentPriors, blocks().agentPriors],
    ]);
    const { rt } = makeRt(store);
    const { svc } = makeSvc(rt);
    expect(await svc.inspect('s1', blocks())).toEqual({ managed: true, missing: [], staleKeys: [] });
  });

  it('missing profile -> managed false and only that key missing', async () => {
    const store = new Map<string, unknown>([
      [INSTRUCTION_KEYS.memoryGuide, blocks().memoryGuide],
      [INSTRUCTION_KEYS.agentPriors, blocks().agentPriors],
    ]);
    const { rt } = makeRt(store);
    const { svc } = makeSvc(rt);
    expect(await svc.inspect('s1', blocks())).toEqual({
      managed: false,
      missing: [INSTRUCTION_KEYS.userProfile],
      staleKeys: [],
    });
  });

  it('stale profile -> managed true with staleKeys (no fallback injection)', async () => {
    const store = new Map<string, unknown>([
      [INSTRUCTION_KEYS.memoryGuide, blocks().memoryGuide],
      [INSTRUCTION_KEYS.userProfile, '<user-profile>OLD</user-profile>'],
      [INSTRUCTION_KEYS.agentPriors, blocks().agentPriors],
    ]);
    const { rt } = makeRt(store);
    const { svc } = makeSvc(rt);
    expect(await svc.inspect('s1', blocks())).toEqual({
      managed: true,
      missing: [],
      staleKeys: [INSTRUCTION_KEYS.userProfile],
    });
  });

  it('capability absent -> unmanaged, all keys missing', async () => {
    const { rt } = makeRt(new Map());
    rt.capabilities.instructionsApi = false;
    const { svc } = makeSvc(rt);
    const r = await svc.inspect('s1', blocks());
    expect(r.managed).toBe(false);
    expect(r.missing).toEqual([
      INSTRUCTION_KEYS.memoryGuide, INSTRUCTION_KEYS.userProfile, INSTRUCTION_KEYS.agentPriors,
    ]);
    expect(r.reason).toBe('capability_absent');
  });

  it('list failure -> unmanaged with all keys missing', async () => {
    const { rt } = makeRt(new Map(), { list: jest.fn(async () => { throw new Error('serve down'); }) });
    const { svc } = makeSvc(rt);
    const r = await svc.inspect('s1', blocks());
    expect(r.managed).toBe(false);
    expect(r.reason).toBe('list_failed');
    expect(r.missing).toHaveLength(3);
  });

  it('breaker active -> reason breaker', async () => {
    const { rt } = makeRt(new Map(), {
      put: jest.fn(async () => { throw Object.assign(new Error('405'), { status: 405 }); }),
    });
    const { svc } = makeSvc(rt);
    await svc.sync('s1');
    const r = await svc.inspect('s1', blocks());
    expect(r.managed).toBe(false);
    expect(r.reason).toBe('breaker');
  });

  it('disabled config -> reason disabled', async () => {
    const { rt } = makeRt(new Map());
    const { svc } = makeSvc(rt, { isEnabled: () => false });
    const r = await svc.inspect('s1', blocks());
    expect(r.managed).toBe(false);
    expect(r.reason).toBe('disabled');
    expect(r.missing).toHaveLength(3);
  });
});
