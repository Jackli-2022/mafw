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

    const result = await tool.execute({
      title: 'New work',
      objective: '调研方向',
      projectDir: PROJECT,
    }, { sessionID: 'ses_lead' });

    expect(techLead.isLeadSession).toHaveBeenCalledWith('ses_lead');
    expect(techLead.createGoal).toHaveBeenCalledWith(expect.objectContaining({
      projectDir: PROJECT,
      title: 'New work',
      objective: '调研方向',
      createdBy: 'ses_lead',
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

  test('a non-Lead or absent session keeps the legacy intake path', async () => {
    const techLead = {
      isLeadSession: jest.fn(() => false),
      createGoal: jest.fn(),
    };
    const emitGoalCreated = jest.fn();
    const intake = jest.fn((input: any, deps: any) => {
      deps.emitGoalCreated({ type: 'goal_created', goalId: input.goalId, projectDir: PROJECT });
      return intakeResult(input);
    });
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
    expect(intake).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'g1',
      title: 'Fix',
      projectDir: PROJECT,
    }), expect.anything());
    expect(emitGoalCreated).toHaveBeenCalledWith(expect.objectContaining({ goalId: 'g1' }));
    expect(result.structuredContent).toMatchObject({ success: true, routedTo: 'legacy' });
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

  test('a Lead source outside a Pod stays legacy but does not auto-start', async () => {
    const techLead = {
      isLeadSession: jest.fn(() => false),
      hasPod: jest.fn(() => false),
      createGoal: jest.fn(),
    };
    const emitGoalCreated = jest.fn();
    const intake = jest.fn((input: any, deps: any) => {
      if (input.autoStart !== false) deps.emitGoalCreated({ type: 'goal_created', goalId: input.goalId });
      return intakeResult(input);
    });
    const tool = createCreateGoalTool({ techLead, intake, emitGoalCreated, now: () => NOW });

    const result = await tool.execute({
      goalId: 'g-lead', title: 'Lead work', charter: '# Lead', source: 'lead', projectDir: PROJECT,
    }, {});

    expect(techLead.createGoal).not.toHaveBeenCalled();
    expect(intake).toHaveBeenCalledWith(expect.objectContaining({
      authorization: expect.objectContaining({ source: 'lead' }),
      autoStart: false,
    }), expect.anything());
    expect(emitGoalCreated).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ success: true, routedTo: 'legacy' });
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
});
