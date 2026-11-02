// gateway/src/core/goal/driver.ts
// NodeDriver —— goal 编排状态机（spec §3）。
// 驱动：state 文件（真相源）+ per-session 事件监听（idle/error 双门完成判定）。
// langgraph 三件套（graph/checkpointer/interrupt）退役；路由用 routing.ts 纯函数。
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  GoalStateV3, loadGoalState, writeGoalState, isTerminalState, effectiveRound, effectiveRevision,
} from './state-v3';
import { routeNext, GoalNodeName } from './routing';
import {
  renderNodePrompt, nodeArtifactPaths, nodeOutputSchema, goalEvalArtifactPath, readGoalEvalArtifact,
} from './node-prompts';
import type { NodeSessionRef } from './state-v3';
import { computeGoalEvalHash, computeWavesHash, validatePlanPackage } from './plan-package';
import { requiredConditionIds } from './goal-eval';
import type { GoalEval } from './goal-eval';
import { ExecutableGoalNode, goalAgentName, isExecutableGoalNode } from './node-names';
import { isTaskType } from '../../orchestration/capability-ledger';
import { parseReviewRubric, taskAcceptanceFromWavePlan, taskIdsFromWavePlan } from './review-rubric';
import {
  validateProbeRequest,
  type ProbeAffects,
  type ProbeBudget,
  type ProbeReport,
  type ProbeRequest,
  type ProbeScope,
} from './probe';
import {
  findGoalCharterPath,
  findGoalRequestPath,
  legacyGoalCharterPath,
  legacyGoalRequestPath,
  readGoalRequest,
} from './goal-intake';
import { ensureWaveTaskIds } from './wave-plan-edit';
import { matchesSignature } from '../langgraph/signature-detector';
import type { OutputSchemaSpec } from '../../runtime/structured-output';
import { classifyNodeFailure } from './failure-class';
import { nextNoProgress } from './no-progress';

/** 从 waves.json 收集 taskId（与 PodTaskService 的 `${wave.id}-t${i+1}` 一致）。
 *  文件缺失/非法 → 返回 []（旧 goal 兼容：review 仍按 verdict 判定）。 */
function readWaveTaskIds(wavesPath: string): string[] {
  try {
    if (!fs.existsSync(wavesPath)) return [];
    return taskIdsFromWavePlan(JSON.parse(fs.readFileSync(wavesPath, 'utf-8')));
  } catch {
    return [];
  }
}

/**
 * 计划批准绑定的内容版本已过期（waves 或 GoalEval 在请求批准后被改写）。
 * HTTP 层据此回 409 + `code: 'stale_plan'`，并带上当前内容哈希供客户端刷新后重批。
 */
export class StalePlanError extends Error {
  readonly code = 'stale_plan';

  constructor(message: string, readonly hashes: { planHash: string | null; evalHash: string | null }) {
    super(message);
    this.name = 'StalePlanError';
  }
}

export interface PlanApprovalHashes {
  planHash: string | null;
  evalHash: string | null;
}

/** waves 规范化哈希；非法 waves（旧计划/半截产物）返回 null，绝不抛。 */
function safeWavesHash(waves: unknown): string | null {
  try { return computeWavesHash(waves); } catch { return null; }
}

function safeGoalEvalHash(goalEval: GoalEval | null): string | null {
  if (!goalEval) return null;
  try { return computeGoalEvalHash(goalEval); } catch { return null; }
}

/** 原子写 Goal Eval（.tmp + rename；坏中间态不会被评审读到）。 */
function writeGoalEvalFile(target: string, goalEval: GoalEval): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(goalEval, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
}

export interface GoalRuntimeClient {
  create(directory: string): Promise<{ id: string }>;  /**
   * W1：节点会话建好后按身份绑模型。opencode v2 会话模型与 agent 解耦
   * （agent md 的 model 只对 subagent 工具子会话生效），goal 会话是先
   * create（默认模型）再 promptAsync(agent)——必须显式 switchModel。
   * 可选 + fail-open：pi 等无 switchModel 的 runtime 跳过。
   */
  bindModel?(sessionID: string, agent: string): Promise<void>;
  promptAsync(opts: {
    sessionID: string;
    parts: Array<{ type: string; text: string }>;
    agent?: string;
    outputSchema?: OutputSchemaSpec;
  }): Promise<void>;
  delete(sessionID: string): Promise<void>;
  abort?(sessionID: string): Promise<void>;
  /** Batch 1：已通过 JSON Schema 校验的交卷（缺省 = 只走文件 fallback）。 */
  structured?(sessionID: string): Promise<unknown | null>;
}

/** 计划输出的探针申请（id/podId/revision 由 driver 注入，计划模型只声明范围）。 */
export interface GoalProbeDraft {
  question: string;
  hypothesis: string;
  scope: ProbeScope;
  budget: ProbeBudget;
  evidenceRequired: string[];
  affects?: ProbeAffects;
}

/** 探针隔离工作区（driver 只要求路径 + 幂等销毁）。 */
export interface GoalProbeWorkspace {
  dir: string;
  dispose(): Promise<void>;
}

/** 探针会话 → ProbeRequest 绑定（ApprovalPolicyService 的范围守卫据此判定）。 */
export interface GoalProbeSessionBinding {
  request: ProbeRequest;
  workspaceDir?: string | null;
  /** 主项目目录：命令里出现它 = 越过隔离边界（deny）。 */
  projectDir?: string | null;
}

/**
 * Task 14：Spike 端口。生产实现是 PodProbeService + ProbeWorkspaceFactory（index.ts 接线）；
 * 测试用内存实现。driver 只依赖这些语义，不直接碰 DB/文件布局。
 */
export interface GoalProbePort {
  /** goal 属于哪个 Pod；不属于 Pod（或 Pod 不存在）→ null。 */
  podIdForGoal(goalId: string): string | null;
  /** 入队计划申请的探针，返回持久化 id（顺序与 drafts 一致）。校验失败必须抛错。 */
  enqueue(input: { podId: string; goalId: string; revision: number; drafts: GoalProbeDraft[] }): string[];
  /** 取该 goal 下一条**可执行**探针（Pod 内单飞；未轮到本 goal → null）。 */
  take(input: { podId: string; goalId: string; probeIds: string[] }): ProbeRequest | null;
  /** 已完成报告；未完成/不存在 → null。 */
  report(probeId: string): ProbeReport | null;
  /** 落报告（校验 + 脱敏由实现负责）。同探针重复完成以最新为准。 */
  complete(probeId: string, report: unknown): ProbeReport;
  /** 终态失败：把探针标记 failed（释放 Pod 运行槽）。实现负责脱敏/幂等/容错。 */
  failProbe(probeId: string, reason: string): void;
  /** 可重试失败：把 running 退回 queued（下一轮 claim 取回同一条）。 */
  requeueProbe(probeId: string, reason?: string): void;
  /** 报告产物路径（prompt 告诉 Builder 写哪里）。 */
  reportPath(goalId: string, probeId: string): string;
  /** 创建隔离工作区；不可用时 null（fail-closed，driver 会失败该节点）。 */
  prepareWorkspace(input: { projectDir: string; goalId: string; probeId: string }): Promise<GoalProbeWorkspace | null>;
  disposeWorkspace(workspace: GoalProbeWorkspace): Promise<void>;
  /** 绑定/解绑探针会话的范围（sessionID → request），供审批守门消费。 */
  bindSession(sessionId: string, binding: GoalProbeSessionBinding | null): void;
}

/** 单个 revision 允许的探针总数上限（防 need_probe ↔ probe 无限循环挤占实施）。 */
export const MAX_PROBES_PER_REVISION = 4;

export interface DriverDeps {
  client: GoalRuntimeClient;
  db: {
    insertNodeRun(i: { goalId: string; projectId: string; loop: number; node: string; attempt: number; sessionId: string | null; startedAt: string; revision?: number }): number;
    finishNodeRun(id: number, p: { status: string; finishedAt: string; outcome?: string | null; error?: string | null; tokensInput?: number | null; tokensOutput?: number | null; costUsd?: number | null }): void;
    listNodeRuns(goalId: string): any[];
    latestNodeAttempt(goalId: string, revision: number, loop: number, node: string): any | null;
  };
  ledger: {
    appendQuestionEvent(e: any): void;
    getQuestionState(questionId: string): string | null;
  };
  emitNodeEvent(p: Record<string, unknown>): void;
  emitPhaseTransition(p: { type: 'phase_transition'; goalId: string; phase: string; loop: number; projectDir: string; revision?: number }): void;
  onSessionCreated(info: { goalId: string; sessionId: string; phase: string; loop: number; revision?: number }): void;
  archiveGoal(goalId: string, opts: { verdict: string; rounds: number; lastError?: string | null; reviewFeedback?: string }): Promise<void>;
  nodeTimeoutMs: number;
  maxAttempts: number;
  /** Random one-time token for each manual plan approval. */
  newApprovalId(): string;
  /**
   * Task 12：复用**既有**节点会话（如 Tech Lead 讨论会话）而不是新建 runtime 会话。
   * 返回 sessionID 表示复用；null/缺省 = 走原来的 create。抛错按 fail-open 视为不复用。
   * 复用的会话由它自己的 owner（如 Tech Lead supervisor）管理生命周期——driver 完成
   * 节点后不会 delete 它，以保证跨 revision 的讨论连续性。
   */
  existingNodeSession?(goalId: string, node: ExecutableGoalNode, revision: number): string | null;
  /** W4：能力账本 + 失败谱块（plan 节点先验），缺省不注入。fail-open。
   *  D4b 起签名带 goalId（读 state.taskType 做同类任务先验）。 */
  capabilityPrior?: (goalId: string) => string | null;
  /** D4b：反事实推演块（pre-mortem，仅 plan 注入），缺省不注入。fail-open。 */
  counterfactualPrior?: (goalId: string) => string | null;
  /** Pod Lite：项目级 Pod 上下文块，缺省不注入。fail-open。 */
  podContext?: (goalId: string, node: 'plan' | 'execute' | 'review', sessionId: string) => string | null;
  /** Pod handoff：promptAsync 被接受后提交 pending 投递状态。 */
  onPromptDispatched?: (sessionId: string) => void;
  /** Pod 暂停自动推进：false 时不创建新节点；askUser/archive 仍可执行。 */
  canCreateNode?: (goalId: string) => boolean;
  /** Task 14：Spike 端口（缺省 = 该 goal 不支持探针；need_probe 计划会失败）。 */
  probes?: GoalProbePort;
}

