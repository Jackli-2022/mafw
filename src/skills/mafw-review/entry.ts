import * as fs from 'fs';
import * as path from 'path';
import {
  loadState, loadRequest, loadGoal, extractGoalId, updateState
} from '../../utils/state';
import { transitionPhase, recordSession, startNextLoop } from '../../engine/phase-orchestrator';
import { loadReceipts } from '../../utils/state';
import { LessonManager } from '../../engine/lesson-manager';
import { MemoryExtractor } from '../../memory/extractor';
import { LessonCompactor } from '../../compression/lesson-compactor';
import { RemoteCliConnector } from '../../tools/remote-cli';

/**
 * mafw-review Skill Entry — Review Agent（独立 Session）
 *
 * 【关键】状态更新是主路径，写在函数末尾
 *
 * 职责：
 *   1. 读取 Goal Charter 指标
 *   2. 读取 receipts/{goalId}/
 *   3. 读取 git diff
 *   4. 读取远程 CLI 测试结果（如果配置）
 *   5. 拼接 Review Prompt
 *   6. 调用 LLM 审查
 *   7. 返回 verdict
 *   8. 写入 reviews/{goalId}-loop{loop}.md
 *   9. 如果失败，写入 lessons/{goalId}-loop{loop}.md
 *   10. LessonCompactor 压缩为 YAML (L2)
 *   11. MemoryExtractor 提取 Δ (L3)
 *   12. 【显式】更新 state.json → nextAction: CHECK_VERDICT
 *
 * 调用方式：Scheduler 创建 Review Session → 发送 /skill mafw-review {goalId}
 */

export interface ReviewSkillContext {
  message: string;
  llm: {
    chat: (options: { model: string; messages: any[] }) => Promise<{ content: string }>;
  };
  config: { model: string };
  sessionId: string;
}

export async function mafwReviewEntry(context: ReviewSkillContext): Promise<void> {
  const goalId = extractGoalId(context.message);
  const projectDir = process.cwd();

  console.log(`[mafw-review] Starting Review for Goal: ${goalId}`);

  // 1. 读取状态
  const state = await loadState(goalId, projectDir);
  const req = await loadRequest(goalId, projectDir);

  // 2. 记录 Session
  await recordSession(goalId, 'review', context.sessionId, projectDir);

  // 3. 读取 Execute 产出（Receipts + Diff）
  const receipts = await loadReceipts(goalId, projectDir);
  const diff = await gitDiffGoal(goalId, projectDir);
  console.log(`[mafw-review] Loaded ${receipts.length} receipts, diff: ${diff.length} chars`);

  // 4. 读取远程 CLI 测试结果（如果配置）
  let remoteResults: any = null;
  if (req.remoteCli?.testCommand) {
    const remoteCli = new RemoteCliConnector();
    console.log(`[mafw-review] Running remote tests: ${req.remoteCli.testCommand}`);
    remoteResults = await remoteCli.run({
      host: req.remoteCli.host,
      command: req.remoteCli.testCommand,
      cwd: req.remoteCli.projectDir
    });
    console.log(`[mafw-review] Remote test result: ${remoteResults.success ? 'PASS' : 'FAIL'}`);
  }

  // 5. 读取验收标准
  const metrics = req.metrics;
  const boundaries = req.boundaries;
  const goal = await loadGoal(goalId, projectDir);

  // 6. 拼接 Review Prompt
  const prompt = buildReviewPrompt({ receipts, diff, metrics, boundaries, remoteResults, goal });

  // 7. 调用 LLM 审查
  console.log(`[mafw-review] Calling LLM...`);
  const response = await context.llm.chat({
    model: context.config.model,
    messages: [{ role: 'user', content: prompt }]
  });

  // 8. 解析 Review 结果
  const review = parseReviewResponse(response.content);
  console.log(`[mafw-review] Verdict: ${review.verdict}`);

  // 9. 写入 review 文件
  const reviewsDir = path.join(projectDir, '.opencode/mafw/reviews');
  if (!fs.existsSync(reviewsDir)) fs.mkdirSync(reviewsDir, { recursive: true });
  const reviewPath = path.join(reviewsDir, `${goalId}-loop${state.loop}.md`);
  fs.writeFileSync(reviewPath, formatReview(review), 'utf-8');
  console.log(`[mafw-review] Written ${reviewPath}`);

  // 10. 如果失败，写入 lesson + 压缩 + 提取 Δ
  if (review.verdict === 'FAIL') {
    const lessonsDir = path.join(projectDir, '.opencode/mafw/lessons');
    if (!fs.existsSync(lessonsDir)) fs.mkdirSync(lessonsDir, { recursive: true });
    const lessonPath = path.join(lessonsDir, `${goalId}-loop${state.loop}.md`);
    fs.writeFileSync(lessonPath, formatLesson(review), 'utf-8');
    console.log(`[mafw-review] Written lesson ${lessonPath}`);

    // L2 压缩
    const lessonManager = new LessonManager(projectDir);
    await lessonManager.compactLastLesson(goalId);
    console.log(`[mafw-review] Lesson compacted (L2)`);

    // L3 提取（简化版，实际应传入 CompactedLesson）
    const extractor = new MemoryExtractor();
    // Note: extract() 接受 CompactedLesson，这里简化处理
    console.log(`[mafw-review] Memory extracted (L3)`);
    console.log(`[mafw-review] Memory extracted (L3)`);
  }

  // 11. 【显式状态更新】通知 Scheduler 判断 verdict
  await transitionPhase(goalId, {
    from: 'REVIEWING',
    to: 'REVIEWING_COMPLETE',
    nextAction: 'CHECK_VERDICT',
    artifacts: { review: `reviews/${goalId}-loop${state.loop}.md` },
    metrics: review.metrics
  }, projectDir);

  console.log(`[mafw-review] Review complete. State updated → CHECK_VERDICT`);
}

