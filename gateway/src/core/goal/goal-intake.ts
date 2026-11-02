// gateway/src/core/goal/goal-intake.ts
// Shared Goal file intake. The MCP tool and Pod composer must never maintain
// two different request/charter writers.

import * as fs from 'fs';
import * as path from 'path';

/** Duplicate goal ids are a client conflict, not a server failure. */
export class GoalConflictError extends Error {
  constructor(goalId: string) {
    super(`Goal ${goalId} already exists`);
    this.name = 'GoalConflictError';
  }
}

export type GoalAuthorization = {
  source: 'desktop' | 'lead' | 'a2a' | 'automation' | 'user';
  requestMode: 'explicit' | 'inferred';
  scope?: string;
};

/**
 * Goal 产物落盘布局：
 * - `legacy`：`goals/<goalId>.md` + `requests/<goalId>.json`（历史调用方）；
 * - `goal-dir`：`goals/<goalId>/{goal.md,request.json}`（协作 Goal 的权威工作区，
 *   与 `direction.json`、`waves.json`、probes 同目录；ContextManifest 基线按此解析）。
 */
export type GoalIntakeLayout = 'legacy' | 'goal-dir';

export interface GoalIntakeInput {
  goalId: string;
  title: string;
  objective?: string;
  charter?: string;
  acceptance?: string[];
  boundaries?: string[];
  metrics?: Record<string, { target?: number; unit?: string }>;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  maxLoops?: number;
  budget?: { maxTurns?: number; maxCostUsd?: number };
  taskType?: 'feature' | 'bugfix' | 'refactor' | 'research' | 'docs' | 'test' | 'other';
  planReview?: 'auto' | 'manual';
  projectDir?: string;
  source?: string;
  authorization: GoalAuthorization;
  /** Set false when the caller starts the goal itself (Pod route enqueues explicitly). */
  autoStart?: boolean;
  /** Selects the Goal workspace layout (default `legacy`). */
  layout?: GoalIntakeLayout;
  /**
   * Direct discussion revision：request 标记 `discussion/stage:'discussing'`，
   * 且**永不**发出 `goal_created`（NodeDriver 只能由方向裁定后的显式启动触发）。
   */
  discussion?: boolean;
}

export interface GoalIntakeResult {
  goalId: string;
  charterPath: string;
  requestPath: string;
  projectDir: string;
  layout: GoalIntakeLayout;
  /** `goal-dir` 布局的工作区目录；legacy 为 null。 */
  goalDir: string | null;
}

export interface GoalIntakeDeps {
  resolveProject(requested?: string): { projectDir: string; mafwDir: string } | null;
  now(): string;
  emitGoalCreated(event: unknown): void;
}

const TASK_TYPES = new Set(['feature', 'bugfix', 'refactor', 'research', 'docs', 'test', 'other']);

