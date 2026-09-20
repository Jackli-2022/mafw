// 切片 1：'always' 回复自动沉淀持久规则（无需客户端 persist:true 也落）。
// scope 由 body.persist 控制：'tool'|'prefix'|true（旧行为=prefix 优先）；fail-open。
import { handlePermissionReply } from '../../../src/routes/permission';
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

function makeRuntime() {
  return {
    session: {
      permissionReply: async () => true,
    },
  } as any;
}

function makeRulesDeps() {
  const added: any[] = [];
  return {
    added,
    deps: {
      rules: { add: (r: any) => { added.push(r); return { ok: true, rules: [r] }; } },
      findRequest: async () => ({ permission: 'bash', patterns: ['git status*'] }),
    },
  };
}

describe('handlePermissionReply always → rules', () => {
  it('always 无 persist 参数也落规则（默认 scope=true，prefix 优先）', async () => {
    const { deps, added } = makeRulesDeps();
    const res = makeRes();
    await handlePermissionReply(makeRuntime(), makeReq({ reply: 'always' }), res, 's1', 'r1', deps as any);
    expect(res.statusCode).toBe(200);
    expect(added).toEqual([{ tool: 'bash', pattern: 'git status', action: 'allow' }]);
  });

  it("persist:'tool' → 裸工具名规则", async () => {
    const { deps, added } = makeRulesDeps();
    const res = makeRes();
    await handlePermissionReply(makeRuntime(), makeReq({ reply: 'always', persist: 'tool' }), res, 's1', 'r1', deps as any);
    expect(added).toEqual([{ tool: 'bash', action: 'allow' }]);
  });

  it("persist:'prefix' → 前缀规则", async () => {
    const { deps, added } = makeRulesDeps();
    const res = makeRes();
    await handlePermissionReply(makeRuntime(), makeReq({ reply: 'always', persist: 'prefix' }), res, 's1', 'r1', deps as any);
    expect(added).toEqual([{ tool: 'bash', pattern: 'git status', action: 'allow' }]);
  });

  it("once 不落规则", async () => {
    const { deps, added } = makeRulesDeps();
    const res = makeRes();
    await handlePermissionReply(makeRuntime(), makeReq({ reply: 'once' }), res, 's1', 'r1', deps as any);
    expect(added).toEqual([]);
  });

  it('findRequest 失败 → fail-open 不抛、照常 200', async () => {
    const { deps } = makeRulesDeps();
    (deps as any).findRequest = async () => { throw new Error('list down'); };
    const res = makeRes();
    await handlePermissionReply(makeRuntime(), makeReq({ reply: 'always' }), res, 's1', 'r1', deps as any);
    expect(res.statusCode).toBe(200);
  });
});
