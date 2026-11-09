import { createPluginCredentials } from '../../../src/runtime/plugin-credentials';

jest.mock('../../../src/runtime/auth', () => ({
  getProviderApiKey: jest.fn((provider: string, _authPath?: string, active?: { getApiKey(p: string): string | null }) =>
    active?.getApiKey(provider) ?? `auth:${provider}`),
}));

describe('createPluginCredentials', () => {
  it('snapshots the active host credentials instead of reading them lazily', () => {
    const active = { getApiKey: (provider: string) => `active:${provider}` };
    const creds = createPluginCredentials(active);

    // Simulate adoption: the live host now points at the plugin credentials
    // object. A lazy lookup would recurse; the snapshot must stay finite.
    const liveHost = { credentials: creds };
    expect(liveHost.credentials.getApiKey('gateway')).toBe('active:gateway');
  });

  it('falls back to auth.json when the activating runtime has no credentials', () => {
    expect(createPluginCredentials(undefined).getApiKey('xiaomi')).toBe('auth:xiaomi');
  });
});
