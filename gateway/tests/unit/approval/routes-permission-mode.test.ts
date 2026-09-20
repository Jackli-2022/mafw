import { handlePermissionModeGet, handlePermissionModeSet, PermissionModeDeps } from '../../../src/routes/permission-mode';
import { ServerResponse, IncomingMessage } from 'http';
import { EventEmitter } from 'events';

function makeRes() {
  const res = new EventEmitter() as any as ServerResponse;
  (res as any).writeHead = (status: number) => { (res as any).statusCode = status; return res; };
  (res as any).end = (body?: any) => { (res as any).body = body; };
  return res as any as ServerResponse & { statusCode: number; body?: string };
}

function makeReq(body: any): IncomingMessage {
  const req = new EventEmitter() as any as IncomingMessage;
  process.nextTick(() => { req.emit('data', JSON.stringify(body)); req.emit('end'); });
  return req;
}

function makeDeps(overrides: Partial<PermissionModeDeps['policy']> = {}): PermissionModeDeps {
  return {
    policy: {
      getMode: async () => 'auto' as const,
      setMode: async () => {},
      getAutoApprovals: () => 7,
      ...overrides,
    },
    budget: 25,
  };
}

describe('GET /api/sessions/:sid/permission-mode', () => {
  it('返回 mode + 计数 + 预算', async () => {
    const res = makeRes();
    await handlePermissionModeGet(res, 's1', makeDeps());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({ mode: 'auto', autoApprovals: 7, budget: 25 });
  });

  it('policy 抛错 → 500', async () => {
    const res = makeRes();
    await handlePermissionModeGet(res, 's1', makeDeps({ getMode: async () => { throw new Error('db down'); } }));
    expect(res.statusCode).toBe(500);
  });
});

describe('POST /api/sessions/:sid/permission-mode', () => {
  it("legacy 'manual' 归一化为 read-only → setMode + 返回", async () => {
    const res = makeRes();
    const setCalls: string[] = [];
    await handlePermissionModeSet(makeReq({ mode: 'manual' }), res, 's1', makeDeps({
      setMode: async (_s, m) => { setCalls.push(m as any); },
    }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body).mode).toBe('read-only');
    expect(setCalls).toEqual(['read-only']);
  });

  it('三档 mode 均接受（read-only / auto / full-access）', async () => {
    for (const mode of ['read-only', 'auto', 'full-access'] as const) {
      const res = makeRes();
      const setCalls: string[] = [];
      await handlePermissionModeSet(makeReq({ mode }), res, 's1', makeDeps({
        setMode: async (_s, m) => { setCalls.push(m as any); },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse((res as any).body).mode).toBe(mode);
      expect(setCalls).toEqual([mode]);
    }
  });

  it('非法 mode → 400', async () => {
    const res = makeRes();
    await handlePermissionModeSet(makeReq({ mode: 'yolo' }), res, 's1', makeDeps());
    expect(res.statusCode).toBe(400);
  });

  it('坏 JSON → 400', async () => {
    const req = new EventEmitter() as any as IncomingMessage;
    const res = makeRes();
    process.nextTick(() => { req.emit('data', '{oops'); req.emit('end'); });
    await handlePermissionModeSet(req, res, 's1', makeDeps());
    expect(res.statusCode).toBe(400);
  });
});
