import { PodError, PodStore, isTerminalGoalRevisionStatus, type PodGoalRevisionStatus, type PodGoalRow, type PodProbeRow, type PodRow } from './pod-store';
import type { PodService } from './pod-service';
import { canonicalProjectDir } from './pod-identity';
import {
  buildPodAttention,
  buildPodGoalView,
  type PodGoalDescription,
  type PodGoalView,
} from './pod-view';
import type { PodAttentionItem, PodGoalVerdict, PodQueueReason } from './pod-stage';
import type { PodGoalResult } from './pod-result';
import type {
  FinishRevisionInput,
  FinishRevisionResult,
  ReopenAfterRejectOptions,
  RejectRevisionResult,
} from './pod-goal-revision-service';

export interface PodEnqueueResult {
  /** discussing = Tech Lead discussion Goal (active but no NodeDriver run). */
  status: 'started' | 'queued' | 'discussing';
  podId: string;
  queueReason: PodQueueReason | null;
}

/** 打回结果（Task 16）：同一 Goal 的下一 revision，讨论立即恢复。 */
export interface PodRejectResult {
  podId: string;
  goalId: string;
  revision: number;
  status: PodGoalRevisionStatus;
  priority: number;
  feedback: string;
  archivedState: string | null;
  previous: RejectRevisionResult['previous'];
  /** Tech Lead 讨论会话（重建/复用的 scoped session）。 */
  sessionID: string | null;
  sessionError?: string;
}

/** 完成通知结果：同一 revision 只广播一次结果事件。 */
export interface PodResultNotification {
  podId: string;
  goalId: string;
  revision: number;
  verdict: PodGoalVerdict | null;
  /** true = 本次调用广播了结果事件。 */
  notified: boolean;
  /** true = 该 revision 已经通知过（重复调用不重复广播）。 */
  duplicate: boolean;
}

/** 打回所需的 revision 生命周期能力（Task 4 service；按需注入）。 */
export interface PodRevisionLifecycle {
  finishRevision(goalId: string, input: FinishRevisionInput): FinishRevisionResult;
  reopenAfterReject(
    goalId: string,
    feedback: string,
    opts?: ReopenAfterRejectOptions,
  ): Promise<RejectRevisionResult>;
}

export interface PodGoalServiceDeps {
  store: PodStore;
  pods: PodService;
  startGoal(goalId: string, projectDirHint?: string): Promise<void>;
  advanceGoal?(goalId: string): Promise<void>;
  resolveProjectDir(goalId: string): string | null;
  now(): string;
  newId(): string;
  notify(podId: string, kind?: string, goalId?: string): void;
  budget?: { canStart(podId: string): { ok: boolean; spentUsd: number; limitUsd: number } };
  goalState?(goalId: string): { terminal: boolean; verdict?: string } | null;
  describeGoal?(goalId: string): PodGoalDescription | null;
  resultForGoal?(goalId: string): PodGoalResult | null;
  listInFlightGoals?(projectDir: string): string[];
  listRegisteredProjectDirs?(): string[];
  finalizeGoal?(goalId: string, outcome?: { verdict?: string }): Promise<void>;
  /** Task 4：revision 收尾 / 打回开下一版。 */
  revisions?: PodRevisionLifecycle;
  /** Revision session retirement (Tech Lead discussion lease). */
  sessions?: { retireRevision(goalId: string, revision: number): Promise<boolean> };
  /** Task 10：打回后立即恢复该 Goal 的 Tech Lead 讨论会话。 */
  techLead?: { ensureSession(goalId: string): Promise<string> };
  /** Task 6：打回反馈作为方向决定的输入（append-only，不推动阶段）。 */
  directions?: { recordRejectInput(input: {
    goalId: string;
    revision?: number;
    feedback: string;
    source?: string | null;
  }): unknown };
  log?(message: string): void;
}

export class PodGoalService {
  /** 已广播过结果事件的 `<podId>/<goalId>#<revision>`（best-effort 去重；重启后最多重发一次）。 */
  private readonly notifiedResults = new Set<string>();

