import { log } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadState, loadGoal, loadRequest, extractGoalId, updateState
} from '../../utils/state';
import { SkillContext } from '../../types/state';
import { transitionPhase, recordSession } from '../../engine/phase-orchestrator';
import { MemoryIndexManager } from '../../compression/memory-index';
import { ParametricStore } from '../../memory/store';
import { DeltaInjector } from '../../memory/injector';
import { Delta } from '../../types/parametric';
import { buildPlanPrompt } from '../../tools/run-plan';

/**
 * mafw-plan Skill Entry —Plan Agent锛堢嫭绔?Session锛?
 *
 * 【关键】状态更新是主路径，写在函数末尾，不依赖 hook
 *
 * 鑱岃矗锛?
 *   1. 读取 Goal Charter (L1)
 *   2. 璇诲彇鐩稿叧 Lessons (L2 妫€绱?
 *   3. 加载 Parametric Δ (L3 注入)
 *   4. 拼接完整 Prompt
 *   5. 调用 LLM
 *   6. 解析回复为 waves.json
 *   7. 写入 tasks/{id}.md
 *   8. 銆愭樉寮忋€戞洿鏂?state.json 鈫?nextAction: CREATE_EXECUTE_SESSION
 *
 * 璋冪敤鏂瑰紡锛歋cheduler 鍒涘缓 Plan Session 鈫?鍙戦€?/skill mafw-plan {goalId}
 */

