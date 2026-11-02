// gateway/src/core/goal/goal-intake.ts
// Shared Goal file intake. The MCP tool and Pod composer must never maintain
// two different request/charter writers.

import * as fs from 'fs';
import * as path from 'path';

export type GoalAuthorization = {
  source: 'desktop' | 'lead' | 'a2a' | 'automation' | 'user';
  requestMode: 'explicit' | 'inferred';
  scope?: string;
};

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
}

export interface GoalIntakeResult {
  goalId: string;
  charterPath: string;
  requestPath: string;
  projectDir: string;
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

  const resolved = deps.resolveProject(input.projectDir);
  if (!resolved) throw new Error(`project is not registered: ${input.projectDir ?? '(current)'}`);
  const { projectDir, mafwDir } = resolved;
  const goalsDir = path.join(mafwDir, 'goals');
  const requestsDir = path.join(mafwDir, 'requests');
  const charterPath = path.join(goalsDir, `${goalId}.md`);
  const requestPath = path.join(requestsDir, `${goalId}.json`);

  // Validate everything above before creating directories/files: invalid
  // intake must not leave partial artifacts behind.
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(requestsDir, { recursive: true });
  if (fs.existsSync(charterPath) || fs.existsSync(requestPath)) {
    throw new Error(`Goal ${goalId} already exists`);
  }

  const body = charter || buildGoalCharter({ title, objective: objective || undefined, acceptance: input.acceptance, boundaries: input.boundaries });
  fs.writeFileSync(charterPath, body, 'utf-8');

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
  fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), 'utf-8');
  deps.emitGoalCreated({ type: 'goal_created', goalId, projectDir });

  return { goalId, charterPath, requestPath, projectDir };
}