  constructor(private readonly deps: PodGoalServiceDeps) {}

  async enqueueGoal(
    goalId: string,
    projectDirHint?: string,
  ): Promise<PodEnqueueResult> {
    const projectDir = projectDirHint ?? this.deps.resolveProjectDir(goalId);
    if (!projectDir) throw new PodError(400, `project not resolved for goal: ${goalId}`);
    const detail = await this.deps.pods.ensure(projectDir);
    const pod = detail.pod;
    const existing = this.deps.store.getGoal(pod.id, goalId);
    if (existing) {
      if (existing.status === 'active') {
        // An active row is not necessarily a running NodeDriver: a discussion Goal
        // is active by design but must report discussing/queued, never started.
        if (this.isStartable(existing.goalId)) {
          return { status: 'started', podId: pod.id, queueReason: null };
        }
        const revision = this.deps.store.getGoalRevision(
          pod.id,
          existing.goalId,
          existing.activeRevision,
        );
        return {
          status: revision?.status === 'direction_review' ? 'queued' : 'discussing',
          podId: pod.id,
          queueReason: null,
        };
      }
      if (existing.status === 'queued' && !this.deps.store.getActiveGoal(pod.id)
        && pod.status !== 'paused' && pod.status !== 'archived') {
        const budget = this.deps.budget?.canStart(pod.id);
        if (!budget || budget.ok) await this.promote(pod.id);
        const current = this.deps.store.getGoal(pod.id, goalId);
        return {
          status: current?.status === 'active' ? 'started' : 'queued',
          podId: pod.id,
          queueReason: current?.status === 'active' ? null : (this.queueReasonFor(pod, current!) ?? null),
        };
      }
      return { status: 'queued', podId: pod.id, queueReason: this.queueReasonFor(pod, existing) ?? null };
    }

    const row = this.deps.store.enqueueGoal({
      id: this.deps.newId(),
      podId: pod.id,
      goalId,
      now: this.deps.now(),
    });
    const active = this.deps.store.getActiveGoal(pod.id);
    const olderQueued = this.deps.store.listGoals(pod.id)
      .some((candidate) => candidate.id !== row.id && candidate.status === 'queued');
    const budget = this.deps.budget?.canStart(pod.id);
    if (pod.status === 'paused' || pod.status === 'archived' || !!active || (budget && !budget.ok)) {
      this.deps.notify(pod.id);
      return { status: 'queued', podId: pod.id, queueReason: this.queueReasonFor(pod, row) ?? null };
    }
    if (olderQueued) {
      await this.promote(pod.id);
      this.deps.notify(pod.id);
      return { status: 'queued', podId: pod.id, queueReason: 'active_goal' };
    }

    await this.startQueued(row.id, pod.id, goalId, pod.projectDir);
    this.deps.notify(pod.id);
    const afterStart = this.deps.store.getGoal(pod.id, goalId) ?? row;
    return {
      status: afterStart.status === 'active' ? 'started' : 'queued',
      podId: pod.id,
      queueReason: afterStart.status === 'active' ? null : (this.queueReasonFor(pod, afterStart) ?? null),
    };
  }

  async onGoalArchived(
    goalId: string,
    outcome?: { verdict?: string },
  ): Promise<void> {
    const goal = this.deps.store.getGoalByGoalId(goalId);
    if (!goal) return;
    if (goal.status === 'done' || goal.status === 'aborted') return;
    const pod = this.deps.store.getPod(goal.podId);
    if (!pod) return;

    const wasActive = pod.activeGoalId === goal.goalId;
    const verdict = normalizeVerdict(outcome?.verdict);
    const nextStatus = verdict === 'CANCELLED' ? 'aborted' : 'done';
    this.deps.store.setGoalStatus(goal.id, nextStatus, {
      endedAt: this.deps.now(),
      ...(verdict ? { verdict } : {}),
    });
    if (!wasActive) {
      this.deps.notify(pod.id);
      return;
    }

    this.deps.store.updatePod(pod.id, {
      activeGoalId: null,
      status: pod.status === 'paused' || pod.status === 'archived' ? pod.status : 'idle',
    }, this.deps.now());
    if (pod.status === 'paused' || pod.status === 'archived') {
      this.deps.notify(pod.id);
      return;
    }
    await this.promote(pod.id);
    this.deps.notify(pod.id);
  }

