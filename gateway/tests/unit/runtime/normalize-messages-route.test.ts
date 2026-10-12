import { applyNormalizeMessages } from '../../../src/runtime/normalize-messages';

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