const NODE_PHASE: Record<ExecutableGoalNode, { running: string; complete: string }> = {
  plan: { running: 'PLANNING', complete: 'PLANNING_COMPLETE' },
  probe: { running: 'PROBING', complete: 'PROBING_COMPLETE' },
  execute: { running: 'EXECUTING', complete: 'EXECUTING_COMPLETE' },
  review: { running: 'REVIEWING', complete: 'REVIEWING_COMPLETE' },
};

export class NodeDriver {
  private mutex = new Map<string, Promise<void>>();
  private listeners = new Map<string, (ev: 'idle' | 'error', failure?: {
    message: string;
    code: string;
    source: 'runtime' | 'artifact';
  }) => boolean | void>();
  private stateDirs = new Map<string, string>(); // goalId → mafwDir
  /** 复用的会话（Tech Lead 讨论会话等）：完成/失败都不 delete，owner 管生命周期。 */
  private reusedSessions = new Set<string>();
  /** 复用会话的"无产物 idle"宽容：讨论回合的 idle 会与本节点的 prompt 竞态。 */
  private reuseIdleGrace = new Set<string>();
  /** 复用会话节点启动时的产物指纹（判断 idle 时的产物是不是本次新写的）。 */
  private nodeStartArtifacts = new Map<string, { path: string; digest: string | null }>();
  /** Task 14：探针会话 → 隔离工作区（完成/失败都必须销毁）。 */
  private probeWorkspaces = new Map<string, GoalProbeWorkspace>();
  /** Task 14：每条探针自己的技术重试计数（attempt 只描述重试，不描述同批第几条）。 */
  private probeAttempts = new Map<string, number>();
  /** Task 14：每条探针的硬超时定时器（budget.maxMinutes）。 */
  private probeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** advanceInner 在同一次推进里的递归深度（probe→plan→probe 的正常链也有上限）。 */
  private advanceDepth = 0;
  private static readonly MAX_ADVANCE_DEPTH = 8;

  constructor(private deps: DriverDeps) {}

  /** index.ts 启动/starter 调用：登记 goal 的状态目录。 */
  registerGoalDir(goalId: string, mafwDir: string): void {
    this.stateDirs.set(goalId, mafwDir);
  }

  /** handleOpencodeEvent 分发入口（idle）。处理器返回 true = 继续监听（暂存 idle）。 */
  onSessionIdle(sessionID: string): void {
    const h = this.listeners.get(sessionID);
    if (!h) return;
    const keep = h('idle');
    if (keep !== true) this.listeners.delete(sessionID);
  }

  /** handleOpencodeEvent 分发入口（error）。code 缺省时按未知运行时错误 fail-closed。 */
  onSessionError(sessionID: string, errorMsg: string, errorCode?: string): void {
    const h = this.listeners.get(sessionID);
    if (h) {
      this.listeners.delete(sessionID);
      h('error', {
        message: errorMsg,
        code: errorCode || 'session_error',
        source: 'runtime',
      });
    }
  }

  /** 推进 goal（幂等、互斥）。所有入口（starter/完成回调/应答/恢复/watchdog）都走这里。 */
  async advance(goalId: string): Promise<void> {
    const prev = this.mutex.get(goalId) ?? Promise.resolve();
    const next = prev.then(() => this.advanceInner(goalId)).catch((err) => {
      // 驱动器异常绝不外抛（spec §7）；落 lastError
      try {
        const mafwDir = this.stateDirs.get(goalId);
        if (mafwDir) writeGoalState(mafwDir, goalId, { lastError: `driver: ${err?.message ?? err}` });
      } catch { /* last-resort */ }
    });
    this.mutex.set(goalId, next);
    try { await next; } finally { if (this.mutex.get(goalId) === next) this.mutex.delete(goalId); }
  }

  private findState(goalId: string): { mafwDir: string; state: GoalStateV3 } | null {
    const mafwDir = this.stateDirs.get(goalId);
    if (!mafwDir) return null;
    const s = loadGoalState(mafwDir, goalId);
    return s ? { mafwDir, state: s } : null;
  }

