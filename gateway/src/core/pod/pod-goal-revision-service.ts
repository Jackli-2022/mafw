// gateway/src/core/pod/pod-goal-revision-service.ts
// Goal revision 生命周期：打回 → 归档旧 state → 开新 revision → 切 active 指针。
// append-only：旧 revision 行与旧 state 快照永不重写（Task 3 的终态行不可变约定）。
import {
  PodError,
  isTerminalGoalRevisionStatus,
  type PodGoalDirectionStatus,
  type PodGoalRevisionRow,
  type PodGoalRevisionStatus,
  type PodGoalRow,
  type PodStore,
} from './pod-store';
import {
  archiveGoalStateForRevision,
  ensureGoalState,
  loadGoalState,
} from '../goal/state-v3';

/** 打回（reject）产生的 revision 默认优先级——直觉上优先于普通 queued Goal。 */
export const REJECT_REVISION_PRIORITY = 10;

export interface PodGoalRevisionServiceDeps {
  store: PodStore;
  /** goal 的 mafw 目录（state 归档/重建的落点）；解析不到时 openNextRevision 报 400。 */
  resolveMafwDir(goalId: string): string | null;
  now?(): string;
  notify?(podId: string): void;
  log?(message: string): void;
}

export interface OpenNextRevisionOptions {
  /**
   * 调用方认为「当前」的 revision（乐观并发 / 防重放）。与 `goal.activeRevision`
   * 不一致时整个操作 no-op（`opened:false, staleReason:'expected_revision_mismatch'`），
   * 在任何 DB / 文件写入之前返回——重试同一次 reject 不会烧掉一个 revision。
   */
  expectedRevision?: number;
  /** 新 revision 的调度优先级；缺省 = 有打回反馈时 REJECT_REVISION_PRIORITY，否则 0。 */
  priority?: number;
  /** 旧 revision 的收尾状态；缺省 completed。 */
  closeAs?: 'completed' | 'aborted';
  /** 旧 revision 收尾时记录的 verdict（缺省保留原值）。 */
  closeVerdict?: string | null;
  /** 新 revision 的初始状态；缺省 discussing（Tech Lead 讨论）。 */
  status?: PodGoalRevisionStatus;
  /** 新 revision 的反馈（打回理由）；缺省用 feedback 参数。 */
  feedback?: string | null;
}

/** no-op 原因：重放/过期的 expectedRevision，或当前 revision 还没产出可打回的结果。 */
export type OpenNextRevisionStaleReason = 'expected_revision_mismatch' | 'pristine_revision';

export interface RevisionCloseOutcome {
  revision: number;
  /** setGoalRevisionStatus 真的改了行。 */
  closed: boolean;
  /** 行已处于终态（Task 3 返回 false 的「不可变」分支）。 */
  alreadyTerminal: boolean;
  /** 根本没有这一版的行（legacy goal，尚未由 intake 建 revision 1）。 */
  missing: boolean;
}

export interface OpenNextRevisionResult {
  /** true = 新建并激活了 N+1；false = 前置条件不满足（重放/无结果可打回），未做任何写入。 */
  opened: boolean;
  staleReason?: OpenNextRevisionStaleReason;
  podId: string;
  goalId: string;
  /** opened：新 revision；no-op：仍是当前 active revision。 */
  revision: number;
  status: PodGoalRevisionStatus;
  priority: number;
  /** 旧 revision state 的归档路径；无 active state（或 no-op）时为 null。 */
  archivedState: string | null;
  previous: RevisionCloseOutcome;
}

export interface FinishRevisionInput {
  status: PodGoalRevisionStatus;
  /** 缺省 = goal 的 active revision。 */
  revision?: number;
  verdict?: string | null;
  directionStatus?: PodGoalDirectionStatus;
  directionJson?: string | null;
  planHash?: string | null;
  evalHash?: string | null;
  feedback?: string | null;
}

/** Task 3 的 setGoalRevisionStatus 返回 boolean：false = 终态行或行不存在，必须显式区分。 */
export type FinishRevisionReason = 'applied' | 'terminal' | 'not_found';

export interface FinishRevisionResult {
  applied: boolean;
  reason: FinishRevisionReason;
  revision: PodGoalRevisionRow | null;
}

export class PodGoalRevisionService {
  constructor(private readonly deps: PodGoalRevisionServiceDeps) {}

  /** 当前 revision 行；legacy goal 尚无行时返回 null（不臆造）。 */
  current(goalId: string): PodGoalRevisionRow | null {
    const goal = this.requireGoal(goalId);
    return this.deps.store.getGoalRevision(goal.podId, goalId, goal.activeRevision);
  }

