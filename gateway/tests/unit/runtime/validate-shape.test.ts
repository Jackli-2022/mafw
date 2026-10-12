/**
 * validateRuntime —— runtime 插件返回值"声明 vs 实现"一致性校验（分严重级）。
 *
 * hard：契约必选面缺失（session 全套 / providerConfigApi 三件套 / eventStream 的
 *   global.event）→ 调用方回退内置 runtime。
 * downgraded：声明了能力位但缺对应可选实现 → 能力位被强制降级（写回拷贝，
 *   不改插件共享的 capabilities 对象），功能 503 门控而非运行时炸。
 * warnings：非阻断缺口（session.update / healthCheck / turnBudgetApi 信任声明）。
 */
import { validateRuntime } from '../../../src/runtime/validate';
import { minimalCapabilities } from '../../../src/runtime/contract';

const FULL_SESSION = () => ({
  create: async () => ({}),
  promptAsync: async () => undefined,
  prompt: async () => ({}),
  messages: async () => ({ data: [] }),
  get: async () => ({}),
  delete: async () => undefined,
  abort: async () => undefined,
  list: async () => [],
  todo: async () => [],
  children: async () => [],
  summarize: async () => ({}),
  update: async () => ({}),
});

const OK_RT = (over: any = {}) => {
  const { caps, session, ...rest } = over;
  return {
    name: 'rt',
    capabilities: { ...minimalCapabilities(), ...caps },
    session: { ...FULL_SESSION(), ...session },
    global: { event: async function* () {} },
    getBaseUrl: () => 'http://127.0.0.1:4096',
    healthCheck: async () => true,
    ...rest,
  };
};

describe('validateRuntime — hard violations', () => {
  it('complete runtime passes clean', () => {
    const v = validateRuntime(OK_RT() as any, 'x');
    expect(v.hard).toEqual([]);
    expect(v.downgraded).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it('non-object -> single hard issue', () => {
    const v = validateRuntime(null as any, 'x');
    expect(v.hard).toHaveLength(1);
    expect(v.hard[0]).toMatch(/must be an object/i);
  });

  it('missing name -> hard issue', () => {
    const rt = OK_RT(); delete (rt as any).name;
    expect(validateRuntime(rt as any, 'x').hard[0]).toMatch(/name/i);
  });

  it('declares sessionApi but session missing -> hard issue', () => {
    const rt = OK_RT(); delete (rt as any).session;
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.hard.some((i) => i.includes('sessionApi') && i.includes('session is missing'))).toBe(true);
  });

  it.each(['create', 'promptAsync', 'prompt', 'messages', 'get', 'delete', 'abort', 'list', 'todo', 'children', 'summarize'])(
    'sessionApi declared but session.%s missing -> hard issue naming the method',
    (method) => {
      const rt = OK_RT(); delete (rt as any).session[method];
      const v = validateRuntime(rt as any, 'my-rt');
      expect(v.hard.some((i) => i.includes(`session.${method}`))).toBe(true);
    },
  );

  it('declares eventStream but global.event missing -> hard issue', () => {
    const rt = OK_RT({ caps: { eventStream: true } }); delete (rt as any).global;
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.hard.some((i) => i.includes('eventStream') && i.includes('global.event'))).toBe(true);
  });

  it('declares providerConfigApi but provider.list missing -> hard issue', () => {
    const rt = OK_RT({ caps: { providerConfigApi: true } });
    expect(validateRuntime(rt as any, 'my-rt').hard.some((i) => i.includes('provider.list'))).toBe(true);
  });

  it('declares providerConfigApi but app.agents missing -> hard issue', () => {
    const rt = OK_RT({ caps: { providerConfigApi: true }, provider: { list: async () => ({}) } });
    expect(validateRuntime(rt as any, 'my-rt').hard.some((i) => i.includes('app.agents'))).toBe(true);
  });

  it('declares providerConfigApi but config.update missing -> hard issue', () => {
    const rt = OK_RT({
      caps: { providerConfigApi: true },
      provider: { list: async () => ({}) },
      app: { agents: async () => [] },
      config: { get: async () => ({}) },
    });
    expect(validateRuntime(rt as any, 'my-rt').hard.some((i) => i.includes('config.update'))).toBe(true);
  });

  it('issues carry source name for diagnosis', () => {
    const rt = OK_RT(); delete (rt as any).session;
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.hard.every((i) => i.includes('my-rt'))).toBe(true);
  });
});

