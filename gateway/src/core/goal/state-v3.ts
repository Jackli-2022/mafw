// gateway/src/core/goal/state-v3.ts
// GoalStateV3 —— NodeDriver 的唯一状态真相源（spec §5）。
// 写入方：NodeDriver（唯一）；读取方：驱动器/timeline/dashboard（双读兼容 round/loop）。
import * as fs from 'fs';
import * as path from 'path';
import type { FailureClass } from './failure-class';

export interface NodeSessionRef {
  id: string;
  phase: 'plan' | 'execute' | 'review';
  startedAt: string;
  attempt: number;
  runId: number;
}

export interface PendingQuestion {
  questionId: string;
  node: 'plan' | 'execute' | 'review';
  /** Node that must consume the answer; legacy defaults to plan. */
  resumeNode?: 'plan' | 'execute' | 'review';
  loop: number;
  questions: string[];
  askedAt: string;
}

export interface UserResponse {
  questionId: string;
  answer: string;
  questions?: string[];
  resumeNode?: 'plan' | 'execute' | 'review';
  respondedAt: string;
  consumedByRunId?: number;
}

export interface GoalStateV3 {
  version: '3';
  goalId: string;
  /** Goal revision（1 起；normalize/ensure 保证存在，旧 v3 状态读侧补 1）。
   *  每个 revision 独立跑完整 loop；上一个 revision 的 state 归档在
   *  `state/revisions/<goalId>/rev-<n>.json`，append-only 永不重写。 */
  revision?: number;
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
  lastFailure?: {
    class: FailureClass;
    code: string;
    message: string;
    node: 'plan' | 'execute' | 'review';
    attempt: number;
    at: string;
  } | null;
  noProgressCount?: number;
  lastArtifactDigest?: Partial<Record<'plan' | 'execute' | 'review', string>>;
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
  /** D4b 任务类型（'feature'|'bugfix'|'refactor'|'research'|'docs'|'test'|'other'）。
   *  创建时声明（request.json）→ plan 节点 waves.taskType 回写覆盖（规划者优先）。 */
  taskType?: string;
  /** W1 计划审阅模式：'manual' 时 plan 完成驻留待批；缺省 'auto'（存量零迁移）。 */
  planReview?: 'auto' | 'manual';
  /** W1 批准门运行态：pending = 驳留在 AWAIT_PLAN_APPROVAL。 */
  planApproval?: {
    /** Random one-time id; absent only for approvals created before v3. */
    id?: string;
    status: 'pending' | 'approved' | 'rejected';
    feedback?: string;
    decidedAt?: string;
    round: number;
  };
  /** W1 最近一次驳回反馈——注入下一版 plan prompt；plan 成功兑现时清除。 */
  planFeedback?: string | null;
  /** 同轮复核：review FAIL 后允许一次"只修失败项"的 execute 复跑（不消耗 round）。
   *  存在且 round 等于当前轮 → 该轮已用过复核。 */
  reviewFix?: {
    round: number;
    tasks: Array<{ taskId: string; evidence: string }>;
    feedback: string;
  } | null;
  updatedAt: string;
}

const TERMINAL_ACTIONS = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED']);

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

function normalizeRevision(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/** 读取侧 revision（旧状态缺字段 → 1）。 */
export function effectiveRevision(s: { revision?: number }): number {
  return normalizeRevision(s.revision);
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
    nodeSession: raw.nodeSession ?? null,
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
    planApproval: (raw as any).planApproval ?? undefined,
    planFeedback: (raw as any).planFeedback ?? null,
    reviewFix: (raw as any).reviewFix ?? null,
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

export interface EnsureGoalStateInit {
  /** 目标 revision（缺省/≤当前 → 幂等返回现有 state；更高 → 归档旧 revision 并重建）。 */
  revision?: number;
  projectDir: string;
  maxRounds: number;
  policySnapshot?: GoalStateV3['policySnapshot'];
  taskType?: string;
  planReview?: 'auto' | 'manual';
}

/**
 * 把当前 active state 归档到 `state/revisions/<goalId>/rev-<n>.json`。
 *
 * - `revision` 缺省 = active state 自身的 revision（旧状态 → 1）。
 * - **append-only**：目标文件已存在时原样保留，绝不重写（旧 revision 的快照
 *   必须一直等于它收尾时的样子）。返回归档路径；无 active state 时返回 null。
 */
export function archiveGoalStateForRevision(
  mafwDir: string,
  goalId: string,
  revision?: number,
): string | null {
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

/** 新 revision 的干净 state（旧 revision 的进度绝不带过来；stateVersion 跨 revision 单调）。 */
function freshState(
  mafwDir: string,
  goalId: string,
  revision: number,
  init: EnsureGoalStateInit,
  stateVersion: number,
): GoalStateV3 {
  return {
    version: '3', goalId, revision,
    projectDir: init.projectDir, mafwDir,
    phase: 'PLANNING', round: 1, loop: 1, maxRounds: init.maxRounds,
    reviewVerdict: null, reviewReportPath: null, reviewFeedback: '',
    wavePlanPath: null, receiptPath: null, lastError: null,
    nodeSession: null, pendingQuestion: null, userResponse: null,
    sameSigCount: 0, stateVersion,
    nextNode: 'plan', nextAction: 'RUNNING_plan',
    artifacts: {}, currentWave: 0, totalWaves: null, sessions: {},
    ...(init.policySnapshot ? { policySnapshot: init.policySnapshot } : {}),
    ...(init.taskType ? { taskType: init.taskType } : {}),
    ...(init.planReview ? { planReview: init.planReview } : {}),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * starter 用：无 state 则建（含 policySnapshot），同一 revision 幂等返回现有 state。
 *
 * 传入更高的 `revision` = 开启新 revision：先把旧 active state 归档（幂等、
 * 不覆盖已有快照），再在 `state/<goalId>.json` 重建干净 state——归档文件与
 * 更高 revision 的进度完全隔离；传入更低/相同的 revision 绝不降级、不改写。
 * 新 revision 的 `stateVersion` 从旧 revision 的末值 +1 起算（跨 revision 单调，
 * 保证 milestone 去重键不碰撞）。
 */
export function ensureGoalState(
  mafwDir: string,
  goalId: string,
  init: EnsureGoalStateInit,
): GoalStateV3 {
  const targetRevision = normalizeRevision(init.revision);
  const existing = loadGoalState(mafwDir, goalId);
  let stateVersion = 0;
  if (existing) {
    const currentRevision = effectiveRevision(existing);
    if (targetRevision <= currentRevision) return existing;
    archiveGoalStateForRevision(mafwDir, goalId, currentRevision);
    // milestone 去重键 = `<goalId>:<phase>:<stateVersion>`（不含 revision）：
    // stateVersion 必须跨 revision 单调递增，否则新 revision 从 0 开始会命中旧
    // revision 的键，manager 里程碑通知被静默吞掉。
    stateVersion = (existing.stateVersion ?? 0) + 1;
  }
  const s = freshState(mafwDir, goalId, targetRevision, init, stateVersion);
  const p = statePathFor(mafwDir, goalId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
  return s;
}
