import { createPluginCredentials } from '../../../src/runtime/plugin-credentials';

describe('createPluginCredentials', () => {
  it('snapshots the active host credentials instead of reading them lazily', () => {
    const active = { getApiKey: (provider: string) => `active:${provider}` };
    const creds = createPluginCredentials(active);

    // Simulate adoption: the live host now points at the plugin credentials
    // object. A lazy lookup would recurse; the snapshot must stay finite.
    const liveHost = { credentials: creds };
    expect(liveHost.credentials.getApiKey('gateway')).toBe('active:gateway');
  });

  it('does not read adapter auth.json when the activating runtime has no credentials', () => {
    // Phase 4 W4: auth.json is adapter-owned; the gateway's factory context only
    // sees the active host snapshot.
    expect(createPluginCredentials(undefined).getApiKey('xiaomi')).toBeNull();
  });
});
