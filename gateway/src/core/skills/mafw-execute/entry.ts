import { log } from '../../utils/logger';
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
 * mafw-execute Skill Entry —Execute Agent锛堢嫭绔?Session锛?
 *
 * 銆愬叧閿€戠姸鎬佹洿鏂版槸涓昏矾寰勶紝鍐欏湪鍑芥暟鏈熬
 *
 * 鑱岃矗锛?
 *   1. 璇诲彇 waves.json
 *   2. Wave 1: Task 骞惰鎵ц锛堝悇鑷?Git 鍒嗘敮锛?
 *   3. 姣忎釜 Task: 璋冪敤 LLM 缂栧啓浠ｇ爜锛屽啓鍏ユ枃浠讹紝git commit
 *   4. 鍚堝苟 Wave 鈫?goal/{goalId}
 *   5. Wave 2+: 閲嶅
 *   6. 杩滅▼ CLI 鍚屾锛堝鏋滈厤缃級
 *   7. 鍐欏叆 receipts/{goalId}/
 *   8. 銆愭樉寮忋€戞洿鏂?state.json 鈫?nextAction: CREATE_REVIEW_SESSION
 *
 * 璋冪敤鏂瑰紡锛歋cheduler 鍒涘缓 Execute Session 鈫?鍙戦€?/skill mafw-execute {goalId}
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

  log.info(`[mafw-execute] Starting Execute for Goal: ${goalId}`);

  // 1. 璇诲彇鐘舵€?
  const state = await loadState(goalId, projectDir);
  const req = await loadRequest(goalId, projectDir);

  // 2. 璁板綍 Session
  await recordSession(goalId, 'execute', context.sessionId, projectDir);

  // 3. 鍑嗗 Worktree
  const worktreeManager = new GoalWorktreeManager(projectDir);
  const worktree = await worktreeManager.prepare({
    projectDir,
    goalId,
    parallel: req.parallel || false
  });
  log.info(`[mafw-execute] Worktree ready: ${worktree.branch} at ${worktree.worktreeDir}`);

  // 4. 璇诲彇 Waves
  const waves = await loadWaves(goalId, projectDir);
  if (waves.length === 0) {
    throw new Error(`No waves found for goal ${goalId}`);
  }
  log.info(`[mafw-execute] ${waves.length} waves to execute`);

  // 5. 鎵ц Waves
  const taskBranchManager = new TaskBranchManager();
  const receipts: any[] = [];

  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i];
    log.info(`[mafw-execute] Wave ${i + 1}/${waves.length}: ${wave.name || 'unnamed'}`);

    // 鏇存柊 Wave 杩涘害
    await updateWaveProgress(goalId, i + 1, waves.length, projectDir);

    // Wave 鍐?Task 骞惰锛堝悇鑷?Git 鍒嗘敮锛?
    const waveResult = await executeWave(wave, {
      goalId,
      worktreeDir: worktree.worktreeDir,
      baseBranch: worktree.branch,
      loopNum: state.loop,
      llm: context.llm,
      model: context.config.model,
      taskBranchManager
    });

    // 鍚堝苟 Wave 鍒?Goal 鍒嗘敮
    const mergeResult = await mergeWaveToGoal(wave, worktree.worktreeDir, taskBranchManager, waveResult.tasks);
    receipts.push({ waveId: wave.id, ...waveResult, merge: mergeResult });
  }

  // 6. 杩滅▼ CLI 鍚屾锛堝鏋滈厤缃級
  if (req.remoteCli?.syncOnExecute) {
    const remoteCli = new RemoteCliConnector();
    log.info(`[mafw-execute] Syncing to remote: ${req.remoteCli.host}`);
    const syncResult = await remoteCli.sync({
      localDir: worktree.worktreeDir,
      remoteHost: req.remoteCli.host,
      remoteDir: req.remoteCli.projectDir
    });

    if (!syncResult.success) {
      log.error(`[mafw-execute] Remote sync failed: ${syncResult.output}`);
      // 涓嶆姏鍑洪敊璇紝缁х画鎵ц锛屼絾璁板綍
    }

    receipts.push({ phase: 'sync', result: syncResult });
  }

  // 7. 鍐欏叆 receipts
  await writeReceipts(goalId, projectDir, receipts);
  log.info(`[mafw-execute] Written ${receipts.length} receipts`);

  // 8. 妫€鏌?Wave 鍚堝苟缁撴灉
  const hasPartialMerge = receipts.some((r: any) => r.merge && r.merge.status !== 'merged');

  // 9. 銆愭樉寮忕姸鎬佹洿鏂般€戦€氱煡 Scheduler 杩涘叆 REVIEWING 鎴?FAILED
  if (hasPartialMerge) {
    await transitionPhase(goalId, {
      from: 'EXECUTING',
      to: 'EXECUTING_COMPLETE',
      nextAction: 'FAILED',
      error: 'wave_merge_partial',
      artifacts: { execute: `receipts/${goalId}/` }
    }, projectDir);
    await handleLoopEvent(goalId, 'wave.fail', undefined, state.loop, projectDir);
    log.info(`[mafw-execute] Execute complete with partial merge. State updated 鈫?FAILED`);
  } else {
    await transitionPhase(goalId, {
      from: 'EXECUTING',
      to: 'EXECUTING_COMPLETE',
      nextAction: 'CREATE_REVIEW_SESSION',
      artifacts: { execute: `receipts/${goalId}/` }
    }, projectDir);
    await handleLoopEvent(goalId, 'wave.complete', undefined, state.loop, projectDir);
    log.info(`[mafw-execute] Execute complete. State updated 鈫?CREATE_REVIEW_SESSION`);
  }
}

