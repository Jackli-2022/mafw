import { fullCapabilities, minimalCapabilities } from '../../../src/runtime/contract';

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
    });
  });
});