function cleanLines(lines: string[] | undefined): string[] | undefined {
  if (!Array.isArray(lines)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const value = String(raw ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length > 0 ? out : undefined;
}

export function buildGoalCharter(
  input: Pick<GoalIntakeInput, 'title' | 'objective' | 'acceptance' | 'boundaries'>,
): string {
  const lines = [`# ${input.title.trim()}`, '', input.objective?.trim() || 'No objective provided.', ''];
  const acceptance = cleanLines(input.acceptance);
  if (acceptance) {
    lines.push('## Acceptance', '', ...acceptance.map((item) => `- ${item}`), '');
  }
  const boundaries = cleanLines(input.boundaries);
  if (boundaries) {
    lines.push('## Boundaries', '', ...boundaries.map((item) => `- ${item}`), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function makePodGoalId(now: string, random: () => number): string {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid goal timestamp: ${now}`);
  const stamp = [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('') + '-' + [
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  const value = Math.floor(Math.max(0, Math.min(0.999999, random())) * 0x1000000);
  return `goal-${stamp}-${value.toString(16).padStart(6, '0')}`;
}

/**
 * 协作 Goal 目录名必须安全：goal-dir 布局下 goalId 直接成为目录名，
 * `..`/绝对路径/路径分隔符会把 Goal 工作区写到 `.mafw` 之外。
 * 生成器（makePodGoalId）与 UI 使用的 id 都满足此形状。
 */
const SAFE_GOAL_DIR_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isSafeGoalDirId(goalId: string): boolean {
  return SAFE_GOAL_DIR_ID.test(goalId) && !goalId.includes('..');
}

/**
 * `goal_created` 监听器唯一判定：discussion revision 绝不自动启动 NodeDriver。
 * 由 Tech Lead 直接创建的 Goal 即使被其它路径重新广播，也必须等
 * `mafw_pod_goal_direction`（或等价 API）显式开始规划。
 */
export function shouldAutoStartGoalEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const data = event as Record<string, unknown>;
  if (!String(data.goalId ?? '').trim()) return false;
  if (data.discussion === true) return false;
  if (data.stage === 'discussing' || data.revisionStage === 'discussing') return false;
  return true;
}

export function createGoalIntake(input: GoalIntakeInput, deps: GoalIntakeDeps): GoalIntakeResult {
  const goalId = String(input.goalId ?? '').trim();
  const title = String(input.title ?? '').trim();
  const objective = String(input.objective ?? '').trim();
  const charter = String(input.charter ?? '').trim();

  if (!goalId) throw new Error('goalId is required');
  if (!title) throw new Error('title is required');
  if (!objective && !charter) throw new Error('objective or charter is required');
  if (input.taskType !== undefined && !TASK_TYPES.has(input.taskType)) {
    throw new Error(`invalid taskType: ${input.taskType} (feature|bugfix|refactor|research|docs|test|other)`);
  }
  if (input.planReview !== undefined && input.planReview !== 'auto' && input.planReview !== 'manual') {
    throw new Error(`invalid planReview: ${input.planReview} (auto|manual)`);
  }
  if (!input.authorization || !input.authorization.source || !input.authorization.requestMode) {
    throw new Error('authorization source and requestMode are required');
  }

  const layout: GoalIntakeLayout = input.layout ?? 'legacy';
  if (layout !== 'legacy' && layout !== 'goal-dir') {
    throw new Error(`invalid goal layout: ${String(input.layout)} (legacy|goal-dir)`);
  }
  if (layout === 'goal-dir' && !isSafeGoalDirId(goalId)) {
    throw new Error(`invalid goal id for goal-dir layout: ${goalId}`);
  }

  const resolved = deps.resolveProject(input.projectDir);
  if (!resolved) throw new Error(`project is not registered: ${input.projectDir ?? '(current)'}`);
  const { projectDir, mafwDir } = resolved;
  const goalsDir = path.join(mafwDir, 'goals');
  const requestsDir = path.join(mafwDir, 'requests');
  const goalDir = layout === 'goal-dir' ? path.join(goalsDir, goalId) : null;
  const charterPath = goalDir
    ? path.join(goalDir, 'goal.md')
    : path.join(goalsDir, `${goalId}.md`);
  const requestPath = goalDir
    ? path.join(goalDir, 'request.json')
    : path.join(requestsDir, `${goalId}.json`);

  // Validate everything above before creating directories/files: invalid
  // intake must not leave partial artifacts behind.
  if (goalDir) {
    fs.mkdirSync(goalDir, { recursive: true });
  } else {
    fs.mkdirSync(goalsDir, { recursive: true });
    fs.mkdirSync(requestsDir, { recursive: true });
  }
  if (fs.existsSync(charterPath) || fs.existsSync(requestPath)) {
    throw new GoalConflictError(goalId);
  }

  const body = charter || buildGoalCharter({ title, objective: objective || undefined, acceptance: input.acceptance, boundaries: input.boundaries });
  // `wx` claims the name atomically; two concurrent intakes cannot both pass
  // the existence check and clobber each other's files.
  try {
    fs.writeFileSync(charterPath, body, { encoding: 'utf-8', flag: 'wx' });
  } catch (err: any) {
    if (err?.code === 'EEXIST') throw new GoalConflictError(goalId);
    throw err;
  }

  const now = deps.now();
  const acceptance = cleanLines(input.acceptance);
  const boundaries = cleanLines(input.boundaries);
  const maxLoops = input.maxLoops ?? 5;
  const hasBudget = !!input.budget
    && (typeof input.budget.maxTurns === 'number' || typeof input.budget.maxCostUsd === 'number');
  const request = {
    version: '2',
    goalId,
    title,
    state: 'draft',
    createdAt: now,
    confirmedAt: now,
    source: input.source || input.authorization.source,
    projectDir,
    mafwDir,
    goalCharter: charterPath,
    ...(layout !== 'legacy' ? { layout } : {}),
    ...(input.discussion ? { discussion: true, stage: 'discussing' as const } : {}),
    ...(acceptance ? { acceptance } : {}),
    ...(boundaries ? { boundaries } : {}),
    ...(input.metrics ? { metrics: input.metrics } : {}),
    priority: input.priority || 'medium',
    maxLoops,
    parallel: false,
    degradeOnLoop: Math.ceil(maxLoops * 0.6),
    ...(hasBudget ? { budget: input.budget } : {}),
    ...(input.taskType ? { taskType: input.taskType } : {}),
    ...(input.planReview ? { planReview: input.planReview } : {}),
    authorization: input.authorization,
  };
  try {
    fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), { encoding: 'utf-8', flag: 'wx' });
  } catch (err: any) {
    // Never leave a charter without its request.
    try { fs.unlinkSync(charterPath); } catch { /* best effort */ }
    if (err?.code === 'EEXIST') throw new GoalConflictError(goalId);
    throw err;
  }
  if (input.autoStart !== false && !input.discussion) {
    deps.emitGoalCreated({ type: 'goal_created', goalId, projectDir });
  }

  return { goalId, charterPath, requestPath, projectDir, layout, goalDir };
}
