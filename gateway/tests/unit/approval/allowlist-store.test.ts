import { AllowlistStore, parseEntry } from '../../../src/core/approval/allowlist-store';

function makeStore(initial: unknown = []) {
  let raw: unknown = initial;
  const persisted: any[] = [];
  const store = new AllowlistStore({
    readRawAllowlist: () => raw,
    persist: (o) => { persisted.push(o); raw = (o as any).approval.allowlist; return { changed: ['approval'] }; },
  });
  return { store, persisted, getRaw: () => raw };
}

describe('parseEntry', () => {
  it('裸工具名', () => {
    expect(parseEntry('read')).toEqual({ tool: 'read' });
  });
  it('tool:prefix（尾部 * 剥离）', () => {
    expect(parseEntry('bash:git status*')).toEqual({ tool: 'bash', prefix: 'git status' });
  });
  it('空/无效 → null', () => {
    expect(parseEntry('')).toBeNull();
    expect(parseEntry(':x')).toBeNull();
  });
});

describe('AllowlistStore', () => {
  it('list 解析条目并过滤无效', () => {
    const { store } = makeStore(['read', 'bash:git status', '', 'ls']);
    expect(store.list()).toEqual([
      { tool: 'read' }, { tool: 'bash', prefix: 'git status' }, { tool: 'ls' },
    ]);
  });

  it('add 去重 + 持久化（整组替换数组）', () => {
    const { store, persisted } = makeStore(['read']);
    const r1 = store.add({ tool: 'bash', prefix: 'git status' });
    expect(r1.ok).toBe(true);
    expect(persisted[0]).toEqual({ approval: { allowlist: ['read', 'bash:git status'] } });
    const r2 = store.add({ tool: 'bash', prefix: 'git status' }); // 重复
    expect(r2.ok).toBe(true);
    expect(persisted.length).toBe(1); // 未再写
  });

  it('add 无效 tool → ok:false 不写', () => {
    const { store, persisted } = makeStore([]);
    expect(store.add({ tool: '' } as any).ok).toBe(false);
    expect(persisted.length).toBe(0);
  });

  it('remove 未命中 → ok:false；命中 → 移除', () => {
    const { store } = makeStore(['read', 'bash:git status']);
    expect(store.remove({ tool: 'edit' }).ok).toBe(false);
    expect(store.remove({ tool: 'bash', prefix: 'git status' }).ok).toBe(true);
    expect(store.list()).toEqual([{ tool: 'read' }]);
  });

  it('matches：裸工具名 = 整工具；prefix = 命令前缀或 pattern 前缀', () => {
    const { store } = makeStore(['read', 'bash:git status']);
    expect(store.matches('read', { toolName: 'read', patterns: [] })).toBe(true);
    expect(store.matches('bash', { toolName: 'bash', patterns: [], metadata: { args: { command: 'git status --porcelain' } } })).toBe(true);
    expect(store.matches('bash', { toolName: 'bash', patterns: ['git status*'] })).toBe(true);
    expect(store.matches('bash', { toolName: 'bash', patterns: ['npm test'] })).toBe(false);
    expect(store.matches('edit', { toolName: 'edit', patterns: ['a.ts'] })).toBe(false);
  });

  it('matches 大小写不敏感', () => {
    const { store } = makeStore(['Read']);
    expect(store.matches('read', { toolName: 'read', patterns: [] })).toBe(true);
  });
});
