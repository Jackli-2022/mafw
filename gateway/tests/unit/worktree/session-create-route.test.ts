// POST /api/session 的生产 worktree 门：真实文件系统 + git 探测
// （`probeGitWorktreeSupport` + `resolveWorktreeAvailability` + 409 映射）。
// 覆盖 review 要求的三条路径：
//   (a) 非 git 目录 → 409 missing-data，且不创建任何东西；
//   (b) git 目录 + session.worktree 可用 → 正常创建 worktree + 会话 + kv；
//   (c) session.worktree 不可用 → 409 unsupported，创建前短路。
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { handleSessionCreate, type SessionCreateDeps } from '../../../src/routes/session-create';
import {
  probeGitWorktreeSupport,
  resolveWorktreeAvailability,
} from '../../../src/core/worktree/worktree-availability';
import { tmpGitRepo } from './tmp-git';

function tmpPlainDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-session-create-nogit-'));
}

function makeRes(): { res: http.ServerResponse; out: { status: number; body: any } } {
  const out = { status: 0, body: null as any };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ? JSON.parse(body) : null; },
  } as unknown as http.ServerResponse;
  return { res, out };
}

function makeReq(body: any): http.IncomingMessage {
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

/** 与 index.ts 相同的生产组合：真实 git 探测 + 纯函数判定。 */
function makeDeps(opts: { directorySupported: boolean }) {
  const kv = new Map<string, any>();
  const created: Array<{ id: string; directory?: string }> = [];
  const deps: SessionCreateDeps = {
    kvGet: (key, id) => kv.get(`${key}/${id}`),
    kvSet: (key, id, v) => { kv.set(`${key}/${id}`, v); },
    kvDel: (key, id) => { kv.delete(`${key}/${id}`); },
    createSession: (directory) => {
      const id = `sess-${created.length + 1}`;
      created.push({ id, directory });
      return Promise.resolve({ id });
    },
    worktreeAvailability: async (directory) => resolveWorktreeAvailability({
      directory,
      directorySupported: opts.directorySupported,
      gitAvailable: await probeGitWorktreeSupport(directory),
    }),
  };
  return { deps, kv, created };
}

describe('POST /api/session worktree availability (production path)', () => {
  test('(a) non-git directory → 409 missing-data before creating session/kv', async () => {
    const dir = tmpPlainDir();
    const { deps, kv, created } = makeDeps({ directorySupported: true });
    expect(await probeGitWorktreeSupport(dir)).toBe(false);

    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: dir, worktree: true }), res, deps);

    expect(out.status).toBe(409);
    expect(out.body).toEqual({ error: 'worktree sessions are not available', reason: 'missing-data' });
    expect(created).toHaveLength(0);
    expect([...kv.keys()]).toEqual([]);
  });

  test('(a2) non-git directory still creates a plain (non-worktree) session', async () => {
    const dir = tmpPlainDir();
    const { deps, created, kv } = makeDeps({ directorySupported: true });

    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: dir }), res, deps);

    expect(out.status).toBe(200);
    expect(out.body.worktree).toBeUndefined();
    expect(created).toEqual([{ id: 'sess-1', directory: dir }]);
    expect([...kv.keys()]).toEqual([]);
  });

  test('(b) git directory + session.worktree available → creates worktree, session and kv', async () => {
    const repo = tmpGitRepo();
    const { deps, kv, created } = makeDeps({ directorySupported: true });
    expect(await probeGitWorktreeSupport(repo)).toBe(true);

    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: repo, worktree: 'review-fix' }), res, deps);

    expect(out.status).toBe(200);
    expect(out.body.id).toBe('sess-1');
    expect(out.body.worktree.branch).toBe('mafw/review-fix');
    expect(created[0].directory).toContain('-wt-review-fix');
    expect(fs.existsSync(created[0].directory!)).toBe(true);
    expect(kv.get('session-worktree/sess-1')).toMatchObject({
      dir: created[0].directory,
      branch: 'mafw/review-fix',
      projectDir: path.resolve(repo),
    });
  });

  test('(c) session.worktree unavailable → 409 unsupported before creating anything', async () => {
    const repo = tmpGitRepo();
    const { deps, kv, created } = makeDeps({ directorySupported: false });

    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: repo, worktree: true }), res, deps);

    expect(out.status).toBe(409);
    expect(out.body).toEqual({ error: 'worktree sessions are not available', reason: 'unsupported' });
    expect(created).toHaveLength(0);
    expect([...kv.keys()]).toEqual([]);
    // 没有产生分支（创建前短路）
    expect(execSync('git branch --list mafw/*', { cwd: repo }).toString()).toBe('');
  });
});
