import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '../../../src/index.ts'),
  'utf-8',
);

describe('Pod gateway wiring', () => {
  test('constructs pod services', () => {
    expect(source).toContain('new PodStore(');
    expect(source).toContain('new PodService(');
    expect(source).toContain('new PodTaskService(');
    expect(source).toContain('new PodMessageService(');
    expect(source).toContain('new PodMemoryService(');
    expect(source).toContain('new PodGoalService(');
  });

  test('routes goal creation through the pod queue', () => {
    expect(source).toMatch(/eventBus\.on\("goal_created"[\s\S]{0,300}this\.startGoal/);
    expect(source).toMatch(/private async startGoal\([\s\S]{0,500}podGoalService\.enqueueGoal/);
    expect(source).toMatch(/handleValidate[\s\S]{0,300}startGoal\(/);
    expect(source).toContain('private async startGoalDirect(');
  });

  test('binds node sessions and snapshots before delete', () => {
    expect(source).toContain('podService?.bindSession(');
    expect(source).toMatch(/snapshotSession\(sessionID\)[\s\S]{0,200}sdkSession\.delete\(sessionID\)/);
    expect(source).toContain('podService?.reconcile()');
    expect(source).toContain('podGoalService?.reconcile()');
  });

  test('archives pod goal and captures memory', () => {
    expect(source).toContain('podGoalService?.onGoalArchived(');
    expect(source).toContain('podMemoryService.captureGoal(');
  });

  test('reconciles pod tasks on both archive verdicts', () => {
    // PASS 由 review 节点投影收口；归档兜底必须两种 verdict 都 reconcile，
    // 否则事件丢失时任务永远停在 review（评审 Important）。
    expect(source).toContain("reconcileArchive(podId, goalId, outcome.verdict === 'PASS')");
  });

  test('injects pod context into the goal driver', () => {
    expect(source).toContain('podContext:');
    expect(source).toContain('renderContext(podId, node)');
  });

  test('projects goal node artifacts into the task board', () => {
    expect(source).toContain('onPodGoalNode(');
    expect(source).toContain('podTaskService.projectWaves(');
    expect(source).toContain('podTaskService.applyReceipt(');
    expect(source).toContain('podTaskService.reopenForReview(');
    expect(source).toContain('podTaskService.startExecution(');
    expect(source).toContain('podTaskService.clearProjected(');
  });
});
