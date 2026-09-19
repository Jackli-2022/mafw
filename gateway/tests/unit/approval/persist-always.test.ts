import { persistAlwaysToAllowlist } from '../../../src/routes/permission';

function makeStore() {
  const added: Array<{ tool: string; prefix?: string }> = [];
  return {
    added,
    store: { add: (e: any) => { added.push(e); return { ok: true, entries: [] }; } },
  };
}

describe('persistAlwaysToAllowlist', () => {
  it('opencode 形状：permission + patterns[0] 去尾部 * 为 prefix', () => {
    const { store, added } = makeStore();
    const r = persistAlwaysToAllowlist(store as any, { permission: 'bash', patterns: ['git status*'] });
    expect(r).toEqual({ tool: 'bash', prefix: 'git status' });
    expect(added).toEqual([{ tool: 'bash', prefix: 'git status' }]);
  });

  it('patterns 空 → 裸工具名', () => {
    const { store, added } = makeStore();
    const r = persistAlwaysToAllowlist(store as any, { permission: 'bash', patterns: [] });
    expect(r).toEqual({ tool: 'bash' });
    expect(added).toEqual([{ tool: 'bash' }]);
  });

  it('pi 形状：toolName 兜底', () => {
    const { store } = makeStore();
    const r = persistAlwaysToAllowlist(store as any, { toolName: 'webfetch', patterns: [] });
    expect(r).toEqual({ tool: 'webfetch' });
  });

  it('tool 全空 → null 不写', () => {
    const { store, added } = makeStore();
    expect(persistAlwaysToAllowlist(store as any, { patterns: ['x'] })).toBeNull();
    expect(added.length).toBe(0);
  });

  it('store.add 抛错 → 不吞（调用方 catch 记 warn）', () => {
    const store = { add: () => { throw new Error('config locked'); } };
    expect(() => persistAlwaysToAllowlist(store as any, { permission: 'bash', patterns: [] })).toThrow('config locked');
  });
});
