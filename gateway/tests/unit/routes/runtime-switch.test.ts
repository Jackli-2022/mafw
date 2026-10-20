import * as http from 'http';
import { handleRuntimeSwitch } from '../../../src/routes/runtime-switch';

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
  return {
    loader: {
      get: (n: string) => (n === 'opencode'
        ? { createRuntime: async () => ({ name: 'opencode', capabilities: {} }) }
        : undefined),
      getState: () => [{ name: 'opencode' }],
    },
    persist: () => ({ changed: [] }),
    getCurrent: () => null,
    runtimeName: () => 'pi',
    runtimeCaps: () => ({}),
    envOverride: () => false,
    createRuntime: async () => ({ name: 'opencode', capabilities: {} }),
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