  async promote(podId: string): Promise<boolean> {
    const pod = this.deps.store.getPod(podId);
    if (!pod || pod.status === 'paused' || pod.status === 'archived') return false;
    if (this.deps.store.getActiveGoal(podId)) return false;
    const next = this.deps.store.listGoals(podId)
      .find((candidate) => candidate.status === 'queued' && this.isStartable(candidate.goalId));
    if (!next) return false;
    const budget = this.deps.budget?.canStart(podId);
    if (budget && !budget.ok) return false;
    await this.startQueued(next.id, podId, next.goalId, pod.projectDir);
    this.deps.notify(podId);
    return true;
  }

  /**
   * 讨论中的 Goal（revision discussing / direction_review）绝不能进入 NodeDriver：
   * 只有 direction `clear`/`decided` 把 revision 推到 planning 后，方向工具才会
   * 显式调用 starter。没有 revision 行的 legacy Goal 保持可启动。
   */
  isStartable(goalId: string): boolean {
    const goal = this.deps.store.getGoalByGoalId(goalId);
    if (!goal) return true;
    const revision = this.deps.store.getGoalRevision(goal.podId, goal.goalId, goal.activeRevision);
    if (!revision) return true;
    return revision.status !== 'discussing'
      && revision.status !== 'direction_review'
      && !isTerminalGoalRevisionStatus(revision.status);
  }

  private async startQueued(
    rowId: string,
    podId: string,
    goalId: string,
    projectDir: string,
  ): Promise<void> {
    if (!this.isStartable(goalId)) {
      this.deps.log?.(
        `[Pod] refusing to start discussing goal ${goalId} before a direction decision`,
      );
      return;
    }
    this.deps.store.setGoalStatus(rowId, 'active', { startedAt: this.deps.now() });
    this.deps.store.updatePod(podId, {
      status: 'active',
      activeGoalId: goalId,
    }, this.deps.now());
    try {
      await this.deps.startGoal(goalId, projectDir);
    } catch (err) {
      this.deps.store.setGoalStatus(rowId, 'queued', {});
      this.deps.store.updatePod(podId, {
        status: 'idle',
        activeGoalId: null,
      }, this.deps.now());
      throw err;
    }
  }

  async reconcile(): Promise<void> {
    const dirs = new Set<string>();
    for (const pod of this.deps.store.listPods()) dirs.add(canonicalProjectDir(pod.projectDir));
    for (const dir of this.deps.listRegisteredProjectDirs?.() ?? []) dirs.add(canonicalProjectDir(dir));

    for (const projectDir of dirs) {
      let pod = this.deps.store.getPodByProject(projectDir);
      if (!pod) {
        const inFlight = this.deps.listInFlightGoals?.(projectDir) ?? [];
        if (inFlight.length === 0) continue;
        try {
          pod = (await this.deps.pods.ensure(projectDir)).pod;
        } catch (err: any) {
          this.deps.log?.(`[Pod] reconcile ensure failed for ${projectDir}: ${err?.message ?? err}`);
          continue;
        }
      }
      try {
        await this.reconcilePod(pod);
      } catch (err: any) {
        this.deps.log?.(`[Pod] reconcile failed for ${pod.id}: ${err?.message ?? err}`);
      }
    }
  }

