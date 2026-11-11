import Database from 'better-sqlite3';
import { handlePodReviewRespond } from '../../src/mcp/handlers/pod-review-respond';
import { PodReviewService } from '../../src/core/pod/pod-review-service';
import { PodStore } from '../../src/core/pod/pod-store';

describe('mafw_pod_review_respond handler', () => {
  test('forwards goal/item/response to the review service', async () => {
    const calls: any[] = [];
    const services = {
      podReview: {
        respond: (podId: string, goalId: string, itemId: string, input: any) => {
          calls.push({ podId, goalId, itemId, input });
          return { id: itemId, status: 'responded' };
        },
      },
      podStore: { getGoalByGoalId: (goalId: string) => (goalId === 'g1' ? { podId: 'pod_1', goalId } : null) },
    };
    const result = await handlePodReviewRespond({
      goalId: 'g1', itemId: 'review_1', response: '已改', sessionID: 'ses_tl',
    }, services as any);
    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      podId: 'pod_1',
      goalId: 'g1',
      itemId: 'review_1',
      input: { sessionID: 'ses_tl', response: '已改' },
    });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      success: true, itemId: 'review_1', status: 'responded',
    });
  });

  test('fails closed when the goal or service is unknown', async () => {
    const noService = await handlePodReviewRespond({
      goalId: 'g1', itemId: 'review_1', response: '已改', sessionID: 'ses_tl',
    }, {} as any);
    expect(noService.isError).toBe(true);

    const noGoal = await handlePodReviewRespond({
      goalId: 'missing', itemId: 'review_1', response: '已改', sessionID: 'ses_tl',
    }, {
      podReview: { respond: () => ({ id: 'review_1', status: 'responded' }) },
      podStore: { getGoalByGoalId: () => null },
    } as any);
    expect(noGoal.isError).toBe(true);
  });

  test('works against the real store/service shape wired by the gateway', async () => {
    const store = new PodStore(new Database(':memory:'));
    store.ensurePod({ id: 'pod_1', projectDir: '/tmp/project', name: 'Project', now: '2026-11-11T00:00:00.000Z' });
    store.enqueueGoal({ id: 'podgoal_1', podId: 'pod_1', goalId: 'g1', now: '2026-11-11T00:00:00.000Z' });
    store.setGoalStatus('podgoal_1', 'active', { startedAt: '2026-11-11T00:00:00.000Z' });
    const service = new PodReviewService({
      store,
      now: () => '2026-11-11T00:01:00.000Z',
      assertTechLeadSession: () => {},
    });
    const [item] = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', comment: '改这里' }],
    });
    const result = await handlePodReviewRespond({
      goalId: 'g1', itemId: item.id, response: '已改', sessionID: 'ses_tl',
    }, { podReview: service, podStore: store } as any);
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ success: true, status: 'responded' });
    expect(store.getReviewItem(item.id)?.status).toBe('responded');
  });
});
