import { createLeadGoalStatusTool, handleLeadGoalStatus } from '../../../src/mcp/handlers/lead-goal-status';

function view(over: Record<string, unknown>) {
  return {
    id: 'row_1',
    podId: 'pod_1',
    goalId: 'g1',
    status: 'active',
    title: 'T',
    phase: null,
    verdict: null,
    stage: { owner: 'person', kind: 'plan_approval' },
    bucket: 'working',
    resultReady: false,
    accepted: false,
    progress: { done: 1, total: 3, inProgress: 0, review: 0, failed: 0, skipped: 0 },
    sourceRef: null,
    strategy: null,
    assessment: null,
    currentAssignment: null,
    pendingQuestion: null,
    activeRevision: 1,
    revision: 1,
    priority: 0,
    enqueuedAt: '2026-11-10T00:00:00.000Z',
    startedAt: null,
    endedAt: null,
    ...over,
  } as any;
}

describe('mafw_lead_goal_status', () => {
  test('returns the projected goals', async () => {
    const tool = createLeadGoalStatusTool({
      listViews: () => [view({})],
      attention: () => [{ goalId: 'g1', kind: 'plan_approval' } as any],
    });
    const result = await tool.execute({ projectDir: '/p' });
    expect(result.structuredContent).toMatchObject({
      success: true,
      goals: [expect.objectContaining({ goalId: 'g1', pendingAttention: 1 })],
    });
  });

  test('unwired handler returns 503', async () => {
    const result = await handleLeadGoalStatus({ projectDir: '/p' }, {} as any);
    expect(result.structuredContent).toMatchObject({ success: false, status: 503 });
  });
});