  private async advanceInner(goalId: string): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId)!;
    if (isTerminalState(state)) return;
    // Legacy per-goal PAUSE control lands as nextAction=PAUSED; resume rewrites
    // nextAction through the control path.
    if (state.nextAction === 'PAUSED') return;
    // W1 批准门驻留：仅 approvePlan/rejectPlan 解锁；stray advance（legacy 唤醒/
    // 幂等重放/watchdog !ns 分支）不得越门推进 execute。
    if (state.nextAction === 'AWAIT_PLAN_APPROVAL') return;
    // Task 14：探针节点先兑现已完成报告（外部 A2A / 路由可能先落库），再决定下一步。
    const inflight = state.nodeSession;
    if (inflight?.phase === 'probe') {
      const probeId = inflight.probeId;
      const report = probeId ? (this.deps.probes?.report(probeId) ?? null) : null;
      if (probeId && report) {
        await this.settleProbe(goalId, mafwDir, probeId, report, {
          sessionId: inflight.id, runId: inflight.runId, attempt: inflight.attempt, advance: false,
        });
        // 已在互斥内：直接继续推进（下一条探针 / 重新规划），不要再排队。
        return this.continueAdvance(goalId);
      }
      return; // 探针在飞——等 idle / 报告完成
    }
    if (state.nodeSession) return; // 节点在飞——完成回调会再次 advance

    const node = state.nextNode as GoalNodeName;
    if (isExecutableGoalNode(node)) {
      if (this.deps.canCreateNode && !this.deps.canCreateNode(goalId)) return;
      await this.executeNode(goalId, mafwDir, node);
    } else if (node === 'askUser') {
      this.executeAskUser(goalId, mafwDir);
    } else {
      await this.executeArchive(goalId, mafwDir, node);
    }
  }

  private async executeNode(goalId: string, mafwDir: string, node: ExecutableGoalNode): Promise<void> {
    // Task 14：探针节点有独立的会话目录（隔离工作区）与完成判定（报告产物）。
    if (node === 'probe') {
      await this.executeProbeNode(goalId, mafwDir);
      return;
    }
    const state = loadGoalState(mafwDir, goalId)!;
    const round = effectiveRound(state);
    const revision = effectiveRevision(state);
    const phaseNames = NODE_PHASE[node];

    // phase 广播（payload 形状与旧 syncToFile 一致——milestone-push 零迁移；
    // revision additive，旧消费方忽略即可）
    this.deps.emitPhaseTransition({
      type: 'phase_transition', goalId, phase: phaseNames.running, loop: round,
      projectDir: state.projectDir, revision,
    });

    // attempt 语义：同 (goal, revision, round, node) 既有行存在即 max+1——含驳回重跑
    // （上一行 succeeded）与失败重试两类（W1 修正：不再按状态过滤）。
    const prevRun = this.deps.db.latestNodeAttempt(goalId, revision, round, node);
    const attempt = prevRun ? prevRun.attempt + 1 : 1;

    // revision ≥ 2 的隔离产物目录首次使用时并不存在；先建好，模型写产物不应因缺目录失败。
    this.ensureArtifactDirs(mafwDir, goalId, round, revision);

    // Task 12：plan 可复用 Tech Lead 讨论会话（同一 revision 的讨论 → 计划连续性）。
    // 复用时不建 runtime 会话，但仍登记 goal_sessions 绑定（onSessionCreated）。
    const reusedSessionId = this.resolveExistingSession(goalId, node, revision);
    const sessionId = reusedSessionId
      ?? (await this.deps.client.create(state.projectDir)).id;
    if (reusedSessionId) this.reusedSessions.add(reusedSessionId);
    // 复用会话：记下节点启动时产物已有的内容指纹（idle 竞态判定"是不是本次写的"）。
    if (reusedSessionId) {
      this.captureNodeStartArtifact(reusedSessionId, mafwDir, goalId, node, round, revision);
    }

    this.deps.onSessionCreated({ goalId, sessionId, phase: node, loop: round, revision });

    // W1：身份绑模型（fail-open——适配器无实现/运行时不支持时跳过）。
    // 复用会话不重绑：讨论会话有自己的模型/身份，改绑会静默改变它的行为。
    if (!reusedSessionId && this.deps.client.bindModel) {
      try { await this.deps.client.bindModel(sessionId, goalAgentName(node)); } catch { /* fail-open */ }
    }

    const runId = this.deps.db.insertNodeRun({
      goalId, projectId: state.projectDir, loop: round, node, attempt, sessionId,
      startedAt: new Date().toISOString(), revision,
    });

    const fixPass = node === 'execute' && state.reviewFix?.round === round && state.reviewVerdict === 'FAIL';
    const acceptance = (() => {
      try {
        const wavesPath = state.wavePlanPath;
        if (!wavesPath || !fs.existsSync(wavesPath)) return undefined;
        const map = taskAcceptanceFromWavePlan(JSON.parse(fs.readFileSync(wavesPath, 'utf-8')));
        return Object.keys(map).length > 0 ? map : undefined;
      } catch { return undefined; }
    })();

    const requestPath = findGoalRequestPath(mafwDir, goalId)
      ?? legacyGoalRequestPath(mafwDir, goalId);
    const charterPath = findGoalCharterPath(mafwDir, goalId)
      ?? legacyGoalCharterPath(mafwDir, goalId);
    const request = readGoalRequest(mafwDir, goalId);
    const goalAcceptance = node === 'plan' && Array.isArray(request?.acceptance)
      ? request!.acceptance.map((item: unknown) => String(item).trim()).filter(Boolean)
      : undefined;
    const goalBoundaries = node === 'plan' && Array.isArray(request?.boundaries)
      ? request!.boundaries.map((item: unknown) => String(item).trim()).filter(Boolean)
      : undefined;
    const goalTaskType = node === 'plan' && typeof request?.taskType === 'string'
      ? request.taskType
      : undefined;
    const planReview = node === 'plan' ? state.planReview : undefined;
    // Task 13/8：review 的必需 Goal 条件来自计划产物（waves 同版本的 Goal Eval），
    // prompt 与 rubric 判定共用同一份条件集。
    const reviewEval = node === 'review'
      ? readGoalEvalArtifact(mafwDir, goalId, revision, this.readPlanDoc(state, goalId, revision))
      : null;

    const basePrompt = renderNodePrompt(node, {
      goalId, projectDir: state.projectDir, mafwDir, round, maxRounds: state.maxRounds,
      revision,
      charterPath,
      requestPath,
      reviewFeedback: state.reviewFeedback || undefined,
      planFeedback: state.planFeedback || undefined,
      attempt,
      maxAttempts: this.deps.maxAttempts,
      lastFailure: state.lastFailure ?? null,
      userAnswer: state.userResponse
        && !state.userResponse.consumedByRunId
        && (state.userResponse.resumeNode ?? 'plan') === node
        ? state.userResponse.answer
        : undefined,
      userQuestions: state.userResponse
        && !state.userResponse.consumedByRunId
        && (state.userResponse.resumeNode ?? 'plan') === node
        ? state.userResponse.questions
        : undefined,
      goalAcceptance: node === 'plan' ? goalAcceptance : undefined,
      goalBoundaries: node === 'plan' ? goalBoundaries : undefined,
      goalTaskType: node === 'plan' ? goalTaskType : undefined,
      planReview: node === 'plan' ? planReview : undefined,
      priorBlock: this.deps.capabilityPrior?.(goalId) ?? undefined,
      counterfactualBlock: node === 'plan' ? (this.deps.counterfactualPrior?.(goalId) ?? undefined) : undefined,
      acceptance: node === 'review' ? acceptance : undefined,
      goalConditions: node === 'review' ? (reviewEval?.goalEval?.conditions ?? undefined) : undefined,
      probeReports: node === 'plan' ? this.collectProbeReports(state) : undefined,
      probeBudget: node === 'plan'
        ? (() => {
          const used = (state.probeRefs?.length ?? 0) + (state.probeQueue?.length ?? 0);
          return { max: MAX_PROBES_PER_REVISION, used, remaining: Math.max(0, MAX_PROBES_PER_REVISION - used) };
        })()
        : undefined,
      fixTasks: fixPass ? (state.reviewFix?.tasks ?? []) : undefined,
      fixPreviousReceipt: fixPass ? nodeArtifactPaths(mafwDir, goalId, round, { revision }).receipt : undefined,
    });
    const podBlock = this.deps.podContext?.(goalId, node, sessionId) ?? null;
    const prompt = podBlock ? `${podBlock}\n\n${basePrompt}` : basePrompt;

    // 不 await——pi 的 promptAsync 在 idle 会话阻塞到回合结束，await 会卡死 advance（spec §7）
    void this.deps.client.promptAsync({
      sessionID: sessionId, parts: [{ type: 'text', text: prompt }], agent: goalAgentName(node),
      outputSchema: nodeOutputSchema(node),
    }).then(() => {
      this.deps.onPromptDispatched?.(sessionId);
    }).catch((err: any) => {
      this.onSessionError(sessionId, `promptAsync: ${err?.message ?? err}`);
    });

    writeGoalState(mafwDir, goalId, {
      phase: phaseNames.running, nextAction: `RUNNING_${node}`,
      nodeSession: {
        id: sessionId, phase: node, startedAt: new Date().toISOString(), attempt, runId, revision,
      },
    });

    this.listeners.set(sessionId, (ev, failure) => {
      if (ev === 'idle') {
        // 复用会话的 idle 竞态：讨论回合结束的 idle 可能晚于本节点的 prompt 到达。
        // 产物还没写（或还是上一版）时先宽容一次，第二次才按 artifact_missing 判定。
        if (this.isStaleReuseIdle(mafwDir, goalId, sessionId)) return true;
        void this.completeNode(goalId, sessionId);
        return false;
      }
      void this.failNode(
        goalId,
        sessionId,
        failure?.code ?? 'session_error',
        failure?.message ?? 'session error',
        failure?.source ?? 'runtime',
      );
      return false;
    });

    this.deps.emitNodeEvent({
      type: 'goal_node', goalId, projectDir: state.projectDir, loop: round, node, revision,
      transition: 'started', at: new Date().toISOString(), attempt,
    });
  }

  // ── Task 14：Spike（probe）节点 ──

  /** 计划申请的探针声明：过 Task 9 的规范化边界（绝对路径 / 逃逸 / 未知类别都拒绝）。 */
  private validateProbeDrafts(input: unknown, ctx: { goalId: string; revision: number }): GoalProbeDraft[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw new Error('need_probe requires at least one probe request');
    }
    return input.map((raw, index) => {
      const draft = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
      let validated: ProbeRequest;
      try {
        validated = validateProbeRequest({
          id: 'draft',
          podId: 'pod',
          goalId: ctx.goalId,
          revision: ctx.revision,
          question: draft.question,
          hypothesis: draft.hypothesis,
          scope: draft.scope,
          budget: draft.budget,
          evidenceRequired: draft.evidenceRequired,
          affects: draft.affects,
        });
      } catch (err: any) {
        throw new Error(`probe[${index}]: ${err?.message ?? err}`);
      }
      return {
        question: validated.question,
        hypothesis: validated.hypothesis,
        scope: validated.scope,
        budget: validated.budget,
        evidenceRequired: validated.evidenceRequired,
        affects: validated.affects,
      };
    });
  }

  /** 计划上下文里的探针证据（plan 节点注入；报告是事实，不因重规划消失）。 */  private collectProbeReports(state: GoalStateV3): ProbeReport[] | undefined {
    const port = this.deps.probes;
    const ids = state.probeRefs ?? [];
    if (!port || ids.length === 0) return undefined;
    const reports: ProbeReport[] = [];
    for (const id of ids) {
      try {
        const report = port.report(id);
        if (report) reports.push(report);
      } catch { /* fail-open：读不到的报告只是少了证据，不打断规划 */ }
    }
    return reports.length ? reports : undefined;
  }

  /**
   * 跑一条 Spike（spec §6.3 模式 A）：
   * 隔离工作区 + Builder 会话（`mafw-execute` 身份）→ 报告落库 → 销毁工作区 → 回 plan。
   * 同一 Pod 同时只跑一条（由端口的 take 语义保证）；队列里还有下一条时下一个 advance 继续。
   */
  private async executeProbeNode(goalId: string, mafwDir: string): Promise<void> {
    const state = loadGoalState(mafwDir, goalId)!;
    const round = effectiveRound(state);
    const revision = effectiveRevision(state);
    const port = this.deps.probes;
    const podId = port?.podIdForGoal(goalId) ?? null;
    const queue = state.probeQueue ?? [];

    if (!port || !podId) {
      await this.abortProbeFlow(goalId, mafwDir, 'probe execution is unavailable for this goal', queue);
      return;
    }
    if (queue.length === 0) {
      // 队列已兑空（恢复/重放路径）：直接回 plan，不留在 probe。
      writeGoalState(mafwDir, goalId, { nextNode: 'plan', nextAction: 'NEXT_plan' });
      await this.continueAdvance(goalId);
      return;
    }

    // 恢复/重放：队列里可能已有跑完但还没兑现的探针（报告先落库、会话已丢）——
    // 先按 FIFO 兑现，避免已完成条目永远占着队头。
    const completedId = queue.find((id) => {
      try { return !!port.report(id); } catch { return false; }
    });
    if (completedId) {
      const completedReport = port.report(completedId)!;
      await this.settleProbe(goalId, mafwDir, completedId, completedReport, { advance: false });
      await this.continueAdvance(goalId);
      return;
    }

    let request: ProbeRequest | null;
    try {
      request = port.take({ podId, goalId, probeIds: queue });
    } catch (err: any) {
      await this.abortProbeFlow(goalId, mafwDir, `probe claim failed: ${err?.message ?? err}`, queue);
      return;
    }
    if (!request) {
      // 该 Pod 还有别的探针在跑（单飞）或尚未轮到自己：驻留，等报告完成后的 advance。
      writeGoalState(mafwDir, goalId, { nodeSession: null, nextNode: 'probe', nextAction: 'WAIT_PROBE' });
      return;
    }
    const probeId = request.id;

    const workspace = await port.prepareWorkspace({ projectDir: state.projectDir, goalId, probeId });
    if (!workspace) {
      this.failProbeRecord(probeId, `probe workspace is unavailable for ${probeId}`);
      await this.abortProbeFlow(
        goalId, mafwDir, `probe workspace is unavailable for ${probeId}`,
        queue.filter((id) => id !== probeId),
      );
      return;
    }
    // 报告可能已经在准备阶段完成（外部 A2A / 恢复重放）：不必再开会话。
    const earlyReport = port.report(probeId);
    if (earlyReport) {
      try { await port.disposeWorkspace(workspace); } catch { /* fail-open */ }
      await this.settleProbe(goalId, mafwDir, probeId, earlyReport, { advance: false });
      await this.continueAdvance(goalId);
      return;
    }

    let sessionId: string;
    try {
      sessionId = (await this.deps.client.create(workspace.dir)).id;
    } catch (err: any) {
      try { await port.disposeWorkspace(workspace); } catch { /* fail-open */ }
      this.failProbeRecord(probeId, `probe session create failed: ${err?.message ?? err}`);
      await this.abortProbeFlow(
        goalId, mafwDir, `probe session create failed: ${err?.message ?? err}`,
        queue.filter((id) => id !== probeId),
      );
      return;
    }
    this.probeWorkspaces.set(sessionId, workspace);

    const phaseNames = NODE_PHASE.probe;
    this.deps.emitPhaseTransition({
      type: 'phase_transition', goalId, phase: phaseNames.running, loop: round,
      projectDir: state.projectDir, revision,
    });
    const attempt = (this.probeAttempts.get(probeId) ?? 0) + 1;
    this.probeAttempts.set(probeId, attempt);
    this.deps.onSessionCreated({ goalId, sessionId, phase: 'probe', loop: round, revision });
    if (this.deps.client.bindModel) {
      try { await this.deps.client.bindModel(sessionId, goalAgentName('probe')); } catch { /* fail-open */ }
    }
    const runId = this.deps.db.insertNodeRun({
      goalId, projectId: state.projectDir, loop: round, node: 'probe', attempt, sessionId,
      startedAt: new Date().toISOString(), revision,
    });

    const requestPath = findGoalRequestPath(mafwDir, goalId) ?? legacyGoalRequestPath(mafwDir, goalId);
    const charterPath = findGoalCharterPath(mafwDir, goalId) ?? legacyGoalCharterPath(mafwDir, goalId);
    const prompt = renderNodePrompt('probe', {
      goalId, projectDir: state.projectDir, mafwDir, round, maxRounds: state.maxRounds, revision,
      charterPath, requestPath,
      probe: { request, workspaceDir: workspace.dir, reportPath: port.reportPath(goalId, probeId) },
      attempt, maxAttempts: this.deps.maxAttempts, lastFailure: state.lastFailure ?? null,
    });
    try { port.bindSession(sessionId, { request, workspaceDir: workspace.dir, projectDir: state.projectDir }); } catch { /* fail-open */ }

    // 预算硬约束（spec §6.5）：maxMinutes 不是建议值——超时即失败并销毁工作区。
    const timeoutMs = Math.max(1, Math.round(request.budget.maxMinutes * 60_000));
    const timer = setTimeout(() => {
      void this.failNode(
        goalId, sessionId, 'timeout',
        `probe ${probeId} exceeded its budget of ${request.budget.maxMinutes} minutes`,
      );
    }, timeoutMs);
    timer.unref?.();
    this.probeTimers.set(sessionId, timer);

    try {
      void this.deps.client.promptAsync({
        sessionID: sessionId, parts: [{ type: 'text', text: prompt }], agent: goalAgentName('probe'),
        outputSchema: nodeOutputSchema('probe'),
      }).then(() => {
        this.deps.onPromptDispatched?.(sessionId);
      }).catch((err: any) => {
        this.onSessionError(sessionId, `promptAsync: ${err?.message ?? err}`);
      });
    } catch (err: any) {
      await this.failNode(goalId, sessionId, 'prompt_failed', `promptAsync: ${err?.message ?? err}`);
      return;
    }

    writeGoalState(mafwDir, goalId, {
      phase: phaseNames.running, nextAction: 'RUNNING_probe', nextNode: 'probe',
      nodeSession: {
        id: sessionId, phase: 'probe', startedAt: new Date().toISOString(), attempt, runId, revision,
        probeId,
      },
    });

    this.listeners.set(sessionId, (ev, failure) => {
      if (ev === 'idle') {
        void this.completeProbeNode(goalId, sessionId);
        return false;
      }
      void this.failNode(
        goalId, sessionId, failure?.code ?? 'session_error', failure?.message ?? 'session error',
        failure?.source ?? 'runtime',
      );
      return false;
    });

    this.deps.emitNodeEvent({
      type: 'goal_node', goalId, projectDir: state.projectDir, loop: round, node: 'probe', revision,
      transition: 'started', at: new Date().toISOString(), attempt,
    });
  }

  /**
   * 探针 idle：报告来源三选一——结构化交卷 → 服务已落库报告 → 报告产物文件。
   * 三者都没有 = artifact_missing（不猜结论）。
   */
  private async completeProbeNode(goalId: string, sessionId: string): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId)!;
    const ns = state.nodeSession;
    if (!ns || ns.id !== sessionId || ns.phase !== 'probe') return; // stale 事件守卫
    const port = this.deps.probes;
    const probeId = ns.probeId;
    if (!port || !probeId) {
      await this.failNode(goalId, sessionId, 'artifact_missing', 'probe request binding is missing', 'artifact');
      return;
    }
    const reportPath = port.reportPath(goalId, probeId);
    let report = port.report(probeId);
    if (!report) {
      const submitted = await this.deps.client.structured?.(sessionId) ?? null;
      if (submitted) {
        try {
          report = port.complete(probeId, submitted);
        } catch (err: any) {
          await this.failNode(goalId, sessionId, 'artifact_invalid', `${reportPath}: ${err?.message ?? err}`, 'artifact');
          return;
        }
      }
    }
    if (!report && fs.existsSync(reportPath)) {
      try {
        report = port.complete(probeId, JSON.parse(fs.readFileSync(reportPath, 'utf-8')));
      } catch (err: any) {
        await this.failNode(goalId, sessionId, 'artifact_invalid', `${reportPath}: ${err?.message ?? err}`, 'artifact');
        return;
      }
    }
    if (!report) {
      await this.failNode(goalId, sessionId, 'artifact_missing', `expected ${reportPath}`, 'artifact');
      return;
    }
    await this.settleProbe(goalId, mafwDir, probeId, report, {
      sessionId, runId: ns.runId, attempt: ns.attempt,
    });
  }

  /**
   * 兑现一条探针报告：去队列、进 probeRefs、销毁工作区与 Builder 会话，然后
   * 下一条探针或回 plan（`advance:false` 表示调用方已在互斥内自行继续推进）。
   */
  private async settleProbe(
    goalId: string,
    mafwDir: string,
    probeId: string,
    report: ProbeReport,
    meta: { sessionId?: string; runId?: number; attempt?: number; advance?: boolean },
  ): Promise<void> {
    const state = loadGoalState(mafwDir, goalId);
    if (!state) return;
    const revision = effectiveRevision(state);
    this.probeAttempts.delete(probeId);
    const refs = Array.from(new Set([...(state.probeRefs ?? []), probeId]));
    const remaining = (state.probeQueue ?? []).filter((id) => id !== probeId);
    const nextNode: GoalNodeName = remaining.length ? 'probe' : 'plan';

    if (meta.sessionId) await this.releaseSession(meta.sessionId);
    if (meta.runId) {
      this.deps.db.finishNodeRun(meta.runId, {
        status: 'succeeded', finishedAt: new Date().toISOString(),
        outcome: `probe=${probeId} ${report.conclusion}`,
      });
    }

    this.deps.emitPhaseTransition({
      type: 'phase_transition', goalId, phase: NODE_PHASE.probe.complete,
      loop: effectiveRound(state), projectDir: state.projectDir, revision,
    });
    writeGoalState(mafwDir, goalId, {
      nodeSession: null, probeRefs: refs, probeQueue: remaining,
      nextNode, nextAction: `NEXT_${nextNode}`, phase: NODE_PHASE.probe.complete,
      lastFailure: null, lastError: null,
    });
    if (meta.runId) this.emitFinished(goalId, state.projectDir, effectiveRound(state), 'probe', `probe=${probeId}`, meta.attempt ?? 1, revision);
    if (meta.advance !== false) await this.advance(goalId);
  }

  /** 探针无法执行（没有端口 / 工作区不可用）→ 终态失败，绝不装作计划已完成。 */
  private async abortProbeFlow(
    goalId: string,
    mafwDir: string,
    message: string,
    probeIds: string[] = [],
  ): Promise<void> {
    const state = loadGoalState(mafwDir, goalId);
    if (!state) return;
    // 终态失败必须把探针从 running/queued 收尾，否则 Pod 的唯一运行槽永远被占住。
    for (const probeId of probeIds) this.failProbeRecord(probeId, `probe aborted: ${message}`);
    const at = new Date().toISOString();
    writeGoalState(mafwDir, goalId, {
      nodeSession: null, probeQueue: [], nextNode: 'archive_fail', reviewVerdict: 'ERROR',
      lastError: `probe: ${message}`,
      lastFailure: {
        class: 'terminal_contract', code: 'probe_unavailable', message,
        node: 'probe', attempt: 1, at,
      },
    });
    this.deps.emitNodeEvent({
      type: 'goal_node', goalId, projectDir: state.projectDir, loop: effectiveRound(state),
      node: 'probe', revision: effectiveRevision(state), transition: 'failed', at, error: message, attempt: 1,
    });
    await this.continueAdvance(goalId);
  }

  /** 探针终态失败（端口实现负责脱敏/幂等；失败不影响 driver 的失败路径）。 */
  private failProbeRecord(probeId: string | null | undefined, reason: string): void {
    if (!probeId) return;
    try { this.deps.probes?.failProbe(probeId, reason); } catch { /* fail-open */ }
  }

  /** 探针可重试失败：退回 queued（释放运行槽，下一轮 claim 取回同一条）。 */
  private requeueProbeRecord(probeId: string | null | undefined, reason: string): void {
    if (!probeId) return;
    try { this.deps.probes?.requeueProbe(probeId, reason); } catch { /* fail-open */ }
  }

  /**
   * 内部推进：已在该 goal 的互斥内（advanceInner 调用链）→ 直接递归，避免自等；
   * 否则走正常的 advance 排队。probe 节点的多个终止点共用这一条语义。
   * 递归深度有硬上限：端口的异常行为（报告永远可读 / 队列不前进）不能把栈打穿。
   * 触顶不是静默停止：写 lastError/lastFailure 并广播 `goal_node.failed`（timeline 可见），
   * 由下一次外部推进（watchdog/应答/审批）重新开始计数。
   */
  private async continueAdvance(goalId: string): Promise<void> {
    if (!this.mutex.has(goalId)) {
      await this.advance(goalId);
      return;
    }
    if (this.advanceDepth >= NodeDriver.MAX_ADVANCE_DEPTH) {
      const mafwDir = this.stateDirs.get(goalId);
      try {
        if (mafwDir) {
          const state = loadGoalState(mafwDir, goalId);
          const message = `driver: advance recursion budget (${NodeDriver.MAX_ADVANCE_DEPTH}) exhausted`;
          writeGoalState(mafwDir, goalId, {
            lastError: message,
            lastFailure: {
              class: 'terminal_contract', code: 'advance_recursion', message,
              node: (state?.nodeSession?.phase ?? 'probe'), attempt: 1, at: new Date().toISOString(),
            },
          });
          this.deps.emitNodeEvent({
            type: 'goal_node', goalId, projectDir: state?.projectDir ?? '', loop: effectiveRound(state ?? { round: 0 }),
            node: state?.nodeSession?.phase ?? 'probe', revision: state ? effectiveRevision(state) : 1,
            transition: 'failed', at: new Date().toISOString(), error: message, attempt: 1,
          });
        }
      } catch { /* last-resort */ }
      return;
    }
    this.advanceDepth += 1;
    try { await this.advanceInner(goalId); } finally { this.advanceDepth -= 1; }
  }

  /** Task 12 hook：复用既有节点会话；缺省/抛错 → null（fail-open，新建会话）。 */
  private resolveExistingSession(
    goalId: string,
    node: ExecutableGoalNode,
    revision: number,
  ): string | null {
    const hook = this.deps.existingNodeSession;
    if (!hook) return null;
    try {
      const sessionId = hook(goalId, node, revision);
      return typeof sessionId === 'string' && sessionId.trim() ? sessionId : null;
    } catch { return null; }
  }

  /** 释放节点会话：复用会话归 owner 管（Tech Lead 连续性），只删除 driver 自己建的。 */
  private async releaseSession(sessionId: string): Promise<void> {
    this.reuseIdleGrace.delete(sessionId);
    this.nodeStartArtifacts.delete(sessionId);
    const timer = this.probeTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.probeTimers.delete(sessionId);
    }
    // Task 14：探针会话的隔离工作区与范围绑定随会话一起收尾（无论如何都销毁）。
    await this.disposeProbeWorkspace(sessionId);
    try { this.deps.probes?.bindSession(sessionId, null); } catch { /* fail-open */ }
    if (this.reusedSessions.delete(sessionId)) return;
    try { await this.deps.client.delete(sessionId); } catch { /* fail-open */ }
  }

  /** 销毁探针隔离工作区（幂等；销毁失败不影响报告已落库的事实）。 */
  private async disposeProbeWorkspace(sessionId: string): Promise<void> {
    const workspace = this.probeWorkspaces.get(sessionId);
    if (!workspace) return;
    this.probeWorkspaces.delete(sessionId);
    try {
      if (this.deps.probes) await this.deps.probes.disposeWorkspace(workspace);
      else await workspace.dispose();
    } catch { /* fail-open */ }
  }

  /** 当前 revision 的 waves 产物原文；缺失/非法 → null。 */
  private readPlanDoc(state: GoalStateV3, goalId: string, revision: number): any | null {
    const wavesPath = state.wavePlanPath
      ?? nodeArtifactPaths(state.mafwDir, goalId, effectiveRound(state), { revision }).waves;
    try {
      if (!fs.existsSync(wavesPath)) return null;
      const parsed = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch { return null; }
  }

  /**
   * 计划内容哈希（批准绑定的唯一来源）。
   * 规范化边界与 Task 7 一致：hash 只取决于合法内容，因此「存的是原文、算的是规范化」
   * 不会误判 stale。
   */
  private readPlanHashes(state: GoalStateV3, goalId: string, revision: number): PlanApprovalHashes | null {
    const planDoc = this.readPlanDoc(state, goalId, revision);
    if (!planDoc) return null;
    const read = readGoalEvalArtifact(state.mafwDir, goalId, revision, planDoc);
    return {
      planHash: safeWavesHash(planDoc.waves),
      evalHash: safeGoalEvalHash(read.goalEval),
    };
  }

  /** 在飞节点应落地的产物路径（完成判定与 idle 宽容共用，防两处漂移）。 */
  private inflightArtifactPath(
    mafwDir: string,
    goalId: string,
    state: GoalStateV3,
    ns: NodeSessionRef,
    revision: number,
  ): string {
    if (ns.phase === 'probe') {
      // 探针的权威产物是 ProbeReport（由端口落库）；prompt 里的路径用于落盘。
      return ns.probeId ? (this.deps.probes?.reportPath(goalId, ns.probeId) ?? '') : '';
    }
    const round = effectiveRound(state);
    const fixPass = ns.phase === 'execute' && state.reviewFix?.round === round && state.reviewVerdict === 'FAIL';
    const reviewFixPass = ns.phase === 'review' && state.reviewFix?.round === round;
    const a = nodeArtifactPaths(mafwDir, goalId, round, { fix: fixPass || reviewFixPass, revision });
    return ns.phase === 'plan' ? a.waves : ns.phase === 'execute' ? a.receipt : a.review;
  }

  /**
   * 复用会话（Tech Lead 讨论会话）的 idle 竞态：讨论回合结束时 runtime 也会发 idle，
   * 它可能排在本节点 prompt 之后到达。判断依据是**产物是否在节点启动后被重写**：
   * - 产物不存在 → 暂存；
   * - 产物内容与节点启动时不同 → 真正的完成；
   * - 内容相同但 mtime 晚于启动时间 → 同内容重写，也算完成；
   * - 内容与 mtime 都是节点启动前的旧值（同 revision 上一版计划）→ 暂存。
   * 暂存只宽容**一次**，第二个 idle 仍按 artifact_missing 判定（避免真的卡死）。
   */
  private isStaleReuseIdle(mafwDir: string, goalId: string, sessionId: string): boolean {
    if (!this.reusedSessions.has(sessionId)) return false;
    if (this.reuseIdleGrace.has(sessionId)) return false;
    const state = loadGoalState(mafwDir, goalId);
    const ns = state?.nodeSession;
    if (!state || !ns || ns.id !== sessionId) return false;
    const revision = ns.revision ?? effectiveRevision(state);
    const artifact = this.inflightArtifactPath(mafwDir, goalId, state, ns, revision);
    const snapshot = this.nodeStartArtifacts.get(sessionId);
    let exists = false;
    let digest: string | null = null;
    let mtimeMs = 0;
    try {
      if (fs.existsSync(artifact)) {
        exists = true;
        digest = createHash('sha1').update(fs.readFileSync(artifact)).digest('hex');
        mtimeMs = fs.statSync(artifact).mtimeMs;
      }
    } catch { exists = false; }
    if (exists) {
      const identical = !!snapshot && snapshot.path === artifact && snapshot.digest === digest;
      const startedMs = Date.parse(ns.startedAt);
      const rewritten = Number.isFinite(startedMs) && mtimeMs > startedMs;
      if (!identical || rewritten) return false; // 真完成
    }
    this.reuseIdleGrace.add(sessionId);
    return true;
  }

  /** 记录节点启动时该节点产物已有的内容指纹（复用会话的 idle 竞态判定基准）。 */
  private captureNodeStartArtifact(
    sessionId: string,
    mafwDir: string,
    goalId: string,
    node: ExecutableGoalNode,
    round: number,
    revision: number,
  ): void {
    const a = nodeArtifactPaths(mafwDir, goalId, round, { revision });
    const target = node === 'plan' ? a.waves : node === 'execute' ? a.receipt : a.review;
    let digest: string | null = null;
    try {
      if (fs.existsSync(target)) {
        digest = createHash('sha1').update(fs.readFileSync(target)).digest('hex');
      }
    } catch { digest = null; }
    this.nodeStartArtifacts.set(sessionId, { path: target, digest });
  }

  /**
   * 批准前复核内容版本：stored hash / 调用方给的 hash 都必须等于当前内容哈希。
   * 不一致 → 刷新 pending 批准的 hash（客户端重新读取后可以批新内容）并抛
   * `stale_plan`。读不到内容时保持原 hash 并抛错（不能批准看不见的计划）。
   */
  private assertApprovalFresh(
    mafwDir: string,
    goalId: string,
    approval: NonNullable<GoalStateV3['planApproval']>,
    content: PlanApprovalHashes | null,
    opts?: { planHash?: string; evalHash?: string },
  ): void {
    const current: PlanApprovalHashes = {
      planHash: content?.planHash ?? null,
      evalHash: content?.evalHash ?? null,
    };
    const mismatches: string[] = [];
    const check = (label: 'plan' | 'goal eval', expected: string | null | undefined, actual: string | null) => {
      if (expected == null) return; // 旧版批准没有绑定 / 调用方没给：不参与判定
      if (expected !== actual) mismatches.push(label);
    };
    check('plan', approval.planHash, current.planHash);
    check('goal eval', approval.evalHash, current.evalHash);
    check('plan', opts?.planHash, current.planHash);
    check('goal eval', opts?.evalHash, current.evalHash);
    if (mismatches.length === 0) return;

    if (content) {
      writeGoalState(mafwDir, goalId, {
        planApproval: { ...approval, planHash: current.planHash, evalHash: current.evalHash },
      });
    }
    throw new StalePlanError(
      `plan content changed since approval was requested (${Array.from(new Set(mismatches)).join(', ')})`,
      current,
    );
  }

  /**
   * 计划内容被改写（任务编辑/新增/删除 → waves.json，或 eval 文件被替换）：
   * - pending：刷新 hash（同一 approvalId，客户端重新读取后可批新内容）；
   * - approved：旧批准失效，回 pending（新 approvalId、清 decidedAt）并重新驻留批准门。
   * 读不到内容 → 不动批准（approve 侧会 fail closed）。
   */
  refreshPlanApproval(goalId: string): boolean {
    const found = this.findState(goalId);
    if (!found) return false;
    const state = loadGoalState(found.mafwDir, goalId);
    if (!state || isTerminalState(state)) return false;
    const approval = state.planApproval;
    if (!approval || approval.status === 'rejected') return false;
    const revision = approval.revision ?? effectiveRevision(state);
    const content = this.readPlanHashes(state, goalId, revision);
    if (!content) return false;

    const approved = approval.status === 'approved';
    const next: NonNullable<GoalStateV3['planApproval']> = {
      ...approval,
      status: 'pending',
      planHash: content.planHash,
      evalHash: content.evalHash,
    };
    if (approved) {
      // 已批准的批准不得继续生效：换 id、清决定时间、重新驻留批准门。
      delete next.decidedAt;
      next.id = this.deps.newApprovalId();
    }
    writeGoalState(found.mafwDir, goalId, {
      planApproval: next,
      ...(approved ? { nextAction: 'AWAIT_PLAN_APPROVAL', phase: 'PLANNING' } : {}),
    });
    return true;
  }

  /** 产物目录预建（幂等、fail-open）：waves 同目录 + receipts/ + reviews/。 */
  private ensureArtifactDirs(
    mafwDir: string,
    goalId: string,
    round: number,
    revision: number,
  ): void {
    try {
      const a = nodeArtifactPaths(mafwDir, goalId, round, { revision });
      for (const p of [a.waves, a.receipt, a.review]) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
      }
    } catch { /* fail-open：模型通常会自建目录，写失败由 artifact 门判定 */ }
  }

  private executeAskUser(goalId: string, mafwDir: string): void {
    const state = loadGoalState(mafwDir, goalId)!;
    if (!state.pendingQuestion) { // 数据异常 → 回 plan
      writeGoalState(mafwDir, goalId, { nextNode: 'plan' });
      void this.advance(goalId);
      return;
    }
    const q = state.pendingQuestion;
    // asked 落地——现状断链根因（asked 事件无写入点 → respond 恒 404）
    this.deps.ledger.appendQuestionEvent({
      type: 'asked', questionId: q.questionId, goalId, node: q.node, loop: q.loop,
      questions: q.questions, askedAt: q.askedAt,
    });
    this.deps.emitPhaseTransition({
      type: 'phase_transition', goalId, phase: 'ASKING_USER', loop: effectiveRound(state),
      projectDir: state.projectDir, revision: effectiveRevision(state),
    });
    writeGoalState(mafwDir, goalId, { phase: 'ASKING_USER', nextAction: 'WAIT_USER_ANSWER' });
  }

  private async executeArchive(goalId: string, mafwDir: string, node: GoalNodeName): Promise<void> {
    const state = loadGoalState(mafwDir, goalId)!;
    const round = effectiveRound(state);
    const v = node === 'archive_success'
      ? { verdict: 'PASS', phase: 'ARCHIVED', nextAction: 'COMPLETED' }
      : node === 'archive_max_retries'
        ? { verdict: 'MAX_RETRIES', phase: 'FAILED', nextAction: 'FAILED' }
        : state.reviewVerdict === 'ERROR'
          ? { verdict: 'ERROR', phase: 'FAILED', nextAction: 'FAILED' }
          : { verdict: 'FAIL', phase: 'FAILED', nextAction: 'FAILED' };
    // review 完成时 round 已 +1 → PASS 归档报实际完成的 loop 数（round-1）
    const rounds = (node === 'archive_success' && state.reviewVerdict === 'PASS')
      ? Math.max(1, round - 1) : round;
    this.deps.emitPhaseTransition({
      type: 'phase_transition', goalId, phase: v.phase, loop: round,
      projectDir: state.projectDir, revision: effectiveRevision(state),
    });
    writeGoalState(mafwDir, goalId, { phase: v.phase, nextAction: v.nextAction, nodeSession: null });
    await this.deps.archiveGoal(goalId, {
      verdict: v.verdict, rounds,
      lastError: state.lastError, reviewFeedback: state.reviewFeedback,
    });
  }

  /** 节点失败（error/timeout/artifact 缺失或非法）。 */
  private async failNode(
    goalId: string,
    sessionID: string,
    kind: string,
    message: string,
    source: 'runtime' | 'artifact' = 'runtime',
  ): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId)!;
    const ns = state.nodeSession;
    const revision = ns?.revision ?? effectiveRevision(state);
    const failureClass = classifyNodeFailure({
      code: kind,
      node: ns?.phase ?? 'execute',
      source,
    });
    const attempt = ns?.attempt ?? 1;
    const retryable = failureClass === 'retryable_environment' && attempt < this.deps.maxAttempts;
    const lastFailure = {
      class: failureClass,
      code: kind,
      message,
      node: (ns?.phase ?? 'execute') as ExecutableGoalNode,
      attempt,
      at: new Date().toISOString(),
    };

    if (ns && ns.id === sessionID) {
      this.deps.db.finishNodeRun(ns.runId, {
        status: kind === 'timeout' ? 'timeout' : 'failed',
        finishedAt: new Date().toISOString(), error: message,
      });
      this.deps.emitNodeEvent({
        type: 'goal_node', goalId, projectDir: state.projectDir, loop: effectiveRound(state),
        node: ns.phase, transition: kind === 'timeout' ? 'timeout' : 'failed',
        at: new Date().toISOString(), error: message, attempt: ns.attempt, revision,
      });
    }
    await this.releaseSession(sessionID);

    // Task 14：探针失败必须同步探针状态，否则 running 会长久占住 Pod 的唯一运行槽。
    if (ns?.phase === 'probe' && ns.probeId) {
      if (retryable) this.requeueProbeRecord(ns.probeId, `${kind}: ${message}`);
      else this.failProbeRecord(ns.probeId, `${kind}: ${message}`);
    }

    if (retryable) {
      writeGoalState(mafwDir, goalId, {
        nodeSession: null,
        lastFailure,
        lastError: `${kind}: ${message}`,
      });
      await this.advance(goalId);
      return;
    }

    writeGoalState(mafwDir, goalId, {
      nodeSession: null,
      lastFailure,
      lastError: `${kind}: ${message}`,
      reviewVerdict: 'ERROR',
      nextNode: 'archive_fail',
    });
    await this.advance(goalId);
  }

  /** 节点完成（idle + 产物双门）：解析产物 → 路由 → 写 state → advance。 */
  private async completeNode(goalId: string, sessionID: string): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId)!;
    const ns = state.nodeSession;
    if (!ns || ns.id !== sessionID) return; // stale 事件守卫

    const node = ns.phase;
    const round = effectiveRound(state);
    // 在飞节点属于它启动时的 revision（state.revision 可能已被打回/新 revision 覆盖）。
    const revision = ns.revision ?? effectiveRevision(state);
    const fixPass = node === 'execute' && state.reviewFix?.round === round && state.reviewVerdict === 'FAIL';
    const reviewIsFixPass = node === 'review' && state.reviewFix?.round === round;
    const a = nodeArtifactPaths(mafwDir, goalId, round, { fix: fixPass || reviewIsFixPass, revision });

    // —— Batch 1：已校验的结构化交卷优先；文件产物 fallback ——
    const submitted = await this.deps.client.structured?.(sessionID) ?? null;
    const artifactPath = this.inflightArtifactPath(mafwDir, goalId, state, ns, revision);
    if (!submitted && !fs.existsSync(artifactPath)) {
      await this.failNode(goalId, sessionID, 'artifact_missing', `expected ${artifactPath}`, 'artifact');
      return;
    }
    // 结构化交卷是本节点的权威内容：plan 必须落盘——已有文件可能是同 revision
    // 上一版计划（驳回重规划/重试），不覆盖会让「disk / hash / GET / approve」看到
    // 不同内容（首屏 stale、首次 approve 409）。execute/review 保持原规则
    // （模型写的更详细版本优先）。
    if (submitted && (node === 'plan' || !fs.existsSync(artifactPath))) {
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      fs.writeFileSync(artifactPath, JSON.stringify(submitted, null, 2), 'utf-8');
    }

    // 计划任务稳定 id：后续任务板新增/删除必须按 id 而不是位置定位
    // （位置 id 在删任务后会让状态错位）。legacy 任务补成当前位置 id，对已有投影无迁移。
    if (node === 'plan') {
      try {
        const planDoc = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
        const ensured = ensureWaveTaskIds(planDoc);
        if (ensured.changed) {
          fs.writeFileSync(artifactPath, JSON.stringify(ensured.plan, null, 2), 'utf-8');
        }
      } catch { /* fail-open：解析阶段会给出明确的 artifact_invalid */ }
    }

    // —— 解析（移植 NODE_CONFIGS.parseResult + plan.node/review.node 语义）——
    let patch: Partial<GoalStateV3>;
    let outcome: string;
    /** plan 交卷的内容哈希：批准门用它绑定"用户实际看到的这一版"。 */
    let approvalHashes: PlanApprovalHashes | null = null;
    try {
      if (node === 'plan') {
        // 只读**最终落盘版**（含 ensureWaveTaskIds 补齐的稳定 taskId）：结构化交卷与
        // 文件产物从此是同一份内容，hash 也只对这份内容做。
        const planDoc: any = JSON.parse(fs.readFileSync(a.waves, 'utf-8'));
        if (planDoc.status === 'need_clarification') {
          patch = {
            pendingQuestion: {
              questionId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_ok`,
              node: 'plan', loop: round, questions: planDoc.ambiguities || [], askedAt: new Date().toISOString(),
            },
          };
          outcome = 'need_clarification';
        } else if (planDoc.status === 'need_probe') {
          // Task 14 两段式：关键技术假设无法只靠读代码消除 → 先让 Builder 在隔离
          // 工作区验证，报告落库后再重新规划。绝不能在这一步产生计划批准。
          const drafts = this.validateProbeDrafts(planDoc.probes, { goalId, revision });
          const port = this.deps.probes;
          const podId = port?.podIdForGoal(goalId) ?? null;
          if (!port || !podId) {
            throw new Error('plan requested probes but probe execution is unavailable for this goal');
          }
          const refs = state.probeRefs ?? [];
          const queued = state.probeQueue ?? [];
          if (refs.length + queued.length + drafts.length > MAX_PROBES_PER_REVISION) {
            throw new Error(
              `probe budget exhausted (max ${MAX_PROBES_PER_REVISION} probes per revision; ` +
              `${refs.length} reported, ${queued.length} queued, ${drafts.length} requested)`,
            );
          }
          const ids = port.enqueue({ podId, goalId, revision, drafts });
          patch = {
            nextNode: 'probe',
            pendingQuestion: null,
            // 探针一入队，本版就不是可实施计划：任何待批/已批状态都必须消失
            // （批准只属于最终 ready 的 PlanPackage）。
            planApproval: undefined,
            probeQueue: [...queued, ...ids],
          };
          outcome = `need_probe=${ids.length}`;
        } else {
          // Task 7/13：waves + goalEval 是同一份 PlanPackage。校验走 Task 7 的
          // 规范化边界，然后把 eval 落到本 revision 的独立产物（评审按它判定）。
          const pkg = planDoc.goalEval !== undefined
            ? validatePlanPackage({ waves: planDoc.waves, goalEval: planDoc.goalEval })
            : null;
          let goalEval: GoalEval | null = pkg ? pkg.goalEval : null;
          if (pkg) {
            writeGoalEvalFile(goalEvalArtifactPath(mafwDir, goalId, revision), pkg.goalEval);
          } else {
            // legacy：计划里没有 eval，但旁文件存在时也必须可解析（坏 eval 不放行）。
            const existing = readGoalEvalArtifact(mafwDir, goalId, revision, planDoc);
            if (existing.error) throw new Error(existing.error);
            goalEval = existing.goalEval;
          }
          // 哈希只从**最终落盘的 PlanPackage** 铸（与 GET /plan / approve 完全同一份读取路径），
          // 不再从内存里的 submitted 算——否则磁盘被 ensureWaveTaskIds 改写后两边不一致。
          approvalHashes = this.readPlanHashes(
            { ...state, wavePlanPath: a.waves } as GoalStateV3,
            goalId,
            revision,
          ) ?? {
            planHash: safeWavesHash(planDoc.waves),
            evalHash: safeGoalEvalHash(goalEval),
          };
          // D4b: the planner read charter + repo — its taskType judgement wins
          // over the creation-time declaration. Validated; absent/invalid ignored.
          // W1: plan 成功即清 planFeedback（清除点——防上一轮驳回意见泄漏进
          // review-FAIL 触发的后续轮次）。
          patch = {
            wavePlanPath: a.waves, pendingQuestion: null, planFeedback: null,
            ...(isTaskType(planDoc.taskType) ? { taskType: planDoc.taskType } : {}),
          };
          outcome = `waves=${(planDoc.waves || []).length}${isTaskType(planDoc.taskType) ? ` taskType=${planDoc.taskType}` : ''}`;
        }
      } else if (node === 'execute') {
        const receipt: any = submitted ?? JSON.parse(fs.readFileSync(a.receipt, 'utf-8'));
        patch = { receiptPath: a.receipt };
        outcome = `receipts=${(receipt.receipts || []).length}`;
      } else {
        const source = submitted
          ? JSON.stringify(submitted)
          : fs.readFileSync(a.review, 'utf-8');
        // Task 8/13：必需 Goal 条件 id 来自本 revision 的计划产物；eval 坏了不放行
        // （否则必需条件门会被静默绕过——宁可 artifact_invalid）。
        const evalRead = readGoalEvalArtifact(mafwDir, goalId, revision, this.readPlanDoc(state, goalId, revision));
        if (evalRead.error) throw new Error(evalRead.error);
        const requiredIds = evalRead.goalEval ? requiredConditionIds(evalRead.goalEval) : [];
        const verdict = parseReviewRubric(source, readWaveTaskIds(a.waves), requiredIds);
        // 同轮复核：FAIL 且本轮还没用过 → 保留 round（不 +1），把失败项写进 state 供
        // execute 修复模式使用；FAIL 且已用过 → 清空 reviewFix，走原 round+1。
        const fixAvailable = verdict.verdict === 'FAIL'
          && !(state.reviewFix && state.reviewFix.round === round)
          && !state.lastError;
        const failedTasks = verdict.tasks
          .filter((task) => task.result === 'fail')
          .map((task) => ({ taskId: task.taskId, evidence: task.evidence }));
        const p: Partial<GoalStateV3> = {
          reviewVerdict: verdict.verdict,
          ...(fs.existsSync(a.review) ? { reviewReportPath: a.review } : {}),
          reviewFeedback: verdict.feedback,
          round: fixAvailable && failedTasks.length > 0 ? round : round + 1,
          reviewFix: fixAvailable && failedTasks.length > 0
            ? { round, tasks: failedTasks, feedback: verdict.feedback }
            : null,
        };
        // same-signature 追问（移植 review.node.ts:56-74，上限 3）
        if (verdict.verdict === 'FAIL' && round < state.maxRounds) {
          const sameSig = state.reviewFeedback && matchesSignature(state.reviewFeedback, verdict.feedback);
          const newSameSigCount = sameSig ? state.sameSigCount + 1 : 1;
          p.sameSigCount = newSameSigCount;
          if (sameSig && newSameSigCount >= 2 && newSameSigCount <= 3) {
            p.pendingQuestion = {
              questionId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_ok`,
              node: 'review', loop: round,
              questions: [`Review keeps failing with same issue: ${verdict.feedback}. Continue retrying?`],
              askedAt: new Date().toISOString(),
            };
          }
        } else {
          p.sameSigCount = 0;
        }
        patch = p;
        outcome = verdict.verdict;
      }
    } catch (err: any) {
      await this.failNode(goalId, sessionID, 'artifact_invalid', `${artifactPath}: ${err.message}`, 'artifact');
      return;
    }

    const digestSource = fs.existsSync(artifactPath)
      ? fs.readFileSync(artifactPath, 'utf-8')
      : JSON.stringify(submitted ?? null);
    const digest = createHash('sha1').update(digestSource).digest('hex');
    const progress = nextNoProgress({
      previousDigest: state.lastArtifactDigest?.[node],
      previousCount: state.noProgressCount ?? 0,
      digest,
    });
    patch.noProgressCount = progress.count;
    patch.lastArtifactDigest = { ...(state.lastArtifactDigest ?? {}), [node]: digest };
    if (progress.ask && !patch.pendingQuestion) {
      // completeNode 只处理 plan/execute/review（probe 有独立的报告门），这里收窄是安全的。
      const questionNode = node as 'plan' | 'execute' | 'review';
      patch.pendingQuestion = {
        questionId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_ok`,
        node: questionNode,
        resumeNode: questionNode,
        loop: round,
        questions: [`No progress: ${node} produced identical output ${progress.count} times. What should change before retrying?`],
        askedAt: new Date().toISOString(),
      };
    }
    if (state.userResponse
      && !state.userResponse.consumedByRunId
      && (state.userResponse.resumeNode ?? 'plan') === node) {
      patch.userResponse = { ...state.userResponse, consumedByRunId: ns.runId };
    }

    try { await this.releaseSession(sessionID); } catch { /* fail-open */ }
    // A valid artifact settles the current node: transient failure text from a
    // previous attempt must not poison the next review/round.
    patch = { ...patch, lastFailure: null, lastError: null };

    const phaseNames = NODE_PHASE[node];
    const nextRound = patch.round ?? round;
    const routedNode = routeNext(
      node === 'plan' ? 'after_plan' : node === 'execute' ? 'after_execute' : 'after_review',
      {
        lastError: null,
        reviewVerdict: (patch.reviewVerdict ?? state.reviewVerdict) as any,
        round: nextRound,
        maxRounds: state.maxRounds,
        pendingQuestion: patch.pendingQuestion ?? null,
        // W1：manual 模式的 plan 成功 → 批准门（pendingQuestion 已在 routing 优先）。
        planReviewGate: node === 'plan' && (state.planReview ?? 'auto') === 'manual',
        // Task 14：need_probe 的探针队列非空 → 先跑 Spike（probe 优先于批准门）。
        probeNeeded: !!patch.probeQueue?.length,
        // 同轮复核：只有刚决定"可复核"（patch.reviewFix 落库）时才回 execute 修复
        reviewFixAvailable: !!patch.reviewFix,
      },
    );
    const nextNode = progress.ask && patch.pendingQuestion ? 'askUser' : routedNode;

    this.deps.db.finishNodeRun(ns.runId, {
      status: 'succeeded', finishedAt: new Date().toISOString(), outcome,
    });
    this.deps.emitPhaseTransition({
      type: 'phase_transition', goalId, phase: phaseNames.complete, loop: nextRound,
      projectDir: state.projectDir, revision,
    });

    // W1 批准门：manual plan 成功 → 驻留待批（合法 parked 态），不 advance。
    if (node === 'plan' && nextNode === 'await_plan_approval') {
      this.deps.emitPhaseTransition({
        type: 'phase_transition', goalId, phase: 'PLANNING_AWAIT_APPROVAL',
        loop: nextRound, projectDir: state.projectDir, revision,
      });
      writeGoalState(mafwDir, goalId, {
        ...patch, nodeSession: null, phase: 'PLANNING',
        nextNode: 'execute', nextAction: 'AWAIT_PLAN_APPROVAL',
        planApproval: {
          id: this.deps.newApprovalId(), status: 'pending', round: nextRound, revision,
          planHash: approvalHashes?.planHash ?? null,
          evalHash: approvalHashes?.evalHash ?? null,
        },
      });
      this.emitFinished(goalId, state.projectDir, round, node, outcome, ns.attempt, revision);
      return;
    }

    writeGoalState(mafwDir, goalId, {
      ...patch, nodeSession: null, phase: phaseNames.complete, nextNode, nextAction: `NEXT_${nextNode}`,
    }, { bumpVersion: node === 'review' });
    this.emitFinished(goalId, state.projectDir, round, node, outcome, ns.attempt, revision);
    await this.advance(goalId);
  }

  private emitFinished(
    goalId: string,
    projectDir: string,
    round: number,
    node: ExecutableGoalNode,
    outcome: string | undefined,
    attempt: number,
    revision: number,
  ): void {
    this.deps.emitNodeEvent({
      type: 'goal_node', goalId, projectDir, loop: round, node, revision,
      transition: 'finished', at: new Date().toISOString(), outcome, attempt,
    });
  }

  /** 应答 askUser（respond 路由 / mafw_answer_question → HTTP → index.ts 调入）。 */
  handleAnswer(goalId: string, questionId: string, answer: string): boolean {
    const found = this.findState(goalId);
    if (!found) return false;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId);
    if (!state || !state.pendingQuestion || state.pendingQuestion.questionId !== questionId) return false;
    this.deps.ledger.appendQuestionEvent({
      type: 'answered', questionId, goalId, answer, answeredAt: new Date().toISOString(),
    });
    const resumeNode = state.pendingQuestion.resumeNode
      ?? (state.pendingQuestion.node === 'review' ? 'plan' : state.pendingQuestion.node);
    writeGoalState(mafwDir, goalId, {
      pendingQuestion: null,
      userResponse: {
        questionId,
        answer,
        questions: state.pendingQuestion.questions,
        resumeNode,
        respondedAt: new Date().toISOString(),
      },
      nextNode: resumeNode,
      noProgressCount: 0,
    });
    void this.advance(goalId);
    return true;
  }

  /** 取消 askUser → 用户拒答，goal 无法继续 → archive_fail。 */
  handleCancel(goalId: string, questionId: string): boolean {
    const found = this.findState(goalId);
    if (!found) return false;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId);
    if (!state || !state.pendingQuestion || state.pendingQuestion.questionId !== questionId) return false;
    this.deps.ledger.appendQuestionEvent({
      type: 'cancelled', questionId, goalId, cancelledAt: new Date().toISOString(),
    });
    writeGoalState(mafwDir, goalId, {
      pendingQuestion: null, lastError: `askUser cancelled by user (question ${questionId})`,
      nextNode: 'archive_fail',
    });
    void this.advance(goalId);
    return true;
  }

  // ── W1 计划批准门：approve / reject（HTTP 路由调入；走 advance 同款互斥） ──

  private matchesApproval(
    approval: { id?: string; status: 'pending' | 'approved' | 'rejected'; round: number },
    approvalId?: string,
  ): boolean {
    if (!approval.id) return approvalId === undefined;
    return approvalId === approval.id;
  }

  private async withGoalMutex<T>(goalId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.mutex.get(goalId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.mutex.set(goalId, next as Promise<void>);
    try { return await next; } finally { if (this.mutex.get(goalId) === next) this.mutex.delete(goalId); }
  }

  /**
   * 批准当前计划 → 解锁驻留，启动 execute。false = 非 pending / 终态 / 未知 goal。
   * 内容已变（waves 或 GoalEval 被改写）→ 抛 `StalePlanError`（HTTP 409 stale_plan）。
   */
  async approvePlan(
    goalId: string,
    approvalId?: string,
    opts?: { planHash?: string; evalHash?: string },
  ): Promise<boolean> {
    return this.withGoalMutex(goalId, async () => {
      const found = this.findState(goalId);
      if (!found) return false;
      const state = loadGoalState(found.mafwDir, goalId)!;
      if (isTerminalState(state) || state.planApproval?.status !== 'pending') return false;
      const approval = state.planApproval;
      if (!this.matchesApproval(approval, approvalId)) return false;
      // 批准必须绑定"用户实际看到的这一版"：内容变了就拒绝并对齐哈希。
      const revision = approval.revision ?? effectiveRevision(state);
      this.assertApprovalFresh(
        found.mafwDir,
        goalId,
        approval,
        this.readPlanHashes(state, goalId, revision),
        opts,
      );
      const decidedAt = new Date().toISOString();
      writeGoalState(found.mafwDir, goalId, {
        planApproval: { ...approval, status: 'approved', decidedAt },
        nextAction: 'NEXT_execute',
      });
      this.deps.emitPhaseTransition({
        type: 'phase_transition', goalId, phase: 'PLANNING_APPROVED',
        loop: effectiveRound(state), projectDir: state.projectDir, revision: effectiveRevision(state),
      });
      await this.advanceInner(goalId);
      return true;
    });
  }

  /** 驳回当前计划 → planFeedback 注入，同 round 重跑 plan（attempt+1）。 */
  async rejectPlan(goalId: string, feedback: string, approvalId?: string): Promise<boolean> {
    return this.withGoalMutex(goalId, async () => {
      const found = this.findState(goalId);
      if (!found) return false;
      const state = loadGoalState(found.mafwDir, goalId)!;
      if (isTerminalState(state) || state.planApproval?.status !== 'pending') return false;
      if (!this.matchesApproval(state.planApproval, approvalId)) return false;
      const round = effectiveRound(state);
      const decidedAt = new Date().toISOString();
      writeGoalState(found.mafwDir, goalId, {
        planApproval: { ...state.planApproval, status: 'rejected', feedback, decidedAt },
        planFeedback: feedback,
        nextNode: 'plan', nextAction: 'RUNNING_plan',
      });
      this.deps.emitPhaseTransition({
        type: 'phase_transition', goalId, phase: 'PLANNING_REJECTED',
        loop: round, projectDir: state.projectDir, revision: effectiveRevision(state),
      });
      await this.advanceInner(goalId);
      return true;
    });
  }

  /**
   * 崩溃恢复 / watchdog 共用：检查在飞节点的处置（spec §6）。
   * ① 产物优先（gateway 死亡期间完成的节点直接兑现）
   * ② 会话探测（alive 则交还监听/watchdog 兜底；无探测能力视为 dead）
   * ③ abort + 重试 attempt+1（≥maxAttempts → archive_fail）
   */
  async examineStaleNode(
    goalId: string,
    opts?: { probeSession?: (sessionID: string) => Promise<'alive' | 'dead'> },
  ): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId);
    if (!state || isTerminalState(state)) return;
    // W1：批准门驻留是合法态（非 stale、不重试）——等待 approve/reject。
    if (state.nextAction === 'AWAIT_PLAN_APPROVAL') return;
    const ns = state.nodeSession;
    if (!ns) { await this.advance(goalId); return; }

    // Task 14：探针报告可能已由外部落库，先兑现（不必重跑 Builder）。
    if (ns.phase === 'probe') {
      const report = ns.probeId ? (this.deps.probes?.report(ns.probeId) ?? null) : null;
      if (ns.probeId && report) {
        await this.settleProbe(goalId, mafwDir, ns.probeId, report, {
          sessionId: ns.id, runId: ns.runId, attempt: ns.attempt, advance: false,
        });
        await this.advance(goalId);
        return;
      }
      // 没有报告 → 落穿到会话探测/重试（重跑会在新工作区重新 claim 同一条探针）。
    }

    // ① 产物优先：gateway 死亡期间节点可能已完成——直接走完成判定兑现
    const revision = ns.revision ?? effectiveRevision(state);
    const artifact = this.inflightArtifactPath(mafwDir, goalId, state, ns, revision);
    if (fs.existsSync(artifact)) {
      await this.completeNode(goalId, ns.id);
      return;
    }

    // ② 会话探测（无探测能力 → 视为 dead，交 watchdog 超时兜底）
    if (opts?.probeSession) {
      try {
        const alive = await opts.probeSession(ns.id);
        if (alive === 'alive') return; // 还在跑——监听若在则正常；若丢（重启）由 watchdog 超时兜底
      } catch { /* fail-open */ }
    }

    // ③ abort + 重试
    try { await this.deps.client.abort?.(ns.id); } catch { /* fail-open */ }
    this.deps.db.finishNodeRun(ns.runId, {
      status: 'aborted', finishedAt: new Date().toISOString(), error: 'stale node (recovery/watchdog)',
    });
    if (ns.attempt >= this.deps.maxAttempts) {
      await this.failNode(goalId, ns.id, 'timeout', `node ${ns.phase} exhausted attempts (${ns.attempt})`);
      return;
    }
    writeGoalState(mafwDir, goalId, { nodeSession: null }); // 清死会话 → advance 重启（attempt+1 由 latestNodeAttempt 推导）
    await this.advance(goalId);
  }

  /** 节点重跑（DFX）：失败/超时行重试；execute 的 destructive 门在路由层。 */
  async retryNodeRun(goalId: string, runId: number): Promise<{ runId: number }> {
    const found = this.findState(goalId);
    if (!found) throw new Error('goal not found');
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId);
    if (!state || isTerminalState(state)) throw new Error('goal is terminal');
    const run = this.deps.db.listNodeRuns(goalId).find((r: any) => r.id === runId);
    if (!run) throw new Error(`node run ${runId} not found`);
    // 清在飞会话（若有）并指回该节点
    if (state.nodeSession) {
      try { await this.deps.client.abort?.(state.nodeSession.id); } catch { /* fail-open */ }
    }
    writeGoalState(mafwDir, goalId, { nodeSession: null, nextNode: run.node, nextAction: `RUNNING_${run.node}` });
    await this.advance(goalId);
    const latest = this.deps.db.latestNodeAttempt(goalId, run.revision ?? effectiveRevision(state), run.loop, run.node);
    return { runId: latest?.id ?? runId };
  }
}
