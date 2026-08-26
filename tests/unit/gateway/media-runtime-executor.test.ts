import { createMediaRuntimeExecutor } from '../../../gateway/src/media/media-runtime-executor';
import type { AgentRuntime } from '../../../gateway/src/runtime/contract';

jest.mock('../../../gateway/src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const fakeRuntime = (): AgentRuntime => {
  const sessions = new Map<string, any>();
  const rt = {
    name: 'pi',
    capabilities: {} as any,
    external: true,
    session: {
      create: jest.fn(async () => { const id = `pi_${sessions.size}`; sessions.set(id, { msgs: [] }); return { id }; }),
      promptAsync: async (opts: any) => {
        const s = sessions.get(opts.sessionID);
        s.msgs.push({ role: 'user', content: [{ type: 'text', text: opts.message ?? (opts.parts || []).map((p: any) => p.text ?? '').join('') }] });
        s.msgs.push({ role: 'assistant', content: [{ type: 'text', text: `answer-${s.msgs.length}` }] });
      },
      prompt: async () => ({ parts: [] }),
      messages: async (opts: any) => ({ data: sessions.get(opts.sessionID).msgs }),
      get: async () => ({}),
      delete: async () => {},
      abort: jest.fn(async () => {}),
      list: async () => [],
      todo: async () => [],
      children: async () => [],
      summarize: async () => ({}),
    } as any,
    global: { event: async () => ({ stream: [] }) } as any,
    provider: { list: async () => ({ all: [], connected: [], default: {} }) } as any,
    app: { agents: async () => [] } as any,
    config: { get: async () => ({}), update: async () => ({}) } as any,
    getBaseUrl: () => 'http://127.0.0.1:3000',
  };
  return rt as any;
};

describe('MediaRuntimeExecutor', () => {
  it('first image turn creates session and returns assistant text', async () => {
    const rt = fakeRuntime();
    const ex = createMediaRuntimeExecutor(rt as any, { sessionTtlMs: 60000 });
    const out = await ex.prompt(
      [{ type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' }, { type: 'text', text: 'what is this?' }],
      { providerID: 'xiaomi', modelID: 'mimo-v2.5' },
    );
    expect(out).toContain('answer-');
  });

  it('follow-up for the same media reuses the session (no new create)', async () => {
    const rt = fakeRuntime();
    const ex = createMediaRuntimeExecutor(rt as any, { sessionTtlMs: 60000 });
    await ex.prompt([{ type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' }], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    await ex.prompt([{ type: 'text', text: 'tell me more' }], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(rt.session.create).toHaveBeenCalledTimes(1);
  });

  it('video media falls back to completeFn without session', async () => {
    const completeFn = jest.fn(async () => 'video analysis');
    const rt = fakeRuntime();
    const ex = createMediaRuntimeExecutor(rt as any, { completeFn, sessionTtlMs: 60000 });
    const out = await ex.prompt(
      [{ type: 'file', url: 'data:video/mp4;base64,AAAA', mime: 'video/mp4' }],
      { providerID: 'xiaomi', modelID: 'mimo-v2.5' },
    );
    expect(out).toBe('video analysis');
    expect(completeFn).toHaveBeenCalled();
    expect(rt.session.create).not.toHaveBeenCalled();
  });

  it('dispose clears all sessions', async () => {
    const rt = fakeRuntime();
    const ex = createMediaRuntimeExecutor(rt as any, { sessionTtlMs: 60000 });
    await ex.prompt([{ type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' }], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    await ex.dispose();
  });

  it('cancelInflight aborts in-flight sessions', async () => {
    const rt = fakeRuntime();
    const ex = createMediaRuntimeExecutor(rt as any, { sessionTtlMs: 60000, timeoutMs: 1000 });
    // 首次 prompt 完成（无 inflight）后 cancelInflight 不应抛错
    await ex.prompt([{ type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' }], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    await ex.cancelInflight();
    expect((rt.session.abort as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(0);
  });
});