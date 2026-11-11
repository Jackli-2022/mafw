import { handlePodReviewRespond } from '../../src/mcp/handlers/pod-review-respond';

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
});
