import {
  PodError,
  PodStore,
  type PodTaskRow,
  type PodTaskStatus,
} from './pod-store';

export interface WavePlan {
  waves: Array<{ id: string; title?: string; tasks: string[] }>;
}

export interface GoalReceipt {
  receipts: Array<{
    taskId: string;
    status: 'done' | 'failed' | 'skipped';
    summary?: string;
    files?: string[];
  }>;
}

export interface PodTaskServiceDeps {
  store: PodStore;
  now(): string;
  newId(): string;
  notify(podId: string): void;
}

const ALLOWED_TRANSITIONS: Record<PodTaskStatus, PodTaskStatus[]> = {
  pending: ['in_progress', 'blocked', 'reopened'],
  in_progress: ['review', 'blocked', 'done', 'failed', 'reopened'],
  blocked: ['in_progress', 'failed'],
  review: ['done', 'reopened'],
  reopened: ['in_progress', 'failed'],
  done: [],
  failed: [],
};

export class PodTaskService {
  constructor(private readonly deps: PodTaskServiceDeps) {}

  projectWaves(podId: string, goalId: string, plan: WavePlan): PodTaskRow[] {
    if (!plan || !Array.isArray(plan.waves)) {
      throw new PodError(400, 'invalid wave plan');
    }
    const tasks: PodTaskRow[] = [];
    for (const wave of plan.waves) {
      if (!wave || typeof wave.id !== 'string' || !Array.isArray(wave.tasks)) {
        throw new PodError(400, 'invalid wave');
      }
      wave.tasks.forEach((title, index) => {
        const sourceKey = `wave:${wave.id}:task:${index}`;
        const task = this.deps.store.upsertTask({
          id: this.deps.newId(),
          podId,
          goalId,
          sourceKey,
          externalTaskId: `${wave.id}-t${index + 1}`,
          title,
          description: null,
          ownerMemberId: null,
          status: 'pending',
          dependenciesJson: null,
          artifactRefsJson: null,
          now: this.deps.now(),
        });
        tasks.push(task);
      });
    }
    if (tasks.length > 0) this.deps.notify(podId);
    return tasks;
  }

  applyReceipt(podId: string, goalId: string, receipt: GoalReceipt): PodTaskRow[] {
    if (!receipt || !Array.isArray(receipt.receipts)) {
      throw new PodError(400, 'invalid goal receipt');
    }
    const byExternal = new Map(
      this.deps.store.listTasks(podId, goalId)
        .filter((task) => task.externalTaskId)
        .map((task) => [task.externalTaskId!, task]),
    );
    const updated: PodTaskRow[] = [];
    for (const item of receipt.receipts) {
      const task = byExternal.get(item.taskId);
      if (!task) continue;
      const status: PodTaskStatus = item.status === 'done' ? 'done' : 'failed';
      const files = item.files ?? [];
      const existingFiles = parseStringArray(task.artifactRefsJson);
      const mergedFiles = Array.from(new Set([...existingFiles, ...files]));
      this.deps.store.updateTask(task.id, {
        status,
        artifactRefsJson: mergedFiles.length > 0 ? JSON.stringify(mergedFiles) : task.artifactRefsJson,
      }, this.deps.now());
      updated.push(this.deps.store.getTask(task.id)!);
    }
    if (updated.length > 0) this.deps.notify(podId);
    return updated;
  }

  createManual(podId: string, goalId: string | null, title: string, ownerMemberId?: string): PodTaskRow {
    if (!title.trim()) throw new PodError(400, 'manual task title is required');
    const task = this.deps.store.upsertTask({
      id: this.deps.newId(),
      podId,
      goalId,
      sourceKey: `manual:${this.deps.newId()}`,
      externalTaskId: null,
      title: title.trim(),
      description: null,
      ownerMemberId: ownerMemberId ?? null,
      status: 'pending',
      dependenciesJson: null,
      artifactRefsJson: null,
      now: this.deps.now(),
    });
    this.deps.notify(podId);
    return task;
  }

  updateTask(
    podId: string,
    taskId: string,
    patch: { status?: PodTaskStatus; ownerMemberId?: string },
  ): PodTaskRow {
    const task = this.deps.store.getTask(taskId);
    if (!task || task.podId !== podId) throw new PodError(404, `task not found: ${taskId}`);
    if (patch.status && patch.status !== task.status) {
      const allowed = ALLOWED_TRANSITIONS[task.status] ?? [];
      if (!allowed.includes(patch.status)) {
        throw new PodError(409, `illegal task transition: ${task.status} -> ${patch.status}`);
      }
    }
    this.deps.store.updateTask(taskId, patch, this.deps.now());
    this.deps.notify(podId);
    return this.deps.store.getTask(taskId)!;
  }

  reopenForReview(podId: string, goalId: string): PodTaskRow[] {
    const tasks = this.deps.store.listTasks(podId, goalId)
      .filter((task) => task.status === 'in_progress' || task.status === 'done');
    for (const task of tasks) {
      this.deps.store.updateTask(task.id, { status: 'reopened' }, this.deps.now());
    }
    if (tasks.length > 0) this.deps.notify(podId);
    return this.list(podId, goalId).filter((task) => task.status === 'reopened');
  }

  reconcileArchive(podId: string, goalId: string, ok: boolean): void {
    if (ok) return;
    const open = new Set<PodTaskStatus>(['pending', 'in_progress', 'blocked', 'review', 'reopened']);
    const tasks = this.deps.store.listTasks(podId, goalId).filter((task) => open.has(task.status));
    for (const task of tasks) {
      this.deps.store.updateTask(task.id, { status: 'failed' }, this.deps.now());
    }
    if (tasks.length > 0) this.deps.notify(podId);
  }

  list(podId: string, goalId?: string): PodTaskRow[] {
    return this.deps.store.listTasks(podId, goalId);
  }
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
