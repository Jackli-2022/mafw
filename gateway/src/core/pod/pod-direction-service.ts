// gateway/src/core/pod/pod-direction-service.ts
// Goal 方向裁定服务（spec §5.1 / §10.1）：
// - 只有存在真实分歧才开 `direction_review`（人类 attention）；
// - 用户已说清方向时用 `markClear` 直接落决定、进 planning，不增加一次确认点击；
// - 决定 append-only、用户原话逐字保留；
// - 文件（direction.json）是权威，revision 的 `direction_json` 是镜像。
import * as fs from 'fs';
import * as path from 'path';
import {
  PodError,
  isTerminalGoalRevisionStatus,
  type PodGoalRevisionRow,
  type PodGoalRevisionStatus,
  type PodGoalDirectionStatus,
  type PodGoalRow,
  type PodStore,
} from './pod-store';
import {
  DIRECTION_STATE_VERSION,
  emptyDirectionState,
  normalizeDirectionDecision,
  normalizeDirectionOptions,
  parseDirectionArtifact,
  parseDirectionState,
  serializeDirectionArtifact,
  serializeDirectionState,
  type DirectionArtifact,
  type DirectionDecision,
  type DirectionDecisionInput,
  type DirectionOptionInput,
  type DirectionReviewRequest,
  type DirectionState,
} from '../goal/direction-decision';

export interface PodDirectionServiceDeps {
  store: PodStore;
  /** goal 的 mafw 目录（Goal 文件产物落点）；解析不到时任何写操作 400，不产生半持久化。 */
  resolveMafwDir(goalId: string): string | null;
  now?(): string;
  newId?(): string;
  notify?(podId: string): void;
  log?(message: string): void;
}

export interface PodDirectionRequestInput {
  goalId: string;
  options: DirectionOptionInput[];
  reason?: string | null;
  requestedBy?: string | null;
  /** 缺省 = goal 的 active revision。 */
  revision?: number;
}

export interface PodDirectionDecideInput {
  goalId: string;
  decision: DirectionDecisionInput;
  revision?: number;
}

export interface PodDirectionClearInput {
  goalId: string;
  userWords?: string | null;
  optionId?: string | null;
  reason?: string | null;
  source?: string | null;
  revision?: number;
}

/** 打回反馈记录（Task 16）：作为方向决定的输入，不改变 revision 阶段。 */
export interface PodDirectionRejectInput {
  goalId: string;
  /** 缺省 = goal 的 active revision（打回后即新开的 N+1）。 */
  revision?: number;
  feedback: string;
  /** 缺省 `reject_feedback`。 */
  source?: string | null;
}

export interface PodDirectionResult {
  podId: string;
  goalId: string;
  revision: number;
  revisionStatus: PodGoalRevisionStatus;
  directionStatus: PodGoalDirectionStatus;
  state: DirectionState;
  decision: DirectionDecision | null;
  artifactPath: string;
}

/** `<mafwDir>/goals/<goalId>/direction.json`（与 Goal charter/request 同一 Goal 工作区）。 */
export function directionArtifactPath(mafwDir: string, goalId: string): string {
  const safeGoalId = goalId.replace(/[^A-Za-z0-9._-]/g, '_') || '_';
  return path.join(mafwDir, 'goals', safeGoalId, 'direction.json');
}

const CLEAR_SOURCE = 'tech_lead_clear';

/** 打回反馈的决策来源（与真实方向裁定区分：它只是输入，不是阶段推进）。 */
export const REJECT_FEEDBACK_SOURCE = 'reject_feedback';

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringOrNull(value: unknown): string | null {
  const text = clean(value);
  return text ? text : null;
}

export class PodDirectionService {
  constructor(private readonly deps: PodDirectionServiceDeps) {}

  /** 当前 revision（或显式 revision）的方向状态；文件优先，镜像兜底。 */
  state(goalId: string, revision?: number): DirectionState {
    const goal = this.requireGoal(goalId);
    const target = revision ?? goal.activeRevision;
    const row = this.requireRevision(goal, target);
    const artifact = this.readArtifact(goal.goalId);
    const fromFile = artifact?.revisions[String(target)];
    const state = fromFile ?? parseDirectionState(row.directionJson, goal.goalId, target);
    // revision 行是阶段/attention 的任务状态；决定内容仍以文件为准。
    return { ...state, status: row.directionStatus };
  }

