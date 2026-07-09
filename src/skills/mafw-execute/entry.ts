import * as fs from 'fs';
import * as path from 'path';
import {
  loadState, loadRequest, loadWaves, extractGoalId, updateState
} from '../../utils/state';
import { transitionPhase, recordSession, updateWaveProgress, handleLoopEvent } from '../../engine/phase-orchestrator';
import { GoalWorktreeManager } from '../../engine/goal-worktree-manager';
import { TaskBranchManager } from '../../engine/task-branch-manager';
import { GitUtils } from '../../utils/git';
import { RemoteCliConnector } from '../../tools/remote-cli';

/**
 * mafw-execute Skill Entry — Execute Agent（独立 Session）
 *
 * 【关键】状态更新是主路径，写在函数末尾
 *
 * 职责：
 *   1. 读取 waves.json
 *   2. Wave 1: Task 并行执行（各自 Git 分支）
 *   3. 每个 Task: 调用 LLM 编写代码，写入文件，git commit
 *   4. 合并 Wave → goal/{goalId}
 *   5. Wave 2+: 重复
 *   6. 远程 CLI 同步（如果配置）
 *   7. 写入 receipts/{goalId}/
 *   8. 【显式】更新 state.json → nextAction: CREATE_REVIEW_SESSION
 *
 * 调用方式：Scheduler 创建 Execute Session → 发送 /skill mafw-execute {goalId}
 */

export interface ExecuteSkillContext {
  message: string;
  llm: {
    chat: (options: { model: string; messages: any[] }) => Promise<{ content: string }>;
  };
  config: { model: string };
  sessionId: string;
}

export async function mafwExecuteEntry(context: ExecuteSkillContext): Promise<void> {
  const goalId = extractGoalId(context.message);
  const projectDir = process.cwd();

  console.log(`[mafw-execute] Starting Execute for Goal: ${goalId}`);

  // 1. 读取状态
  const state = await loadState(goalId, projectDir);
  const req = await loadRequest(goalId, projectDir);

  // 2. 记录 Session
  await recordSession(goalId, 'execute', context.sessionId, projectDir);

  // 3. 准备 Worktree
  const worktreeManager = new GoalWorktreeManager(projectDir);
  const worktree = await worktreeManager.prepare({
    projectDir,
    goalId,
    parallel: req.parallel || false
  });
  console.log(`[mafw-execute] Worktree ready: ${worktree.branch} at ${worktree.worktreeDir}`);

  // 4. 读取 Waves
  const waves = await loadWaves(goalId, projectDir);
  if (waves.length === 0) {
    throw new Error(`No waves found for goal ${goalId}`);
  }
  console.log(`[mafw-execute] ${waves.length} waves to execute`);

  // 5. 执行 Waves
  const taskBranchManager = new TaskBranchManager();
  const receipts: any[] = [];

  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i];
    console.log(`[mafw-execute] Wave ${i + 1}/${waves.length}: ${wave.name || 'unnamed'}`);

    // 更新 Wave 进度
    await updateWaveProgress(goalId, i + 1, waves.length, projectDir);

    // Wave 内 Task 并行（各自 Git 分支）
    const waveResult = await executeWave(wave, {
      goalId,
      worktreeDir: worktree.worktreeDir,
      baseBranch: worktree.branch,
      loopNum: state.loop,
      llm: context.llm,
      model: context.config.model,
      taskBranchManager
    });

    // 合并 Wave 到 Goal 分支
    const mergeResult = await mergeWaveToGoal(wave, worktree.worktreeDir, taskBranchManager, waveResult.tasks);
    receipts.push({ waveId: wave.id, ...waveResult, merge: mergeResult });
  }

  // 6. 远程 CLI 同步（如果配置）
  if (req.remoteCli?.syncOnExecute) {
    const remoteCli = new RemoteCliConnector();
    console.log(`[mafw-execute] Syncing to remote: ${req.remoteCli.host}`);
    const syncResult = await remoteCli.sync({
      localDir: worktree.worktreeDir,
      remoteHost: req.remoteCli.host,
      remoteDir: req.remoteCli.projectDir
    });

    if (!syncResult.success) {
      console.error(`[mafw-execute] Remote sync failed: ${syncResult.output}`);
      // 不抛出错误，继续执行，但记录
    }

    receipts.push({ phase: 'sync', result: syncResult });
  }

  // 7. 写入 receipts
  await writeReceipts(goalId, projectDir, receipts);
  console.log(`[mafw-execute] Written ${receipts.length} receipts`);

  // 8. 检查 Wave 合并结果
  const hasPartialMerge = receipts.some((r: any) => r.merge && r.merge.status !== 'merged');

  // 9. 【显式状态更新】通知 Scheduler 进入 REVIEWING 或 FAILED
  if (hasPartialMerge) {
    await transitionPhase(goalId, {
      from: 'EXECUTING',
      to: 'EXECUTING_COMPLETE',
      nextAction: 'FAILED',
      error: 'wave_merge_partial',
      artifacts: { execute: `receipts/${goalId}/` }
    }, projectDir);
    await handleLoopEvent(goalId, 'wave.fail', undefined, state.loop, projectDir);
    console.log(`[mafw-execute] Execute complete with partial merge. State updated → FAILED`);
  } else {
    await transitionPhase(goalId, {
      from: 'EXECUTING',
      to: 'EXECUTING_COMPLETE',
      nextAction: 'CREATE_REVIEW_SESSION',
      artifacts: { execute: `receipts/${goalId}/` }
    }, projectDir);
    await handleLoopEvent(goalId, 'wave.complete', undefined, state.loop, projectDir);
    console.log(`[mafw-execute] Execute complete. State updated → CREATE_REVIEW_SESSION`);
  }
}

