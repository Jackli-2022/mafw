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
