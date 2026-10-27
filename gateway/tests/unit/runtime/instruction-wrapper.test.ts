import { withInstructionSync } from '../../../src/runtime/instruction-wrapper';
import { withIdentityPrompt, IdentityState } from '../../../src/runtime/identity-state';

describe('withInstructionSync', () => {
  it('syncs before promptAsync and prompt; other methods pass through', async () => {
    const calls: string[] = [];
    const target = {
      promptAsync: async (o: any) => { calls.push('promptAsync:' + o.sessionID); return { ok: true }; },
      prompt: async (o: any) => { calls.push('prompt:' + o.sessionID); return {}; },
      other: () => 42,
    };
    const wrapped = withInstructionSync(target as any, async (sid) => { calls.push('sync:' + sid); });
    expect(await wrapped.promptAsync({ sessionID: 's1' })).toEqual({ ok: true });
    await wrapped.prompt({ sessionID: 's2' });
    expect(calls).toEqual(['sync:s1', 'promptAsync:s1', 'sync:s2', 'prompt:s2']);
    expect((wrapped as any).other()).toBe(42);
  });

  it('sync failure never blocks the prompt', async () => {
    const target = {
      promptAsync: async () => ({ ok: true }),
      prompt: async () => ({}),
    };
    const wrapped = withInstructionSync(target as any, async () => { throw new Error('boom'); });
    await expect(wrapped.promptAsync({ sessionID: 's1' })).resolves.toEqual({ ok: true });
  });

  it('identity queue intercept short-circuits before sync', async () => {
    const calls: string[] = [];
    const target = {
      promptAsync: async () => { calls.push('target'); return {}; },
      prompt: async () => ({}),
    };
    const synced = withInstructionSync(target as any, async () => { calls.push('sync'); });
    const wrapped = withIdentityPrompt(
      synced as any,
      new IdentityState() as any,
      () => 'test',
      () => false,
      async () => ({ queued: true }),
    );
    await wrapped.promptAsync({ sessionID: 's1', delivery: 'queue' });
    expect(calls).toEqual([]);
  });
});
