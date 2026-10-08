import { isHiddenSession } from '../../../src/core/session-visibility';

const noRole = () => undefined;

describe('isHiddenSession', () => {
  it('hides subagent children (parentID)', () => {
    expect(isHiddenSession({ parentID: 'p1' }, noRole)).toBe(true);
  });

  it('hides legacy worker title patterns', () => {
    expect(isHiddenSession({ title: '# Memory Index Scan' }, noRole)).toBe(true);
    expect(isHiddenSession({ title: '{"relevant_ids":[]}' }, noRole)).toBe(true);
    expect(isHiddenSession({ title: '```json' }, noRole)).toBe(true);
    expect(isHiddenSession({ title: '标题：记忆提取' }, noRole)).toBe(true);
  });

  it('hides sessions with internal worker roles', () => {
    for (const role of ['index-scan', 'extract', 'reflect']) {
      expect(isHiddenSession({ id: 's1', title: 'normal' }, () => role)).toBe(true);
    }
  });

  it('hides memory-curator agent sessions even when the role registry lost them (kv TTL prune)', () => {
    // 回归：internal-session kv 7 天 TTL 剪枝后，老 worker 会话失去 role 标记
    // 重新浮出桌面列表（2026-10-08 事故：09-30 的 13 个 reflect 失败会话复活）。
    // agent 字段持久化在 session 本体上，不受 kv 剪枝影响。
    expect(isHiddenSession({ id: 'old-worker', agent: 'memory-curator', title: 'New session - 2026-09-30' }, noRole)).toBe(true);
  });

  it('keeps manager sessions visible (agent=manager)', () => {
    expect(isHiddenSession({ id: 'm1', agent: 'manager', title: 'Manager' }, noRole)).toBe(false);
  });

  it('keeps normal user sessions visible', () => {
    expect(isHiddenSession({ id: 'u1', title: 'Fix the bug' }, noRole)).toBe(false);
  });

  it('hides curator sessions even with another registered role present', () => {
    expect(isHiddenSession({ id: 'w1', agent: 'memory-curator' }, () => 'extract')).toBe(true);
  });
});
