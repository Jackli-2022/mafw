import { createStandingGoalTool } from '../../../src/mcp/handlers/standing-goals';

describe('standing goal MCP tools', () => {
  test('create forwards triggers and returns the goal', async () => {
    const create = jest.fn(() => ({
      id: 'sg1',
      projectDir: '/p',
      title: 'Daily',
      objective: 'Report',
      template: {},
      triggers: [],
      state: 'active',
    }));
    const tool = createStandingGoalTool({
      service: { create } as any,
      projectDir: () => '/p',
    });
    const result = await tool.execute({
      title: 'Daily',
      objective: 'Report',
      triggers: [{ id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' }],
    }, { sessionID: 'ses_lead' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ projectDir: '/p', title: 'Daily' }));
    expect(JSON.parse((result.content[0] as any).text)).toMatchObject({ success: true, goal: { id: 'sg1' } });
  });

  test('disabled service returns a structured error', async () => {
    const tool = createStandingGoalTool({ service: { create: () => { throw Object.assign(new Error('disabled'), { status: 503 }); } } as any, projectDir: () => '/p' });
    const result = await tool.execute({ title: 'x', objective: 'y', triggers: [] }, {});
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content[0] as any).text)).toMatchObject({ success: false, status: 503 });
  });

  test('feature flag off gates the tool even when a service exists', async () => {
    const tool = createStandingGoalTool({
      service: { create: jest.fn() } as any,
      projectDir: () => '/p',
      enabled: () => false,
    });
    const result = await tool.execute({ title: 'x', objective: 'y', triggers: [] }, {});
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content[0] as any).text)).toMatchObject({ success: false, status: 503 });
  });
});
