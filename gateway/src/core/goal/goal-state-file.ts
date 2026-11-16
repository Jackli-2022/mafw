// gateway/src/core/goal/goal-state-file.ts
// File-backed GoalState implementation (`.mafw/state/<goalId>.json` plus
// `state/revisions/<goalId>/rev-<n>.json`). SQLite is the write authority since
// Phase 2; these helpers remain the mirror and the pre-migration read source.
import * as fs from 'fs';
import * as path from 'path';
import type { GoalStateV3 } from './state-v3';

const TERMINAL_ACTIONS = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED']);

export function normalizeRevision(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function effectiveRound(s: { round?: number; loop?: number }): number {
  return s.round ?? s.loop ?? 0;
}

export function isTerminalState(s: GoalStateV3): boolean {
  return TERMINAL_ACTIONS.has(s.nextAction);
}

export function statePathFor(mafwDir: string, goalId: string): string {
  return path.join(mafwDir, 'state', `${goalId}.json`);
}

/** revision 快照目录（`state/revisions/<goalId>/`）。 */
export function revisionStateDirFor(mafwDir: string, goalId: string): string {
  return path.join(mafwDir, 'state', 'revisions', goalId);
}

/** 归档的 revision state 路径（`state/revisions/<goalId>/rev-<n>.json`）。 */
export function revisionStatePathFor(mafwDir: string, goalId: string, revision: number): string {
  return path.join(revisionStateDirFor(mafwDir, goalId), `rev-${normalizeRevision(revision)}.json`);
}

export function normalizeGoalState(raw: any, mafwDir: string, goalId: string): GoalStateV3 {
  const round = effectiveRound(raw);
  return {
    version: '3',
    goalId: raw.goalId ?? goalId,
    revision: normalizeRevision(raw.revision),
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
    lastFailure: raw.lastFailure ?? null,
    noProgressCount: raw.noProgressCount ?? 0,
    lastArtifactDigest: raw.lastArtifactDigest ?? {},
    nodeSession: raw.nodeSession
      ? { ...raw.nodeSession, revision: normalizeRevision(raw.nodeSession.revision ?? raw.revision) }
      : null,
    pendingQuestion: raw.pendingQuestion
      ? {
        ...raw.pendingQuestion,
        resumeNode: raw.pendingQuestion.resumeNode
          ?? (raw.pendingQuestion.node === 'review' ? 'plan' : raw.pendingQuestion.node ?? 'plan'),
      }
      : null,
    userResponse: raw.userResponse
      ? {
        ...raw.userResponse,
        resumeNode: raw.userResponse.resumeNode ?? 'plan',
      }
      : null,
    sameSigCount: raw.sameSigCount ?? 0,
    stateVersion: raw.stateVersion ?? 0,
    nextNode: raw.nextNode ?? 'plan',
    nextAction: raw.nextAction ?? 'RUNNING_plan',
    artifacts: raw.artifacts ?? {},
    currentWave: raw.currentWave ?? 0,
    totalWaves: raw.totalWaves ?? null,
    sessions: raw.sessions ?? {},
    policySnapshot: raw.policySnapshot,
    taskType: raw.taskType,
    planReview: (raw as any).planReview === 'manual' ? 'manual' : ((raw as any).planReview === 'auto' ? 'auto' : undefined),
    strategy: (raw as any).strategy === 'quick' || (raw as any).strategy === 'collaborative'
      ? (raw as any).strategy
      : undefined,
    assessment: (raw as any).assessment === 'reviewed' || (raw as any).assessment === 'unreviewed'
      ? (raw as any).assessment
      : undefined,
    quickRepairCount: typeof (raw as any).quickRepairCount === 'number' ? (raw as any).quickRepairCount : undefined,
    currentAssignmentId: typeof (raw as any).currentAssignmentId === 'string'
      ? (raw as any).currentAssignmentId
      : undefined,
    planApproval: (raw as any).planApproval ?? undefined,
    planFeedback: (raw as any).planFeedback ?? null,
    reviewFix: (raw as any).reviewFix ?? null,
    probeRefs: Array.isArray((raw as any).probeRefs) ? (raw as any).probeRefs : [],
    probeQueue: Array.isArray((raw as any).probeQueue) ? (raw as any).probeQueue : [],
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

/** 读 state（v3 或旧 v2 均可；旧格式不重写，读取侧规范化）。 */
export function loadGoalStateFile(mafwDir: string, goalId: string): GoalStateV3 | null {
  const p = statePathFor(mafwDir, goalId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return normalizeGoalState(raw, mafwDir, goalId);
  } catch {
    return null;
  }
}

/** 原子整份写入（.tmp + rename）。 */
export function saveGoalStateFile(mafwDir: string, goalId: string, state: GoalStateV3): void {
  const p = statePathFor(mafwDir, goalId);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

/**
 * 把当前 active state 归档到 `state/revisions/<goalId>/rev-<n>.json`。
 *
 * - **append-only**：目标文件已存在时原样保留，绝不重写。
 * - 无 active state 时返回 null。
 */
export function archiveGoalStateFile(mafwDir: string, goalId: string, revision?: number): string | null {
  const activePath = statePathFor(mafwDir, goalId);
  if (!fs.existsSync(activePath)) return null;
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(activePath, 'utf-8'));
  } catch {
    return null;
  }
  const target = revisionStatePathFor(mafwDir, goalId, revision ?? normalizeRevision(raw?.revision));
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...raw, revision: normalizeRevision(revision ?? raw?.revision) }, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
  return target;
}

/** File-mode goal discovery (`<mafwDir>/state/*.json`). */
export function listGoalStateFiles(mafwDir: string): string[] {
  const stateDir = path.join(mafwDir, 'state');
  if (!fs.existsSync(stateDir)) return [];
  return fs.readdirSync(stateDir).filter((f) => f.endsWith('.json'));
}