  request(input: PodDirectionRequestInput): PodDirectionResult {
    const goal = this.requireGoal(input.goalId);
    const revision = input.revision ?? goal.activeRevision;
    const row = this.requireRevision(goal, revision);
    this.ensureMutable(goal, revision, row);
    if (row.status !== 'discussing' && row.status !== 'direction_review') {
      throw new PodError(409, `direction review not allowed in revision status: ${row.status}`);
    }
    const options = this.safeOptions(input.options);
    if (options.length === 0) {
      throw new PodError(400, 'direction review requires at least one option');
    }
    const mafwDir = this.requireMafwDir(goal.goalId);
    const artifact = this.readArtifactStrict(mafwDir, goal.goalId);
    const current = this.currentState(artifact, row, goal.goalId, revision);
    const now = this.now();
    const request: DirectionReviewRequest = {
      id: this.deps.newId?.() ?? `dirreq_${revision}_${current.requests.length + 1}`,
      options,
      reason: stringOrNull(input.reason),
      requestedAt: now,
      requestedBy: stringOrNull(input.requestedBy),
      revision,
    };
    const state: DirectionState = {
      ...current,
      status: 'pending',
      options,
      requests: [...current.requests, request],
      updatedAt: now,
    };
    this.persist(goal, revision, state, 'direction_review', 'pending');
    return this.result(goal, revision, state, null, mafwDir);
  }

  decide(input: PodDirectionDecideInput): PodDirectionResult {
    const goal = this.requireGoal(input.goalId);
    const revision = input.revision ?? goal.activeRevision;
    const row = this.requireRevision(goal, revision);
    this.ensureMutable(goal, revision, row);
    const mafwDir = this.requireMafwDir(goal.goalId);
    const artifact = this.readArtifactStrict(mafwDir, goal.goalId);
    const current = this.currentState(artifact, row, goal.goalId, revision);
    const now = this.now();
    const decision = this.safeDecision(input.decision, current, revision, now, 'user');

    const existing = current.decisions.find((item) => item.id === decision.id);
    if (existing) {
      // 幂等重放：同一条决定不重复追加，也不回退阶段。
      this.persist(goal, revision, current, 'planning', 'decided');
      return this.result(goal, revision, current, existing, mafwDir);
    }

    const state: DirectionState = {
      ...current,
      status: 'decided',
      decisions: [...current.decisions, decision],
      updatedAt: now,
    };
    this.persist(goal, revision, state, 'planning', 'decided');
    return this.result(goal, revision, state, decision, mafwDir);
  }

  /**
   * 方向明确：记录决定并进 planning，但**不**创建 `direction_review`/pending attention。
   * 与 `decide` 的差别只有来源与语义入口，不改变 append-only 历史。
   */
  markClear(input: PodDirectionClearInput): PodDirectionResult {
    const goal = this.requireGoal(input.goalId);
    const revision = input.revision ?? goal.activeRevision;
    const row = this.requireRevision(goal, revision);
    this.ensureMutable(goal, revision, row);
    const mafwDir = this.requireMafwDir(goal.goalId);
    const artifact = this.readArtifactStrict(mafwDir, goal.goalId);
    const current = this.currentState(artifact, row, goal.goalId, revision);
    const now = this.now();
    const decision = this.safeDecision({
      userWords: input.userWords ?? '',
      optionId: input.optionId ?? null,
      reason: input.reason ?? null,
      source: input.source ?? CLEAR_SOURCE,
      revision,
      decidedAt: now,
    }, current, revision, now, CLEAR_SOURCE);

    const existing = current.decisions.find((item) => item.id === decision.id);
    if (existing) {
      this.persist(goal, revision, current, 'planning', 'decided');
      return this.result(goal, revision, current, existing, mafwDir);
    }

    const state: DirectionState = {
      ...current,
      status: 'decided',
      decisions: [...current.decisions, decision],
      updatedAt: now,
    };
    this.persist(goal, revision, state, 'planning', 'decided');
    return this.result(goal, revision, state, decision, mafwDir);
  }

