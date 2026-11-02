// Task 2 review I-2（spec 2026-11-02-pod-collaborative-goal-loop §3.1/§9）：会话列表
// 可见性选择的行为测试。
//
// `/api/sessions` 的合并/过滤逻辑原先内联在 index.ts（无法单测，只有源码正则断言）。
// 现抽为纯函数 `selectVisibleSessions`，四条路径逐条覆盖：
//   1. serve 形状没有 metadata → 用本地 metadata 判定 Lead 并隐藏
//   2. 只在本地存储里的 Lead（registerExternal，serve 不知道）→ 隐藏
//   3. 空合并回退（runtime 没给会话）→ 仍要过滤隐藏会话
//   4. 普通会话可见 + serve 副本覆盖 db 副本
import { selectVisibleSessions } from '../../src/core/session-visibility';

const noRole = () => undefined;
const ids = (list: Array<{ id?: string }>) => list.map((s) => s.id);

const leadLocal = (id: string, extra: Record<string, any> = {}) => ({
  id,
  title: 'Lead',
  metadata: { mafw: { role: 'lead' } },
  ...extra,
});

describe('selectVisibleSessions: 内部会话过滤', () => {
  it('hides a Lead session the serve list reports without metadata (local metadata is authoritative)', () => {
    const out = selectVisibleSessions({
      fromServe: [{ id: 'lead-1', title: 'Lead' }, { id: 'user-1', title: 'Fix the bug' }],
      dbSessions: [],
      localSessions: [leadLocal('lead-1')],
      roleFor: noRole,
    });
    expect(ids(out)).toEqual(['user-1']);
  });

  it('hides a local-only Lead session (registered via registerExternal, unknown to serve)', () => {
    const out = selectVisibleSessions({
      fromServe: [{ id: 'user-1', title: 'Fix the bug' }],
      dbSessions: [],
      localSessions: [leadLocal('lead-1', { projectID: '/proj/a', directory: '/proj/a' })],
      projectID: '/proj/a',
      roleFor: noRole,
    });
    expect(ids(out)).toEqual(['user-1']);
  });

  it('filters the empty-merge fallback instead of leaking the hidden Lead', () => {
    // runtime 返回空（未启动 / MCP-only）时走本地回退：Lead 仍然必须隐藏，且按项目收敛。
    const out = selectVisibleSessions({
      fromServe: [],
      dbSessions: [],
      localSessions: [
        leadLocal('lead-1', { projectID: '/proj/a', directory: '/proj/a', time: { created: 2 } }),
        { id: 'user-1', projectID: '/proj/a', directory: '/proj/a', title: 'Chat', time: { created: 1 } },
        { id: 'other-1', projectID: '/proj/b', directory: '/proj/b', title: 'Other project', time: { created: 3 } },
      ],
      projectID: '/proj/a',
      roleFor: noRole,
    });
    expect(ids(out)).toEqual(['user-1']);
  });

  it('keeps ordinary sessions visible and lets the serve copy win over the database copy', () => {
    const out = selectVisibleSessions({
      fromServe: [{ id: 'u1', title: 'live title' }],
      dbSessions: [{ id: 'u1', title: 'db title' }],
      localSessions: [],
      roleFor: noRole,
    });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('live title');
  });
});

describe('selectVisibleSessions: 既有可见性口径不回退', () => {
  it('still hides worker roles from the role registry', () => {
    const out = selectVisibleSessions({
      fromServe: [{ id: 'w1', title: 'worker' }, { id: 'u1', title: 'chat' }],
      dbSessions: [],
      localSessions: [],
      roleFor: (id) => (id === 'w1' ? 'extract' : undefined),
    });
    expect(ids(out)).toEqual(['u1']);
  });

  it('hides subagent children even when the serve copy lost parentID', () => {
    const out = selectVisibleSessions({
      fromServe: [{ id: 'child-1', title: 'subagent' }, { id: 'u1', title: 'chat' }],
      // The SQLite window still carries parentID, so its ids seed the child set.
      dbSessions: [{ id: 'child-1', parentID: 'u1', title: 'subagent' }],
      localSessions: [],
      roleFor: noRole,
    });
    expect(ids(out)).toEqual(['u1']);
  });

  it('hides Tech Lead sessions by agent name', () => {
    const out = selectVisibleSessions({
      fromServe: [{ id: 'tl-1', agent: 'mafw-tech-lead', title: 'Tech Lead' }, { id: 'u1', title: 'chat' }],
      dbSessions: [],
      localSessions: [],
      roleFor: noRole,
    });
    expect(ids(out)).toEqual(['u1']);
  });

  it('enriches serve entries with local metadata so clients see the coordinator marker', () => {
    const out = selectVisibleSessions({
      fromServe: [{ id: 'm1', title: 'legacy manager' }],
      dbSessions: [],
      localSessions: [{ id: 'm1', metadata: { mafw: { role: 'manager' } } }],
      roleFor: noRole,
    });
    // `manager` 是历史值：保持可见（既有会话兼容），但标记要透传给客户端。
    expect(out).toHaveLength(1);
    expect(out[0].metadata).toEqual({ mafw: { role: 'manager' } });
  });

  it('matches local-only sessions by normalized project directory (Windows case/separators)', () => {
    const out = selectVisibleSessions({
      fromServe: [{ id: 'u1', title: 'chat' }],
      dbSessions: [],
      localSessions: [
        { id: 'local-1', projectID: 'C:\\Proj\\A', directory: 'C:\\Proj\\A', title: 'local only', metadata: { mafw: { role: 'agent' } } },
        { id: 'local-2', projectID: 'C:\\Proj\\B', directory: 'C:\\Proj\\B', title: 'other project', metadata: { mafw: { role: 'agent' } } },
      ],
      projectID: 'c:/proj/a',
      roleFor: noRole,
    });
    expect(ids(out)).toEqual(['u1', 'local-1']);
  });
});
