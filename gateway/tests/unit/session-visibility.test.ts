// Task 2（spec 2026-11-02-pod-collaborative-goal-loop §3.1/§9）：Lead 替换 Manager。
//
// Pod 协作循环把 Lead / Tech Lead 的 runtime session 都变成内部实现细节——用户不感知、
// 不在会话列表里出现（用户只经由 Lead 入口 / Goal 的 Tech Lead 页面对话）。
// 旧的 `manager` / `manager-archived` 元数据必须继续可读（既有会话兼容），
// 所以它们刻意**不在**隐藏名单里。
import { isHiddenSession } from '../../src/core/session-visibility';
import { LEAD_IDENTITY_SYSTEM_PROMPT } from '../../src/skills/lead-identity';

const noRole = () => undefined;

describe('isHiddenSession: Lead / Tech Lead 是内部会话', () => {
  it('hides the Lead session by its metadata role', () => {
    expect(isHiddenSession({ metadata: { mafw: { role: 'lead' } } } as any)).toBe(true);
  });

  it('hides Tech Lead sessions (hyphen and Pod underscore spellings)', () => {
    expect(isHiddenSession({ metadata: { mafw: { role: 'tech-lead' } } } as any)).toBe(true);
    expect(isHiddenSession({ metadata: { mafw: { role: 'tech_lead' } } } as any)).toBe(true);
  });

  it('hides Lead / Tech Lead sessions via the internal role registry (kv survived)', () => {
    for (const role of ['lead', 'tech-lead', 'tech_lead']) {
      expect(isHiddenSession({ id: 's1', title: 'normal' }, () => role)).toBe(true);
    }
  });

  it('hides Tech Lead runtime sessions by agent even when the role registry was pruned', () => {
    // 与 memory-curator 同理：agent 持久化在 session 本体上，不受 internal-session kv TTL 影响。
    expect(isHiddenSession({ id: 'tl', agent: 'mafw-tech-lead', title: 'Tech Lead' }, noRole)).toBe(true);
  });

  it('keeps legacy manager / manager-archived sessions readable (compatibility)', () => {
    expect(isHiddenSession({ id: 'm1', metadata: { mafw: { role: 'manager' } } } as any)).toBe(false);
    expect(isHiddenSession({ id: 'm2', metadata: { mafw: { role: 'manager-archived' } } } as any)).toBe(false);
    expect(isHiddenSession({ id: 'm3', title: 'Manager' }, () => 'manager')).toBe(false);
  });

  it('keeps ordinary user sessions visible', () => {
    expect(isHiddenSession({ id: 'u1', title: 'Fix the bug', agent: 'build' } as any)).toBe(false);
    expect(isHiddenSession({ id: 'u2', metadata: { mafw: { role: 'lead-user' } } } as any)).toBe(false);
  });

  it('still works with the single-argument form used by session listing', () => {
    expect(isHiddenSession({ id: 'w1', parentID: 'p1' })).toBe(true);
  });
});

describe('LEAD_IDENTITY_SYSTEM_PROMPT: Lead 不讨论技术方案、只建 Goal 并指到 Tech Lead', () => {
  it('forbids expanding technical solutions', () => {
    expect(LEAD_IDENTITY_SYSTEM_PROMPT).toContain('不要展开技术方案');
  });

  it('routes a work intent through mafw_create_goal', () => {
    expect(LEAD_IDENTITY_SYSTEM_PROMPT).toContain('mafw_create_goal');
  });

  it('points the user at the Goal Tech Lead after creating the Goal', () => {
    expect(LEAD_IDENTITY_SYSTEM_PROMPT).toMatch(/Tech Lead/);
    expect(LEAD_IDENTITY_SYSTEM_PROMPT).toMatch(/Tech Lead(?: 入口| 讨论|页|讨论入口)/);
  });
});
