import { applyNormalizeMessages, wrapRuntimeMessages } from '../../../src/runtime/normalize-messages';

describe('applyNormalizeMessages', () => {
  test('runtime 无 normalizeMessages → 恒等', () => {
    const raw = [{ info: { id: 'm1' }, parts: [] }];
    expect(applyNormalizeMessages({ session: {} } as any, raw)).toBe(raw);
  });

  test('有 normalizeMessages → 应用（绑定 session 作用域）', () => {
    const rt = {
      session: {
        marker: 'x',
        normalizeMessages(this: any, raw: any[]) {
          return raw.map(() => ({ info: { id: this.marker }, parts: [] }));
        },
      },
    } as any;
    expect(applyNormalizeMessages(rt, [{}, {}])).toEqual([
      { info: { id: 'x' }, parts: [] },
      { info: { id: 'x' }, parts: [] },
    ]);
  });

  test('normalizeMessages 抛错 → fail-open 回原数组', () => {
    const raw = [{ a: 1 }];
    const rt = { session: { normalizeMessages: () => { throw new Error('bad'); } } } as any;
    expect(applyNormalizeMessages(rt, raw)).toBe(raw);
  });
});

describe('wrapRuntimeMessages', () => {
  test('有 normalizeMessages → messages() 出口归一为 DTO', async () => {
    const rt = {
      session: {
        normalizeMessages: (raw: any[]) => raw.map((r) => ({ info: { id: r.id, role: 'assistant' }, parts: [{ type: 'text', text: 'x' }] })),
        messages: async () => ({ data: [{ id: 'm1' }, { id: 'm2' }], nextCursor: null }),
      },
    } as any;
    wrapRuntimeMessages(rt);
    const out = await rt.session.messages({});
    expect(out.data).toEqual([
      { info: { id: 'm1', role: 'assistant' }, parts: [{ type: 'text', text: 'x' }] },
      { info: { id: 'm2', role: 'assistant' }, parts: [{ type: 'text', text: 'x' }] },
    ]);
    expect(out.nextCursor).toBeNull();
  });

  test('无 normalizeMessages → 不包装（opencode 恒等）', async () => {
    const orig = async () => ({ data: [{ raw: 1 }] });
    const rt = { session: { messages: orig } } as any;
    wrapRuntimeMessages(rt);
    expect(rt.session.messages).toBe(orig);
  });

  test('幂等：重复包装不叠加', () => {
    const rt = { session: { normalizeMessages: (r: any[]) => r, messages: async () => ({ data: [] }) } } as any;
    wrapRuntimeMessages(rt);
    const wrapped = rt.session.messages;
    wrapRuntimeMessages(rt);
    expect(rt.session.messages).toBe(wrapped);
  });

  test('data 非数组 → 原样返回', async () => {
    const rt = { session: { normalizeMessages: () => [], messages: async () => ({ data: undefined }) } } as any;
    wrapRuntimeMessages(rt);
    expect(await rt.session.messages({})).toEqual({ data: undefined });
  });
});