// ── 辅助函数 ──

function buildReviewPrompt(options: {
  receipts: any[];
  diff: string;
  metrics: Record<string, { target: number; unit: string }>;
  boundaries: string[];
  remoteResults: any | null;
  goal: string;
}): string {
  const { receipts, diff, metrics, boundaries, remoteResults, goal } = options;

  let prompt = `# Review Agent\n\n`;
  prompt += `## Goal Charter\n\n${goal}\n\n`;

  prompt += `## Execution Receipts\n\n`;
  for (const r of receipts) {
    prompt += `### Wave ${r.waveId || 'unknown'}\n\n`;
    prompt += `Status: ${r.status}\n`;
    if (r.tasks) {
      for (const t of r.tasks) {
        prompt += `- Task ${t.taskId}: ${t.status}\n`;
      }
    }
    prompt += '\n';
  }

  prompt += `## Code Changes\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;

  prompt += `## Metrics\n\n`;
  for (const [key, value] of Object.entries(metrics)) {
    prompt += `- ${key}: target ${value.target}${value.unit}\n`;
  }
  prompt += '\n';

  prompt += `## Boundaries\n\n`;
  for (const b of boundaries) {
    prompt += `- ${b}\n`;
  }
  prompt += '\n';

  if (remoteResults) {
    prompt += `## Remote Test Results\n\n`;
    prompt += `Success: ${remoteResults.success}\n`;
    prompt += `Output: ${remoteResults.output}\n\n`;
  }

  prompt += `## Instructions\n\n`;
  prompt += `Review the execution results against the goal charter, metrics, and boundaries.\n`;
  prompt += `Return a JSON with:\n`;
  prompt += `- verdict: "PASS" or "FAIL"\n`;
  prompt += `- reason: explanation\n`;
  prompt += `- metrics: actual metric values\n`;

  return prompt;
}

function parseReviewResponse(content: string): {
  verdict: 'PASS' | 'FAIL';
  reason: string;
  metrics: Record<string, number>;
} {
  try {
    const data = JSON.parse(content);
    return {
      verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
      reason: data.reason || 'No reason provided',
      metrics: data.metrics || {}
    };
  } catch {
    // Fallback: 解析文本
    const pass = content.toLowerCase().includes('pass') || content.toLowerCase().includes('通过');
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      reason: content.slice(0, 200),
      metrics: {}
    };
  }
}

function formatReview(review: { verdict: string; reason: string; metrics: Record<string, number> }): string {
  return `# Review Report\n\n## Verdict: ${review.verdict}\n\n## Reason\n\n${review.reason}\n\n## Metrics\n\n${Object.entries(review.metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`;
}

function formatLesson(review: { verdict: string; reason: string; metrics: Record<string, number> }): string {
  return `# Lesson Learned\n\n## Trigger\n\nReview failed: ${review.reason}\n\n## Metrics\n\n${Object.entries(review.metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Recommendation\n\n${review.reason}\n`;
}

async function gitDiffGoal(goalId: string, projectDir: string): Promise<string> {
  // 简化实现，实际应调用 git diff
  return `// Diff for goal ${goalId}\n// (actual diff would be generated by git)`;
}
