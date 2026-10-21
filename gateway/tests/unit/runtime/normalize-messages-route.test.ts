import { applyNormalizeMessages, wrapRuntimeMessages } from '../../../src/runtime/normalize-messages';
import { toWireHistory } from '../../../src/runtime/wire-compat';
import { isMafwMessage } from '../../../src/runtime/canonical-types';

describe('applyNormalizeMessages（canonical v3：输出恒 flat）', () => {
  test('无声明 → 默认 wire→flat 翻译（{info,parts} 进，MafwMessage 出）', () => {
    const raw = [{ info: { id: 'm1', role: 'user' }, parts: [{ id: 'p1', type: 'text', text: 'q' }] }];
    const out = applyNormalizeMessages({ session: {} } as any, raw);
    expect(out).toHaveLength(1);
    expect(isMafwMessage(out[0])).toBe(true);
    expect(out[0]).toMatchObject({ id: 'm1', role: 'user' });
    expect((out[0] as any).content).toBe(raw[0].parts); // parts 引用直通
  });

  test('无声明且输入非 wire 形状 → 逐项放行（已是 flat 的数据不过翻译）', () => {
    const raw = [{ id: 'x', role: 'user', content: [] }];
    const out = applyNormalizeMessages({ session: {} } as any, raw);
    expect(out).toEqual(raw);
    expect(out[0]).toBe(raw[0]); // 项身份保持（零拷贝）
  });

  test('有 normalizeMessages → 应用（绑定 session 作用域，flat 输出）', () => {
    const rt = {
      session: {
        marker: 'x',
        normalizeMessages(this: any, raw: any[]) {
          return raw.map(() => ({ id: this.marker, role: 'assistant' as const, content: [] }));
        },
      },
    } as any;
    expect(applyNormalizeMessages(rt, [{}, {}])).toEqual([
      { id: 'x', role: 'assistant', content: [] },
      { id: 'x', role: 'assistant', content: [] },
    ]);
  });

  test('normalizeMessages 抛错 → fail-open 回原数组', () => {
    const raw = [{ a: 1 }];
    const rt = { session: { normalizeMessages: () => { throw new Error('bad'); } } } as any;
    expect(applyNormalizeMessages(rt, raw)).toBe(raw);
  });
});

describe('wrapRuntimeMessages（无声明也包装——默认翻译保证出口恒 flat）', () => {
  test('有 normalizeMessages → messages() 出口归一为 flat', async () => {
    const rt = {
      session: {
        normalizeMessages: (raw: any[]) => raw.map((r) => ({ id: r.id, role: 'assistant' as const, content: [{ id: 'p', type: 'text', text: 'x' }] })),
        messages: async () => ({ data: [{ id: 'm1' }, { id: 'm2' }], nextCursor: null }),
      },
    } as any;
    wrapRuntimeMessages(rt);
    const out = await rt.session.messages({});
    expect(out.data.every(isMafwMessage)).toBe(true);
    expect(out.data).toEqual([
      { id: 'm1', role: 'assistant', content: [{ id: 'p', type: 'text', text: 'x' }] },
      { id: 'm2', role: 'assistant', content: [{ id: 'p', type: 'text', text: 'x' }] },
    ]);
    expect(out.nextCursor).toBeNull();
  });

  test('无 normalizeMessages → 包装 + 默认 wire→flat（opencode 路径）', async () => {
    const rt = {
      session: {
        messages: async () => ({ data: [{ info: { id: 'm1', role: 'assistant' }, parts: [{ id: 'p', type: 'text', text: 'hi' }] }], nextCursor: 'c1' }),
      },
    } as any;
    wrapRuntimeMessages(rt);
    const out = await rt.session.messages({});
    expect(out.data.every(isMafwMessage)).toBe(true);
    expect((out.data[0] as any).content[0].text).toBe('hi');
    expect(out.nextCursor).toBe('c1');
  });

  test('组合链（路由出口）：wrap 后 flat → toWireHistory 还原 wire 形状', async () => {
    const wireIn = [{ info: { id: 'm1', role: 'assistant', modelID: 'glm-5.3' }, parts: [{ id: 'p', type: 'text', text: 'hi' }] }];
    const rt = { session: { messages: async () => ({ data: wireIn, nextCursor: null }) } } as any;
    wrapRuntimeMessages(rt);
    const { data } = await rt.session.messages({});
    const wire = toWireHistory(data);
    expect(wire).toEqual(wireIn); // egress 出口 = 原 wire（round-trip 语义）
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

describe('B2 normalizeMessages 输出守卫（flat 契约）', () => {
  test('返回非数组 → onViolation + 回退原文', () => {
    const raw = [{ a: 1 }];
    const rt = { session: { normalizeMessages: () => 'nope' } } as any;
    const violations: string[] = [];
    expect(applyNormalizeMessages(rt, raw, (r) => violations.push(r))).toBe(raw);
    expect(violations[0]).toContain('non-array');
  });

  test('返回非 flat 形状成员（{info,parts} 信封）→ onViolation + 回退原文', () => {
    const raw = [{ a: 1 }];
    const rt = { session: { normalizeMessages: () => [{ info: { role: 'user' }, parts: [] }] } } as any;
    const violations: string[] = [];
    expect(applyNormalizeMessages(rt, raw, (r) => violations.push(r))).toBe(raw);
    expect(violations[0]).toContain('flat');
  });

  test('wrapRuntimeMessages 透传 onViolation（抛错路径）', async () => {
    const rt = {
      session: {
        normalizeMessages: () => { throw new Error('bad'); },
        messages: async () => ({ data: [{ id: 'm1' }] }),
      },
    } as any;
    const violations: string[] = [];
    wrapRuntimeMessages(rt, (r) => violations.push(r));
    const out = await rt.session.messages({});
    expect(out.data).toEqual([{ id: 'm1' }]);
    expect(violations[0]).toContain('bad');
  });
});
