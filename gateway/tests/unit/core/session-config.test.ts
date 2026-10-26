import { SessionConfigService } from '../../../src/core/session-config';

function make() {
  const store: Record<string, any> = {};
  const calls: any[] = [];
  const deps: any = {
    load: (sid: string) => store[sid],
    save: (sid: string, state: any) => { store[sid] = state; },
    getMode: async () => 'read-only',
    setMode: async (_sid: string, mode: string) => { calls.push(['mode', mode]); },
    getSession: async () => ({ agent: 'build', model: { providerID: 'p', id: 'm' } }),
    switchAgent: async (_sid: string, agent: string) => { calls.push(['agent', agent]); },
    switchModel: async (_sid: string, model: any, variant?: string) => { calls.push(['model', model, variant]); },
    setThinkingLevel: async (_sid: string, level: string) => { calls.push(['thinking', level]); },
    emit: (_sid: string, state: any, category: string) => { calls.push(['emit', category, state]); },
  };
  return { svc: new SessionConfigService(deps), store, calls, deps };
}

describe('SessionConfigService', () => {
  it('get merges runtime agent/model with stored variant/thinking', async () => {
    const { svc, store } = make();
    store.s1 = { variant: 'max', thinkingLevel: 'high' };
    expect(await svc.get('s1')).toMatchObject({
      mode: 'read-only',
      agent: 'build',
      model: { providerID: 'p', modelID: 'm' },
      variant: 'max',
      thinkingLevel: 'high',
    });
  });

  it('sets mode/agent/model/thought_level and emits config', async () => {
    const { svc, calls } = make();
    await svc.set('s1', 'mode', 'auto');
    await svc.set('s1', 'agent', 'plan');
    await svc.set('s1', 'model', { providerID: 'p', modelID: 'm2', variant: 'fast' });
    await svc.set('s1', 'thought_level', 'max');
    expect(calls).toEqual(expect.arrayContaining([
      ['mode', 'auto'],
      ['agent', 'plan'],
      ['model', { providerID: 'p', modelID: 'm2' }, 'fast'],
      ['thinking', 'max'],
    ]));
    expect(calls.filter(c => c[0] === 'emit')).toHaveLength(4);
  });

  it('model_config.variant reuses current model', async () => {
    const { svc, calls } = make();
    await svc.set('s1', 'model_config', { variant: 'fast' });
    expect(calls).toContainEqual(['model', { providerID: 'p', modelID: 'm' }, 'fast']);
  });

  it('rejects invalid category/values and unsupported thought level', async () => {
    const { svc, deps } = make();
    await expect(svc.set('s1', 'nope', 1)).rejects.toMatchObject({ status: 400 });
    await expect(svc.set('s1', 'mode', 'nope')).rejects.toMatchObject({ status: 400 });
    await expect(svc.set('s1', 'thought_level', 'nope')).rejects.toMatchObject({ status: 400 });
    deps.setThinkingLevel = undefined;
    await expect(svc.set('s1', 'thought_level', 'high')).rejects.toMatchObject({ status: 400 });
  });
});
