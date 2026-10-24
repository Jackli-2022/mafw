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
    expect(parsed.tools).toHaveLength(7);
    for (const t of parsed.tools) {
      expect(t.execute).toBeUndefined();
      expect(t.parameters.type).toBe('object');
    }
  });
});

describe('POST /api/tools/execute（通用执行）', () => {
  const makeDeps = (regOver: any = {}) => ({
    buildFactory: () => (sid: string) => [
      { name: 'mafw_echo', description: 'd', parameters: { type: 'object', properties: {} }, execute: regOver.execute ?? (async (p: any) => ({ text: `${sid}:${p.x ?? ''}` })) },
    ] as any[],
    emitEvent: jest.fn(),
  });

  it('按名分发 + sessionID 亲和 + 两帧合成（running→completed，同 part.id）', async () => {
    const deps = makeDeps();
    const { res, status, body } = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'mafw_echo', params: { x: 'v' }, sessionID: 's7' }), res, deps);
    expect(status()).toBe(200);
    expect(JSON.parse(body())).toEqual({ text: 's7:v' });
    expect(deps.emitEvent).toHaveBeenCalledTimes(2);
    const calls = (deps.emitEvent as jest.Mock).mock.calls;
    const f1 = calls[0][0];
    const f2 = calls[1][0];
    expect(f1.type).toBe('part.updated');
    expect(f1.properties.part.state.status).toBe('running');
    expect(f1.properties.sessionID).toBe('s7');
    expect(f1.properties.part.tool).toBe('mafw_echo');
    expect(f1.properties.part.state.input).toEqual({ x: 'v' });
    expect(f2.properties.part.state.status).toBe('completed');
    expect(f2.properties.part.state.output).toBe('s7:v');
    expect(f1.properties.part.id).toBe(f2.properties.part.id);
  });

  it('isError → error 帧；execute 抛错 → 502 + error 帧', async () => {
    const depsErr = makeDeps({ execute: async () => ({ text: 'bad', isError: true }) });
    const a = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'mafw_echo', sessionID: 's' }), a.res, depsErr);
    expect(a.status()).toBe(200);
    const frames = (depsErr.emitEvent as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(frames[1].properties.part.state.status).toBe('error');
    expect(frames[1].properties.part.state.error).toBe('bad');

    const depsThrow = makeDeps({ execute: async () => { throw new Error('kaboom'); } });
    const b = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'mafw_echo', sessionID: 's' }), b.res, depsThrow);
    expect(b.status()).toBe(502);
    const frames2 = (depsThrow.emitEvent as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(frames2[1].properties.part.state.status).toBe('error');
    expect(frames2[1].properties.part.state.error).toContain('kaboom');
  });

  it('未知工具 → 404 + available 列表；缺 name → 400；坏 JSON → 400——全部零帧（D7 无幻影卡片）', async () => {
    const deps = makeDeps();
    const a = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'nope', sessionID: 's' }), a.res, deps);
    expect(a.status()).toBe(404);
    const parsed = JSON.parse(a.body());
    expect(parsed.error).toContain('nope');
    expect(parsed.available).toEqual(['mafw_echo']);
    const b = fakeRes();
    await handleToolsExecute(fakeReq({ sessionID: 's' }), b.res, deps);
    expect(b.status()).toBe(400);
    const badReq = { on: (ev: string, cb: (d?: string) => void) => { if (ev === 'data') cb('{not json'); if (ev === 'end') cb(); return badReq; } } as any;
    const c = fakeRes();
    await handleToolsExecute(badReq, c.res, deps);
    expect(c.status()).toBe(400);
    expect(deps.emitEvent).not.toHaveBeenCalled();
  });
});
