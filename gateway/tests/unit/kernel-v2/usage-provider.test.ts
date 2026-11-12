import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import { createUsageCapability } from '../../../src/kernel-v2/providers/usage';
import type { ExternalAdapter, UsageProvider } from '../../../src/usage/types';

function provider(name: string): UsageProvider {
  return {
    name,
    windows: [{ window: 'day', used: 1, limit: 10, unit: 'tokens', pct: 10 }],
    severity: 'low',
  };
}

function adapter(name: string): ExternalAdapter {
  return {
    name,
    async fetch(): Promise<UsageProvider> {
      return provider(name);
    },
  };
}

function registry(): CapabilityRegistry<ExternalAdapter> {
  return new CapabilityRegistry<ExternalAdapter>({
    defaultId: 'opencode',
    capability: 'usage',
    version: '1.0.0',
    revision: 'test',
    plane: 'gateway',
  });
}

describe('Usage capability adapter', () => {
  test('lists one winner per name with package > legacy > builtin', () => {
    const reg = registry();
    reg.register('builtin', { id: 'opencode', value: adapter('builtin') });
    reg.register('legacy', { id: 'opencode', value: adapter('legacy') });
    reg.register('package', { id: 'opencode', value: adapter('package') });
    reg.register('builtin', { id: 'zen', value: adapter('zen') });
    const usage = createUsageCapability(reg);
    expect(usage.adapters().map((item) => item.name)).toEqual(['package', 'zen']);
  });

  test('resolve falls back to the default adapter', () => {
    const reg = registry();
    reg.register('builtin', { id: 'opencode', value: adapter('opencode') });
    const usage = createUsageCapability(reg);
    expect(usage.resolve('missing').name).toBe('opencode');
  });

  test('removing a provider does not throw and leaves other adapters', () => {
    const reg = registry();
    reg.register('builtin', { id: 'opencode', value: adapter('opencode') });
    reg.register('legacy', { id: 'zen', value: adapter('zen') });
    const usage = createUsageCapability(reg);
    reg.replaceTier('legacy', []);
    expect(usage.adapters().map((item) => item.name)).toEqual(['opencode']);
  });

  test('record/replay fixture stays off the network', async () => {
    const reg = registry();
    reg.register('builtin', { id: 'opencode', value: adapter('fixture') });
    const usage = createUsageCapability(reg);
    const fetched = await usage.resolve().fetch();
    expect(fetched?.name).toBe('fixture');
    expect(fetched?.windows[0].used).toBe(1);
  });

  test('scoped adapters use the requested scope', () => {
    const reg = registry();
    const global = { kind: 'global' } as const;
    const project = { kind: 'project', projectId: 'p1' } as const;
    reg.register('builtin', { id: 'opencode', value: adapter('global') }, global);
    reg.register('builtin', { id: 'opencode', value: adapter('project') }, project);
    const usage = createUsageCapability(reg);
    expect(usage.adapters(global)[0].name).toBe('global');
    expect(usage.adapters(project)[0].name).toBe('project');
  });
});