  /**
   * 收尾 revision（通常 completed/aborted）。已收尾的行原样返回 `terminal`：
   * 打回必须开新 revision，绝不能把已 PASS 的版本改回进行中。
   */
  finishRevision(
    goalId: string,
    input: PodGoalRevisionStatus | FinishRevisionInput,
  ): FinishRevisionResult {
    const goal = this.requireGoal(goalId);
    const spec: FinishRevisionInput = typeof input === 'string' ? { status: input } : input;
    const revision = spec.revision ?? goal.activeRevision;
    const existing = this.deps.store.getGoalRevision(goal.podId, goalId, revision);
    if (!existing) return { applied: false, reason: 'not_found', revision: null };
    if (isTerminalGoalRevisionStatus(existing.status)) {
      return { applied: false, reason: 'terminal', revision: existing };
    }

    const applied = this.deps.store.setGoalRevisionStatus({
      podId: goal.podId,
      goalId,
      revision,
      status: spec.status,
      now: this.now(),
      verdict: spec.verdict ?? null,
      directionStatus: spec.directionStatus,
      directionJson: spec.directionJson ?? null,
      planHash: spec.planHash ?? null,
      evalHash: spec.evalHash ?? null,
      feedback: spec.feedback ?? null,
    });
    const after = this.deps.store.getGoalRevision(goal.podId, goalId, revision);
    if (!applied) {
      // 预检之后发生的竞态：以行现状为准，不假装写入成功。
      const reason: FinishRevisionReason = after && isTerminalGoalRevisionStatus(after.status)
        ? 'terminal'
        : 'not_found';
      this.deps.log?.(`[Pod] finishRevision skipped goal=${goalId} rev=${revision} reason=${reason}`);
      return { applied: false, reason, revision: after };
    }
    this.deps.notify?.(goal.podId);
    return { applied: true, reason: 'applied', revision: after };
  }

  /**
   * 打回/重开：收尾当前 revision → 归档其 state → 建 N+1（discussing + 优先级）
   * → 重建 active state（新 revision）→ 切 root `active_revision`。
   *
   * 幂等/防重放（任何 DB 或文件写入之前判定）：
   * - `expectedRevision` 与当前 active revision 不一致 → no-op
   *   （`staleReason:'expected_revision_mismatch'`）：重试同一次 reject 不会再开一版；
   * - 当前 revision 仍是「刚开、未产出任何东西」的 discussing 版（无 started/ended/
   *   verdict/hash/direction）且要求按 completed 收尾 → no-op（`pristine_revision`）：
   *   不会把一个空 revision 标成 completed 再归档假快照。显式 `closeAs:'aborted'`
   *   仍可放弃这样的 revision。
   *
   * 旧的 revision 行与 `rev-<n>.json` 快照都保持原样；即使当前 revision 已终态
   * （Task 3 返回 false）也照样开下一版，只是 `previous.closed = false`。
   */
  async openNextRevision(
    goalId: string,
    feedback?: string | null,
    opts: OpenNextRevisionOptions = {},
  ): Promise<OpenNextRevisionResult> {
    const goal = this.requireGoal(goalId);
    const currentRow = this.deps.store.getGoalRevision(goal.podId, goalId, goal.activeRevision);

    if (opts.expectedRevision !== undefined && opts.expectedRevision !== goal.activeRevision) {
      this.deps.log?.(
        `[Pod] openNextRevision stale goal=${goalId} expected=${opts.expectedRevision}`
        + ` active=${goal.activeRevision}`,
      );
      return this.staleResult(goal, currentRow, 'expected_revision_mismatch');
    }
    if (
      currentRow
      && (opts.closeAs ?? 'completed') === 'completed'
      && isPristineRevision(currentRow)
    ) {
      this.deps.log?.(
        `[Pod] openNextRevision stale goal=${goalId} active=${goal.activeRevision} (pristine revision)`,
      );
      return this.staleResult(goal, currentRow, 'pristine_revision');
    }

    const pod = this.deps.store.getPod(goal.podId);
    if (!pod) throw new PodError(404, `pod not found: ${goal.podId}`);
    const mafwDir = this.deps.resolveMafwDir(goalId);
    if (!mafwDir) throw new PodError(400, `mafw dir not resolved for goal: ${goalId}`);

    const now = this.now();
    const previous = this.closeCurrentRevision(goal, opts, now);

    const reason = (opts.feedback ?? feedback ?? '').toString().trim();
    const priority = opts.priority ?? (reason ? REJECT_REVISION_PRIORITY : 0);
    const status: PodGoalRevisionStatus = opts.status ?? 'discussing';
    const row = this.deps.store.createGoalRevision({
      podId: goal.podId,
      goalId,
      revision: this.deps.store.nextGoalRevision(goal.podId, goalId),
      status,
      priority,
      feedback: reason ? reason : null,
      now,
    });
    // createGoalRevision 幂等：并发打开同一版时以数据库既有行为准。
    const openedRevision = row.revision;

    const previousState = loadGoalState(mafwDir, goalId);
    const archivedState = archiveGoalStateForRevision(
      mafwDir,
      goalId,
      previousState?.revision ?? goal.activeRevision,
    );
    ensureGoalState(mafwDir, goalId, {
      revision: openedRevision,
      projectDir: previousState?.projectDir ?? pod.projectDir,
      maxRounds: previousState?.maxRounds ?? 3,
      policySnapshot: previousState?.policySnapshot,
      taskType: previousState?.taskType,
      planReview: previousState?.planReview,
    });

    this.deps.store.setActiveRevision(goal.podId, goalId, openedRevision);
    if (priority > 0) this.deps.store.setGoalPriority(goal.podId, goalId, priority);
    this.deps.notify?.(goal.podId);

    return {
      opened: true,
      podId: goal.podId,
      goalId,
      revision: openedRevision,
      status: row.status,
      priority: row.priority,
      archivedState,
      previous,
    };
  }

