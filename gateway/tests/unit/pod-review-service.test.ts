import Database from 'better-sqlite3';
import { PodError, PodStore } from '../../src/core/pod/pod-store';
import { PodReviewService } from '../../src/core/pod/pod-review-service';

function setup() {
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
