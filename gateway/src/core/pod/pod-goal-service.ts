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
      return { status: existing.status === 'active' ? 'started' : 'queued', podId: pod.id };
    }

    const row = this.deps.store.enqueueGoal({
      id: this.deps.newId(),
      podId: pod.id,
      goalId,
      now: this.deps.now(),
    });
    const active = this.deps.store.getActiveGoal(pod.id);
    const budget = this.deps.budget?.canStart(pod.id);
    if (pod.status === 'paused' || !!active || (budget && !budget.ok)) {
      this.deps.notify(pod.id);
      return { status: 'queued', podId: pod.id };
    }

    this.deps.store.setGoalStatus(row.id, 'active', { startedAt: this.deps.now() });
    this.deps.store.updatePod(pod.id, { status: 'active', activeGoalId: goalId }, this.deps.now());
    await this.deps.startGoal(goalId, pod.projectDir);
    this.deps.notify(pod.id);
    return { status: 'started', podId: pod.id };
  }

  async onGoalArchived(goalId: string): Promise<void> {
    const goal = this.deps.store.getGoalByGoalId(goalId);
    if (!goal) return;
    this.deps.store.setGoalStatus(goal.id, 'done', { endedAt: this.deps.now() });
    const pod = this.deps.store.getPod(goal.podId);
    if (!pod) return;

    this.deps.store.updatePod(pod.id, {
      activeGoalId: null,
      status: pod.status === 'paused' ? 'paused' : 'idle',
    }, this.deps.now());
    if (pod.status !== 'paused') {
      const next = this.deps.store.listGoals(pod.id).find((candidate) => candidate.status === 'queued');
      if (next) {
        this.deps.store.setGoalStatus(next.id, 'active', { startedAt: this.deps.now() });
        this.deps.store.updatePod(pod.id, { status: 'active', activeGoalId: next.goalId }, this.deps.now());
        await this.deps.startGoal(next.goalId, pod.projectDir);
      }
    }
    this.deps.notify(pod.id);
  }

  list(podId: string): PodGoalRow[] {
    return this.deps.store.listGoals(podId);
  }
}
