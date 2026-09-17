import { buildBuiltinHandlers, MafwBuiltinDeps } from '../../src/commands/builtin-handlers';

function makeDeps(overrides: Partial<MafwBuiltinDeps> = {}): MafwBuiltinDeps {
  return {
    ensureManagerSession: async () => 'mgr-1',
    createSession: async () => 'new-1',
    promptAsync: async () => {},
    listMessages: async () => [],
    btwAsk: async () => '答案',
    rotateManagerSession: async () => ({ sessionId: 'mgr-2' }),
    mergeMemory: async () => ({ success: true, merged: 3 }),
    readStatus: () => '# STATUS',
    llmAvailable: () => true,
    ...overrides,
  };
}

describe('builtin handlers', () => {
  test('goal requires args', async () => {
    const h = buildBuiltinHandlers(makeDeps()).get('goal')!;
    const r = await h({ args: '', projectDir: '/p' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/goal description required/);
  });

  test('goal prompts manager session with 创建新 Goal prefix', async () => {
    const sent: Array<{ sid: string; text: string }> = [];
    const deps = makeDeps({ promptAsync: async (sid, text) => { sent.push({ sid, text }); } });
    const r = await buildBuiltinHandlers(deps).get('goal')!({ args: '做X', projectDir: '/p' });
    expect(r.ok).toBe(true);
    expect(sent).toEqual([{ sid: 'mgr-1', text: '创建新 Goal：做X' }]);
    expect(r.sessionID).toBe('mgr-1');
  });

  test('goal falls back to new session when no manager; 503 when llm unavailable', async () => {
    const deps = makeDeps({ ensureManagerSession: async () => '', createSession: async () => 'new-9' });
    const r = await buildBuiltinHandlers(deps).get('goal')!({ args: 'x', projectDir: '/p' });
    expect(r.sessionID).toBe('new-9');
    const deps2 = makeDeps({ llmAvailable: () => false });
    const r2 = await buildBuiltinHandlers(deps2).get('goal')!({ args: 'x', projectDir: '/p' });
    expect(r2).toMatchObject({ ok: false, error: 'LLM client not available' });
  });

  test('new-topic returns rotate result', async () => {
    const r = await buildBuiltinHandlers(makeDeps()).get('new-topic')!({ args: '', projectDir: '/p' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('mgr-2');
  });

  test('btw requires args and returns text', async () => {
    const h = buildBuiltinHandlers(makeDeps()).get('btw')!;
    expect((await h({ args: '', projectDir: '/p' })).ok).toBe(false);
    expect(await h({ args: '问', projectDir: '/p' })).toMatchObject({ ok: true, text: '答案' });
  });

  test('waitwhat requires sessionID; propagates runWaitwhat failure', async () => {
    const h = buildBuiltinHandlers(makeDeps()).get('waitwhat')!;
    expect((await h({ args: '', projectDir: '/p' })).ok).toBe(false);
    // 无 assistant 消息 → runWaitwhat 返回 ok:false
    const r = await h({ args: '', projectDir: '/p', sessionID: 's1' });
    expect(r).toMatchObject({ ok: false, error: 'no assistant message to re-pitch' });
  });

  test('waitwhat prompts re-pitch into same session', async () => {
    const sent: string[] = [];
    const deps = makeDeps({
      listMessages: async () => [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: '原回复' }] }],
      promptAsync: async (_sid, text) => { sent.push(text); },
    });
    const r = await buildBuiltinHandlers(deps).get('waitwhat')!({ args: '', projectDir: '/p', sessionID: 's1' });
    expect(r.ok).toBe(true);
    expect(sent[0]).toContain('原回复');
  });

  test('status returns STATUS.md content', async () => {
    const r = await buildBuiltinHandlers(makeDeps()).get('status')!({ args: '', projectDir: '/p' });
    expect(r).toMatchObject({ ok: true, text: '# STATUS' });
  });

  test('merge-memory requires path and passes strategy', async () => {
    const h = buildBuiltinHandlers(makeDeps()).get('merge-memory')!;
    expect((await h({ args: '', projectDir: '/p' })).ok).toBe(false);
    const r = await h({ args: '/wt higher_energy', projectDir: '/p' });
    expect(r).toMatchObject({ ok: true, success: true, merged: 3 });
  });
});
