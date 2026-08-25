import { UsagePoller } from '../../../gateway/src/usage/usage-poller';
import { ExternalAdapter } from '../../../gateway/src/usage/types';
import { UsageProvider } from '../../../gateway/src/usage/types';

class MockPluginLoader {
  private adapters: ExternalAdapter[];
  constructor(adapters: ExternalAdapter[]) {
    this.adapters = adapters;
  }
  getAdapters(): ExternalAdapter[] {
    return this.adapters;
  }
  getState() { return []; }
  stop() {}
}

describe('PluginLoader + UsagePoller e2e', () => {
  const mockStore = {
    getDistinctProviders: () => [],
    getProviderTotalCost: () => 0,
    getProviderTotalTokens: () => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }),
  } as any;

  const emptyLimits = () => ({} as any);

  test('plugin provider appears in poller results', async () => {
    const pluginAdapter: ExternalAdapter = {
      name: 'test-plugin',
      async fetch(): Promise<UsageProvider | null> {
        return {
          name: 'test-plugin',
          plan: 'Test',
          windows: [{ window: '5h', used: 5, limit: 10, unit: '$', pct: 50 }],
          severity: 'mid',
        };
      },
    };
    const loader = new MockPluginLoader([pluginAdapter]);
    const poller = new UsagePoller(mockStore, emptyLimits, () => ({}), loader as any);

    const result = await poller.poll();
    console.log('Providers:', result.providers.map(p => p.name));
    const pluginProvider = result.providers.find(p => p.name === 'test-plugin');
    expect(pluginProvider).toBeDefined();
    expect(pluginProvider?.plan).toBe('Test');
    expect(pluginProvider?.windows).toHaveLength(1);
    expect(pluginProvider?.windows[0].pct).toBe(50);
  });

  test('plugin overrides builtin adapter', async () => {
    const pluginAdapter: ExternalAdapter = {
      name: 'deepseek',
      async fetch(): Promise<UsageProvider | null> {
        return {
          name: 'deepseek',
          plan: 'Override',
          windows: [{ window: '5h', used: 1, limit: 10, unit: '$', pct: 10 }],
          severity: 'low',
        };
      },
    };
    const loader = new MockPluginLoader([pluginAdapter]);
    const poller = new UsagePoller(mockStore, emptyLimits, () => ({}), loader as any);

    const result = await poller.poll();
    const providers = result.providers.filter(p => p.name === 'deepseek');
    expect(providers).toHaveLength(1);
    expect(providers[0].plan).toBe('Override');
  });

  test('plugin returning null hides provider', async () => {
    const pluginAdapter: ExternalAdapter = {
      name: 'hidden',
      async fetch(): Promise<UsageProvider | null> {
        return null;
      },
    };
    const loader = new MockPluginLoader([pluginAdapter]);
    const poller = new UsagePoller(mockStore, emptyLimits, () => ({}), loader as any);

    const result = await poller.poll();
    const hidden = result.providers.find(p => p.name === 'hidden');
    expect(hidden).toBeUndefined();
  });

  test('plugin severity computed from pct', async () => {
    const pluginAdapter: ExternalAdapter = {
      name: 'sev-test',
      async fetch(): Promise<UsageProvider | null> {
        return {
          name: 'sev-test',
          plan: 'Sev',
          windows: [{ window: '5h', used: 9, limit: 10, unit: '$', pct: 90 }],
          severity: 'critical',
        };
      },
    };
    const loader = new MockPluginLoader([pluginAdapter]);
    const poller = new UsagePoller(mockStore, emptyLimits, () => ({}), loader as any);

    const result = await poller.poll();
    const provider = result.providers.find(p => p.name === 'sev-test');
    expect(provider?.severity).toBe('critical');
  });
});
