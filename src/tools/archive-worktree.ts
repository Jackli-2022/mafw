/**
 * Archive Worktree Tool — Archive tool 函数
 *
 * 职责：
 *   1. 合并 Goal 分支到 main
 *   2. 生成报告
 *   3. 更新 STATUS.md
 *   4. 清理临时资源
 *
 * 被 Scheduler 在 ARCHIVE 阶段调用。
 */

import * as fs from 'fs';
import * as path from 'path';
import { GoalWorktreeManager } from '../engine/goal-worktree-manager';

export interface ArchiveContext {
  goalId: string;
  projectDir: string;
  loopCount: number;
}

/**
 * 执行 Archive 流程
 */
export async function archiveWorktree(context: ArchiveContext): Promise<void> {
  const { goalId, projectDir, loopCount } = context;
  
  console.log(`[archive-worktree] Archiving goal ${goalId}`);

  // 1. 合并 Goal 分支到 main
  const worktreeManager = new GoalWorktreeManager(projectDir);
  const info = await worktreeManager.getCurrentInfo(goalId);
  
  try {
    await worktreeManager.archive(info, 'merge');
    console.log(`[archive-worktree] Merged goal/${goalId} into main`);
  } catch (err: any) {
    console.error(`[archive-worktree] Merge failed: ${err.message}`);
    throw err;
  }

  // 2. 生成报告
  await generateReport(goalId, projectDir, loopCount);

  // 3. 更新 STATUS.md
  updateStatusArchive(goalId, projectDir);

  console.log(`[archive-worktree] Goal ${goalId} archived successfully`);
}

/**
 * 生成报告
 */
async function generateReport(goalId: string, projectDir: string, loopCount: number): Promise<void> {
  const reportsDir = path.join(projectDir, '.opencode/mafw/reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const reportPath = path.join(reportsDir, `${goalId}.md`);
  const report = `# Report: ${goalId}

## Summary

- Goal: ${goalId}
- Loops: ${loopCount}
- Status: COMPLETED
- Completed: ${new Date().toISOString()}

## Artifacts

- Plan: waves.json
- Receipts: receipts/${goalId}/
- Reviews: reviews/${goalId}-loop*.md

## Notes

Goal completed successfully after ${loopCount} loop(s).
`;

  fs.writeFileSync(reportPath, report, 'utf-8');
  console.log(`[archive-worktree] Report generated: ${reportPath}`);
}

/**
 * 更新 STATUS.md 为 COMPLETED
 */
function updateStatusArchive(goalId: string, projectDir: string): void {
  const statusPath = path.join(projectDir, '.opencode/mafw/STATUS.md');
  
  if (!fs.existsSync(statusPath)) {
    return;
  }

  const content = fs.readFileSync(statusPath, 'utf-8');
  // 更新对应 Goal 的状态
  const updated = content.replace(
    new RegExp(`(goalId: "${goalId}"[\s\S]*?state:) "[^"]*"`, 'g'),
    `$1 "COMPLETED"`
  );
  
  fs.writeFileSync(statusPath, updated, 'utf-8');
  console.log(`[archive-worktree] STATUS.md updated for ${goalId}`);
}
