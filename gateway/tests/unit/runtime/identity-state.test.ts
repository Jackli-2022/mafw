import { IdentityState, withIdentityPrompt, mergeAgentLists } from '../../../src/runtime/identity-state';

describe('IdentityState', () => {
  it('session and turn bindings; clearTurnBindings only clears turn kind', () => {
    const s = new IdentityState();
    s.bind('a', 'manager', 'session');
    s.bind('b', 'manager', 'turn');
    expect(s.get('a')).toEqual({ identity: 'manager', kind: 'session' });
    s.clearTurnBindings('a');
    expect(s.get('a')?.kind).toBe('session');
    s.clearTurnBindings('b');
    expect(s.get('b')).toBeUndefined();
  });

  it('session binding takes precedence over a later turn binding', () => {
    const s = new IdentityState();
    s.bind('a', 'manager', 'session');
    s.bind('a', 'other', 'turn');
    expect(s.get('a')).toEqual({ identity: 'manager', kind: 'session' });
  });

  it('unbind removes any kind', () => {
    const s = new IdentityState();
    s.bind('a', 'manager', 'session');
    s.unbind('a');
    expect(s.get('a')).toBeUndefined();
  });

  it('materialization per (runtime, identity); resetMaterialization clears one runtime', () => {
    const s = new IdentityState();
    expect(s.isMaterialized('opencode', 'manager')).toBe(false);
    s.setMaterialized('opencode', 'manager', true);
    s.setMaterialized('pi', 'manager', true);
    expect(s.isMaterialized('opencode', 'manager')).toBe(true);
    s.resetMaterialization('opencode');
    expect(s.isMaterialized('opencode', 'manager')).toBe(false);
    expect(s.isMaterialized('pi', 'manager')).toBe(true);
  });
});

describe('withIdentityPrompt wrapper', () => {
  const calls: Array<any> = [];
  const base = {
    async promptAsync(o: any) { calls.push(['async', o]); },
    async prompt(o: any) { calls.push(['sync', o]); return { parts: [] }; },
  };

  it('injects agent when bound + materialized + no agent given', async () => {
    calls.length = 0;
    const s = new IdentityState();
    s.bind('sess-1', 'manager', 'session');
    s.setMaterialized('opencode', 'manager', true);
    const w = withIdentityPrompt(base, s, () => 'opencode', (n) => n === 'manager');
    await w.promptAsync({ sessionID: 'sess-1', message: 'hi' } as any);
    expect(calls[0][1].agent).toBe('manager');
  });

  it('strips registry agent name when NOT materialized (unknown-agent guard)', async () => {
    calls.length = 0;
    const s = new IdentityState();
    const w = withIdentityPrompt(base, s, () => 'codex', (n) => n === 'memory-curator');
    await w.promptAsync({ sessionID: 'x', message: 'hi', agent: 'memory-curator' } as any);
    expect(calls[0][1].agent).toBeUndefined();
  });

  it('passes through non-registry agents (build/plan) untouched', async () => {
    calls.length = 0;
    const s = new IdentityState();
    const w = withIdentityPrompt(base, s, () => 'opencode', (n) => n === 'manager');
    await w.promptAsync({ sessionID: 'x', message: 'hi', agent: 'build' } as any);
    expect(calls[0][1].agent).toBe('build');
  });

  it('no agent injection for unbound sessions', async () => {
    calls.length = 0;
    const s = new IdentityState();
    s.setMaterialized('opencode', 'manager', true);
    const w = withIdentityPrompt(base, s, () => 'opencode', (n) => n === 'manager');
    await w.promptAsync({ sessionID: 'other', message: 'hi' } as any);
    expect(calls[0][1].agent).toBeUndefined();
  });

  it('wraps both promptAsync and prompt', async () => {
    calls.length = 0;
    const s = new IdentityState();
    s.bind('sess-1', 'manager', 'session');
    s.setMaterialized('opencode', 'manager', true);
    const w = withIdentityPrompt(base, s, () => 'opencode', (n) => n === 'manager');
    await w.prompt({ sessionID: 'sess-1', message: 'hi' } as any);
    expect(calls[0][0]).toBe('sync');
    expect(calls[0][1].agent).toBe('manager');
  });
});

describe('mergeAgentLists', () => {
  it('registry first with source tag; runtime items tagged; dedupe by name', () => {
    const out = mergeAgentLists(
      [{ name: 'manager', description: '编排', scope: 'primary' }],
      [{ name: 'build', description: 'x' }, { name: 'manager', description: 'stale' }],
    );
    expect(out[0]).toMatchObject({ name: 'manager', source: 'mafw' });
    expect(out.find((a: any) => a.name === 'build')?.source).toBe('runtime');
    expect(out.filter((a: any) => a.name === 'manager')).toHaveLength(1);
  });

  it('tolerates non-array runtime agents', () => {
    const out = mergeAgentLists([{ name: 'manager', description: 'd', scope: 'primary' }], undefined as any);
    expect(out).toHaveLength(1);
  });
});
