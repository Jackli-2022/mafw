// Immutable assignment files: the exact task, acceptance, context and output
// paths given to one Worker/Reviewer. Prompt snapshots are append-only so a
// retry can never rewrite what an earlier execution was told.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { PlanStrategy } from './plan-package';

export interface GoalAssignmentAttempt {
  attempt: number;
  sessionId: string;
  startedAt: string;
  nodeRunId?: number;
}

export interface GoalAssignment {
  version: 1;
  assignmentId: string;
  goalId: string;
  revision: number;
  role: 'builder' | 'reviewer';
  strategy: PlanStrategy;
  taskIds: string[];
  acceptance: Record<string, string[]>;
  contextRefs: string[];
  artifacts: { receipt?: string; review?: string };
  instructions: string;
  attempts: GoalAssignmentAttempt[];
  createdAt: string;
}

export interface GoalAssignmentInput {
  goalId: string;
  revision: number;
  role: 'builder' | 'reviewer';
  strategy: PlanStrategy;
  taskIds: string[];
  acceptance: Record<string, string[]>;
  contextRefs: string[];
  artifacts: { receipt?: string; review?: string };
  instructions: string;
  sessionId: string;
  startedAt: string;
  nodeRunId?: number;
}

export interface CurrentAssignmentSummary {
  assignmentId: string;
  role: 'builder' | 'reviewer';
  taskIds: string[];
  attempt: number;
}

const SAFE_GOAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertGoalId(goalId: string): void {
  if (!SAFE_GOAL_ID.test(goalId) || goalId.includes('..')) {
    throw new Error(`invalid goal id for assignment: ${goalId}`);
  }
}

function assertRevision(revision: number): void {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error(`assignment revision must be a positive integer (got ${revision})`);
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(',')}}`;
}

function assignmentIdFor(input: Omit<GoalAssignment, 'version' | 'assignmentId' | 'attempts' | 'createdAt'>): string {
  const digest = createHash('sha256').update(stableJson({
    goalId: input.goalId,
    revision: input.revision,
    role: input.role,
    strategy: input.strategy,
    taskIds: input.taskIds,
    acceptance: input.acceptance,
    contextRefs: input.contextRefs,
    artifacts: input.artifacts,
    instructions: input.instructions,
  })).digest('hex');
  return `asg_${digest.slice(0, 12)}`;
}

function normalizeTaskIds(raw: string[]): string[] {
  const ids = Array.from(new Set(raw.map((id) => String(id ?? '').trim()).filter(Boolean)));
  if (!ids.length) throw new Error('assignment requires at least one task id');
  return ids;
}

function normalizeAcceptance(raw: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [taskId, values] of Object.entries(raw ?? {})) {
    const id = String(taskId ?? '').trim();
    if (!id || !Array.isArray(values)) continue;
    const clean = values.map((value) => String(value ?? '').trim()).filter(Boolean);
    if (clean.length) out[id] = clean;
  }
  return out;
}

export function createGoalAssignment(input: GoalAssignmentInput): GoalAssignment {
  assertGoalId(input.goalId);
  assertRevision(input.revision);
  const taskIds = normalizeTaskIds(input.taskIds);
  const acceptance = normalizeAcceptance(input.acceptance);
  const core = {
    goalId: input.goalId,
    revision: input.revision,
    role: input.role,
    strategy: input.strategy,
    taskIds,
    acceptance,
    contextRefs: input.contextRefs.map(String).filter(Boolean),
    artifacts: { ...input.artifacts },
    instructions: String(input.instructions ?? ''),
  };
  return {
    version: 1,
    assignmentId: assignmentIdFor(core),
    ...core,
    attempts: [{
      attempt: 1,
      sessionId: input.sessionId,
      startedAt: input.startedAt,
      ...(input.nodeRunId !== undefined ? { nodeRunId: input.nodeRunId } : {}),
    }],
    createdAt: input.startedAt,
  };
}

export function retryGoalAssignment(
  previous: GoalAssignment,
  next: { sessionId: string; startedAt: string; nodeRunId?: number },
): GoalAssignment {
  const attempt = previous.attempts.reduce((max, item) => Math.max(max, item.attempt), 0) + 1;
  return {
    ...previous,
    attempts: [
      ...previous.attempts,
      {
        attempt,
        sessionId: next.sessionId,
        startedAt: next.startedAt,
        ...(next.nodeRunId !== undefined ? { nodeRunId: next.nodeRunId } : {}),
      },
    ],
  };
}

export function assignmentDir(mafwDir: string, goalId: string, revision: number): string {
  assertGoalId(goalId);
  assertRevision(revision);
  if (revision <= 1) return path.join(mafwDir, 'goals', goalId, 'assignments');
  return path.join(mafwDir, 'revisions', goalId, `rev-${revision}`, 'assignments');
}

export function goalAssignmentFilePath(
  mafwDir: string,
  goalId: string,
  revision: number,
  assignmentId: string,
): string {
  if (!/^asg_[a-f0-9]{12}$/.test(assignmentId)) {
    throw new Error(`invalid assignment id: ${assignmentId}`);
  }
  return path.join(assignmentDir(mafwDir, goalId, revision), `${assignmentId}.json`);
}

export function writeGoalAssignment(input: {
  mafwDir: string;
  assignment: GoalAssignment;
  fullPrompt: string;
}): { jsonPath: string; promptPath: string } {
  const { assignment } = input;
  assertGoalId(assignment.goalId);
  assertRevision(assignment.revision);
  if (!assignment.attempts.length) throw new Error('assignment has no attempts');
  const dir = assignmentDir(input.mafwDir, assignment.goalId, assignment.revision);
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = goalAssignmentFilePath(
    input.mafwDir,
    assignment.goalId,
    assignment.revision,
    assignment.assignmentId,
  );
  const attempt = assignment.attempts[assignment.attempts.length - 1].attempt;
  const promptPath = path.join(dir, `${assignment.assignmentId}.attempt-${attempt}.prompt.md`);

  // Prompt first: an existing snapshot is never overwritten, and a failed JSON
  // write cannot leave a prompt the model believes was audited.
  fs.writeFileSync(promptPath, input.fullPrompt, { encoding: 'utf-8', flag: 'wx' });
  const tmp = `${jsonPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(assignment, null, 2), 'utf-8');
  fs.renameSync(tmp, jsonPath);
  return { jsonPath, promptPath };
}

