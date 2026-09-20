// GET/POST/DELETE /api/approvals/rules — 持久规则 CRUD（deps 注入可单测）。
import { handleRulesGet, handleRulesPost, handleRulesDelete, RulesRouteDeps } from '../../../src/routes/rules';
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
  const rules: any[] = [];
  const deps: RulesRouteDeps = {
    store: {
      list: () => rules.map((r) => ({ ...r })),
      add: (r) => { rules.push(r); return { ok: true, rules: rules.map((x) => ({ ...x })) }; },
      remove: (r) => {
        const idx = rules.findIndex((x) => x.tool === r.tool && (x.pattern ?? '') === (r.pattern ?? ''));
        if (idx < 0) return { ok: false, rules };
        rules.splice(idx, 1);
        return { ok: true, rules };
      },
    },
  };
  return { deps, rules };
}

describe('rules routes', () => {
  it('GET → entries', async () => {
    const { deps } = makeDeps();
    deps.store.add({ tool: 'bash', pattern: 'git status', action: 'allow' });
    const res = makeRes();
    await handleRulesGet(res, deps);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body).entries).toEqual([{ tool: 'bash', pattern: 'git status', action: 'allow' }]);
  });

  it('POST tool+pattern → add', async () => {
    const { deps } = makeDeps();
    const res = makeRes();
    await handleRulesPost(makeReq({ tool: 'bash', pattern: 'git status' }), res, deps);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body).success).toBe(true);
    expect(deps.store.list()).toEqual([{ tool: 'bash', pattern: 'git status', action: 'allow' }]);
  });

  it('POST tool only → tool-level rule', async () => {
    const { deps } = makeDeps();
    const res = makeRes();
    await handleRulesPost(makeReq({ tool: 'read' }), res, deps);
    expect(deps.store.list()).toEqual([{ tool: 'read', action: 'allow' }]);
  });

  it('POST 缺 tool → 400', async () => {
    const { deps } = makeDeps();
    const res = makeRes();
    await handleRulesPost(makeReq({ pattern: 'x' }), res, deps);
    expect(res.statusCode).toBe(400);
  });

  it('DELETE 命中 → 200；未命中 → 404', async () => {
    const { deps } = makeDeps();
    deps.store.add({ tool: 'read', action: 'allow' });
    const res = makeRes();
    await handleRulesDelete(makeReq({ tool: 'bash', pattern: 'nope' }), res, deps);
    expect(res.statusCode).toBe(404);
    await handleRulesDelete(makeReq({ tool: 'read' }), res, deps);
    expect(res.statusCode).toBe(200);
    expect(deps.store.list()).toEqual([]);
  });
});
