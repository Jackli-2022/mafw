import * as fs from 'fs';
import * as path from 'path';
import {
  loadState, loadGoal, loadRequest, extractGoalId, updateState
} from '../../utils/state';
import { transitionPhase, recordSession } from '../../engine/phase-orchestrator';
import { MemoryIndexManager } from '../../compression/memory-index';
import { ParametricStore } from '../../memory/store';
import { DeltaInjector } from '../../memory/injector';
import { Delta } from '../../types/parametric';

/**
 * mafw-plan Skill Entry — Plan Agent（独立 Session）
 *
 * 【关键】状态更新是主路径，写在函数末尾，不依赖 hook
 *
 * 职责：
 *   1. 读取 Goal Charter (L1)
 *   2. 读取相关 Lessons (L2 检索)
 *   3. 加载 Parametric Δ (L3 注入)
 *   4. 拼接完整 Prompt
 *   5. 调用 LLM
 *   6. 解析回复为 waves.json
 *   7. 写入 tasks/{id}.md
 *   8. 【显式】更新 state.json → nextAction: CREATE_EXECUTE_SESSION
 *
 * 调用方式：Scheduler 创建 Plan Session → 发送 /skill mafw-plan {goalId}
 */

export interface SkillContext {
  message: string;
  llm: {
    chat: (options: { model: string; messages: any[] }) => Promise<{ content: string }>;
  };
  config: { model: string };
  sessionId: string;
}

export async function mafwPlanEntry(context: SkillContext): Promise<void> {
  const goalId = extractGoalId(context.message);
  const projectDir = process.cwd();

  console.log(`[mafw-plan] Starting Plan for Goal: ${goalId}`);

  // 1. 读取状态
  const state = await loadState(goalId, projectDir);

  // 2. 记录 Session（用于 hook 兜底反查）
  await recordSession(goalId, 'plan', context.sessionId, projectDir);

  // 3. 读取 L1: Goal Charter
  const goal = await loadGoal(goalId, projectDir);
  console.log(`[mafw-plan] Loaded Goal Charter (${goal.length} chars)`);

  // 4. 读取 L2: 相关 Lessons
  const index = new MemoryIndexManager(path.join(projectDir, '.opencode/mafw/memory-index.json'));
  const keywords = extractKeywords(goal);
  const domain = extractDomain(goal);
  const relevantLessons = index.search(keywords, domain, 3);
  console.log(`[mafw-plan] L2: ${relevantLessons.length} lessons loaded`);

  // 5. 读取 L3: Parametric Deltas
  const store = new ParametricStore({
    baseDir: path.join(projectDir, '.opencode/mafw/parametric'),
    bannedDir: path.join(projectDir, '.opencode/mafw/parametric/banned'),
    manifestFile: path.join(projectDir, '.opencode/mafw/parametric/base-skill-manifest.yaml')
  });
  const matchedDeltas = store.match({
    domain,
    goalKeywords: keywords,
    loopStage: 'planning',
    loopCount: state.loop
  });
  const injector = new DeltaInjector();
  const injection = injector.inject(matchedDeltas);
  console.log(`[mafw-plan] L3: ${injection.injected.length} deltas injected (${injection.totalTokens} tokens)`);

  // 6. 拼接 Prompt
  const prompt = buildPlanPrompt({ goal, lessons: relevantLessons, deltas: injection.injected, handoff: null, loopNum: state.loop });

  // 7. 调用 LLM
  console.log(`[mafw-plan] Calling LLM...`);
  const response = await context.llm.chat({
    model: context.config.model,
    messages: [{ role: 'user', content: prompt }]
  });

  // 8. 解析并写入产出
  const plan = parsePlanResponse(response.content);

  // 写入 waves.json
  const wavesPath = path.join(projectDir, '.opencode/mafw/waves.json');
  fs.writeFileSync(wavesPath, JSON.stringify({ waves: plan.waves }, null, 2), 'utf-8');
  console.log(`[mafw-plan] Written waves.json (${plan.waves.length} waves)`);

  // 写入 tasks/
  const tasksDir = path.join(projectDir, '.opencode/mafw/tasks');
  if (!fs.existsSync(tasksDir)) fs.mkdirSync(tasksDir, { recursive: true });
  for (const task of plan.tasks) {
    const taskPath = path.join(tasksDir, `${task.id}.md`);
    fs.writeFileSync(taskPath, formatTaskMarkdown(task), 'utf-8');
  }
  console.log(`[mafw-plan] Written ${plan.tasks.length} tasks`);

  // 9. 【显式状态更新】通知 Scheduler 进入 EXECUTING
  // 这是主路径，必须成功；如果失败会抛异常，Scheduler 心跳监控会重建
  await transitionPhase(goalId, {
    from: 'PLANNING',
    to: 'PLANNING_COMPLETE',
    nextAction: 'CREATE_EXECUTE_SESSION',
    artifacts: { plan: 'waves.json' }
  }, projectDir);

  console.log(`[mafw-plan] Plan complete. State updated → CREATE_EXECUTE_SESSION`);

  // 10. 函数返回 → OpenCode 关闭 Session
  // hook 'session-ending' 会做兜底检查，但正常情况下 state 已更新
}

// ── 辅助函数 ──

function buildPlanPrompt(options: {
  goal: string;
  lessons: any[];
  deltas: Delta[];
  handoff: any | null;
  loopNum: number;
}): string {
  const { goal, lessons, deltas, handoff, loopNum } = options;

  let prompt = `# Plan Agent — Loop ${loopNum}\n\n`;
  prompt += `## Goal Charter\n\n${goal}\n\n`;

  if (handoff) {
    prompt += `## Handoff from Loop ${loopNum - 1}\n\n${handoff.summary}\n\n`;
  }

  if (lessons.length > 0) {
    prompt += `## Lessons Learned (L2)\n\n`;
    for (const lesson of lessons) {
      prompt += `- ${lesson}\n`;
    }
    prompt += '\n';
  }

  if (deltas.length > 0) {
    prompt += `## Parametric Constraints (L3)\n\n`;
    for (const delta of deltas) {
      if (delta.type === 'constraint') {
        prompt += `- ${delta.type}: ${(delta as any).rule}\n`;
      } else if (delta.type === 'prompt') {
        prompt += `- ${delta.type}: ${(delta as any).prompt_delta}\n`;
      } else if (delta.type === 'pattern') {
        prompt += `- ${delta.type}: ${(delta as any).pattern_template}\n`;
      }
    }
    prompt += '\n';
  }

  prompt += `## Instructions\n\n`;
  prompt += `Generate a detailed execution plan with waves and tasks.\n`;
  prompt += `Output format: JSON with "waves" and "tasks" arrays.\n`;
  prompt += `Each task must have: id, description, affected_files, acceptance_criteria.\n`;

  return prompt;
}

function parsePlanResponse(content: string): { waves: any[]; tasks: any[] } {
  try {
    // 尝试直接解析 JSON
    return JSON.parse(content);
  } catch {
    // 尝试从 markdown 代码块中提取
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    // fallback: 返回空结构
    console.warn('[mafw-plan] Failed to parse LLM response, using fallback');
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
