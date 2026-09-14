import { handleCreateGoal } from '../../src/mcp/handlers/create-goal';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-budget-'));
process.env.MAFW_PROJECT_DIR = tmp;

afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('mafw_create_goal budget passthrough', () => {
  it('writes request.budget when provided', async () => {
    const out = await handleCreateGoal({
      goalId: 'budget-1', title: 'T', charter: '# C',
      budget: { maxTurns: 12, maxCostUsd: 0.5 },
    } as any, {} as any);
    const parsed = JSON.parse((out as any).content[0].text);
    expect(parsed.success).toBe(true);
    const request = JSON.parse(fs.readFileSync(path.join(tmp, '.mafw', 'requests', 'budget-1.json'), 'utf-8'));
    expect(request.budget).toEqual({ maxTurns: 12, maxCostUsd: 0.5 });
  });

  it('omits request.budget when absent', async () => {
    await handleCreateGoal({ goalId: 'budget-2', title: 'T', charter: '# C' } as any, {} as any);
    const request = JSON.parse(fs.readFileSync(path.join(tmp, '.mafw', 'requests', 'budget-2.json'), 'utf-8'));
    expect(request.budget).toBeUndefined();
  });

  it('omits request.budget when both fields missing', async () => {
    await handleCreateGoal({ goalId: 'budget-3', title: 'T', charter: '# C', budget: {} } as any, {} as any);
    const request = JSON.parse(fs.readFileSync(path.join(tmp, '.mafw', 'requests', 'budget-3.json'), 'utf-8'));
    expect(request.budget).toBeUndefined();
  });
});
