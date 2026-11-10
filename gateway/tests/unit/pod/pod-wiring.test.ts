import * as fs from 'fs';
import * as path from 'path';

const source = [
  // D3 Task 8: the class (composition root) lives in kernel.ts now.
  fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf-8'),
  fs.readFileSync(path.join(__dirname, '../../../src/boot.ts'), 'utf-8'),
  // D3 Task 7: eventBus 订阅（goal_created → startGoal）随 setupEventBus 搬到 event-hub.ts。
  fs.readFileSync(path.join(__dirname, '../../../src/server/event-hub.ts'), 'utf-8'),
].join('\n');

describe('Pod gateway wiring', () => {
  test('constructs pod services', () => {
    expect(source).toContain('new PodStore(');
    expect(source).toContain('new PodService(');
    expect(source).toContain('new PodTaskService(');
    expect(source).toContain('new PodMessageService(');
    expect(source).toContain('new PodMemoryService(');
    expect(source).toContain('new PodGoalService(');
  });

  test('constructs the revision worktree service and injects it everywhere', () => {
    expect(source).toContain('new PodWorktreeService(');
    expect(source).toMatch(/worktrees:\s*this\.podWorktreeService/);
    expect(source).toContain('workdirForRevision:');
    expect(source).toMatch(/workdirForRevision:[\s\S]{0,800}ensureExisting/);
  });

  test('resolves A2A artifacts from the active revision worktree', () => {
    expect(source).toContain('new PodA2AArtifactStore(() =>');
    expect(source).toMatch(/podArtifactRoots\(podId\)/);
    expect(source).toMatch(/getGoalWorktree\([\s\S]{0,200}status === 'active'/);
  });

  test('routes goal creation through the pod queue', () => {
    expect(source).toMatch(/eventBus\.on\("goal_created"[\s\S]{0,300}this\.startGoal/);
    expect(source).toMatch(/private async startGoal\([\s\S]{0,500}podGoalService\.enqueueGoal/);
    expect(source).toMatch(/handleValidate[\s\S]{0,300}startGoal\(/);
    expect(source).toContain('private async startGoalDirect(');
  });

  test('binds node sessions and snapshots before delete', () => {
    expect(source).toContain('podService?.bindSession(');
    // Phase D1 Task D1: DELETE /api/session/:id 迁入 routes/sessions-core.ts。
    const sessionsCore = fs.readFileSync(path.join(__dirname, '../../../src/routes/sessions-core.ts'), 'utf-8');
    expect(sessionsCore).toMatch(/snapshotSession\(sessionID\)[\s\S]{0,200}sdkSession\(\)\.delete\(sessionID\)/);
    expect(source).toContain('podService?.reconcile()');
    expect(source).toContain('podGoalService?.reconcile()');
  });

  test('archives pod goal and captures memory', () => {
    expect(source).toContain('podGoalService?.onGoalArchived(');
    expect(source).toContain('podMemoryService.captureGoal(');
  });

  test('reconciles pod tasks on both archive verdicts', () => {
    // PASS / UNREVIEWED 由 review 节点/快速完成投影收口；归档兜底必须两种成功
    // verdict 都 reconcile，否则事件丢失时任务永远停在 review（评审 Important）。
    expect(source).toContain("const successful = outcome.verdict === 'PASS' || outcome.verdict === 'UNREVIEWED'");
    expect(source).toContain("reconcileArchive(podId, goalId, successful)");
  });

  test('projects review rubric onto per-task statuses', () => {
    expect(source).toContain('readReviewRubric(');
    expect(source).toContain('applyReviewResults(podId, p.goalId, rubric.tasks)');
  });

  test('injects pod context into the goal driver', () => {
    expect(source).toContain('podContext:');
    expect(source).toContain('renderContext(podId, node)');
  });

  test('wires plan-edit resolution for pod task board edits', () => {
    expect(source).toContain('resolveGoalPlan:');
    expect(source).toMatch(/resolveGoalPlan:[\s\S]{0,400}findGoalStatePath\(goalId\)/);
    expect(source).toMatch(/resolveGoalPlan:[\s\S]{0,600}state\.nextAction/);
    expect(source).toContain('state.nodeSession,');
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