  /** no-op 结果：完全不触碰 DB / 文件，调用方可按 `opened === false` 幂等处理。 */
  private staleResult(
    goal: PodGoalRow,
    row: PodGoalRevisionRow | null,
    staleReason: OpenNextRevisionStaleReason,
  ): OpenNextRevisionResult {
    return {
      opened: false,
      staleReason,
      podId: goal.podId,
      goalId: goal.goalId,
      revision: goal.activeRevision,
      status: row?.status ?? 'discussing',
      priority: row?.priority ?? goal.priority,
      archivedState: null,
      previous: {
        revision: goal.activeRevision,
        closed: false,
        alreadyTerminal: !!row && isTerminalGoalRevisionStatus(row.status),
        missing: !row,
      },
    };
  }

  private closeCurrentRevision(
    goal: PodGoalRow,
    opts: OpenNextRevisionOptions,
    now: string,
  ): RevisionCloseOutcome {
    const revision = goal.activeRevision;
    const row = this.deps.store.getGoalRevision(goal.podId, goal.goalId, revision);
    if (!row) {
      return { revision, closed: false, alreadyTerminal: false, missing: true };
    }
    if (isTerminalGoalRevisionStatus(row.status)) {
      return { revision, closed: false, alreadyTerminal: true, missing: false };
    }

    const applied = this.deps.store.setGoalRevisionStatus({
      podId: goal.podId,
      goalId: goal.goalId,
      revision,
      status: opts.closeAs ?? 'completed',
      now,
      verdict: opts.closeVerdict ?? null,
    });
    if (applied) {
      return { revision, closed: true, alreadyTerminal: false, missing: false };
    }
    // Task 3 的 false 必须显式处理：以重读结果解释，而不是假设写入成功。
    const after = this.deps.store.getGoalRevision(goal.podId, goal.goalId, revision);
    const alreadyTerminal = !!after && isTerminalGoalRevisionStatus(after.status);
    this.deps.log?.(
      `[Pod] close revision skipped goal=${goal.goalId} rev=${revision}`
      + ` (${alreadyTerminal ? 'already terminal' : 'missing'})`,
    );
    return { revision, closed: false, alreadyTerminal, missing: !after };
  }

  private requireGoal(goalId: string): PodGoalRow {
    const goal = this.deps.store.getGoalByGoalId(goalId);
    if (!goal) throw new PodError(404, `goal not found: ${goalId}`);
    return goal;
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}

/**
 * 「刚开出来、还没产出任何东西」的 revision：没有 started/ended 戳、没有 verdict、
 * 没有 plan/eval hash、没有 direction 决策。这种 revision 不是可打回的结果——
 * 对它按 completed 收尾只会在 append-only 历史里留下一个假的 completed 快照
 * （重放同一次 reject 正是这样烧掉一版的）。
 */
function isPristineRevision(row: PodGoalRevisionRow): boolean {
  return row.status === 'discussing'
    && row.startedAt == null
    && row.endedAt == null
    && row.verdict == null
    && row.planHash == null
    && row.evalHash == null
    && row.directionStatus === 'none';
}
