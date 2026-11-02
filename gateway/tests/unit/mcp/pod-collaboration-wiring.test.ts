import * as fs from 'fs';
import * as path from 'path';

describe('Pod collaboration MCP wiring gate', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'index.ts'), 'utf-8');

  test('MCP services expose the Tech Lead and direction services', () => {
    expect(source).toContain('podTechLead: this.podTechLeadService');
    expect(source).toContain('podDirection: this.podDirectionService');
    expect(source).toContain('podGoalDirection: {');
    expect(source).toContain('techLead: this.podTechLeadService');
    expect(source).toContain('direction: this.podDirectionService');
    expect(source).toContain('startPlanning: (goalId: string) => this.startGoalDirect(goalId)');
  });

  test('discussion Goals are gated in the starter and the goal_created listener', () => {
    expect(source).toContain('shouldAutoStartGoalEvent(data)');
    expect(source).toContain('this.podGoalService.isStartable(goalId)');
    expect(source).toContain('refusing to start before a direction decision');
  });

  test('the starter resolves goal-dir requests and preserves their plan fields', () => {
    expect(source).toContain('findGoalRequestPath(found.mafwDir, goalId)');
    expect(source).toContain('readGoalRequest(found.mafwDir, goalId)');
    expect(source).toContain("request?.planReview === 'manual'");
    expect(source).toContain('isTaskType(request?.taskType)');
  });
});
