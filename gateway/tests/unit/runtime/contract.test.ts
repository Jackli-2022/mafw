import { fullCapabilities, minimalCapabilities, RuntimeCapabilities, CompletionRequest, CompletionResult } from '../../../src/runtime/contract';

describe('runtime contract capabilities', () => {
  it('fullCapabilities enables every tier (opencode = Tier 2)', () => {
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
    });
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
