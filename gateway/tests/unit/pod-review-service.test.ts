import Database from 'better-sqlite3';
import { PodError, PodStore } from '../../src/core/pod/pod-store';
import { PodReviewService, type PodReviewServiceDeps } from '../../src/core/pod/pod-review-service';

const now = '2026-11-11T00:00:00.000Z';

function setup(overrides: Partial<PodReviewServiceDeps> = {}) {
  const store = new PodStore(new Database(':memory:'));
  store.enqueueGoal({
    id: 'podgoal_1',
    podId: 'pod_1',
    goalId: 'g1',
    now: '2026-11-11T00:00:00.000Z',
  });
  store.setGoalStatus('podgoal_1', 'active', { startedAt: '2026-11-11T00:00:00.000Z' });
  const techLeadGoals: string[] = [];
  const service = new PodReviewService({
    store,
    now: () => '2026-11-11T00:01:00.000Z',
    assertTechLeadSession: (goalId, sessionID) => {
      if (sessionID !== 'ses_tl') throw new PodError(403, 'not the tech lead session');
      techLeadGoals.push(goalId);
    },
    ...overrides,
  });
  return { store, service, techLeadGoals };
}

describe('PodReviewService', () => {
  test('creates items on the active revision only', () => {
    const { service } = setup();
    const items = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', startLine: 2, endLine: 2, code: 'x', comment: '改这里' }],
    });
    expect(items[0].status).toBe('pending');
    expect(items[0].revision).toBe(1);
    expect(() => service.createItems('pod_1', 'g1', {
      revision: 2,
      items: [{ rel: 'src/a.ts', comment: '旧版' }],
    })).toThrow(PodError);
  });

  test('rejects an oversized batch before writing any row', () => {
    const { service, store } = setup();
    const items = Array.from({ length: 20 }, (_, index) => ({
      rel: `src/${index}.ts`,
      comment: 'review',
      code: 'x'.repeat(20000),
    }));
    expect(() => service.createItems('pod_1', 'g1', { items })).toThrow(PodError);
    expect(store.listReviewItems('pod_1', 'g1', 1)).toHaveLength(0);
  });

  test('an invalid item in a batch leaves no partial rows', () => {
    const { service, store } = setup();
    expect(() => service.createItems('pod_1', 'g1', {
      items: [
        { rel: 'src/a.ts', comment: '先写进去的' },
        { rel: 'src/b.ts', startLine: 9, endLine: 2, comment: '非法行号' },
      ],
    })).toThrow(PodError);
    expect(store.listReviewItems('pod_1', 'g1', 1)).toHaveLength(0);
  });

  test('retries reuse clientRef rows without duplicate events', () => {
    const { service, store } = setup();
    const source = { kind: 'project' as const, projectDir: 'C:/repo', root: 'C:/repo', contentVersion: 'v1' };
    const first = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', comment: '改这里', source, clientRef: 'ann-1' }],
    });
    const second = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', comment: '改这里', source, clientRef: 'ann-1' }],
    });
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].source).toEqual(source);
    expect(store.listReviewItems('pod_1', 'g1', 1)).toHaveLength(1);
    expect(store.listReviewItemEvents(first[0].id)).toHaveLength(1);
  });

  test('rejects duplicate clientRefs in one batch and invalid source', () => {
    const { service } = setup();
    expect(() => service.createItems('pod_1', 'g1', { items: [
      { rel: 'a.ts', comment: 'a', clientRef: 'same' },
      { rel: 'b.ts', comment: 'b', clientRef: 'same' },
    ] })).toThrow(PodError);
    expect(() => service.createItems('pod_1', 'g1', { items: [
      { rel: 'a.ts', comment: 'a', source: { kind: 'goal', projectDir: 'C:/r' } as any },
    ] })).toThrow(PodError);
    expect(() => service.createItems('pod_1', 'g1', { items: [
      { rel: 'a.ts', comment: 'a', clientRef: 'x'.repeat(201) },
    ] })).toThrow(PodError);
  });

  test('review writes are blocked while an accept/reject mutation is in flight', () => {
    const { service } = setup({ isGoalMutating: () => true });
    try {
      service.createItems('pod_1', 'g1', {
        items: [{ rel: 'src/a.ts', comment: '晚到的意见' }],
      });
      throw new Error('expected 409');
    } catch (error) {
      expect(error).toBeInstanceOf(PodError);
      expect((error as PodError).status).toBe(409);
    }
  });

  test('legacy merged revisions freeze their review items without an acceptance row', () => {
    const { service, store } = setup();
    store.insertGoalWorktree({
      podId: 'pod_1', goalId: 'g1', revision: 1, dir: '/tmp/wt',
      branch: 'b', baseRef: 'main', baseBranch: 'main', status: 'merged', now,
    });
    try {
      service.createItems('pod_1', 'g1', {
        items: [{ rel: 'src/a.ts', comment: '验收后补意见' }],
      });
      throw new Error('expected 409');
    } catch (error) {
      expect(error).toBeInstanceOf(PodError);
      expect((error as PodError).status).toBe(409);
    }
  });

  test('Tech Lead can respond, only human transitions resolve/reopen', () => {
    const { service, techLeadGoals } = setup();
    const [item] = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', comment: '改这里' }],
    });
    const responded = service.respond('pod_1', 'g1', item.id, {
      sessionID: 'ses_tl', response: '已改，见 rev1',
    });
    expect(responded.status).toBe('responded');
    expect(techLeadGoals).toEqual(['g1']);

    expect(() => service.respond('pod_1', 'g1', item.id, {
      sessionID: 'ses_other', response: 'again',
    })).toThrow(PodError);

    expect(service.resolve('pod_1', 'g1', item.id, { note: '确认解决' }).status).toBe('resolved');
    expect(service.reopen('pod_1', 'g1', item.id, { note: '又出现了' }).status).toBe('pending');
  });

  test('resolved items cannot be responded to; invalid transitions are 409', () => {
    const { service } = setup();
    const [item] = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', comment: '改这里' }],
    });
    service.resolve('pod_1', 'g1', item.id);
    try {
      service.respond('pod_1', 'g1', item.id, { sessionID: 'ses_tl', response: 'late' });
      throw new Error('expected 409');
    } catch (error) {
      expect(error).toBeInstanceOf(PodError);
      expect((error as PodError).status).toBe(409);
    }
  });

  test('items are frozen after acceptance', () => {
    const { service } = setup();
    const [item] = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', comment: '改这里' }],
    });
    service.recordAcceptance({
      podId: 'pod_1', goalId: 'g1', revision: 1,
      unresolvedItemIds: [item.id], forced: true,
      riskAcknowledged: true, mergeCommit: 'abc1234',
    });
    expect(() => service.resolve('pod_1', 'g1', item.id)).toThrow(PodError);
    expect(() => service.respond('pod_1', 'g1', item.id, { sessionID: 'ses_tl', response: 'late' })).toThrow(PodError);
  });
});
