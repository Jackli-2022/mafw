import { fullCapabilities, minimalCapabilities, RuntimeCapabilities, CompletionRequest, CompletionResult, SessionPromptOpts } from '../../../src/runtime/contract';

describe('runtime contract capabilities', () => {
  it('fullCapabilities enables every tier except turnBudgetApi (opencode = Tier 2)', () => {
    // turnBudgetApi 例外：opencode 适配器不转发 maxTurns/maxCostUsd（SDK 无对应字段），
    // 预算由 gateway 侧 BudgetGuard 承担——声明 true 会让 attachBudgetGuardForGoal
    // 跳过挂载，goal 预算在默认 runtime 上完全失效。
    expect(fullCapabilities()).toEqual({
      sessionApi: true,
      promptWhileBusy: true,
      eventStream: true,
      nativeApprovals: true,
      providerConfigApi: true,
      perLlmCallTransform: true,
      sessionStorageApi: true,
      agentConfigApi: true,
      agentProcessApi: true,
      completionApi: true,
      sessionBranchApi: true,
      turnBudgetApi: false,
      questionApi: true,
      diffApi: true,
      worktreeApi: true,
    });
  });

  it('minimalCapabilities keeps only the Tier-0 session core', () => {
    expect(minimalCapabilities()).toEqual({
      sessionApi: true,
      promptWhileBusy: true,
      eventStream: false,
      nativeApprovals: false,
      providerConfigApi: false,
      perLlmCallTransform: false,
      sessionStorageApi: false,
      agentConfigApi: false,
      agentProcessApi: false,
      sessionBranchApi: false,
      turnBudgetApi: false,
      questionApi: false,
      diffApi: false,
      worktreeApi: false,
    });
  });

  it('SessionPromptOpts supports delivery and expectReply', () => {
    const opts: SessionPromptOpts = {
      sessionID: 's1',
      delivery: 'steer',
      expectReply: false,
    };
    expect(opts.delivery).toBe('steer');
    expect(opts.expectReply).toBe(false);
  });

  it('CompletionRequest supports responseFormat json_schema', () => {
    const req: CompletionRequest = {
      model: { providerID: 'p', modelID: 'm' },
      user: [{ type: 'text', text: 'q' }],
      responseFormat: { type: 'json_schema', name: 'verdict', schema: { type: 'object' }, strict: true },
    };
    expect(req.responseFormat?.type).toBe('json_schema');
  });

  it('RuntimeCapabilities supports optional sessionBranchApi/turnBudgetApi flags', () => {
    const caps: RuntimeCapabilities = {
      sessionApi: true, promptWhileBusy: true, eventStream: false,
      nativeApprovals: false, providerConfigApi: false, perLlmCallTransform: false,
    };
    expect(caps.sessionBranchApi).toBeUndefined();
    expect(caps.turnBudgetApi).toBeUndefined();
    caps.sessionBranchApi = true;
    caps.turnBudgetApi = true;
    expect(caps.sessionBranchApi).toBe(true);
    expect(caps.turnBudgetApi).toBe(true);
  });

  it('RuntimeCapabilities supports optional completionApi flag', () => {
    const caps: RuntimeCapabilities = {
      sessionApi: true, promptWhileBusy: true, eventStream: false,
      nativeApprovals: false, providerConfigApi: false, perLlmCallTransform: false,
    };
    expect(caps.completionApi).toBeUndefined();
    caps.completionApi = true;
    expect(caps.completionApi).toBe(true);
  });

  it('CompletionRequest accepts text + image user parts and cacheable system blocks', () => {
    const req: CompletionRequest = {
      model: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      system: [{ text: 'sys' }, { text: '# Memory Index', cacheable: true }],
      user: [
        { type: 'text', text: 'q' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      ],
      maxTokens: 4096,
      temperature: 0,
      timeoutMs: 30_000,
    };
    expect(req.system?.[1].cacheable).toBe(true);
    expect(req.user[1].type).toBe('image');
  });

  it('CompletionResult usage is optional', () => {
    const withUsage: CompletionResult = { text: 'ok', usage: { input: 1, cached: 2, output: 3 } };
    const without: CompletionResult = { text: 'ok' };
    expect(withUsage.usage?.cached).toBe(2);
    expect(without.usage).toBeUndefined();
  });
});
