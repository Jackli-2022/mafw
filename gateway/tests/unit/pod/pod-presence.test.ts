// gateway/tests/unit/pod/pod-presence.test.ts
// Cross-project presence: the desktop keeps only ONE pod loaded, so the tray
// cannot be driven from renderer state. This projection is the single source.
import { buildPodPresence } from '../../../src/core/pod/pod-presence';

const goal = (over: any = {}) => ({
  goalId: 'g1',
  title: '冒烟',
  phase: 'EXECUTING',
  status: 'active',
  verdict: null,
  resultReady: false,
  endedAt: null,
  startedAt: '2026-11-04T00:00:00Z',
  currentAssignment: { role: 'builder' },
  ...over,
});

it('counts only non-terminal goals and derives progress from tasks', () => {
  const out = buildPodPresence([
    {
      podId: 'p1',
      projectId: 'proj',
      projectName: 'mafw',
      goals: [goal(), goal({ goalId: 'g2', status: 'done', endedAt: '2026-11-04T01:00:00Z' })],
      tasks: [
        { goalId: 'g1', status: 'done' },
        { goalId: 'g1', status: 'review' },
        { goalId: 'g1', status: 'pending' },
      ],
      attention: [],
    },
  ]);
  expect(out.running).toHaveLength(1);
  expect(out.running[0].progress).toEqual({ current: 1, total: 3 });
  expect(out.running[0].node).toBe('execute');
});

it('progress is null when the goal has no tasks', () => {
  const out = buildPodPresence([
    { podId: 'p1', projectId: 'proj', projectName: 'mafw', goals: [goal()], tasks: [], attention: [] },
  ]);
  expect(out.running[0].progress).toBeNull();
});

it('unread results pick the latest by endedAt', () => {
  const out = buildPodPresence([
    {
      podId: 'p1',
      projectId: 'proj',
      projectName: 'mafw',
      tasks: [],
      attention: [],
      unread: [{ goalId: 'old', revision: 1 }, { goalId: 'new', revision: 1 }],
      goals: [
        goal({ goalId: 'old', status: 'done', resultReady: true, endedAt: '2026-11-04T01:00:00Z' }),
        goal({ goalId: 'new', status: 'done', resultReady: true, endedAt: '2026-11-04T02:00:00Z' }),
      ],
    },
  ]);
  expect(out.unreadResults.count).toBe(2);
  expect(out.unreadResults.latest?.goalId).toBe('new');
});

it('a result is no longer unread once its event is seen', () => {
  const out = buildPodPresence([
    {
      podId: 'p1',
      projectId: 'proj',
      projectName: 'mafw',
      tasks: [],
      attention: [],
      unread: [],
      goals: [goal({ goalId: 'g', status: 'done', resultReady: true, endedAt: '2026-11-04T01:00:00Z' })],
    },
  ]);
  expect(out.unreadResults.count).toBe(0);
});

it('a hard failure without evidence still surfaces when its event is unread', () => {
  const out = buildPodPresence([
    {
      podId: 'p1',
      projectId: 'proj',
      projectName: 'mafw',
      tasks: [],
      attention: [],
      unread: [{ goalId: 'bad', revision: 1 }],
      goals: [goal({ goalId: 'bad', status: 'done', verdict: 'ERROR', resultReady: false, endedAt: '2026-11-04T01:00:00Z' })],
    },
  ]);
  expect(out.unreadResults.count).toBe(1);
});

it('cancelled goals are not unread results', () => {
  const out = buildPodPresence([
    {
      podId: 'p1',
      projectId: 'proj',
      projectName: 'mafw',
      tasks: [],
      attention: [],
      goals: [goal({ goalId: 'c', status: 'aborted', verdict: 'CANCELLED', resultReady: true, endedAt: '2026-11-04T01:00:00Z' })],
    },
  ]);
  expect(out.unreadResults.count).toBe(0);
});

it('folds worktree pods into the parent project', () => {
  const out = buildPodPresence([
    { podId: 'p1', projectId: 'C:/proj', projectName: 'proj', goals: [goal()], tasks: [], attention: [] },
    {
      podId: 'p2',
      projectId: 'C:/proj-wt-x',
      parentProjectId: 'C:/proj',
      projectName: 'proj',
      goals: [goal({ goalId: 'g9' })],
      tasks: [],
      attention: [],
    },
  ]);
  expect(out.running.map((r) => r.projectId)).toEqual(['C:/proj', 'C:/proj']);
});

it('dedupes the same goal seen from both a worktree pod and its parent', () => {
  const out = buildPodPresence([
    { podId: 'p1', projectId: 'C:/proj', projectName: 'proj', goals: [goal({ goalId: 'g1' })], tasks: [], attention: [] },
    {
      podId: 'p2',
      projectId: 'C:/proj-wt-x',
      parentProjectId: 'C:/proj',
      projectName: 'proj',
      goals: [goal({ goalId: 'g1' })],
      tasks: [],
      attention: [{ id: 'g1:blocked:r1', goalId: 'g1', revision: 1, kind: 'blocked', title: 'x', action: { type: 'open_goal', goalId: 'g1' } } as any],
    },
    {
      podId: 'p3',
      projectId: 'C:/proj-wt-y',
      parentProjectId: 'C:/proj',
      projectName: 'proj',
      goals: [],
      tasks: [],
      attention: [{ id: 'g1:blocked:r1', goalId: 'g1', revision: 1, kind: 'blocked', title: 'x', action: { type: 'open_goal', goalId: 'g1' } } as any],
    },
  ]);
  expect(out.running).toHaveLength(1);
  expect(out.attention.count).toBe(1);
});

it('carries attention items with their revision-scoped ids', () => {
  const out = buildPodPresence([
    {
      podId: 'p1',
      projectId: 'proj',
      projectName: 'mafw',
      goals: [],
      tasks: [],
      attention: [{ id: 'g1:plan_approval:r2', goalId: 'g1', kind: 'plan_approval', title: '冒烟', action: { kind: 'open_plan_review' } as any }],
    },
  ]);
  expect(out.attention.count).toBe(1);
  expect(out.attention.items[0].id).toBe('g1:plan_approval:r2');
});

// The mobile work tab renders presence attention across projects and must be
// able to switch the active project before opening the Goal detail, so every
// item has to carry the owning Pod + project (Task 7 / spec §7.1).
it('attaches podId and projectId to every attention item', () => {
  const out = buildPodPresence([
    {
      podId: 'p1',
      projectId: 'C:/proj',
      projectName: 'proj',
      goals: [],
      tasks: [],
      attention: [
        { id: 'g1:blocked:r1', goalId: 'g1', revision: 1, kind: 'blocked', title: 'x', action: { type: 'open_goal', goalId: 'g1' } } as any,
      ],
    },
  ]);
  expect(out.attention.items[0].podId).toBe('p1');
  expect(out.attention.items[0].projectId).toBe('C:/proj');
});

it('folds a worktree attention item onto the parent project id', () => {
  const out = buildPodPresence([
    {
      podId: 'p2',
      projectId: 'C:/proj-wt-x',
      parentProjectId: 'C:/proj',
      projectName: 'proj',
      goals: [],
      tasks: [],
      attention: [
        { id: 'g2:question:r2', goalId: 'g2', revision: 2, kind: 'question', title: 'y', action: { type: 'open_question', goalId: 'g2' } } as any,
      ],
    },
  ]);
  expect(out.attention.items[0].projectId).toBe('C:/proj');
  // The Pod id stays the worktree Pod: project folding is a display concern.
  expect(out.attention.items[0].podId).toBe('p2');
  expect(out.attention.items[0].revision).toBe(2);
});
