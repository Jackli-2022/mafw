// Task 5：路由能力门统一走 RuntimeAccess surface（设计 §7.1 / §11）。
//
// 断言两件事：
//   1. 每个 gated route 只认 surface，不看裸 capabilities 或方法存在性；
//   2. 缺 surface 的 503 文案中性，不泄漏 runtime 名或 capability flag。
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { Readable } from 'node:stream';
import { handleSessionDiff, handleSessionDiffRevert } from '../../../src/routes/session-diff';
import { handleSessionSummarize } from '../../../src/routes/session-summarize';
import { handleSessionMutations } from '../../../src/routes/session-mutations';
import { handleSessionSwitch } from '../../../src/routes/session-switch';
import { handleRestartAgent } from '../../../src/routes/restart-agent';
import { handlePermissionReply, handlePermissionReplyById } from '../../../src/routes/permission';
import { resolveWorktreeAvailability } from '../../../src/core/worktree/worktree-availability';

const RUNTIME_NAME = 'secret-runtime-name';

interface ResOut { status: number; body: any }

function makeRes(): { res: http.ServerResponse; out: ResOut } {
  const out: ResOut = { status: 0, body: null };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ? JSON.parse(body) : null; },
  } as unknown as http.ServerResponse;
  return { res, out };
}

/** `on('data')/on('end')` 形态（permission/mutations/summarize 的 readBody）。 */
function makeReq(method: string, body?: any, url = '/'): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = { method, url, on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); } };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

/** `for await` 形态（session-switch 的 readJson）。 */
function makeStreamReq(body: any): http.IncomingMessage {
  return Object.assign(Readable.from([JSON.stringify(body)]), {
    method: 'POST',
    url: '/api/sessions/s1/agent',
  }) as unknown as http.IncomingMessage;
}

function accessAllowing(allowed: readonly string[]): { can(id: string): boolean } {
  return { can: (id: string) => allowed.includes(id) };
}

function accessDenying(denied: string): { can(id: string): boolean } {
  return { can: (id: string) => id !== denied };
}

function runtime(over: Record<string, any> = {}): any {
  return {
    name: RUNTIME_NAME,
    capabilities: {},
    session: {
      diff: async () => [],
      get: async () => ({ directory: '/tmp/proj' }),
      summarize: async () => ({}),
      delete: async () => {},
      update: async () => ({}),
      switchAgent: async () => {},
      switchModel: async () => {},
      permissionReply: async () => true,
      permissionList: async () => [],
    },
    agentProcess: { restart: async () => {} },
    ...over,
  };
}

function expectNeutral503(out: ResOut, surface: string): void {
  expect(out.status).toBe(503);
  expect(out.body.error).toBe(`runtime does not support ${surface}`);
  expect(out.body.error).not.toContain(RUNTIME_NAME);
}

