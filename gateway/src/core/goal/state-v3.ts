// gateway/src/core/goal/state-v3.ts
// GoalStateV3 —— NodeDriver 的唯一状态真相源（spec §5）。
// 写入方：NodeDriver（唯一）；读取方：驱动器/timeline/dashboard（双读兼容 round/loop）。
import * as fs from 'fs';
import * as path from 'path';

export interface NodeSessionRef {
  id: string;
  phase: 'plan' | 'execute' | 'review';
  startedAt: string;
  attempt: number;
  runId: number;
}

export interface PendingQuestion {
  questionId: string;
  node: 'plan' | 'review';
  loop: number;
  questions: string[];
  askedAt: string;
}

export interface UserResponse {
  questionId: string;
  answer: string;
  respondedAt: string;
}

export interface GoalStateV3 {
  version: '3';
  goalId: string;
  projectDir: string;
  mafwDir: string;
  phase: string;
  round: number;
  loop: number; // round 的双写别名（读取走 effectiveRound）
  maxRounds: number;
  reviewVerdict: 'PASS' | 'FAIL' | 'ERROR' | null;
  reviewReportPath: string | null;
  reviewFeedback: string;
  wavePlanPath: string | null;
  receiptPath: string | null;
  lastError: string | null;
  nodeSession: NodeSessionRef | null;
  pendingQuestion: PendingQuestion | null;
  userResponse: UserResponse | null;
  sameSigCount: number;
  stateVersion: number;
  nextNode: string;
  nextAction: string;
  artifacts: Record<string, string>;
  currentWave: number;
  totalWaves: number | null;
  sessions: Record<string, { id: string; createdAt: string; destroyedAt?: string; active: boolean }>;
  policySnapshot?: { version: string; proposalId: string | null; maxTurns?: number; maxCostUsd?: number };
  updatedAt: string;
}

const TERMINAL_ACTIONS = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED']);

export function statePathFor(mafwDir: string, goalId: string): string {
  return path.join(mafwDir, 'state', `${goalId}.json`);
}

export function effectiveRound(s: { round?: number; loop?: number }): number {
  return s.round ?? s.loop ?? 0;
}

export function isTerminalState(s: GoalStateV3): boolean {
  return TERMINAL_ACTIONS.has(s.nextAction);
}

/** 读 state（v3 或旧 v2 均可；旧格式不重写，读取侧规范化）。 */
export function loadGoalState(mafwDir: string, goalId: string): GoalStateV3 | null {
  const p = statePathFor(mafwDir, goalId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return normalize(raw, mafwDir, goalId);
  } catch {
    return null;
  }
}

function normalize(raw: any, mafwDir: string, goalId: string): GoalStateV3 {
  const round = effectiveRound(raw);
  return {
    version: '3',
    goalId: raw.goalId ?? goalId,
    projectDir: raw.projectDir ?? '',
    mafwDir: raw.mafwDir ?? mafwDir,
    phase: raw.phase ?? null,
    round,
    loop: round,
    maxRounds: raw.maxRounds ?? 3,
    reviewVerdict: raw.reviewVerdict ?? null,
    reviewReportPath: raw.reviewReportPath ?? null,
    reviewFeedback: raw.reviewFeedback ?? '',
    wavePlanPath: raw.wavePlanPath ?? null,
    receiptPath: raw.receiptPath ?? null,
    lastError: raw.lastError ?? raw.error ?? null,
    nodeSession: raw.nodeSession ?? null,
    pendingQuestion: raw.pendingQuestion ?? null,
    userResponse: raw.userResponse ?? null,
    sameSigCount: raw.sameSigCount ?? 0,
    stateVersion: raw.stateVersion ?? 0,
    nextNode: raw.nextNode ?? 'plan',
    nextAction: raw.nextAction ?? 'RUNNING_plan',
    artifacts: raw.artifacts ?? {},
    currentWave: raw.currentWave ?? 0,
    totalWaves: raw.totalWaves ?? null,
    sessions: raw.sessions ?? {},
    policySnapshot: raw.policySnapshot,
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

/** 原子合并写入（.tmp + rename；round/loop 双写）。 */
export function writeGoalState(
  mafwDir: string,
  goalId: string,
  patch: Partial<GoalStateV3>,
  opts?: { bumpVersion?: boolean },
): GoalStateV3 {
  const p = statePathFor(mafwDir, goalId);
  const current = loadGoalState(mafwDir, goalId);
  if (!current) throw new Error(`State file not found: ${p}`);
  const round = patch.round ?? current.round;
  const next: GoalStateV3 = {
    ...current,
    ...patch,
    round,
    loop: round,
    stateVersion: opts?.bumpVersion ? (current.stateVersion ?? 0) + 1 : current.stateVersion ?? 0,
    updatedAt: new Date().toISOString(),
  };
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
  return next;
}

/** starter 用：无 state 则建（含 policySnapshot），有则原样返回（幂等）。 */
export function ensureGoalState(
  mafwDir: string,
  goalId: string,
  init: { projectDir: string; maxRounds: number; policySnapshot?: GoalStateV3['policySnapshot'] },
): GoalStateV3 {
  const existing = loadGoalState(mafwDir, goalId);
  if (existing) return existing;
  const s: GoalStateV3 = {
    version: '3', goalId,
    projectDir: init.projectDir, mafwDir,
    phase: 'PLANNING', round: 1, loop: 1, maxRounds: init.maxRounds,
    reviewVerdict: null, reviewReportPath: null, reviewFeedback: '',
    wavePlanPath: null, receiptPath: null, lastError: null,
    nodeSession: null, pendingQuestion: null, userResponse: null,
    sameSigCount: 0, stateVersion: 0,
    nextNode: 'plan', nextAction: 'RUNNING_plan',
    artifacts: {}, currentWave: 0, totalWaves: null, sessions: {},
    ...(init.policySnapshot ? { policySnapshot: init.policySnapshot } : {}),
    updatedAt: new Date().toISOString(),
  };
  const p = statePathFor(mafwDir, goalId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf-8');
  return s;
}
