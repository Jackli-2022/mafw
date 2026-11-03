import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleManagerSetGoal } from '../../../src/mcp/handlers/manager-set-goal';

describe('mafw_set_goal routed through the Lead/Tech Lead path', () => {
  test('passes the source snapshot to Pod Tech Lead instead of writing a Pod-less Goal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-set-goal-techlead-'));
    const projectDir = path.join(root, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    const sourceRef = {
      sessionID: 'ses_free',
      messageID: 'msg_2',
      snapshot: '讨论决定创建 Goal',
      capturedAt: '2026-11-03T00:00:00.000Z',
    };
    const createGoal = jest.fn(async () => ({
      podId: 'pod_1',
      goalId: 'goal-from-set',
      revision: 1,
      stage: 'discussing' as const,
      status: 'discussing' as const,
      sessionID: 'ses_tl',
      projectDir,
      goalDir: path.join(projectDir, '.mafw', 'goals', 'goal-from-set'),
      charterPath: path.join(projectDir, '.mafw', 'goals', 'goal-from-set', 'goal.md'),
      requestPath: path.join(projectDir, '.mafw', 'goals', 'goal-from-set', 'request.json'),
    }));
    const services = {
      podTechLead: { createGoal },
      listProjects: () => [{ projectDir, mafwDir: path.join(projectDir, '.mafw') }],
    } as any;

    const out = await handleManagerSetGoal({
      goalId: 'goal-from-set',
      title: 'Set by Lead',
      charter: '# Set by Lead',
      projectDir,
      sourceRef,
    }, services);
    const payload = JSON.parse(out.content![0].text as string);

    expect(payload).toMatchObject({ success: true, routedTo: 'tech_lead', goalId: 'goal-from-set' });
    expect(createGoal).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'goal-from-set',
      projectDir,
      source: 'lead',
      sourceRef,
      authorization: expect.objectContaining({ source: 'lead' }),
    }));
    expect(fs.existsSync(path.join(projectDir, '.mafw', 'requests', 'goal-from-set.json'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
