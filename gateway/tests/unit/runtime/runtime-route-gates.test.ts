// Task 5：路由能力门统一走 RuntimeAccess surface（设计 §7.1 / §11）。
//
// 断言两件事：
//   1. 每个 gated route 只认 surface，不看裸 capabilities 或方法存在性；
//   2. 缺 surface 的 503 文案中性，不泄漏 runtime 名或 capability flag。
import * as http from 'http';
import { Readable } from 'node:stream';
import { handleSessionDiff, handleSessionDiffRevert } from '../../../src/routes/session-diff';
import { handleSessionSummarize } from '../../../src/routes/session-summarize';
import { handleSessionMutations } from '../../../src/routes/session-mutations';
import { handleSessionSwitch } from '../../../src/routes/session-switch';
import { handleRestartAgent } from '../../../src/routes/restart-agent';
import { handlePermissionReply, handlePermissionReplyById } from '../../../src/routes/permission';
import { handleSkillContent } from '../../../src/routes/skill-content';
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

  it('skill content only uses the runtime channel when discovery.loadSkill is available', async () => {
    const loaded: string[] = [];
    const denied = makeRes();
    await handleSkillContent(
      makeReq('GET', undefined, '/api/skill/content?directory=D%3A%5Cp&id=vision-tools'),
      denied.res,
      '/api/skill/content?directory=D%3A%5Cp&id=vision-tools',
      {
        getAccess: () => accessDenying('discovery.loadSkill') as any,
        loadSkill: async (opts) => {
          loaded.push(opts.key);
          return { id: opts.key, name: opts.key, content: 'RUNTIME' };
        },
        listSkills: async () => [{ id: 'vision-tools', location: 'C:/skills/vision-tools/SKILL.md' }],
        readFile: () => 'FALLBACK',
      },
    );
    expect(loaded).toEqual([]);
    expect(denied.out.status).toBe(200);
    expect(denied.out.body.content).toBe('FALLBACK');

    const allowed = makeRes();
    await handleSkillContent(
      makeReq('GET', undefined, '/api/skill/content?directory=D%3A%5Cp&id=vision-tools'),
      allowed.res,
      '/api/skill/content?directory=D%3A%5Cp&id=vision-tools',
      {
        getAccess: () => accessAllowing(['discovery.loadSkill']) as any,
        loadSkill: async (opts) => ({ id: opts.key, name: opts.key, content: 'RUNTIME' }),
        listSkills: async () => [],
        readFile: () => 'FALLBACK',
      },
    );
    expect(allowed.out.body.content).toBe('RUNTIME');
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