// ── Wave 执行 ──

async function executeWave(
  wave: any,
  options: {
    goalId: string;
    worktreeDir: string;
    baseBranch: string;
    loopNum: number;
    llm: any;
    model: string;
    taskBranchManager: TaskBranchManager;
  }
): Promise<{ tasks: any[]; status: string }> {
  const { goalId, worktreeDir, baseBranch, loopNum, llm, model, taskBranchManager } = options;
  const tasks = wave.tasks || [];

  // Task 并行执行（各自 Git 分支）
  const taskResults = await Promise.all(
    tasks.map(async (task: any) => {
      try {
        // 创建 Task 分支
        const branch = await taskBranchManager.createTaskBranch(worktreeDir, task.id, baseBranch);
        console.log(`  [Task] ${task.id}: branch ${branch}`);

        // 调用 LLM 编写代码
        const taskPrompt = buildTaskPrompt(task, worktreeDir);
        const response = await llm.chat({
          model,
          messages: [{ role: 'user', content: taskPrompt }]
        });

        // 写入文件（模拟）
        // 实际应由 LLM 生成文件内容并写入
        await writeTaskCode(task, response.content, worktreeDir);

        // Git commit
        const git = new GitUtils(worktreeDir);
        await git.commit(task.affected_files || [], `task(${task.id}): ${task.description}`);

        return {
          taskId: task.id,
          status: 'completed',
          branch,
          filesChanged: task.affected_files || []
        };
      } catch (err: any) {
        console.error(`  [Task] ${task.id} failed: ${err.message}`);
        return {
          taskId: task.id,
          status: 'failed',
          error: err.message
        };
      }
    })
  );

  return { tasks: taskResults, status: 'completed' };
}

// ── 合并 Wave ──

export async function mergeWaveToGoal(
  wave: any,
  worktreeDir: string,
  taskBranchManager: TaskBranchManager,
  taskResults: any[]
): Promise<{ merged: string[]; failed: string[]; status: string }> {
  const completedTasks = taskResults.filter((r: any) => r.status === 'completed');
  const taskIds = completedTasks.map((r: any) => r.taskId);
  console.log(`[mafw-execute] Merging wave ${wave.id} (${taskIds.length} tasks) into goal branch`);

  const merged: string[] = [];
  const failed: string[] = [];
  for (const taskId of taskIds) {
    try {
      await taskBranchManager.mergeTaskBranch(worktreeDir, taskId);
      merged.push(taskId);
    } catch (err: any) {
      console.error(`[mafw-execute] Failed to merge task ${taskId}: ${err.message}`);
      failed.push(taskId);
    }
  }

  return {
    merged,
    failed,
    status: failed.length === 0 ? 'merged' : 'partial'
  };
}

// ── 写入 Receipts ──

async function writeReceipts(goalId: string, projectDir: string, receipts: any[]): Promise<void> {
  const receiptsDir = path.join(projectDir, '.mafw/receipts', goalId);
  if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
  }

  const receiptFile = path.join(receiptsDir, `loop-receipt.json`);
  fs.writeFileSync(receiptFile, JSON.stringify({
    goalId,
    timestamp: new Date().toISOString(),
    receipts
  }, null, 2), 'utf-8');
}

// ── 辅助 ──

function buildTaskPrompt(task: any, worktreeDir: string): string {
  return `# Task: ${task.id}\n\n${task.description}\n\n## Affected Files\n\n${(task.affected_files || []).join('\n')}\n\n## Instructions\n\nImplement this task. Write the code to the affected files.\nWorktree: ${worktreeDir}\n`;
}

async function writeTaskCode(task: any, content: string, worktreeDir: string): Promise<void> {
  // 解析 content 中的文件内容并写入
  // 简化实现：直接写入一个文件
  for (const file of task.affected_files || []) {
    const filePath = path.join(worktreeDir, file);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, `// Generated by MAFW Execute Agent\n// Task: ${task.id}\n\n${content}`, 'utf-8');
  }
}
