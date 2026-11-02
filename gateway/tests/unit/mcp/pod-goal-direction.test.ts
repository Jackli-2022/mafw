import { PodError } from '../../../src/core/pod/pod-store';
import { createPodGoalDirectionTool } from '../../../src/mcp/handlers/pod-goal-direction';

const NOW = '2026-11-03T00:00:00.000Z';

function directionResult(mode: 'clear' | 'decided' | 'needs_user') {
  return {
    podId: 'pod_1',
    goalId: 'g1',
    revision: 1,
    revisionStatus: mode === 'needs_user' ? 'direction_review' : 'planning',
    directionStatus: mode === 'needs_user' ? 'pending' : 'decided',
    state: {
      version: 1,
      goalId: 'g1',
      revision: 1,
      status: mode === 'needs_user' ? 'pending' : 'decided',
      options: [],
      requests: mode === 'needs_user'
        ? [{ id: 'dirreq_1', options: [], reason: '需要你选', requestedAt: NOW, requestedBy: 'ses_tl', revision: 1 }]
        : [],
      decisions: [],
      updatedAt: NOW,
    },
    decision: mode === 'needs_user' ? null : {
      id: 'dirdec_1',
      optionId: null,
      userWords: '按方案 A',
      reason: null,
      source: mode === 'clear' ? 'tech_lead_clear' : 'user',
      revision: 1,
      decidedAt: NOW,
      options: [],
    },
    artifactPath: '/tmp/direction.json',
  };
}

describe('mafw_pod_goal_direction', () => {
  let techLead: { assertTechLeadSession: jest.Mock };
  let direction: { decide: jest.Mock; request: jest.Mock };
  let startPlanning: jest.Mock;
  let log: jest.Mock;
  let tool: ReturnType<typeof createPodGoalDirectionTool>;

  beforeEach(() => {
    techLead = { assertTechLeadSession: jest.fn(() => ({ revision: 1 })) };
    direction = {
      decide: jest.fn(({ goalId }) => directionResult(goalId === 'g1' ? 'clear' : 'decided')),
      request: jest.fn(() => directionResult('needs_user')),
    };
    startPlanning = jest.fn(async () => undefined);
    log = jest.fn();
    tool = createPodGoalDirectionTool({ techLead, direction, startPlanning, now: () => NOW, log });
  });

  test('clear records a Tech Lead decision without user attention and starts planning', async () => {
    const result = await tool.execute(
      { goalId: 'g1', mode: 'clear', userWords: '按方案 A', reason: '约束已经足够清楚' },
      { sessionID: 'ses_tl' },
    );

    expect(techLead.assertTechLeadSession).toHaveBeenCalledWith('g1', 'ses_tl');
    expect(direction.decide).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'g1',
      decision: expect.objectContaining({
        userWords: '按方案 A',
        reason: '约束已经足够清楚',
        source: 'tech_lead_clear',
      }),
    }));
    expect(direction.request).not.toHaveBeenCalled();
    expect(startPlanning).toHaveBeenCalledWith('g1');
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      success: true,
      mode: 'clear',
      goalId: 'g1',
      revision: 1,
      planningStarted: true,
    });
    expect(result.structuredContent.review).toBeUndefined();
  });

  test('clear may use the reason when no user words/option are supplied', async () => {
    const result = await tool.execute(
      { goalId: 'g1', mode: 'clear', reason: 'Tech Lead 判断方向已唯一' },
      { sessionID: 'ses_tl' },
    );

    expect(direction.decide).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'g1',
      decision: expect.objectContaining({
        userWords: 'Tech Lead 判断方向已唯一',
        reason: 'Tech Lead 判断方向已唯一',
        source: 'tech_lead_clear',
      }),
    }));
    expect(startPlanning).toHaveBeenCalledWith('g1');
    expect(result.structuredContent).toMatchObject({ success: true, mode: 'clear' });
  });

  test('decided records the user-supplied direction and starts planning', async () => {
    const result = await tool.execute(
      { goalId: 'g1', mode: 'decided', userWords: '用户补充：采用 B', optionId: 'B' },
      { sessionID: 'ses_tl' },
    );

    expect(direction.decide).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'g1',
      decision: expect.objectContaining({
        userWords: '用户补充：采用 B',
        optionId: 'B',
        source: 'user',
      }),
    }));
    expect(startPlanning).toHaveBeenCalledWith('g1');
    expect(result.structuredContent).toMatchObject({ mode: 'decided', planningStarted: true });
  });

  test('needs_user persists a DirectionReview and never starts planning', async () => {
    const result = await tool.execute({
      goalId: 'g1',
      mode: 'needs_user',
      reason: '两种架构取舍需要用户裁定',
      options: [
        { id: 'A', title: '沿用当前架构', summary: '风险低' },
        { id: 'B', title: '重写并行层', risks: ['回归风险'] },
      ],
    }, { sessionID: 'ses_tl' });

    expect(direction.request).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'g1',
      reason: '两种架构取舍需要用户裁定',
      requestedBy: 'ses_tl',
      options: [
        { id: 'A', title: '沿用当前架构', summary: '风险低' },
        { id: 'B', title: '重写并行层', risks: ['回归风险'] },
      ],
    }));
    expect(direction.decide).not.toHaveBeenCalled();
    expect(startPlanning).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      mode: 'needs_user',
      revisionStatus: 'direction_review',
      directionStatus: 'pending',
      review: expect.objectContaining({ id: 'dirreq_1' }),
    });
  });

  test('rejects callers that are not the bound Tech Lead session', async () => {
    techLead.assertTechLeadSession.mockImplementation(() => {
      throw new PodError(403, 'session is not the bound Tech Lead session for goal g1');
    });

    await expect(tool.execute({ goalId: 'g1', mode: 'clear', userWords: 'x' }, { sessionID: 'ses_other' }))
      .rejects.toMatchObject({ status: 403 });
    expect(direction.decide).not.toHaveBeenCalled();
    expect(direction.request).not.toHaveBeenCalled();
    expect(startPlanning).not.toHaveBeenCalled();

    await expect(tool.execute({ goalId: 'g1', mode: 'clear', userWords: 'x' }, {}))
      .rejects.toMatchObject({ status: 403 });
  });

  test('validates the mode and required fields', async () => {
    await expect(tool.execute({ goalId: 'g1', mode: 'nonsense' } as any, { sessionID: 'ses_tl' }))
      .rejects.toMatchObject({ status: 400 });
    await expect(tool.execute({ goalId: 'g1', mode: 'needs_user' }, { sessionID: 'ses_tl' }))
      .rejects.toMatchObject({ status: 400 });
    expect(direction.request).not.toHaveBeenCalled();
    expect(direction.decide).not.toHaveBeenCalled();
  });

  test('a planning starter failure does not lose the durable direction decision', async () => {
    startPlanning.mockRejectedValueOnce(new Error('driver unavailable'));

    const result = await tool.execute(
      { goalId: 'g1', mode: 'clear', userWords: '按方案 A' },
      { sessionID: 'ses_tl' },
    );

    expect(direction.decide).toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      success: true,
      mode: 'clear',
      planningStarted: false,
      planningError: 'driver unavailable',
    });
    expect(log).toHaveBeenCalled();
  });
});