// 鈹€鈹€ Wave 鎵ц 鈹€鈹€

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

  // Task 骞惰鎵ц锛堝悇鑷?Git 鍒嗘敮锛?
  const taskResults = await Promise.all(
    tasks.map(async (task: any) => {
      try {
        // 鍒涘缓 Task 鍒嗘敮
        const branch = await taskBranchManager.createTaskBranch(worktreeDir, task.id, baseBranch);
        log.info(`  [Task] ${task.id}: branch ${branch}`);

        // 璋冪敤 LLM 缂栧啓浠ｇ爜
        const taskPrompt = buildTaskPrompt(task, worktreeDir);
        const response = await llm.chat({
          model,
          messages: [{ role: 'user', content: taskPrompt }]
        });

        // 鍐欏叆鏂囦欢锛堟ā鎷燂級
        // 瀹為檯搴旂敱 LLM 鐢熸垚鏂囦欢鍐呭骞跺啓鍏?
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
        log.error(`  [Task] ${task.id} failed: ${err.message}`);
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

// 鈹€鈹€ 鍚堝苟 Wave 鈹€鈹€

export async function mergeWaveToGoal(
  wave: any,
  worktreeDir: string,
  taskBranchManager: TaskBranchManager,
  taskResults: any[]
): Promise<{ merged: string[]; failed: string[]; status: string }> {
  const completedTasks = taskResults.filter((r: any) => r.status === 'completed');
  const taskIds = completedTasks.map((r: any) => r.taskId);
  log.info(`[mafw-execute] Merging wave ${wave.id} (${taskIds.length} tasks) into goal branch`);

  const merged: string[] = [];
  const failed: string[] = [];
  for (const taskId of taskIds) {
    try {
      await taskBranchManager.mergeTaskBranch(worktreeDir, taskId);
      merged.push(taskId);
    } catch (err: any) {
      log.error(`[mafw-execute] Failed to merge task ${taskId}: ${err.message}`);
      failed.push(taskId);
    }
  }

  return {
    merged,
    failed,
    status: failed.length === 0 ? 'merged' : 'partial'
  };
}

// 鈹€鈹€ 鍐欏叆 Receipts 鈹€鈹€

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

// 鈹€鈹€ 杈呭姪 鈹€鈹€

function buildTaskPrompt(task: any, worktreeDir: string): string {
  return `# Task: ${task.id}\n\n${task.description}\n\n## Affected Files\n\n${(task.affected_files || []).join('\n')}\n\n## Instructions\n\nImplement this task. Write the code to the affected files.\nWorktree: ${worktreeDir}\n`;
}

async function writeTaskCode(task: any, content: string, worktreeDir: string): Promise<void> {
  // 瑙ｆ瀽 content 涓殑鏂囦欢鍐呭骞跺啓鍏?
  // 绠€鍖栧疄鐜帮細鐩存帴鍐欏叆涓€涓枃浠?
  for (const file of task.affected_files || []) {
    const filePath = path.join(worktreeDir, file);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, `// Generated by MAFW Execute Agent\n// Task: ${task.id}\n\n${content}`, 'utf-8');
  }
}



