import { log } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadState, loadRequest, loadGoal, extractGoalId, updateState
} from '../../utils/state';
import { transitionPhase, recordSession, startNextLoop, handleLoopEvent } from '../../engine/phase-orchestrator';
import { loadReceipts } from '../../utils/state';
import { LessonManager } from '../../engine/lesson-manager';
import { MemoryExtractor } from '../../memory/extractor';
import { ParametricStore } from '../../memory/store';
import { LessonCompactor } from '../../compression/lesson-compactor';
import { RemoteCliConnector } from '../../tools/remote-cli';
import { buildReviewPrompt } from '../../tools/run-review';

/**
 * mafw-review Skill Entry —Review Agent锛堢嫭绔?Session锛?
 *
 * 【关键】状态更新是主路径，写在函数末尾
 *
 * 鑱岃矗锛?
 *   1. 读取 Goal Charter 指标
 *   2. 读取 receipts/{goalId}/
 *   3. 读取 git diff
 *   4. 读取远程 CLI 测试结果（如果配置）
 *   5. 拼接 Review Prompt
 *   6. 调用 LLM 审查
 *   7. 返回 verdict
 *   8. 写入 reviews/{goalId}-loop{loop}.md
 *   9. 濡傛灉澶辫触锛屽啓鍏?lessons/{goalId}-loop{loop}.md
 *   10. LessonCompactor 鍘嬬缉涓?YAML (L2)
 *   11. MemoryExtractor 提取 Δ (L3)
 *   12. 銆愭樉寮忋€戞洿鏂?state.json 鈫?nextAction: CHECK_VERDICT
 *
 * 璋冪敤鏂瑰紡锛歋cheduler 鍒涘缓 Review Session 鈫?鍙戦€?/skill mafw-review {goalId}
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

  log.info(`[mafw-review] Starting Review for Goal: ${goalId}`);

  // 1. 璇诲彇鐘舵€?
  const state = await loadState(goalId, projectDir);
  const req = await loadRequest(goalId, projectDir);

  // 2. 记录 Session
  await recordSession(goalId, 'review', context.sessionId, projectDir);

  // 3. 璇诲彇 Execute 浜у嚭锛圧eceipts + Diff锛?
  const receipts = await loadReceipts(goalId, projectDir);
  const diff = await gitDiffGoal(goalId, projectDir);
  log.info(`[mafw-review] Loaded ${receipts.length} receipts, diff: ${diff.length} chars`);

  // 4. 读取远程 CLI 测试结果（如果配置）
  let remoteResults: any = null;
  if (req.remoteCli?.testCommand) {
    const remoteCli = new RemoteCliConnector();
    log.info(`[mafw-review] Running remote tests: ${req.remoteCli.testCommand}`);
    remoteResults = await remoteCli.run({
      host: req.remoteCli.host,
      command: req.remoteCli.testCommand,
      cwd: req.remoteCli.projectDir
    });
    log.info(`[mafw-review] Remote test result: ${remoteResults.success ? 'PASS' : 'FAIL'}`);
  }

  // 5. 读取验收标准
  const metrics = req.metrics;
  const boundaries = req.boundaries;
  const goal = await loadGoal(goalId, projectDir);

  // 6. 拼接 Review Prompt
  const prompt = buildReviewPrompt({ receipts, diff, metrics, boundaries, remoteResults, goal });

  // 7. 调用 LLM 审查
  log.info(`[mafw-review] Calling LLM...`);
  const response = await context.llm.chat({
    model: context.config.model,
    messages: [{ role: 'user', content: prompt }]
  });

  // 8. 解析 Review 结果
  const review = parseReviewResponse(response.content);
  log.info(`[mafw-review] Verdict: ${review.verdict}`);

  // 9. 写入 review 文件
  const reviewsDir = path.join(projectDir, '.mafw/reviews');
  if (!fs.existsSync(reviewsDir)) fs.mkdirSync(reviewsDir, { recursive: true });
  const reviewPath = path.join(reviewsDir, `${goalId}-loop${state.loop}.md`);
  fs.writeFileSync(reviewPath, formatReview(review), 'utf-8');
  log.info(`[mafw-review] Written ${reviewPath}`);

  // 10. 濡傛灉澶辫触锛屽啓鍏?lesson + 鍘嬬缉 + 鎻愬彇 螖
  if (review.verdict === 'FAIL') {
    const lessonsDir = path.join(projectDir, '.mafw/lessons');
    if (!fs.existsSync(lessonsDir)) fs.mkdirSync(lessonsDir, { recursive: true });
    const lessonPath = path.join(lessonsDir, `${goalId}-loop${state.loop}.md`);
    fs.writeFileSync(lessonPath, formatLesson(review), 'utf-8');
    log.info(`[mafw-review] Written lesson ${lessonPath}`);

    const lessonManager = new LessonManager(projectDir);
    await lessonManager.compactLastLesson(goalId);

    const extractor = new MemoryExtractor();
    const compacted = lessonManager.loadAll(goalId).slice(-1)[0];
    if (compacted) {
      const deltas = extractor.extract(compacted);
      const store = new ParametricStore({
        baseDir: path.join(projectDir, '.mafw/parametric'),
        bannedDir: path.join(projectDir, '.mafw/parametric/banned'),
        manifestFile: path.join(projectDir, '.mafw/parametric/base-skill-manifest.yaml')
      });
      for (const delta of deltas) store.save(delta);
    }
  }

  // 11. 銆愭樉寮忕姸鎬佹洿鏂般€戠敱 Review Skill 鐩存帴鍒ゅ畾 verdict锛屼笉鍐嶄氦缁?Gateway
  await evaluateReviewResult(goalId, state, req, review, projectDir);

  log.info(`[mafw-review] Review complete. State updated`);
}

async function evaluateReviewResult(
  goalId: string,
  state: any,
  req: any,
  review: { verdict: 'PASS' | 'FAIL'; reason: string; metrics: Record<string, number> },
  projectDir: string
) {
  const metricsOk = checkMetrics(req.metrics, review.metrics);
  const reviewArtifact = `reviews/${goalId}-loop${state.loop}.md`;

  if (review.verdict === 'PASS' && metricsOk) {
    await transitionPhase(goalId, {
      from: 'REVIEWING',
      to: 'REVIEWING_COMPLETE',
      nextAction: 'PASS',
      artifacts: { review: reviewArtifact },
      metrics: review.metrics
    }, projectDir);
    log.info(`[mafw-review] PASS 鈫?REVIEWING_COMPLETE`);
    await handleLoopEvent(goalId, 'review.complete', { verdict: 'PASS' }, state.loop, projectDir);
    return;
  }

  if (state.loop >= req.maxLoops) {
    await transitionPhase(goalId, {
      from: 'REVIEWING',
      to: 'REVIEWING_COMPLETE',
      nextAction: 'FAIL',
      error: 'max_loops_reached',
      artifacts: { review: reviewArtifact },
      metrics: review.metrics
    }, projectDir);
    log.info(`[mafw-review] FAIL but maxLoops reached 鈫?REVIEWING_COMPLETE`);
    await handleLoopEvent(goalId, 'review.complete', { verdict: 'PARTIAL' }, state.loop, projectDir);
    return;
  }

  await transitionPhase(goalId, {
    from: 'REVIEWING',
    to: 'REVIEWING_COMPLETE',
    nextAction: 'FAIL',
    artifacts: { review: reviewArtifact },
    metrics: review.metrics
  }, projectDir);
  log.info(`[mafw-review] FAIL 鈫?REVIEWING_COMPLETE`);
  await handleLoopEvent(goalId, 'review.complete', { verdict: 'FAIL' }, state.loop, projectDir);
}

function checkMetrics(
  reqMetrics: Record<string, { target: number; unit: string }>,
  reviewMetrics: Record<string, number> | undefined
): boolean {
  if (!reviewMetrics) return true;
  for (const [key, target] of Object.entries(reqMetrics)) {
    const actual = reviewMetrics[key];
    if (actual === undefined) continue;
    if (actual < target.target) return false;
  }
  return true;
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
  // 绠€鍖栧疄鐜帮紝瀹為檯搴旇皟鐢?git diff
  return `// Diff for goal ${goalId}\n// (actual diff would be generated by git)`;
}



