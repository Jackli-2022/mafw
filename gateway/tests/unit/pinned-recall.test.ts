import { handleRecallPinned, PINNED_BUDGET } from '../../src/routes/pinned-recall';

function entry(overrides: Partial<{ id: string; pinned: boolean; superseded_by: string; energy: number; salience: number }> = {}) {
  return { id: 'mem_a', type: 'semantic', pinned: true, energy: 0.8, salience: 0.5, ...overrides };
}

describe('handleRecallPinned', () => {
  test('filters to pinned && !superseded, loads full values, returns budget', async () => {
    const units: Record<string, any> = {
      mem_a: { id: 'mem_a', type: 'semantic', primary_abstraction: 'a', memory_value: '偏好中文', energy: 0.8, salience: 0.5, created_at: '2026-08-28T00:00:00Z' },
      mem_b: { id: 'mem_b', type: 'semantic', primary_abstraction: 'b', memory_value: '偏好简洁', energy: 0.9, salience: 0.5, created_at: '2026-08-28T00:00:00Z' },
    };
    const result = await handleRecallPinned({
      getIndex: () => ({ entries: [
        entry({ id: 'mem_a' }),
        entry({ id: 'mem_b', energy: 0.9 }),
        entry({ id: 'mem_c', superseded_by: 'mem_b' }),   // superseded：排除
        entry({ id: 'mem_d', pinned: false }),            // 未 pin：排除
      ] }),
      readUnit: async (id: string) => units[id] || null,
    });
    expect(result.entries.map((e: any) => e.id)).toEqual(['mem_b', 'mem_a']); // energy 0.9 > 0.8
    expect(result.profile).toContain('偏好简洁');
    expect(result.budget).toEqual({ ...PINNED_BUDGET, used: 2 });
  });

  test('empty set → profile null', async () => {
    const result = await handleRecallPinned({ getIndex: () => ({ entries: [] }), readUnit: async () => null });
    expect(result.profile).toBeNull();
    expect(result.budget.used).toBe(0);
  });

  test('salience missing treated as 1 in sort', async () => {
    const units: Record<string, any> = {
      mem_low: { id: 'mem_low', memory_value: '低', energy: 0.8, salience: 0.5 },
      def: { id: 'def', memory_value: '默认', energy: 0.8 }, // salience 缺失 = 1 → 排前
    };
    const result = await handleRecallPinned({
      getIndex: () => ({ entries: [entry({ id: 'mem_low' }), entry({ id: 'def', salience: undefined as any })] }),
      readUnit: async (id) => units[id] || null,
    });
    expect(result.entries[0].id).toBe('def');
  });
});
