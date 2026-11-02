import { PodError, PodStore, isTerminalGoalRevisionStatus, type PodGoalRow, type PodRow } from './pod-store';
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

export interface PodEnqueueResult {
  status: 'started' | 'queued';
  podId: string;
  queueReason: PodQueueReason | null;
}

export interface PodGoalServiceDeps {
  store: PodStore;
  pods: PodService;
  startGoal(goalId: string, projectDirHint?: string): Promise<void>;
  advanceGoal?(goalId: string): Promise<void>;
  resolveProjectDir(goalId: string): string | null;
  now(): string;
  newId(): string;
  notify(podId: string): void;
  budget?: { canStart(podId: string): { ok: boolean; spentUsd: number; limitUsd: number } };
  goalState?(goalId: string): { terminal: boolean; verdict?: string } | null;
  describeGoal?(goalId: string): PodGoalDescription | null;
  resultForGoal?(goalId: string): PodGoalResult | null;
  listInFlightGoals?(projectDir: string): string[];
  listRegisteredProjectDirs?(): string[];
  finalizeGoal?(goalId: string, outcome?: { verdict?: string }): Promise<void>;
  log?(message: string): void;
}

export class PodGoalService {
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
      if (existing.status === 'active') return { status: 'started', podId: pod.id, queueReason: null };
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
    return { status: 'started', podId: pod.id, queueReason: null };
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
    return this.deps.store.listGoals(podId).map((row) => buildPodGoalView(
      row,
      this.describeGoal(row.goalId),
      this.queueReasonFor(pod, row),
    ));
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

  list(podId: string): PodGoalRow[] {
    return this.deps.store.listGoals(podId);
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
