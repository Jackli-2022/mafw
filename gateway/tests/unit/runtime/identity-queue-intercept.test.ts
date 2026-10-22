import { withIdentityPrompt, IdentityState } from '../../../src/runtime/identity-state';

function makeWrapped(intercept?: (o: any) => Promise<unknown> | undefined) {
  const calls: any[] = [];
  const target = {
    promptAsync: async (o: any) => { calls.push(o); return { sent: true }; },
    prompt: async (o: any) => { calls.push(o); return {}; },
    other: () => 42,
  };
  const state = new IdentityState();
  const wrapped = withIdentityPrompt(target as any, state as any, () => 'test', () => false, intercept);
  return { wrapped, calls };
}

describe('withIdentityPrompt 拦截扩展（spec §5.3 v2）', () => {
  it('intercept 返回 Promise → 短路，target.promptAsync 不被调', async () => {
    const { wrapped, calls } = makeWrapped(async () => ({ queued: true, itemId: 'q_1' }));
    const r = await wrapped.promptAsync({ sessionID: 's1', text: 'x', delivery: 'queue' });
    expect(r).toEqual({ queued: true, itemId: 'q_1' });
    expect(calls).toHaveLength(0);
  });
  it('intercept 返回 undefined → 透传原路径（含 identity apply 仍生效）', async () => {
    const { wrapped, calls } = makeWrapped(() => undefined);
    await wrapped.promptAsync({ sessionID: 's1', text: 'x', delivery: 'steer' });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe('x');
  });
  it('无 intercept 参数 → 行为与现状 byte-for-byte 一致（C2：harness 零影响）', async () => {
    const { wrapped, calls } = makeWrapped(undefined);
    await wrapped.promptAsync({ sessionID: 's1', text: 'x' });
    expect(calls).toHaveLength(1);
  });
  it('intercept 抛错 → 传播（调用方 catch 处理）', async () => {
    const { wrapped } = makeWrapped(async () => { throw new Error('queue full'); });
    await expect(wrapped.promptAsync({ sessionID: 's1', delivery: 'queue' })).rejects.toThrow('queue full');
  });
  it('prompt() 不经 intercept（队列只挂 promptAsync——同步 prompt 语义不同）', async () => {
    const { wrapped, calls } = makeWrapped(async () => ({ queued: true }));
    await wrapped.prompt({ sessionID: 's1' });
    expect(calls).toHaveLength(1);  // prompt 透传
  });
});