  private async reconcilePod(pod: PodRow): Promise<void> {
    const active = this.deps.store.getActiveGoal(pod.id);
    if (active) {
      if (pod.activeGoalId !== active.goalId) {
        this.deps.store.updatePod(pod.id, { activeGoalId: active.goalId }, this.deps.now());
      }
      const state = this.deps.goalState?.(active.goalId);
      if (this.deps.goalState && !state) return; // unreadable state stays blocked, never invented CANCELLED
      if (this.deps.goalState && state?.terminal) {
        const outcome = { verdict: state.verdict };
        if (this.deps.finalizeGoal) await this.deps.finalizeGoal(active.goalId, outcome);
        else await this.onGoalArchived(active.goalId, outcome);
        return;
      }
      return;
    }

    const unstartable = pod.status === 'paused' || pod.status === 'archived';
    if (pod.activeGoalId) {
      const state = this.deps.goalState?.(pod.activeGoalId);
      if (this.deps.goalState && !state) return;
      if (this.deps.goalState && state?.terminal) {
        this.deps.store.updatePod(pod.id, {
          activeGoalId: null,
          status: unstartable ? pod.status : 'idle',
        }, this.deps.now());
      } else if (!unstartable) {
        const row = this.deps.store.getGoalByGoalId(pod.activeGoalId)
          ?? this.deps.store.enqueueGoal({
            id: this.deps.newId(),
            podId: pod.id,
            goalId: pod.activeGoalId,
            now: this.deps.now(),
          });
        this.deps.store.setGoalStatus(row.id, 'active', { startedAt: this.deps.now() });
        this.deps.store.updatePod(pod.id, { activeGoalId: pod.activeGoalId, status: 'active' }, this.deps.now());
        return;
      }
    }

    if (!unstartable) {
      const inFlight = this.deps.listInFlightGoals?.(pod.projectDir) ?? [];
      const next = inFlight.find((goalId) => {
        if (this.deps.store.getGoalByGoalId(goalId)) return false;
        if (!this.isStartable(goalId)) return false;
        const state = this.deps.goalState?.(goalId);
        return !state || !state.terminal;
      });
      if (next) {
        const row = this.deps.store.enqueueGoal({
          id: this.deps.newId(),
          podId: pod.id,
          goalId: next,
          now: this.deps.now(),
        });
        this.deps.store.setGoalStatus(row.id, 'active', { startedAt: this.deps.now() });
        this.deps.store.updatePod(pod.id, { activeGoalId: next, status: 'active' }, this.deps.now());
        return;
      }
      await this.promote(pod.id);
    }
  }

  async pause(podId: string): Promise<void> {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    this.deps.store.updatePod(podId, { status: 'paused' }, this.deps.now());
    this.deps.notify(podId);
  }

  async resume(podId: string): Promise<boolean> {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    if (pod.status === 'archived') throw new PodError(409, 'archived pod cannot resume');
    this.deps.store.updatePod(podId, { status: 'active' }, this.deps.now());

    const active = this.deps.store.getActiveGoal(podId);
    if (active) {
      if (this.isStartable(active.goalId)) {
        await this.deps.advanceGoal?.(active.goalId);
      } else {
        this.deps.log?.(
          `[Pod] resume kept discussing goal ${active.goalId} parked until a direction decision`,
        );
      }
      this.deps.notify(podId);
      return true;
    }
    return this.promote(podId);
  }

  cancelQueued(podId: string, goalId: string): PodGoalRow {
    const row = this.deps.store.getGoal(podId, goalId);
    if (!row) throw new PodError(404, `goal not found: ${goalId}`);
    if (row.status !== 'queued') throw new PodError(409, `goal is not queued: ${goalId}`);
    this.deps.store.setGoalStatus(row.id, 'aborted', {
      endedAt: this.deps.now(),
      verdict: 'CANCELLED',
    });
    this.deps.notify(podId);
    return this.deps.store.getGoal(podId, goalId)!;
  }

  describeGoal(goalId: string): PodGoalDescription | null {
    return this.deps.describeGoal?.(goalId) ?? null;
  }

