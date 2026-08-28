import { formatPinnedProfile, PINNED_BUDGET } from '../../src/recall/inject-format';

function mem(overrides: Partial<{ memory_value: string; primary_abstraction: string }> = {}) {
  return { id: 'mem_x', memory_value: '用户偏好中文回复', primary_abstraction: '偏好', ...overrides };
}

describe('formatPinnedProfile', () => {
  test('empty entries → profile null, used 0', () => {
    expect(formatPinnedProfile([])).toEqual({ profile: null, used: 0 });
  });

  test('renders <user-profile> block with one bullet per memory_value', () => {
    const { profile, used } = formatPinnedProfile([mem(), mem({ memory_value: '不在生产库跑迁移前先备份' })]);
    expect(profile).toBe('<user-profile>\n- 用户偏好中文回复\n- 不在生产库跑迁移前先备份\n</user-profile>');
    expect(used).toBe(2);
  });

  test('strips newlines from memory_value', () => {
    const { profile } = formatPinnedProfile([mem({ memory_value: '第一行\n第二行' })]);
    expect(profile).not.toContain('\n第二行');
    expect(profile).toContain('第一行 第二行');
  });

  test('enforces maxEntries cap', () => {
    const entries = Array.from({ length: 30 }, (_, i) => mem({ memory_value: `条目${i}` }));
    const { used } = formatPinnedProfile(entries);
    expect(used).toBe(PINNED_BUDGET.max);
  });

  test('enforces maxChars budget (long entries dropped)', () => {
    const longValue = 'x'.repeat(1500);
    const entries = [mem({ memory_value: longValue }), mem({ memory_value: longValue })];
    const { used } = formatPinnedProfile(entries);
    expect(used).toBe(1); // 第二条会超出 2000 字符预算
  });
});
