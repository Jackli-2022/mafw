/**
 * E1-5 会话目录严格化（spec §E1-5 / A8）。
 *
 * 缺陷：`POST /api/session` 缺 directory 时静默用 gateway 的 resolvedProjectDir
 * 兜底；worktree 分支还会 `path.resolve(opts.directory ?? '.')`。违反 AGENTS
 * 硬不变量「SessionCreateOpts.directory 必填绝对路径」，且让调用方无从发现漏传。
 *
 * 契约：directory 缺失 / 非绝对路径 → 400 {error:'directory must be an absolute
 * path'}；绝对路径 → 正常创建；worktree 分支不再回退 '.'。
 *
 * grep 结论（2026-11-11，见 batch2-report）：仓库内 HTTP 创建入口里唯一漏传的是
 * desktop renderer 的 `sessions.create()`（同一提交内改为传当前项目）；
 * gateway scripts / desktop worktree 入口 / mobile createTopicSession 都传绝对路径。
 */
import * as path from 'path';
import * as http from 'http';
import { handleSessionCreate, type SessionCreateDeps } from '../../../src/routes/session-create';

function makeRes(): { res: http.ServerResponse; out: { status: number; body: any } } {
  const out = { status: 0, body: null as any };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ? JSON.parse(body) : null; },
  } as unknown as http.ServerResponse;
  return { res, out };
}

function makeReq(body: unknown): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method: 'POST',
    url: '/api/session',
    on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); },
  };
  setImmediate(() => {
    for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

function makeDeps() {
  const created: Array<{ directory?: string; metadata?: Record<string, unknown> }> = [];
  // Never fall through to the real git manager: even on the RED (unvalidated)
  // path the fake must not create a worktree next to the gateway checkout.
  const managerFactory = jest.fn(() => ({
    create: async () => ({ worktreeDir: path.resolve(__dirname, 'fake-wt'), branch: 'mafw/fake' }),
    remove: async () => {},
  }));
  const deps: SessionCreateDeps = {
    kvGet: () => undefined,
    kvSet: () => {},
    kvDel: () => {},
    createSession: (directory, metadata) => {
      created.push({ directory, metadata });
      return Promise.resolve({ id: `sess-${created.length}` });
    },
    managerFactory: managerFactory as any,
    worktreeAvailability: () => ({ supported: true }),
  };
  return { deps, created, managerFactory };
}

const ABS = path.resolve(__dirname, 'strict-project');

describe('POST /api/session 目录严格化（E1-5）', () => {
  it('缺 directory → 400，且不创建会话', async () => {
    const { deps, created } = makeDeps();
    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({}), res, deps);
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ error: 'directory must be an absolute path' });
    expect(created).toHaveLength(0);
  });

  it('相对路径 → 400，且不创建会话', async () => {
    const { deps, created } = makeDeps();
    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: 'relative/child' }), res, deps);
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ error: 'directory must be an absolute path' });
    expect(created).toHaveLength(0);
  });

  it('非字符串 directory → 400', async () => {
    const { deps, created } = makeDeps();
    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: 42 }), res, deps);
    expect(out.status).toBe(400);
    expect(created).toHaveLength(0);
  });

  it('绝对路径 → 200，directory 原样传给 runtime', async () => {
    const { deps, created } = makeDeps();
    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: ABS, metadata: { title: 't' } }), res, deps);
    expect(out.status).toBe(200);
    expect(created).toEqual([{ directory: ABS, metadata: { title: 't' } }]);
  });

  it('worktree 缺 directory → 400，不回退 "."，不建 worktree/会话', async () => {
    const { deps, created, managerFactory } = makeDeps();
    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ worktree: true }), res, deps);
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ error: 'directory must be an absolute path' });
    expect(managerFactory).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('worktree 相对路径 → 400，不回退 "."', async () => {
    const { deps, created, managerFactory } = makeDeps();
    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: '.', worktree: 'fix' }), res, deps);
    expect(out.status).toBe(400);
    expect(managerFactory).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});
