// gateway/src/core/goal/state-v3.ts
// GoalStateV3 —— NodeDriver 的唯一状态真相源（spec §5）。
// 写入方：NodeDriver（唯一）；读取方：驱动器/timeline/dashboard（双读兼容 round/loop）。
// Phase 2：SQLite（`GoalStateStore`）是写权威；JSON 文件是兼容镜像与旧数据导入源。
import * as fs from 'fs';
import {
  archiveGoalStateFile,
  effectiveRound,
  listGoalStateFiles,
  loadGoalStateFile,
  normalizeGoalState,
  normalizeRevision,
  saveGoalStateFile,
  isTerminalState,
  revisionStateDirFor,
  revisionStatePathFor,
  statePathFor,
} from './goal-state-file';
import type { GoalStateBackend, GoalStateHistoryMeta } from './goal-state-store';
import type { FailureClass } from './failure-class';

export {
  effectiveRound,
  isTerminalState,
  normalizeGoalState,
  revisionStateDirFor,
  revisionStatePathFor,
  statePathFor,
};

export interface NodeSessionRef {
  id: string;
  phase: 'plan' | 'probe' | 'execute' | 'review';
  startedAt: string;
  attempt: number;
  runId: number;
  /** 归属的 Goal revision（旧状态缺字段读侧补 state.revision 或 1）。 */
  revision?: number;
  /** Task 14：probe 节点正在执行的探针 id（报告完成判定用）。 */
  probeId?: string;
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
    node: 'plan' | 'probe' | 'execute' | 'review';
    attempt: number;
    at: string;
  } | null;
  noProgressCount?: number;
  lastArtifactDigest?: Partial<Record<'plan' | 'probe' | 'execute' | 'review', string>>;
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
  /** Tech Lead 为当前 revision 选择的执行策略；旧状态缺省 = collaborative。 */
  strategy?: 'quick' | 'collaborative';
  /** 结果是否经过独立评审；缺省 = 未声明。 */
  assessment?: 'reviewed' | 'unreviewed';
  /** 快速路径在同一 revision 内的机械校验修复次数。 */
  quickRepairCount?: number;
  /** 当前派工文件 id（Assignment prompt 审计入口）。 */
  currentAssignmentId?: string;
  /** W1 批准门运行态：pending = 驳留在 AWAIT_PLAN_APPROVAL。 */
  planApproval?: {
    /** Random one-time id; absent only for approvals created before v3. */
    id?: string;
    status: 'pending' | 'approved' | 'rejected';
    feedback?: string;
    decidedAt?: string;
    round: number;
    /** 产生该计划的 Goal revision（旧状态缺字段 → effectiveRevision(state)）。 */
    revision?: number;
    /** Task 13 内容绑定：批准时 waves 的规范化哈希（缺省 = 旧版计划，未绑定内容）。 */
    planHash?: string | null;
    /** Task 13 内容绑定：GoalEval 的规范化哈希；旧版计划没有 eval → null。 */
    evalHash?: string | null;
  };
  /** W1 最近一次驳回反馈——注入下一版 plan prompt；plan 成功兑现时清除。 */
  planFeedback?: string | null;
  /** 同轮复核：review FAIL 后允许一次"只修失败项"的 execute 复跑（不消耗 round）。
   *  存在且 round 等于当前轮 → 该轮已用过复核。 */
  reviewFix?: {
    round: number;
    tasks: Array<{ taskId: string; evidence: string }>;
    /** 评审内容缺口（缺证据 / 漏任务 / 漏必需 Goal 条件）；与失败任务同语义进入同轮修复。 */
    omissions?: string[];
    feedback: string;
  } | null;
  /** Task 14：本 revision 已兑现的 ProbeReport id（报告的权威输入证据）。 */
  probeRefs?: string[];
  /** Task 14：已入队、尚未兑现报告的探针 id（FIFO；一个 Pod 同时只跑一条）。 */
  probeQueue?: string[];
  updatedAt: string;
}

let goalStateBackend: GoalStateBackend | null = null;

/** kernel bootstrap registers the SQLite store; tests/CLI stay file-backed. */
export function setGoalStateBackend(backend: GoalStateBackend | null): void {
  goalStateBackend = backend;
}

/** 读取侧 revision（旧状态缺字段 → 1）。 */
export function effectiveRevision(s: { revision?: number }): number {
  return normalizeRevision(s.revision);
}

/** 读 state（DB 优先；未注册 backend 或测试环境走文件）。 */
export function loadGoalState(mafwDir: string, goalId: string): GoalStateV3 | null {
  if (goalStateBackend) return goalStateBackend.load(mafwDir, goalId);
  return loadGoalStateFile(mafwDir, goalId);
}

