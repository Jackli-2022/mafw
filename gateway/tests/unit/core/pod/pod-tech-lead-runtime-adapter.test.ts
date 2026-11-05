/**
 * P0-4: Tech Lead runtime adapter — 建会话后按 resolveNodeModel 绑定模型
 * （config.goal.techLeadModel 覆盖优先，身份内置兜底；半空对不半用），
 * switchModel 失败 fail-open（会话照常返回）。
 */
import { createTechLeadRuntimeAdapter } from '../../../../src/core/pod/pod-tech-lead-runtime-adapter';

const IDENTITY = { providerID: 'gateway', modelID: 'volcengine/deepseek-v4.1-flash' };

function makeDeps(overrides: Record<string, any> = {}) {
  const createSession = jest.fn(async () => ({ id: 'ses_1' }));
  const switchModel = jest.fn(async () => undefined);
  const deps = {
    createSession,
    switchModel,
    promptAsync: jest.fn(async () => undefined),
    messages: jest.fn(async () => ({ data: [] })),
    identityModel: IDENTITY,
    configModel: null,
    ...overrides,
  };
  return { deps, createSession, switchModel };
}

describe('createTechLeadRuntimeAdapter (P0-4)', () => {
  it('binds the configured model when config is a complete pair', async () => {
    const config = { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' };
    const { deps, switchModel } = makeDeps({ configModel: config });
    const runtime = createTechLeadRuntimeAdapter(deps);

    const id = await runtime.createSession({ projectDir: '/proj', goalId: 'g1', revision: 1 });

    expect(id).toBe('ses_1');
    expect(switchModel).toHaveBeenCalledWith({ sessionID: 'ses_1', model: config });
  });

  it('falls back to the identity model for empty or half-configured pairs', async () => {
    for (const configModel of [null, { providerID: 'x', modelID: '' }, { providerID: '', modelID: 'y' }]) {
      const { deps, switchModel } = makeDeps({ configModel });
      const runtime = createTechLeadRuntimeAdapter(deps);
      await runtime.createSession({ projectDir: '/proj', goalId: 'g1', revision: 1 });
      expect(switchModel).toHaveBeenCalledWith({ sessionID: 'ses_1', model: IDENTITY });
    }
  });

  it('fail-open: session is returned even when switchModel rejects', async () => {
    const { deps } = makeDeps({
      configModel: { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' },
      switchModel: jest.fn(async () => { throw new Error('provider down'); }),
    });
    const runtime = createTechLeadRuntimeAdapter(deps);

    await expect(runtime.createSession({ projectDir: '/proj', goalId: 'g1', revision: 1 })).resolves.toBe('ses_1');
  });
});
