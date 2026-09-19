import { handleAllowlistGet, handleAllowlistPost, handleAllowlistDelete, AllowlistRouteDeps } from '../../../src/routes/allowlist';
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

function makeDeps() {
  const added: any[] = [];
  const removed: any[] = [];
  const deps: AllowlistRouteDeps & { added: any[]; removed: any[] } = {
    store: {
      list: () => [{ tool: 'read' }],
      add: async (e: any) => { added.push(e); return { ok: true, entries: [{ tool: 'read' }, e] }; },
      remove: async (e: any) => { removed.push(e); return { ok: true, entries: [{ tool: 'read' }] }; },
    },
    added,
    removed,
  } as any;
  return deps;
}

describe('allowlist routes', () => {
  it('GET → entries', async () => {
    const res = makeRes();
    await handleAllowlistGet(res, makeDeps());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({ entries: [{ tool: 'read' }] });
  });

  it('POST 合法条目 → success + entries', async () => {
    const res = makeRes();
    const deps = makeDeps();
    await handleAllowlistPost(makeReq({ tool: 'bash', prefix: 'git status' }), res, deps);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body).success).toBe(true);
    expect(deps.added).toEqual([{ tool: 'bash', prefix: 'git status' }]);
  });

  it('POST 缺 tool → 400', async () => {
    const res = makeRes();
    await handleAllowlistPost(makeReq({ prefix: 'x' }), res, makeDeps());
    expect(res.statusCode).toBe(400);
  });

  it('POST 坏 JSON → 400', async () => {
    const req = new EventEmitter() as any as IncomingMessage;
    const res = makeRes();
    process.nextTick(() => { req.emit('data', '{bad'); req.emit('end'); });
    await handleAllowlistPost(req, res, makeDeps());
    expect(res.statusCode).toBe(400);
  });

  it('DELETE 未命中 → 404', async () => {
    const res = makeRes();
    const deps = makeDeps();
    (deps as any).store.remove = async () => ({ ok: false, entries: [] });
    await handleAllowlistDelete(makeReq({ tool: 'edit' }), res, deps);
    expect(res.statusCode).toBe(404);
  });

  it('DELETE 命中 → success + entries', async () => {
    const res = makeRes();
    const deps = makeDeps();
    await handleAllowlistDelete(makeReq({ tool: 'read' }), res, deps);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body).success).toBe(true);
    expect(deps.removed).toEqual([{ tool: 'read' }]);
  });
});