describe('route surface gates', () => {
  it('session diff uses the branch.diff surface, not capabilities.diffApi', async () => {
    const { res, out } = makeRes();
    await handleSessionDiff(res, 's1', undefined, {
      runtime: runtime({ capabilities: { diffApi: true } }),
      access: accessDenying('branch.diff') as any,
    });
    expectNeutral503(out, 'branch.diff');
  });

  it('session diff revert is gated on branch.diff', async () => {
    const { res, out } = makeRes();
    await handleSessionDiffRevert(
      makeReq('POST', { patches: [{ file: 'x', patch: '@@ -1 +1 @@\n-a\n+b', hunkIndices: [0] }] }),
      res,
      's1',
      { runtime: runtime({ capabilities: { diffApi: true } }), access: accessDenying('branch.diff') as any },
    );
    expectNeutral503(out, 'branch.diff');
  });

  it('session summarize is gated on session.summarize', async () => {
    const { res, out } = makeRes();
    await handleSessionSummarize(makeReq('POST', {}), res, '/api/session/s1/summarize', {
      getRuntime: () => runtime(),
      getAccess: () => accessDenying('session.summarize') as any,
    });
    expectNeutral503(out, 'session.summarize');
  });

  it('session delete is gated on session.delete', async () => {
    const { res, out } = makeRes();
    const handled = await handleSessionMutations(makeReq('DELETE', undefined, '/api/sessions/s1'), res, {
      getRuntime: () => runtime(),
      getAccess: () => accessDenying('session.delete') as any,
    });
    expect(handled).toBe(true);
    expectNeutral503(out, 'session.delete');
  });

  it('session rename is gated on session.update (not on method presence)', async () => {
    const { res, out } = makeRes();
    await handleSessionMutations(makeReq('PATCH', { title: 'x' }, '/api/sessions/s1'), res, {
      getRuntime: () => runtime(),
      getAccess: () => accessDenying('session.update') as any,
    });
    expectNeutral503(out, 'session.update');
  });

  it('session agent/model switch is gated on its own surfaces', async () => {
    for (const [kind, surface] of [['agent', 'session.switchAgent'], ['model', 'session.switchModel']] as const) {
      const { res, out } = makeRes();
      await handleSessionSwitch(makeStreamReq(kind === 'agent' ? { agent: 'plan' } : { model: { providerID: 'p', modelID: 'm' } }),
        res, 's1', kind, {
          getRuntime: () => runtime(),
          getAccess: () => accessDenying(surface) as any,
        });
      expectNeutral503(out, surface);
    }
  });

  it('agent process restart is gated on process.restart', async () => {
    const { res, out } = makeRes();
    await handleRestartAgent(makeReq('POST'), res, {
      getAccess: () => accessDenying('process.restart') as any,
      isRecovering: () => false,
      isSwitching: () => false,
      begin: () => {},
      end: () => {},
      restartAgent: async () => ({ mode: 'owned-respawn' }),
    });
    expectNeutral503(out, 'process.restart');
  });

  it('permission reply is gated on both entry routes', async () => {
    const rt = runtime({ capabilities: { nativeApprovals: true } });

    const legacy = makeRes();
    await handlePermissionReply(rt, makeReq('POST', { reply: 'once' }), legacy.res, 's1', 'r1', {
      access: accessDenying('approval.permissionReply') as any,
    });
    expectNeutral503(legacy.out, 'approval.permissionReply');

    const direct = makeRes();
    await handlePermissionReplyById(makeReq('POST', { reply: 'once' }), direct.res, 'r1', {
      runtime: rt,
      access: accessDenying('approval.permissionReply') as any,
      rules: { add: () => ({ ok: true }) },
    });
    expectNeutral503(direct.out, 'approval.permissionReply');
  });
});

describe('worktree availability', () => {
  it('worktree availability comes from git + directory contract', () => {
    expect(
      resolveWorktreeAvailability({ directory: '/repo', directorySupported: true, gitAvailable: true }),
    ).toEqual({ supported: true });
    expect(
      resolveWorktreeAvailability({ directory: '/tmp', directorySupported: true, gitAvailable: false }),
    ).toEqual({ supported: false, reason: 'missing-data' });
  });
});

// 源码守卫：POST /api/session 的 worktree 门必须留在 index.ts 接线里（gateway git +
// session.create({directory}) 契约），且 409 映射留在被抽出的 route 中。防止后续重构
// 把门拆掉或退回 worktreeApi。
describe('POST /api/session worktree gate wiring', () => {
  const SRC = path.resolve(__dirname, '../../../src');
  const indexSrc = fs.readFileSync(path.join(SRC, 'index.ts'), 'utf8');
  const createRouteSrc = fs.readFileSync(path.join(SRC, 'routes', 'session-create.ts'), 'utf8');

  it('index.ts delegates to the gated route with the production availability probe', () => {
    expect(indexSrc).toContain("import { handleSessionCreate } from './routes/session-create';");
    expect(indexSrc).not.toContain("import { createSessionWithWorktree");
    const start = indexSrc.indexOf('await handleSessionCreate(req, res, {');
    expect(start).toBeGreaterThan(-1);
    const call = indexSrc.slice(start, start + 1200);
    expect(call).toContain('worktreeAvailability:');
    expect(call).toContain("access?.can('session.worktree')");
    expect(call).toContain('resolveWorktreeAvailability({');
    expect(call).toContain('probeGitWorktreeSupport(directory)');
  });

  it('the route maps an unavailable worktree to 409 before creating anything', () => {
    expect(createRouteSrc).toContain('createSessionWithWorktree(deps, opts)');
    expect(createRouteSrc).toContain('WorktreeUnavailableError');
    expect(createRouteSrc).toContain(
      "json(res, 409, { error: 'worktree sessions are not available', reason: err.reason })",
    );
  });
});
