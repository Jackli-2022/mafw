import * as path from 'path';
import {
  createCreateGoalTool,
  handleCreateGoal,
} from '../../../src/mcp/handlers/create-goal';
import type { GoalIntakeResult } from '../../../src/core/goal/goal-intake';

const NOW = '2026-11-03T00:00:00.000Z';
const PROJECT = path.resolve('/repo/project');

function intakeResult(input: any): GoalIntakeResult {
  return {
    goalId: input.goalId,
    charterPath: '/repo/project/.mafw/goals/g1.md',
    requestPath: '/repo/project/.mafw/requests/g1.json',
    projectDir: PROJECT,
    layout: 'legacy',
    goalDir: null,
  };
}

describe('mafw_create_goal routed through the Tech Lead', () => {
  test('a Lead caller creates a discussing goal instead of starting NodeDriver', async () => {
    const created = {
      podId: 'pod_1',
      goalId: 'goal-direct-1',
      revision: 1,
      stage: 'discussing' as const,
      status: 'discussing' as const,
      sessionID: 'ses_tech_lead',
      projectDir: PROJECT,
      goalDir: '/repo/project/.mafw/goals/goal-direct-1',
      charterPath: '/repo/project/.mafw/goals/goal-direct-1/goal.md',
      requestPath: '/repo/project/.mafw/goals/goal-direct-1/request.json',
    };
    const techLead = {
      isLeadSession: jest.fn(() => true),
      createGoal: jest.fn(async () => created),
    };
    const intake = jest.fn(intakeResult);
    const emitGoalCreated = jest.fn();
    const tool = createCreateGoalTool({
      techLead,
      intake,
      emitGoalCreated,
      now: () => NOW,
    });

    const sourceRef = {
      sessionID: 'ses_free',
      messageID: 'msg_1',
      snapshot: '按方案 B 执行',
      capturedAt: NOW,
    };
    const result = await tool.execute({
      title: 'New work',
      objective: '调研方向',
      projectDir: PROJECT,
      sourceRef,
    }, { sessionID: 'ses_lead' });

    expect(techLead.isLeadSession).toHaveBeenCalledWith('ses_lead');
    expect(techLead.createGoal).toHaveBeenCalledWith(expect.objectContaining({
      projectDir: PROJECT,
      title: 'New work',
      objective: '调研方向',
      createdBy: 'ses_lead',
      sourceRef,
      authorization: expect.objectContaining({ source: 'lead' }),
    }));
    expect(intake).not.toHaveBeenCalled();
    expect(emitGoalCreated).not.toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      success: true,
      routedTo: 'tech_lead',
      goalId: 'goal-direct-1',
      stage: 'discussing',
      sessionID: 'ses_tech_lead',
    });
  });

  test('passes handoff and sourceRef to the Tech Lead', async () => {
    const createGoal = jest.fn(async () => ({ goalId: 'g1' }));
    const tool = createCreateGoalTool({
      techLead: {
        isLeadSession: () => true,
        hasPod: () => true,
        createGoal,
      },
    });

    await tool.execute({
      title: 'T',
      objective: 'O',
      sessionID: 'lead_1',
      handoff: 'current-topic',
      sourceRef: { snapshot: 'hi', topicId: 't1' },
    });

    expect(createGoal).toHaveBeenCalledWith(expect.objectContaining({
      handoff: 'current-topic',
      sourceRef: expect.objectContaining({ topicId: 't1' }),
    }));
  });

  test('Lead-selected context becomes the sourceRef and replaces auto handoff', async () => {
    const createGoal = jest.fn(async () => ({ goalId: 'g1' }));
    const tool = createCreateGoalTool({
      techLead: {
        isLeadSession: () => true,
        createGoal,
      },
      now: () => NOW,
    });

    await tool.execute({
      title: 'T',
      objective: 'O',
      sessionID: 'lead_1',
      contextSummary: '用户要求先修登录；约束：不改数据库。',
    }, { sessionID: 'lead_1' });

    expect(createGoal).toHaveBeenCalledWith(expect.objectContaining({
      sourceRef: expect.objectContaining({
        sessionID: 'lead_1',
        snapshot: '用户要求先修登录；约束：不改数据库。',
        capturedAt: NOW,
      }),
    }));
  });

  test('a non-Lead caller is rejected even before a Pod exists', async () => {
    const techLead = {
      isLeadSession: jest.fn(() => false),
      hasPod: jest.fn(() => false),
      createGoal: jest.fn(),
    };
    const emitGoalCreated = jest.fn();
    const intake = jest.fn(intakeResult);
    const tool = createCreateGoalTool({
      techLead,
      intake,
      emitGoalCreated,
      now: () => NOW,
    });

    const result = await tool.execute({
      goalId: 'g1',
      title: 'Fix',
      charter: '# Fix',
      projectDir: PROJECT,
    }, { sessionID: 'ses_builder' });

    expect(techLead.createGoal).not.toHaveBeenCalled();
    expect(intake).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ success: false, status: 403 });
  });

  test('handleCreateGoal uses the wired Tech Lead service from MCP services', async () => {
    const techLead = {
      isLeadSession: jest.fn(() => true),
      createGoal: jest.fn(async () => ({
        podId: 'pod_1',
        goalId: 'goal-direct-1',
        revision: 1,
        stage: 'discussing' as const,
        status: 'discussing' as const,
        sessionID: 'ses_tech_lead',
        projectDir: PROJECT,
        goalDir: '/repo/project/.mafw/goals/goal-direct-1',
        charterPath: '/repo/project/.mafw/goals/goal-direct-1/goal.md',
        requestPath: '/repo/project/.mafw/goals/goal-direct-1/request.json',
      })),
    };

    const out = await handleCreateGoal({
      title: 'New work',
      objective: '调研方向',
      projectDir: PROJECT,
      sessionID: 'ses_lead',
    } as any, { podTechLead: techLead } as any);

    expect(techLead.createGoal).toHaveBeenCalledWith(expect.objectContaining({
      projectDir: PROJECT,
      createdBy: 'ses_lead',
    }));
    expect(JSON.parse((out as any).content[0].text)).toMatchObject({
      success: true,
      routedTo: 'tech_lead',
      goalId: 'goal-direct-1',
    });
  });

  test('a Pod project without a caller session creates a discussing Goal, never legacy/start', async () => {
    const created = {
      podId: 'pod_1',
      goalId: 'goal-local-1',
      revision: 1,
      stage: 'discussing' as const,
      status: 'discussing' as const,
      sessionID: 'ses_tech_lead',
      projectDir: PROJECT,
      goalDir: '/repo/project/.mafw/goals/goal-local-1',
      charterPath: '/repo/project/.mafw/goals/goal-local-1/goal.md',
      requestPath: '/repo/project/.mafw/goals/goal-local-1/request.json',
    };
    const techLead = {
      isLeadSession: jest.fn(() => false),
      hasPod: jest.fn(() => true),
      createGoal: jest.fn(async () => created),
    };
    const intake = jest.fn(intakeResult);
    const emitGoalCreated = jest.fn();
    const tool = createCreateGoalTool({ techLead, intake, emitGoalCreated, now: () => NOW });

    const result = await tool.execute({
      title: 'New work', objective: 'x', projectDir: PROJECT,
    }, {});

    expect(techLead.createGoal).toHaveBeenCalledWith(expect.objectContaining({
      projectDir: PROJECT,
      title: 'New work',
      objective: 'x',
    }));
    // No transport caller identity: local user/Lead, not an arbitrary session.
    expect(techLead.createGoal.mock.calls[0][0]).not.toHaveProperty('createdBy');
    expect(techLead.isLeadSession).not.toHaveBeenCalled();
    expect(intake).not.toHaveBeenCalled();
    expect(emitGoalCreated).not.toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      success: true,
      routedTo: 'tech_lead',
      goalId: 'goal-local-1',
      revision: 1,
      stage: 'discussing',
    });
  });

  test('a Lead source without a Pod creates one and routes to Tech Lead discussion', async () => {
    const techLead = {
      isLeadSession: jest.fn(() => false),
      hasPod: jest.fn(() => false),
      createGoal: jest.fn(async () => ({
        podId: 'pod_new',
        goalId: 'goal-lead-new',
        revision: 1,
        stage: 'discussing' as const,
        status: 'discussing' as const,
        sessionID: 'ses_tl',
        projectDir: PROJECT,
        goalDir: '/repo/project/.mafw/goals/goal-lead-new',
        charterPath: '/repo/project/.mafw/goals/goal-lead-new/goal.md',
        requestPath: '/repo/project/.mafw/goals/goal-lead-new/request.json',
      })),
    };
    const intake = jest.fn(intakeResult);
    const emitGoalCreated = jest.fn();
    const tool = createCreateGoalTool({ techLead, intake, emitGoalCreated, now: () => NOW });

    const result = await tool.execute({
      title: 'Lead work', objective: '# Lead', source: 'lead', projectDir: PROJECT,
    }, {});

    expect(techLead.createGoal).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Lead work', objective: '# Lead', projectDir: PROJECT,
    }));
    expect(intake).not.toHaveBeenCalled();
    expect(emitGoalCreated).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      success: true,
      routedTo: 'tech_lead',
      goalId: 'goal-lead-new',
      revision: 1,
      stage: 'discussing',
    });
  });

  test('a non-Lead session in a Pod project is rejected, never routed to legacy', async () => {
    const techLead = {
      isLeadSession: jest.fn(() => false),
      hasPod: jest.fn(() => true),
      createGoal: jest.fn(),
    };
    const intake = jest.fn(intakeResult);
    const tool = createCreateGoalTool({ techLead, intake, now: () => NOW });

    const result = await tool.execute({
      goalId: 'g1', title: 'Fix', charter: '# Fix', projectDir: PROJECT,
    }, { sessionID: 'ses_builder' });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ success: false, status: 403 });
    expect(intake).not.toHaveBeenCalled();
  });

  test('Tech Lead failures return an error payload, not a silent fallback', async () => {
    const techLead = {
      isLeadSession: jest.fn(() => true),
      createGoal: jest.fn(async () => { throw new Error('project is not registered'); }),
    };
    const intake = jest.fn(intakeResult);
    const tool = createCreateGoalTool({ techLead, intake, now: () => NOW });

    const result = await tool.execute({
      title: 'New work', objective: 'x', projectDir: PROJECT,
    }, { sessionID: 'ses_lead' });

    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content[0] as any).text)).toMatchObject({
      success: false,
      error: expect.stringContaining('project is not registered'),
    });
    expect(intake).not.toHaveBeenCalled();
    expect(techLead.createGoal).toHaveBeenCalledTimes(1);
  });

  test('passes forkFromTopicId to the Tech Lead', async () => {
    const techLead = {
      isLeadSession: jest.fn(() => true),
      hasPod: jest.fn(() => true),
      createGoal: jest.fn(async () => ({ goalId: 'g-fork' })),
    };
    const tool = createCreateGoalTool({ techLead, now: () => NOW });

    await tool.execute({
      title: 'Fork', objective: 'O', sessionID: 'ses_lead', forkFromTopicId: 't1',
    });

    expect(techLead.createGoal).toHaveBeenCalledWith(expect.objectContaining({
      forkFromTopicId: 't1',
    }));
  });
});