  views(podId: string): PodGoalView[] {
    const pod = this.deps.store.getPod(podId);
    if (!pod) return [];
    const runningProbe = this.deps.store.getRunningProbe(podId);
    return this.deps.store.listGoals(podId).map((row) => buildPodGoalView(
      row,
      this.describeWithRevision(row, runningProbe),
      this.queueReasonFor(pod, row),
    ));
  }

  /**
   * 把当前 revision 的任务状态与 Spike 运行态并入描述（Task 11 读模型）：
   * revision 行是「阶段/attention」的权威，state 只提供 blockers 与标题。
   */
  private describeWithRevision(
    row: PodGoalRow,
    runningProbe: PodProbeRow | null,
  ): PodGoalDescription | null {
    const description = this.describeGoal(row.goalId);
    if (!description) return null;
    const revision = this.deps.store.getGoalRevision(row.podId, row.goalId, row.activeRevision);
    return {
      ...description,
      ...(revision
        ? {
          revisionStatus: revision.status,
          directionStatus: revision.directionStatus,
        }
        : {}),
      probeRunning: !!runningProbe
        && runningProbe.goalId === row.goalId
        && runningProbe.revision === row.activeRevision,
    };
  }

  attention(podId: string): PodAttentionItem[] {
    return buildPodAttention(this.views(podId));
  }

  result(podId: string, goalId: string): PodGoalResult {
    const row = this.deps.store.getGoal(podId, goalId);
    if (!row) throw new PodError(404, `goal not found: ${goalId}`);
    const result = this.deps.resultForGoal?.(goalId);
    if (!result) throw new PodError(404, `goal result not found: ${goalId}`);
    return { ...result, verdict: row.verdict ?? result.verdict };
  }

  /**
   * 完成通知（spec §8.1）：Reviewer 判 PASS 后由 Lead 通知用户。
   *
   * - 当前 revision **保持**真实完成结果（终态行永不改写；尚未收尾但有证据时
   *   只按证据 verdict 收尾一次，绝不臆造 PASS）；
   * - 只广播一条 `pod.updated {kind:'result', goalId}`，同一 revision 不重复发；
   * - 不创建人类 attention，也不需要用户再点一次「验收通过」。
   */
  async notifyResult(podId: string, goalId: string): Promise<PodResultNotification> {
    const row = this.requireGoalRow(podId, goalId);
    const revision = this.deps.store.getGoalRevision(podId, goalId, row.activeRevision);
    if (!revision) {
      throw new PodError(404, `goal revision not found: ${goalId}#${row.activeRevision}`);
    }
    const result = this.deps.resultForGoal?.(goalId) ?? null;
    const verdict = normalizeVerdict(
      result?.verdict ?? revision.verdict ?? row.verdict ?? undefined,
    ) ?? null;
    const hasEvidence = verdict !== null || result?.resultReady === true;
    if (!hasEvidence) {
      throw new PodError(409, `goal has no result to notify: ${goalId}`);
    }
    if (!isTerminalGoalRevisionStatus(revision.status) && this.deps.revisions) {
      const finished = this.deps.revisions.finishRevision(goalId, {
        revision: revision.revision,
        status: 'completed',
        verdict,
      });
      if (finished.applied) {
        await this.deps.sessions?.retireRevision(goalId, revision.revision);
      }
    }

    const key = `${podId}/${goalId}#${revision.revision}`;
    if (this.notifiedResults.has(key)) {
      return {
        podId, goalId, revision: revision.revision, verdict, notified: false, duplicate: true,
      };
    }
    this.notifiedResults.add(key);
    this.deps.notify(podId, 'result', goalId);
    return {
      podId, goalId, revision: revision.revision, verdict, notified: true, duplicate: false,
    };
  }

