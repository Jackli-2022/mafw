import {
  handleApproveRun,
  handleCreateStandingGoal,
  handleListStandingGoals,
} from '../../../src/routes/standing-goals';

function deps(over: Record<string, any> = {}) {
  return {
    enabled: () => true,
    list: jest.fn(() => []),
    create: jest.fn((input: any) => ({
      id: 'sg1',
      projectDir: input.projectDir,
      title: input.title,
      objective: input.objective,
      template: {},
      triggers: input.triggers,
      state: 'active',
      concurrency: 1,
      cooldownMs: 0,
      budget: {},
      approval: 'plan',
      createdBy: null,
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
      lastRunAt: null,
      nextRunAt: null,
    })),
    update: jest.fn(),
    runs: jest.fn(() => []),
    pause: jest.fn(),
    resume: jest.fn(),
    stop: jest.fn(),
    run: jest.fn(),
    getRun: jest.fn(() => ({ id: 'r1', status: 'running' })),
    approveRun: jest.fn(async () => ({ id: 'r1', status: 'done' })),
    ...over,
  } as any;
}

describe('standing goal routes', () => {
  test('returns 503 when standing goals are off', () => {
    expect(handleListStandingGoals({ projectDir: '/p' }, deps({ enabled: () => false })).status).toBe(503);
  });

  test('create validates cron and returns the stored goal', () => {
    const out = handleCreateStandingGoal({
      projectDir: '/p',
      title: 'Daily',
      objective: 'Report',
      triggers: [{ id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' }],
    }, deps());
    expect(out.status).toBe(200);
    expect(out.body.goal).toMatchObject({ title: 'Daily', state: 'active' });
    expect(handleCreateStandingGoal({ projectDir: '/p', title: 'x', objective: 'y', triggers: [] }, deps()).status).toBe(400);
  });

  test('approve rejects a run that is not waiting_person', async () => {
    expect((await handleApproveRun({ id: 'r1' }, deps({ getRun: () => ({ id: 'r1', status: 'running' }) }))).status).toBe(409);
  });
});
