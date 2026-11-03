import * as http from 'http';
import { handleRuntimeSwitch, performRuntimeSwitch } from '../../../src/routes/runtime-switch';

function fakeRes() {
  const res: any = { statusCode: 0, body: '' as any };
  res.writeHead = (c: number) => { res.statusCode = c; return res; };
  res.end = (b?: string) => { res.body = b ? JSON.parse(b) : ''; return res; };
  return res;
}

function fakeReq(body: any) {
  return {
    on(ev: string, cb: (d?: string) => void) {
      if (ev === 'data') cb(JSON.stringify(body));
      if (ev === 'end') cb();
      return this;
    },
  } as any;
}

function makeDeps() {
  // 组合根诊断视图：createRuntime 成功后 runtimeName/runtimeCaps 指向新 runtime。
  const state = { name: 'pi', caps: {} as any };
  return {
    loader: {
      get: (n: string) => (n === 'opencode'
        ? { createRuntime: async () => ({ name: 'opencode', capabilities: {} }) }
        : undefined),
      getState: () => [{ name: 'opencode' }],
    },
    persist: () => ({ changed: [] }),
    getCurrent: () => null,
    runtimeName: () => state.name,
    runtimeCaps: () => state.caps,
    envOverride: () => false,
    createRuntime: async () => { state.name = 'opencode'; return { name: 'opencode', capabilities: {} }; },
    onSwitched: async () => {},
  } as any;
}

describe('POST /api/runtime/switch（D 收敛：opencode 走 loader 校验路径，特判已删）', () => {
  test('switch 到 opencode 经 loader.get 命中 → 200 正常切换', async () => {
    const res = fakeRes();
    await handleRuntimeSwitch(fakeReq({ plugin: 'opencode' }), res, makeDeps());
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.active.name).toBe('opencode');
  });

  test('未注册名 → 400 + available 列表', async () => {
    const res = fakeRes();
    await handleRuntimeSwitch(fakeReq({ plugin: 'ghost' }), res, makeDeps());
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('ghost');
    expect(res.body.available).toEqual(['opencode']);
  });

  test('空 plugin（切回默认）→ 跳过校验直接走 createRuntime', async () => {
    const res = fakeRes();
    await handleRuntimeSwitch(fakeReq({ plugin: '' }), res, makeDeps());
    expect(res.statusCode).toBe(200);
  });
});

/**
 * The apply path (`POST /api/plugins/:name/apply`) reuses this orchestration but
 * must respect the same guard/mutex as the HTTP swap route: `serveRecovering`
 * and a switch already in progress both block, and a silent fallback to builtin
 * opencode must not be reported as a successful switch.
 */