  /**
   * 打回反馈 → 方向决定的**输入**（append-only 记录，原话逐字保留）。
   *
   * 与 `decide`/`markClear` 的区别：它不推动 revision 阶段。打回后新 revision 仍是
   * `discussing`（Tech Lead 与用户重新判断方向/Plan/Eval），绝不把讨论推成 planning，
   * 也不产生人类 attention；行上的 `direction_status` 保持原值。
   */
  recordRejectInput(input: PodDirectionRejectInput): PodDirectionResult {
    const goal = this.requireGoal(input.goalId);
    const revision = input.revision ?? goal.activeRevision;
    const row = this.requireRevision(goal, revision);
    if (isTerminalGoalRevisionStatus(row.status)) {
      throw new PodError(409, `revision ${revision} is terminal (${row.status})`);
    }
    const userWords = typeof input.feedback === 'string' ? input.feedback : '';
    if (!userWords.trim()) throw new PodError(400, 'reject feedback is required');
    const mafwDir = this.requireMafwDir(goal.goalId);
    const artifact = this.readArtifactStrict(mafwDir, goal.goalId);
    const current = this.currentState(artifact, row, goal.goalId, revision);
    const now = this.now();
    const decision = this.safeDecision({
      userWords,
      optionId: null,
      reason: null,
      source: input.source ?? REJECT_FEEDBACK_SOURCE,
      revision,
      decidedAt: now,
    }, current, revision, now, REJECT_FEEDBACK_SOURCE);

    const existing = current.decisions.find((item) => item.id === decision.id);
    if (existing) {
      return this.result(goal, revision, current, existing, mafwDir);
    }
    const state: DirectionState = {
      ...current,
      decisions: [...current.decisions, decision],
      updatedAt: now,
    };
    artifact.revisions[String(revision)] = state;
    this.writeArtifact(mafwDir, goal.goalId, artifact);
    const applied = this.deps.store.setGoalRevisionDirection({
      podId: goal.podId,
      goalId: goal.goalId,
      revision,
      directionJson: serializeDirectionState(state),
    });
    if (!applied) {
      throw new PodError(409, `revision ${revision} could not be updated (terminal or missing)`);
    }
    this.deps.notify?.(goal.podId);
    return this.result(goal, revision, state, decision, mafwDir);
  }

  private requireGoal(goalId: string): PodGoalRow {
    const goal = this.deps.store.getGoalByGoalId(clean(goalId));
    if (!goal) throw new PodError(404, `goal not found: ${goalId}`);
    return goal;
  }

  private requireRevision(goal: PodGoalRow, revision: number): PodGoalRevisionRow {
    const row = this.deps.store.getGoalRevision(goal.podId, goal.goalId, revision);
    if (!row) throw new PodError(404, `goal revision not found: ${goal.goalId}#${revision}`);
    return row;
  }

  private ensureMutable(goal: PodGoalRow, revision: number, row: PodGoalRevisionRow): void {
    if (isTerminalGoalRevisionStatus(row.status)) {
      throw new PodError(409, `revision ${revision} is terminal (${row.status})`);
    }
    // 没有 mafw 目录就没有权威方向文件：在写任何东西之前失败（不产生半持久化）。
    this.requireMafwDir(goal.goalId);
  }

  private requireMafwDir(goalId: string): string {
    const dir = this.deps.resolveMafwDir(goalId);
    if (!dir) throw new PodError(400, `mafw dir not resolved for goal: ${goalId}`);
    return dir;
  }

  private safeOptions(options: DirectionOptionInput[]): ReturnType<typeof normalizeDirectionOptions> {
    try {
      return normalizeDirectionOptions(options ?? []);
    } catch (err: any) {
      throw new PodError(400, err?.message ?? 'invalid direction options');
    }
  }

  private safeDecision(
    input: DirectionDecisionInput,
    current: DirectionState,
    revision: number,
    now: string,
    defaultSource: string,
  ): DirectionDecision {
    const options = input.options && (input.options as unknown[]).length > 0
      ? input.options
      : current.options;
    try {
      return normalizeDirectionDecision({
        ...input,
        source: clean(input.source) || defaultSource,
        revision,
        decidedAt: clean(input.decidedAt) || now,
        options,
      });
    } catch (err: any) {
      throw new PodError(400, err?.message ?? 'invalid direction decision');
    }
  }

