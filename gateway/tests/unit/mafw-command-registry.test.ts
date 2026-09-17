import { MafwCommandRegistry, BUILTIN_COMMAND_DEFS } from '../../src/commands/registry';

describe('MafwCommandRegistry', () => {
  test('register + resolve by name', () => {
    const r = new MafwCommandRegistry();
    const handler = async () => ({ ok: true });
    r.register({ name: 'btw', description: '支线问答', category: 'session', kind: 'builtin' }, handler);
    expect(r.resolve('btw')?.handler).toBe(handler);
  });

  test('resolve by alias returns canonical def', () => {
    const r = new MafwCommandRegistry();
    r.register({ name: 'new-topic', aliases: ['new'], description: '新话题', category: 'session', kind: 'builtin' }, async () => ({ ok: true }));
    expect(r.resolve('new')?.def.name).toBe('new-topic');
  });

  test('resolve unknown returns null', () => {
    expect(new MafwCommandRegistry().resolve('nope')).toBeNull();
  });

  test('list returns defs without handlers, aliases included', () => {
    const r = new MafwCommandRegistry();
    r.register({ name: 'a', aliases: ['b'], description: 'd', category: 'session', kind: 'builtin' }, async () => ({ ok: true }));
    const list = r.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'a', aliases: ['b'] });
    expect((list[0] as any).handler).toBeUndefined();
  });

  test('re-register same name overwrites (custom reload)', () => {
    const r = new MafwCommandRegistry();
    r.register({ name: 'x', description: 'v1', category: 'custom', kind: 'custom' }, async () => ({ ok: true, message: 'v1' }));
    r.register({ name: 'x', description: 'v2', category: 'custom', kind: 'custom' }, async () => ({ ok: true, message: 'v2' }));
    expect(r.list()[0].description).toBe('v2');
  });

  test('unregister removes name and aliases', () => {
    const r = new MafwCommandRegistry();
    r.register({ name: 'x', aliases: ['y'], description: 'd', category: 'custom', kind: 'custom' }, async () => ({ ok: true }));
    r.unregister('x');
    expect(r.resolve('x')).toBeNull();
    expect(r.resolve('y')).toBeNull();
  });

  test('BUILTIN_COMMAND_DEFS covers the 6 legacy commands with metadata', () => {
    const names = BUILTIN_COMMAND_DEFS.map((d) => d.name).sort();
    expect(names).toEqual(['btw', 'goal', 'merge-memory', 'new-topic', 'status', 'waitwhat']);
    const nt = BUILTIN_COMMAND_DEFS.find((d) => d.name === 'new-topic');
    expect(nt?.aliases).toContain('new');
    const btw = BUILTIN_COMMAND_DEFS.find((d) => d.name === 'btw');
    expect(btw?.argumentHint).toBe('<问题>');
    const mm = BUILTIN_COMMAND_DEFS.find((d) => d.name === 'merge-memory');
    expect(mm?.argumentHint).toBe('<worktree路径> [strategy]');
    for (const d of BUILTIN_COMMAND_DEFS) expect(d.kind).toBe('builtin');
  });
});