describe('performRuntimeSwitch（共享编排：守卫 + 回退检测）', () => {
  function switchDeps(overrides: Record<string, any> = {}) {
    const state = { name: 'pi', caps: { eventStream: true } as any };
    const calls: string[] = [];
    const known = new Set(['pi', 'opencode', 'broken']);
    const deps: any = {
      loader: {
        get: (n: string) => (known.has(n) ? { createRuntime: async () => ({}) } : undefined),
        getState: () => [...known].map((name) => ({ name })),
      },
      persist: () => { calls.push('persist'); return { changed: [] }; },
      getCurrent: () => null,
      runtimeName: () => state.name,
      runtimeCaps: () => state.caps,
      envOverride: () => false,
      createRuntime: async () => {
        calls.push('createRuntime');
        state.name = 'pi';
        return { name: 'pi', capabilities: {} } as any;
      },
      onSwitched: async () => { calls.push('onSwitched'); },
      ...overrides,
    };
    return { deps: deps as any, state, calls };
  }

  function guard(blocked = false) {
    return { blocked: () => blocked, begin: jest.fn(), end: jest.fn() };
  }

  test('blocked 时不进入切换序列（不 persist、不 createRuntime、不 begin）', async () => {
    const { deps, calls } = switchDeps();
    const g = guard(true);
    const result = await performRuntimeSwitch(deps, 'pi', g);
    expect(result).toMatchObject({ success: false, code: 'blocked' });
    expect((result as any).error).toMatch(/blocked/);
    expect(calls).toEqual([]);
    expect(g.begin).not.toHaveBeenCalled();
    expect(g.end).not.toHaveBeenCalled();
  });

  test('未注册 runtime 名 → not-found，且不进入切换序列', async () => {
    const { deps, calls } = switchDeps();
    const g = guard();
    const result = await performRuntimeSwitch(deps, 'ghost', g);
    expect(result).toMatchObject({ success: false, code: 'not-found' });
    expect((result as any).error).toContain('ghost');
    expect(calls).toEqual([]);
    expect(g.begin).not.toHaveBeenCalled();
  });

  test('成功切换：persist → createRuntime → onSwitched，begin/end 各一次', async () => {
    const { deps, calls, state } = switchDeps();
    const g = guard();
    const result = await performRuntimeSwitch(deps, 'pi', g);
    expect(result).toEqual({ success: true, active: { name: 'pi', capabilities: { eventStream: true } } });
    expect(calls).toEqual(['persist', 'createRuntime', 'onSwitched']);
    expect(state.name).toBe('pi');
    expect(g.begin).toHaveBeenCalledTimes(1);
    expect(g.end).toHaveBeenCalledTimes(1);
  });

  test('createRuntime 抛错 → failed，guard.end 仍执行', async () => {
    const { deps } = switchDeps({ createRuntime: async () => { throw new Error('offline'); } });
    const g = guard();
    const result = await performRuntimeSwitch(deps, 'pi', g);
    expect(result).toMatchObject({ success: false, code: 'failed', error: 'offline' });
    expect(g.begin).toHaveBeenCalledTimes(1);
    expect(g.end).toHaveBeenCalledTimes(1);
  });

  test('createRuntime 静默回退到 opencode → failed（不谎报 applied）', async () => {
    const { deps, state } = switchDeps({
      createRuntime: async () => { state.name = 'opencode'; return { name: 'opencode', capabilities: {} } as any; },
    });
    const result = await performRuntimeSwitch(deps, 'broken');
    expect(result.success).toBe(false);
    expect((result as any).code).toBe('failed');
    expect((result as any).error).toContain('broken');
    expect((result as any).error).toContain('opencode');
    expect((result as any).active).toEqual({ name: 'opencode', capabilities: { eventStream: true } });
  });

  test('空 plugin（切回默认）不做名字回退检测', async () => {
    const { deps, state } = switchDeps({
      createRuntime: async () => { state.name = 'opencode'; return { name: 'opencode', capabilities: {} } as any; },
    });
    const result = await performRuntimeSwitch(deps, '');
    expect(result.success).toBe(true);
    expect((result as any).active.name).toBe('opencode');
  });

  test('钉死方言名（opencode@v2）不算回退：门面身份是裸 runtime 名', async () => {
    const { deps, state } = switchDeps({
      loader: {
        get: (n: string) => (n === 'opencode@v2' ? { createRuntime: async () => ({}) } : undefined),
        getState: () => [{ name: 'opencode@v2' }],
      },
      createRuntime: async () => { state.name = 'opencode'; return { name: 'opencode', capabilities: {} } as any; },
    });
    const result = await performRuntimeSwitch(deps, 'opencode@v2');
    expect(result.success).toBe(true);
    expect((result as any).active.name).toBe('opencode');
  });

  test('文件包 stem 别名（foo.js 声明 name=bar）切换成功不算回退', async () => {
    const { deps, state } = switchDeps({
      loader: {
        get: (n: string) => (n === 'foo' || n === 'bar' ? { createRuntime: async () => ({}) } : undefined),
        getState: () => [{ name: 'bar', alias: 'foo' }],
      },
      createRuntime: async () => { state.name = 'bar'; return { name: 'bar', capabilities: {} } as any; },
    });
    const result = await performRuntimeSwitch(deps, 'foo');
    expect(result.success).toBe(true);
    expect((result as any).active.name).toBe('bar');
  });
});