export async function mafwPlanEntry(context: SkillContext): Promise<void> {
  const goalId = extractGoalId(context.message);
  const projectDir = process.cwd();

  log.info(`[mafw-plan] Starting Plan for Goal: ${goalId}`);

  // 1. 璇诲彇鐘舵€?
  const state = await loadState(goalId, projectDir);

  // 2. 璁板綍 Session锛堢敤浜?hook 鍏滃簳鍙嶆煡锛?
  await recordSession(goalId, 'plan', context.sessionId, projectDir);

  // 3. 读取 L1: Goal Charter
  const goal = await loadGoal(goalId, projectDir);
  log.info(`[mafw-plan] Loaded Goal Charter (${goal.length} chars)`);

  // 4. 读取 L2: 相关 Lessons
  const index = new MemoryIndexManager(path.join(projectDir, '.mafw/memory-index.json'));
  const keywords = extractKeywords(goal);
  const domain = extractDomain(goal);
  const relevantLessons = index.search(keywords, domain, 3);
  log.info(`[mafw-plan] L2: ${relevantLessons.length} lessons loaded`);

  // 5. 读取 L3: Parametric Deltas
  const store = new ParametricStore({
    baseDir: path.join(projectDir, '.mafw/parametric'),
    bannedDir: path.join(projectDir, '.mafw/parametric/banned'),
    manifestFile: path.join(projectDir, '.mafw/parametric/base-skill-manifest.yaml')
  });
  const matchedDeltas = store.match({
    domain,
    goalKeywords: keywords,
    loopStage: 'planning',
    loopCount: state.loop
  });
  const injector = new DeltaInjector();
  const injection = injector.inject(matchedDeltas);
  log.info(`[mafw-plan] L3: ${injection.injected.length} deltas injected (${injection.totalTokens} tokens)`);

  // 6. 拼接 Prompt
  const prompt = buildPlanPrompt({ goal, lessons: relevantLessons, deltas: injection.injected, handoff: null, loopNum: state.loop });

  // 7. 调用 LLM
  log.info(`[mafw-plan] Calling LLM...`);
  const response = await context.llm.chat({
    model: context.config.model,
    messages: [{ role: 'user', content: prompt }]
  });

  // 8. 瑙ｆ瀽骞跺啓鍏ヤ骇鍑?
  const plan = parsePlanResponse(response.content);

  // 写入 waves.json
  const wavesPath = path.join(projectDir, '.mafw/waves.json');
  fs.writeFileSync(wavesPath, JSON.stringify({ waves: plan.waves }, null, 2), 'utf-8');
  log.info(`[mafw-plan] Written waves.json (${plan.waves.length} waves)`);

  // 写入 tasks/
  const tasksDir = path.join(projectDir, '.mafw/tasks');
  if (!fs.existsSync(tasksDir)) fs.mkdirSync(tasksDir, { recursive: true });
  for (const task of plan.tasks) {
    const taskPath = path.join(tasksDir, `${task.id}.md`);
    fs.writeFileSync(taskPath, formatTaskMarkdown(task), 'utf-8');
  }
  log.info(`[mafw-plan] Written ${plan.tasks.length} tasks`);

  // 9a. Plan Reflection: inject previous loop feedback
  const prevLoop = (loadState as any)?.loop ? (loadState as any).loop - 1 : null;
  if (prevLoop && prevLoop > 0) {
    try {
      const { loadReview } = require('../../utils/state');
      const prevReview = await loadReview(goalId, prevLoop, projectDir);
      if (prevReview) {
        const text = typeof prevReview === 'string' ? prevReview : JSON.stringify(prevReview);
        const scoreMatch = text.match(/[Ss]core[:\s]+(\d+)/i);
        const reasonMatch = text.match(/[Rr]eason[:\s]+"?([^"\n]+)"?/i);
        if (scoreMatch || reasonMatch) {
          let reflection = '\n\n## Previous Loop Feedback\n';
          if (scoreMatch) reflection += `Score: ${scoreMatch[1]}/100`;
          if (reasonMatch) reflection += `\nFailure reason: ${reasonMatch[1].trim()}`;
          plan.waves.forEach((w: any) => {
            w.reflection = reflection;
          });
          log.info(`[mafw-plan] Reflection injected from loop ${prevLoop}`);
        }
      }
    } catch { /* skip if no previous review */ }
  }

  // 9b. 銆愭樉寮忕姸鎬佹洿鏂般€戦€氱煡 Scheduler 杩涘叆 EXECUTING
  await transitionPhase(goalId, {
    from: 'PLANNING',
    to: 'PLANNING_COMPLETE',
    nextAction: 'CREATE_EXECUTE_SESSION',
    totalWaves: plan.waves.length,
    artifacts: { plan: 'waves.json' }
  }, projectDir);

  log.info(`[mafw-plan] Plan complete. State updated 鈫?CREATE_EXECUTE_SESSION`);

  // 10. 鍑芥暟杩斿洖 鈫?OpenCode 鍏抽棴 Session
  // hook 'session-ending' 会做兜底检查，但正常情况下 state 已更新
}



function parsePlanResponse(content: string): { waves: any[]; tasks: any[] } {
  try {
    // 尝试直接解析 JSON
    return JSON.parse(content);
  } catch {
    // 灏濊瘯浠?markdown 浠ｇ爜鍧椾腑鎻愬彇
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    // fallback: 杩斿洖绌虹粨鏋?
    log.warn('[mafw-plan] Failed to parse LLM response, using fallback');
    return { waves: [], tasks: [] };
  }
}

function formatTaskMarkdown(task: any): string {
  return `# Task: ${task.id}\n\n${task.description}\n\n## Affected Files\n\n${(task.affected_files || []).map((f: string) => `- ${f}`).join('\n')}\n\n## Acceptance Criteria\n\n${(task.acceptance_criteria || []).map((c: string) => `- [ ] ${c}`).join('\n')}\n`;
}

function extractKeywords(charter: string): string[] {
  const words = charter.toLowerCase()
    .replace(/[^\u4e00-\u9fff\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !['the', 'and', 'for', 'with', 'this', 'that'].includes(w));
  return Array.from(new Set(words)).slice(0, 10);
}

function extractDomain(charter: string): string | undefined {
  const domains = ['auth', 'api', 'viz', 'db', 'ui', 'test', 'ci', 'deploy'];
  return domains.find(d => charter.toLowerCase().includes(d));
}



