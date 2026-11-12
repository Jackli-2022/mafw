import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';

type Value = string;

const global: { kind: 'global' } = { kind: 'global' };
const p1: { kind: 'project'; projectId: string } = { kind: 'project', projectId: 'p1' };
const p2: { kind: 'project'; projectId: string } = { kind: 'project', projectId: 'p2' };
const s1: { kind: 'session'; projectId: string; sessionId: string } = {
  kind: 'session',
  projectId: 'p1',
  sessionId: 's1',
};

function entry(id: string, value: Value, over: Record<string, unknown> = {}) {
  return { id, value, ...over };
}

describe('CapabilityRegistry scopes and health', () => {
  test('project overrides global and session overrides project', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'tts' });
    reg.register('builtin', entry('tts', 'global'), global);
    reg.register('builtin', entry('tts', 'project'), p1);
    reg.register('builtin', entry('tts', 'session'), s1);
    expect(reg.resolve('tts', global)).toBe('global');
    expect(reg.resolve('tts', p1)).toBe('project');
    expect(reg.resolve('tts', s1)).toBe('session');
  });

  test('scopes do not leak across projects or sessions', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'tts' });
    reg.register('builtin', entry('tts', 'global'), global);
    reg.register('builtin', entry('tts', 'p1'), p1);
    reg.register('builtin', entry('tts', 'p2'), p2);
    expect(reg.resolve('tts', p2)).toBe('p2');
    expect(reg.resolve('tts', p1)).toBe('p1');
    expect(reg.resolve('tts', { kind: 'session', projectId: 'p2', sessionId: 's2' })).toBe('p2');
  });

  test('resolveBest uses priority and is deterministic', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'tts' });
    reg.register('builtin', entry('low', 'low', { priority: 1 }), global);
    reg.register('builtin', entry('high', 'high', { priority: 10 }), global);
    reg.register('builtin', entry('same-a', 'same-a', { priority: 5 }), global);
    reg.register('builtin', entry('same-b', 'same-b', { priority: 5 }), global);
    expect(reg.resolveBest(global)).toBe('high');
    expect(reg.resolveBest(global)).toBe('high');
  });

  test('health failure falls back to a lower tier', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'tts' });
    reg.register('builtin', entry('tts', 'healthy'), global);
    reg.register('package', entry('tts', 'failed', { health: () => 'failed' }), global);
    expect(reg.resolve('tts', global)).toBe('healthy');
  });

  test('diagnostics report provider state and capability metadata', () => {
    const reg = new CapabilityRegistry<Value>({
      defaultId: 'tts',
      capability: 'tts',
      version: '1.0.0',
      revision: 'boot-1:1',
      plane: 'gateway',
    });
    reg.register('builtin', entry('healthy', 'ok'), global);
    reg.register('package', entry('failed', 'bad', { health: () => 'failed' }), global);
    const diagnostics = reg.diagnostics();
    expect(diagnostics.find((item) => item.providerId === 'healthy')?.state).toBe('active');
    expect(diagnostics.find((item) => item.providerId === 'failed')?.state).toBe('failed');
    expect(diagnostics[0].capability).toBe('tts');
    expect(diagnostics[0].revision).toBe('boot-1:1');
  });

  test('cache invalidates on register and explicit invalidate', () => {
    let health: 'healthy' | 'failed' = 'healthy';
    const reg = new CapabilityRegistry<Value>({ defaultId: 'tts' });
    reg.register('builtin', entry('tts', 'healthy'), global);
    reg.register('package', entry('tts', 'package', { health: () => health }), global);
    expect(reg.resolve('tts', global)).toBe('package');
    health = 'failed';
    expect(reg.resolve('tts', global)).toBe('package'); // cached
    reg.invalidate();
    expect(reg.resolve('tts', global)).toBe('healthy');
  });

  test('list(scope) returns the visible winner per id with its scope', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'a' });
    reg.register('builtin', entry('a', 'global-a'), global);
    reg.register('builtin', entry('b', 'global-b'), global);
    reg.register('builtin', entry('a', 'project-a'), p1);
    expect(reg.list(p1)).toEqual([
      { id: 'a', value: 'project-a', tier: 'builtin', scope: p1 },
      { id: 'b', value: 'global-b', tier: 'builtin', scope: global },
    ]);
  });

  test('replaceTier is scoped', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'a' });
    reg.register('builtin', entry('a', 'global-a'), global);
    reg.register('legacy', entry('a', 'project-legacy'), p1);
    reg.replaceTier('legacy', [entry('a', 'project-new')], p1);
    expect(reg.resolve('a', p1)).toBe('project-new');
    expect(reg.resolve('a', global)).toBe('global-a');
  });
});
