import * as http from 'http';
import { handleToolsList, handleToolsExecute } from '../../../src/routes/tools';

function fakeRes(): { res: http.ServerResponse; status: () => number; body: () => string } {
  const res = {} as unknown as http.ServerResponse;
  let status = 0;
  let payload = '';
  (res as any).writeHead = (s: number) => { status = s; return res; };
  (res as any).end = (b: string) => { payload = b ?? ''; return res; };
  return { res, status: () => status, body: () => payload };
}

function fakeReq(body: any): http.IncomingMessage {
  const req = {} as unknown as http.IncomingMessage;
  const json = JSON.stringify(body);
  (req as any).on = (ev: string, cb: (d?: string) => void) => {
    if (ev === 'data') { if (json) cb(json); }
    if (ev === 'end') cb();
    return req;
  };
  return req;
}

describe('GET /api/tools（spec 清单）', () => {
  it('返回六件套 spec（无 execute）', () => {
    const { res, status, body } = fakeRes();
    handleToolsList(res);
    expect(status()).toBe(200);
    const parsed = JSON.parse(body());
    expect(parsed.tools).toHaveLength(6);
    for (const t of parsed.tools) {
      expect(t.execute).toBeUndefined();
      expect(t.parameters.type).toBe('object');
    }
  });
});

describe('POST /api/tools/execute（通用执行）', () => {
  const deps = {
    buildFactory: () => (sid: string) => [
      { name: 'mafw_echo', description: 'd', parameters: { type: 'object', properties: {} }, execute: async (p: any) => ({ text: `${sid}:${p.x ?? ''}` }) },
    ] as any[],
  };

  it('按名分发 + sessionID 亲和', async () => {
    const { res, status, body } = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'mafw_echo', params: { x: 'v' }, sessionID: 's7' }), res, deps);
    expect(status()).toBe(200);
    expect(JSON.parse(body())).toEqual({ text: 's7:v' });
  });

  it('未知工具 → 404 + available 列表', async () => {
    const { res, status, body } = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'nope', sessionID: 's' }), res, deps);
    expect(status()).toBe(404);
    const parsed = JSON.parse(body());
    expect(parsed.error).toContain('nope');
    expect(parsed.available).toEqual(['mafw_echo']);
  });

  it('缺 name → 400；坏 JSON → 400', async () => {
    const a = fakeRes();
    await handleToolsExecute(fakeReq({ sessionID: 's' }), a.res, deps);
    expect(a.status()).toBe(400);
    const badReq = { on: (ev: string, cb: (d?: string) => void) => { if (ev === 'data') cb('{not json'); if (ev === 'end') cb(); return badReq; } } as any;
    const b = fakeRes();
    await handleToolsExecute(badReq, b.res, deps);
    expect(b.status()).toBe(400);
  });

  it('execute 抛错 → 502', async () => {
    const deps2 = {
      buildFactory: () => () => [
        { name: 'boom', description: 'd', parameters: {}, execute: async () => { throw new Error('kaboom'); } },
      ] as any[],
    };
    const { res, status, body } = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'boom', sessionID: 's' }), res, deps2);
    expect(status()).toBe(502);
    expect(JSON.parse(body()).error).toContain('kaboom');
  });
});