function saveGoalState(
  mafwDir: string,
  goalId: string,
  state: GoalStateV3,
  meta?: GoalStateHistoryMeta,
): void {
  if (goalStateBackend) {
    goalStateBackend.save(mafwDir, goalId, state, meta);
    return;
  }
  saveGoalStateFile(mafwDir, goalId, state);
}

/** 原子合并写入（.tmp + rename；round/loop 双写）。 */
export function writeGoalState(
  mafwDir: string,
  goalId: string,
  patch: Partial<GoalStateV3>,
  opts?: { bumpVersion?: boolean },
): GoalStateV3 {
  const current = loadGoalState(mafwDir, goalId);
  if (!current) throw new Error(`State file not found: ${statePathFor(mafwDir, goalId)}`);
  const round = patch.round ?? current.round;
  const next: GoalStateV3 = {
    ...current,
    ...patch,
    round,
    loop: round,
    stateVersion: opts?.bumpVersion ? (current.stateVersion ?? 0) + 1 : current.stateVersion ?? 0,
    updatedAt: new Date().toISOString(),
  };
  const unset = Object.keys(patch).filter((key) => (patch as any)[key] === undefined);
  saveGoalState(mafwDir, goalId, next, { patch, ...(unset.length ? { unset } : {}) });
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
 * 把当前 active state 归档到 `state/revisions/<goalId>/rev-<n>.json`（或 DB 归档表）。
 * append-only：已有快照原样保留。返回归档文件路径；DB 模式返回 null。
 */
export function archiveGoalStateForRevision(
  mafwDir: string,
  goalId: string,
  revision?: number,
): string | null {
  if (goalStateBackend) {
    const current = goalStateBackend.load(mafwDir, goalId);
    if (!current) return null;
    const target = normalizeRevision(revision ?? current.revision);
    goalStateBackend.archiveRevision(mafwDir, goalId, target);
    // Keep the API contract: callers still get the mirror path when it exists.
    const mirrorPath = revisionStatePathFor(mafwDir, goalId, target);
    return fs.existsSync(mirrorPath) ? mirrorPath : null;
  }
  return archiveGoalStateFile(mafwDir, goalId, revision);
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
 * 不覆盖已有快照），再重建干净 state——归档文件与更高 revision 的进度完全隔离；
 * 传入更低/相同的 revision 绝不降级、不改写。新 revision 的 `stateVersion`
 * 从旧 revision 的末值 +1 起算（跨 revision 单调，保证 milestone 去重键不碰撞）。
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
    stateVersion = (existing.stateVersion ?? 0) + 1;
  }
  const s = freshState(mafwDir, goalId, targetRevision, init, stateVersion);
  saveGoalState(mafwDir, goalId, s, { reset: true });
  return s;
}

/**
 * Goal 发现（recovery / scheduler 用）。DB 模式列出全部行；文件模式扫描
 * `<mafwDir>/state/*.json`。返回项保持旧的 `{ goalId, mafwDir, projectDir }` 形状。
 */
export function listGoalStateSummaries(
  workspaces: Array<{ projectDir: string; mafwDir: string }>,
): Array<{ goalId: string; mafwDir: string; projectDir: string }> {
  if (goalStateBackend) {
    const registered = new Set(workspaces.map((workspace) => workspace.mafwDir));
    const summaries = new Map<string, { goalId: string; mafwDir: string; projectDir: string }>();
    for (const state of goalStateBackend.list()) {
      if (workspaces.length > 0 && !registered.has(state.mafwDir)) continue;
      summaries.set(state.goalId, {
        goalId: state.goalId,
        mafwDir: state.mafwDir,
        projectDir: state.projectDir,
      });
    }
    // First boot after the upgrade: the DB is empty but legacy JSON files are
    // not. Import them here so active goals are not stranded by recovery.
    for (const workspace of workspaces) {
      for (const file of listGoalStateFiles(workspace.mafwDir)) {
        const goalId = file.replace(/\.json$/, '');
        if (summaries.has(goalId)) continue;
        const imported = goalStateBackend.load(workspace.mafwDir, goalId);
        if (!imported) continue;
        summaries.set(goalId, {
          goalId,
          mafwDir: imported.mafwDir || workspace.mafwDir,
          projectDir: imported.projectDir || workspace.projectDir,
        });
      }
    }
    return [...summaries.values()];
  }
  const out: Array<{ goalId: string; mafwDir: string; projectDir: string }> = [];
  for (const workspace of workspaces) {
    for (const file of listGoalStateFiles(workspace.mafwDir)) {
      out.push({
        goalId: file.replace(/\.json$/, ''),
        mafwDir: workspace.mafwDir,
        projectDir: workspace.projectDir,
      });
    }
  }
  return out;
}