export function readGoalAssignment(jsonPath: string): GoalAssignment | null {
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    if (!raw || raw.version !== 1 || typeof raw.assignmentId !== 'string') return null;
    return raw as GoalAssignment;
  } catch {
    return null;
  }
}

export function currentAssignmentSummary(
  mafwDir: string,
  goalId: string,
  revision: number,
  assignmentId: string,
): CurrentAssignmentSummary | null {
  let jsonPath: string;
  try {
    jsonPath = goalAssignmentFilePath(mafwDir, goalId, revision, assignmentId);
  } catch {
    return null;
  }
  const assignment = readGoalAssignment(jsonPath);
  if (!assignment || assignment.goalId !== goalId || assignment.revision !== revision) return null;
  const lastAttempt = assignment.attempts.reduce(
    (max, item) => Math.max(max, item.attempt),
    0,
  );
  return {
    assignmentId: assignment.assignmentId,
    role: assignment.role,
    taskIds: assignment.taskIds,
    attempt: lastAttempt,
  };
}

export function renderGoalAssignmentBlock(assignment: GoalAssignment): string {
  const acceptance = assignment.taskIds.map((taskId) => {
    const criteria = assignment.acceptance[taskId] ?? [];
    return `- ${taskId}: ${criteria.length ? criteria.join('；') : '（无额外 acceptance）'}`;
  });
  const artifacts = [
    assignment.artifacts.receipt ? `receipt: ${assignment.artifacts.receipt}` : '',
    assignment.artifacts.review ? `review: ${assignment.artifacts.review}` : '',
  ].filter(Boolean);
  return [
    '[ASSIGNMENT]',
    `assignmentId: ${assignment.assignmentId}`,
    `goalId: ${assignment.goalId}`,
    `revision: ${assignment.revision}`,
    `role: ${assignment.role}`,
    `strategy: ${assignment.strategy}`,
    `tasks: ${assignment.taskIds.join(', ')}`,
    'acceptance:',
    ...acceptance,
    assignment.contextRefs.length
      ? `context refs:\n${assignment.contextRefs.map((ref) => `- ${ref}`).join('\n')}`
      : 'context refs: （无）',
    artifacts.length ? `artifacts:\n${artifacts.map((line) => `- ${line}`).join('\n')}` : 'artifacts: （无）',
    `instructions: ${assignment.instructions}`,
    '[/ASSIGNMENT]',
  ].join('\n');
}