  /** 文件优先：artifact 中该 revision 的状态即权威；缺失才读 revision 镜像。 */
  private currentState(
    artifact: DirectionArtifact,
    row: PodGoalRevisionRow,
    goalId: string,
    revision: number,
  ): DirectionState {
    const fromFile = artifact.revisions[String(revision)];
    if (fromFile) return fromFile;
    const mirrored = parseDirectionState(row.directionJson, goalId, revision);
    if (mirrored.status !== 'none' || mirrored.decisions.length > 0) return mirrored;
    return emptyDirectionState(goalId, revision);
  }

  private readArtifact(goalId: string): DirectionArtifact | null {
    let mafwDir: string;
    try {
      mafwDir = this.requireMafwDir(goalId);
    } catch {
      return null;
    }
    return this.readArtifactStrict(mafwDir, goalId);
  }

  /**
   * 严格读取：坏 JSON/坏形状硬失败（500），绝不把损坏的历史文件当成空文件覆盖。
   * 文件不存在返回空 artifact。
   */
  private readArtifactStrict(mafwDir: string, goalId: string): DirectionArtifact {
    const target = directionArtifactPath(mafwDir, goalId);
    if (!fs.existsSync(target)) {
      return { version: DIRECTION_STATE_VERSION, goalId, revisions: {} };
    }
    let text: string;
    try {
      text = fs.readFileSync(target, 'utf-8');
    } catch (err: any) {
      throw new PodError(500, `direction artifact could not be read: ${err?.message ?? err}`);
    }
    let raw: any;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new PodError(500, `direction artifact is not valid JSON: ${target}`);
    }
    if (!raw || typeof raw !== 'object') {
      throw new PodError(500, `direction artifact is not valid JSON: ${target}`);
    }
    let artifact: DirectionArtifact;
    try {
      artifact = parseDirectionArtifact(text);
    } catch (err: any) {
      throw new PodError(500, `direction artifact is not valid: ${err?.message ?? err}`);
    }
    return { ...artifact, goalId: artifact.goalId || goalId };
  }

  private persist(
    goal: PodGoalRow,
    revision: number,
    state: DirectionState,
    status: PodGoalRevisionStatus,
    directionStatus: PodGoalDirectionStatus,
  ): void {
    const mafwDir = this.requireMafwDir(goal.goalId);
    const artifact = this.readArtifactStrict(mafwDir, goal.goalId);
    artifact.revisions[String(revision)] = state;
    this.writeArtifact(mafwDir, goal.goalId, artifact);

    const applied = this.deps.store.setGoalRevisionStatus({
      podId: goal.podId,
      goalId: goal.goalId,
      revision,
      status,
      now: this.now(),
      directionStatus,
      directionJson: serializeDirectionState(state),
    });
    if (!applied) {
      this.deps.log?.(
        `[Pod] direction revision update skipped goal=${goal.goalId} rev=${revision}`
        + ` status=${status} (terminal or missing)`,
      );
      throw new PodError(409, `revision ${revision} could not be updated (terminal or missing)`);
    }
    this.deps.notify?.(goal.podId);
  }

  private writeArtifact(mafwDir: string, goalId: string, artifact: DirectionArtifact): string {
    const target = directionArtifactPath(mafwDir, goalId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, serializeDirectionArtifact({ ...artifact, goalId }), 'utf-8');
    fs.renameSync(tmp, target);
    return target;
  }

  private result(
    goal: PodGoalRow,
    revision: number,
    state: DirectionState,
    decision: DirectionDecision | null,
    mafwDir: string,
  ): PodDirectionResult {
    const row = this.deps.store.getGoalRevision(goal.podId, goal.goalId, revision);
    return {
      podId: goal.podId,
      goalId: goal.goalId,
      revision,
      revisionStatus: row?.status ?? 'planning',
      directionStatus: row?.directionStatus ?? (decision ? 'decided' : 'pending'),
      state,
      decision,
      artifactPath: directionArtifactPath(mafwDir, goal.goalId),
    };
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}
