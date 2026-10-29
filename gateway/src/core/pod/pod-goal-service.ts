import { PodError, PodStore, type PodGoalRow } from './pod-store';
import type { PodService } from './pod-service';

export interface PodGoalServiceDeps {
  store: PodStore;
  pods: PodService;
  startGoal(goalId: string, projectDirHint?: string): Promise<void>;
  resolveProjectDir(goalId: string): string | null;
  now(): string;
  newId(): string;
  notify(podId: string): void;
  budget?: { canStart(podId: string): { ok: boolean; spentUsd: number; limitUsd: number } };
}

export class PodGoalService {
  constructor(private readonly deps: PodGoalServiceDeps) {}

  async enqueueGoal(
    goalId: string,
    projectDirHint?: string,
  ): Promise<{ status: 'started' | 'queued'; podId: string }> {
    const projectDir = projectDirHint ?? this.deps.resolveProjectDir(goalId);
    if (!projectDir) throw new PodError(400, `project not resolved for goal: ${goalId}`);
    const detail = await this.deps.pods.ensure(projectDir);
    const pod = detail.pod;
    const existing = this.deps.store.getGoal(pod.id, goalId);
    if (existing) {
      if (existing.status === 'active') return { status: 'started', podId: pod.id };
      if (existing.status === 'queued' && !this.deps.store.getActiveGoal(pod.id)
        && pod.status !== 'paused' && pod.status !== 'archived') {
        const budget = this.deps.budget?.canStart(pod.id);
        if (!budget || budget.ok) await this.promote(pod.id);
        const current = this.deps.store.getGoal(pod.id, goalId);
        return { status: current?.status === 'active' ? 'started' : 'queued', podId: pod.id };
      }
      return { status: 'queued', podId: pod.id };
    }

    const row = this.deps.store.enqueueGoal({
      id: this.deps.newId(),
      podId: pod.id,
      goalId,
      now: this.deps.now(),
    });
    const active = this.deps.store.getActiveGoal(pod.id);
    const budget = this.deps.budget?.canStart(pod.id);
    if (pod.status === 'paused' || pod.status === 'archived' || !!active || (budget && !budget.ok)) {
      this.deps.notify(pod.id);
      return { status: 'queued', podId: pod.id };
    }

    await this.startQueued(row.id, pod.id, goalId, pod.projectDir, false);
    this.deps.notify(pod.id);
    return { status: 'started', podId: pod.id };
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
    const nextStatus = outcome?.verdict === 'CANCELLED' ? 'aborted' : 'done';
    this.deps.store.setGoalStatus(goal.id, nextStatus, { endedAt: this.deps.now() });
    if (!wasActive) {
      this.deps.notify(pod.id);
      return;
    }

    this.deps.store.updatePod(pod.id, {
      activeGoalId: null,
      status: pod.status === 'paused' ? 'paused' : 'idle',
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
    const next = this.deps.store.listGoals(podId).find((candidate) => candidate.status === 'queued');
    if (!next) return false;
    const budget = this.deps.budget?.canStart(podId);
    if (budget && !budget.ok) return false;
    await this.startQueued(next.id, podId, next.goalId, pod.projectDir, false);
    this.deps.notify(podId);
    return true;
  }

  private async startQueued(
    rowId: string,
    podId: string,
    goalId: string,
    projectDir: string,
    paused: boolean,
  ): Promise<void> {
    this.deps.store.setGoalStatus(rowId, 'active', { startedAt: this.deps.now() });
    this.deps.store.updatePod(podId, {
      status: paused ? 'paused' : 'active',
      activeGoalId: goalId,
    }, this.deps.now());
    try {
      await this.deps.startGoal(goalId, projectDir);
    } catch (err) {
      this.deps.store.setGoalStatus(rowId, 'queued', {});
      this.deps.store.updatePod(podId, {
        status: paused ? 'paused' : 'idle',
        activeGoalId: null,
      }, this.deps.now());
      throw err;
    }
  }

  list(podId: string): PodGoalRow[] {
    return this.deps.store.listGoals(podId);
  }
}