  /**
   * 打回（spec §8.2 / §8.3）：同一 Goal 继续，开下一 revision。
   *
   * 顺序不可交换（HARD PREREQUISITE）：先带结果证据收尾当前 revision，再
   * `openNextRevision(expectedRevision)`。旧 revision 只追加、永不重写或反归档；
   * 新 revision 从 `discussing` 开始（Tech Lead 讨论立即恢复），并带上打回优先级。
   */
  async rejectResult(podId: string, goalId: string, feedback: string): Promise<PodRejectResult> {
    const reason = typeof feedback === 'string' ? feedback.trim() : '';
    if (!reason) throw new PodError(400, 'reject feedback is required');
    const row = this.requireGoalRow(podId, goalId);
    if (!this.deps.revisions) throw new PodError(503, 'goal revisions unavailable');

    const reopened = await this.deps.revisions.reopenAfterReject(goalId, reason, {
      expectedRevision: row.activeRevision,
    });
    if (!reopened.opened) {
      throw new PodError(
        409,
        `goal revision ${row.activeRevision} could not be reopened`
        + ` (${reopened.staleReason ?? 'stale'})`,
      );
    }

    // 同一 Goal 回到 Pod 队列：当前没有别的 Goal 在跑就立即 active；否则排队等优先级。
    const pod = this.deps.store.getPod(podId);
    const active = this.deps.store.getActiveGoal(podId);
    const blocked = !pod || pod.status === 'paused' || pod.status === 'archived';
    const nextStatus: 'active' | 'queued' = !blocked && (!active || active.goalId === goalId)
      ? 'active'
      : 'queued';
    this.deps.store.reopenGoal(podId, goalId, { status: nextStatus, now: this.deps.now() });
    if (nextStatus === 'active' && pod) {
      this.deps.store.updatePod(podId, { status: 'active', activeGoalId: goalId }, this.deps.now());
    }

    // 打回反馈作为方向决定的输入（append-only；不改变 discussing 阶段）。
    try {
      this.deps.directions?.recordRejectInput({
        goalId,
        revision: reopened.revision,
        feedback: reason,
      });
    } catch (err: any) {
      // revision 已经开出：反馈镜像失败不能让打回回滚（原件仍在行 feedback 上）。
      this.deps.log?.(
        `[Pod] reject feedback record failed for ${goalId}#${reopened.revision}`
        + ` (non-fatal): ${err?.message ?? err}`,
      );
    }

    let sessionID: string | null = null;
    let sessionError: string | undefined;
    try {
      sessionID = (await this.deps.techLead?.ensureSession(goalId)) ?? null;
    } catch (err: any) {
      sessionError = String(err?.message ?? err);
      this.deps.log?.(
        `[Pod] Tech Lead session restore failed for ${goalId}#${reopened.revision}: ${sessionError}`,
      );
    }

    this.deps.notify(podId, 'revision', goalId);
    return {
      podId,
      goalId,
      revision: reopened.revision,
      status: 'discussing',
      priority: reopened.priority,
      feedback: reason,
      archivedState: reopened.archivedState,
      previous: reopened.previous,
      sessionID,
      ...(sessionError ? { sessionError } : {}),
    };
  }

  list(podId: string): PodGoalRow[] {
    return this.deps.store.listGoals(podId);
  }

  private requireGoalRow(podId: string, goalId: string): PodGoalRow {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    const row = this.deps.store.getGoal(podId, goalId);
    if (!row) throw new PodError(404, `goal not found: ${goalId}`);
    return row;
  }

  private queueReasonFor(pod: PodRow, row: PodGoalRow): PodQueueReason | undefined {
    if (pod.status === 'paused') return 'paused';
    if (pod.status === 'archived') return 'archived';

    const budget = this.deps.budget?.canStart(pod.id);
    if (budget && !budget.ok) return 'budget';
    if (row.status === 'queued') {
      return this.deps.store.getActiveGoal(pod.id) ? 'active_goal' : undefined;
    }
    return undefined;
  }
}

function normalizeVerdict(value: string | undefined): PodGoalVerdict | undefined {
  if (value === 'PASS' || value === 'FAIL' || value === 'MAX_RETRIES' || value === 'ERROR' || value === 'CANCELLED') {
    return value;
  }
  return undefined;
}