describe('validateRuntime — capability downgrade (declared bit, missing implementation)', () => {
  it('nativeApprovals without session.permissionReply -> downgraded to false', () => {
    const rt = OK_RT({ caps: { nativeApprovals: true } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.hard).toEqual([]);
    expect(v.downgraded.some((i) => i.includes('nativeApprovals') && i.includes('permissionReply'))).toBe(true);
    expect((rt as any).capabilities.nativeApprovals).toBe(false);
  });

  it('questionApi without session.question.{list,reply,reject} -> downgraded', () => {
    const rt = OK_RT({ caps: { questionApi: true } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.downgraded.some((i) => i.includes('questionApi'))).toBe(true);
    expect((rt as any).capabilities.questionApi).toBe(false);
  });

  it('sessionBranchApi without fork -> downgraded', () => {
    const rt = OK_RT({ caps: { sessionBranchApi: true }, session: { revert: async () => {} } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.downgraded.some((i) => i.includes('sessionBranchApi'))).toBe(true);
    expect((rt as any).capabilities.sessionBranchApi).toBe(false);
  });

  it('sessionBranchApi with fork+revert but no unrevert -> NOT downgraded (unrevert optional)', () => {
    const rt = OK_RT({ caps: { sessionBranchApi: true }, session: { fork: async () => ({}), revert: async () => {} } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.downgraded).toEqual([]);
    expect((rt as any).capabilities.sessionBranchApi).toBe(true);
  });

  it('diffApi without session.vcs.apply -> downgraded', () => {
    const rt = OK_RT({ caps: { diffApi: true }, session: { diff: async () => [] } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.downgraded.some((i) => i.includes('diffApi'))).toBe(true);
    expect((rt as any).capabilities.diffApi).toBe(false);
  });

  it('completionApi without completion.complete -> downgraded', () => {
    const rt = OK_RT({ caps: { completionApi: true } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.downgraded.some((i) => i.includes('completionApi'))).toBe(true);
    expect((rt as any).capabilities.completionApi).toBe(false);
  });

  it('agentConfigApi without agents.install -> downgraded', () => {
    const rt = OK_RT({ caps: { agentConfigApi: true } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.downgraded.some((i) => i.includes('agentConfigApi'))).toBe(true);
    expect((rt as any).capabilities.agentConfigApi).toBe(false);
  });

  it('agentProcessApi without agentProcess.restart -> downgraded', () => {
    const rt = OK_RT({ caps: { agentProcessApi: true } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.downgraded.some((i) => i.includes('agentProcessApi'))).toBe(true);
    expect((rt as any).capabilities.agentProcessApi).toBe(false);
  });

  it('sessionStorageApi without session.listByDirectory -> downgraded', () => {
    const rt = OK_RT({ caps: { sessionStorageApi: true } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.downgraded.some((i) => i.includes('sessionStorageApi'))).toBe(true);
    expect((rt as any).capabilities.sessionStorageApi).toBe(false);
  });

  it('fully-implemented declared capabilities survive untouched', () => {
    const rt = OK_RT({
      caps: {
        nativeApprovals: true, questionApi: true, sessionBranchApi: true, diffApi: true,
        completionApi: true, agentConfigApi: true, agentProcessApi: true, sessionStorageApi: true,
      },
      session: {
        permissionReply: async () => true,
        permissionList: async () => [],
        question: { list: async () => [], reply: async () => {}, reject: async () => {} },
        fork: async () => ({}), revert: async () => {}, unrevert: async () => {},
        diff: async () => [], vcs: { diff: async () => [], apply: async () => {} },
        listByDirectory: async () => [],
      },
      completion: { complete: async () => ({ text: '' }) },
      agents: { install: async () => {} },
      agentProcess: { restart: async () => {} },
    });
    const before = JSON.stringify((rt as any).capabilities);
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.downgraded).toEqual([]);
    expect(JSON.stringify((rt as any).capabilities)).toBe(before);
  });
});

describe('validateRuntime — warnings (non-blocking)', () => {
  it('sessionApi without optional session.update -> warning (rename would fail)', () => {
    const rt = OK_RT(); delete (rt as any).session.update;
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.hard).toEqual([]);
    expect(v.warnings.some((i) => i.includes('session.update'))).toBe(true);
  });

  it('missing healthCheck -> warning (runtime treated as unhealthy)', () => {
    const rt = OK_RT(); delete (rt as any).healthCheck;
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.warnings.some((i) => i.includes('healthCheck'))).toBe(true);
  });

  it('missing getBaseUrl -> warning', () => {
    const rt = OK_RT(); delete (rt as any).getBaseUrl;
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.warnings.some((i) => i.includes('getBaseUrl'))).toBe(true);
  });

  it('nativeApprovals with permissionReply but no permissionList -> warning', () => {
    const rt = OK_RT({ caps: { nativeApprovals: true }, session: { permissionReply: async () => true } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.downgraded).toEqual([]);
    expect(v.warnings.some((i) => i.includes('permissionList'))).toBe(true);
  });

  it('turnBudgetApi true -> trust warning (BudgetGuard will not be attached)', () => {
    const rt = OK_RT({ caps: { turnBudgetApi: true } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.warnings.some((i) => i.includes('turnBudgetApi') && i.includes('BudgetGuard'))).toBe(true);
  });
});
