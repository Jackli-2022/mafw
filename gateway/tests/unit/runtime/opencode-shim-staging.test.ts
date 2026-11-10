/**
 * Plan 6 Task 7 (final review hardening): the gateway shim must treat a
 * partially staged `@mafw/adapter-opencode` as unavailable instead of caching a
 * module whose surfaces are `undefined` (activation would then die later with an
 * opaque "x is not a function"). The package is mocked as an empty object here —
 * the same shape a half-copied `dist/` produces at require time.
 */
jest.mock('@mafw/adapter-opencode', () => ({}));

describe('opencode package shim against a partial staging', () => {
  it('fails diagnosably instead of caching an empty module', async () => {
    const shim = await import('../../../src/runtime/opencode-adapter');

    // Static fallbacks keep registration alive for users on another runtime.
    expect(shim.opencodeStaticEntry('adaptive')).toEqual({});
    expect(shim.opencodeCapabilities('adaptive', false).sessionApi).toBe(false);
    expect(shim.readProviderApiKey({}, 'gateway')).toBeNull();
    expect(shim.readProviderTransportFromList([], 'gateway')).toEqual({ baseUrl: null, apiKey: null });
    expect(shim.getProviderApiKey('gateway')).toBeUndefined();

    // Activation surfaces the staging problem instead of degrading silently.
    await expect(
      shim.createOpencodeDefinition(
        {} as any,
        { variant: 'v1', baseUrl: 'http://127.0.0.1:4096', registrationName: 'opencode' },
      ),
    ).rejects.toThrow(/partially staged: missing createOpencodeDefinition\(\)/);
  });
});
