import * as fs from 'fs';
import * as path from 'path';
import { editWaveTask } from '../goal/wave-plan-edit';
import {
  PodError,
  PodStore,
  type PodTaskRow,
  type PodTaskStatus,
} from './pod-store';

export interface WavePlan {
  waves: Array<{ id: string; title?: string; tasks: Array<string | { title: string; acceptance?: string[] }> }>;
}

export interface GoalReceipt {
  receipts: Array<{
    taskId: string;
    status: 'done' | 'failed' | 'skipped';
    summary?: string;
    files?: string[];
  }>;
}

export interface PodGoalPlanRef {
  wavesPath: string;
  nextAction: string;
  nodeSession: unknown | null;
}

export interface PodTaskServiceDeps {
  store: PodStore;
  now(): string;
  newId(): string;
  notify(podId: string): void;
  /** 计划文件定位（编辑计划任务用）；缺省时 editPlanTask 全部 404。 */
  resolveGoalPlan?(goalId: string): PodGoalPlanRef | null;
}

const TERMINAL_ACTIONS = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED']);

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
      wave.tasks.forEach((raw, index) => {
        const title = typeof raw === 'string'
          ? raw
          : String((raw as any)?.title ?? '').trim();
        if (!title) return;
        const acceptance = raw && typeof raw === 'object' && Array.isArray((raw as any).acceptance)
          ? (raw as any).acceptance.map((item: unknown) => String(item)).filter((item: string) => item.trim())
          : [];
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
          acceptanceJson: acceptance.length > 0 ? JSON.stringify(acceptance) : null,
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
      const status: PodTaskStatus = item.status === 'done' ? 'review' : 'failed';
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

  /**
   * 计划任务编辑（v1：标题 + 验收）：写回 waves.json 后重新投影。
   * 门：goal 未终止、无节点在跑；任务必须是 waves 投影出来的（有 goalId + externalTaskId）。
   */
  editPlanTask(
    podId: string,
    taskId: string,
    patch: { title?: string; acceptance?: string[] },
  ): PodTaskRow {
    const task = this.deps.store.getTask(taskId);
    if (!task || task.podId !== podId) throw new PodError(404, `task not found: ${taskId}`);
    if (!task.goalId || !task.externalTaskId) {
      throw new PodError(400, 'only plan-projected tasks can be edited');
    }
    if (patch.title !== undefined && String(patch.title).trim() === '') {
      throw new PodError(400, 'task title is required');
    }
    if (patch.acceptance !== undefined && !Array.isArray(patch.acceptance)) {
      throw new PodError(400, 'acceptance must be a string array');
    }

    const goal = this.deps.resolveGoalPlan?.(task.goalId);
    if (!goal) throw new PodError(404, `goal plan not found for ${task.goalId}`);
    if (TERMINAL_ACTIONS.has(goal.nextAction)) throw new PodError(409, 'goal is closed');
    if (goal.nodeSession) throw new PodError(409, 'goal is running; wait for the node to finish');
    if (!fs.existsSync(goal.wavesPath)) throw new PodError(404, 'waves.json not found');

    let plan: unknown;
    try {
      plan = JSON.parse(fs.readFileSync(goal.wavesPath, 'utf-8'));
    } catch {
      throw new PodError(422, 'malformed waves.json');
    }
    const next = editWaveTask(plan, task.externalTaskId, {
      title: patch.title,
      acceptance: patch.acceptance,
    });
    if (!next) throw new PodError(404, `task ${task.externalTaskId} not found in plan`);

    const tmp = `${goal.wavesPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(tmp, goal.wavesPath);

    this.projectWaves(podId, task.goalId, next as WavePlan);
    this.deps.notify(podId);
    return this.deps.store.getTask(taskId)!;
  }

  /**
   * Review rubric 收口：按每个任务的结果落状态（pass→done / fail→reopened / skipped→failed）。
   * 幂等：当前状态已等于目标则跳过；未知 taskId 忽略。
   */
  applyReviewResults(
    podId: string,
    goalId: string,
    results: Array<{ taskId: string; result: 'pass' | 'fail' | 'skipped' }>,
  ): PodTaskRow[] {
    if (!Array.isArray(results) || results.length === 0) return [];
    const wanted = new Map<string, PodTaskStatus>();
    for (const item of results) {
      if (!item || typeof item.taskId !== 'string') continue;
      wanted.set(item.taskId, item.result === 'pass' ? 'done' : item.result === 'fail' ? 'reopened' : 'failed');
    }
    if (wanted.size === 0) return [];
    const updated: PodTaskRow[] = [];
    for (const task of this.deps.store.listTasks(podId, goalId)) {
      const target = task.externalTaskId ? wanted.get(task.externalTaskId) : undefined;
      if (!target) continue;
      this.deps.store.updateTask(task.id, { status: target }, this.deps.now());
      updated.push(this.deps.store.getTask(task.id)!);
    }
    if (updated.length > 0) this.deps.notify(podId);
    return updated;
  }

  reopenForReview(podId: string, goalId: string): PodTaskRow[] {
    const tasks = this.deps.store.listTasks(podId, goalId)
      .filter((task) => task.status === 'in_progress' || task.status === 'review' || task.status === 'done');
    for (const task of tasks) {
      this.deps.store.updateTask(task.id, { status: 'reopened' }, this.deps.now());
    }
    if (tasks.length > 0) this.deps.notify(podId);
    return this.list(podId, goalId).filter((task) => task.status === 'reopened');
  }

  startExecution(podId: string, goalId: string): PodTaskRow[] {
    const tasks = this.deps.store.listTasks(podId, goalId)
      .filter((task) => task.status === 'pending' || task.status === 'reopened');
    for (const task of tasks) {
      this.deps.store.updateTask(task.id, { status: 'in_progress' }, this.deps.now());
    }
    if (tasks.length > 0) this.deps.notify(podId);
    return this.list(podId, goalId);
  }

  clearProjected(podId: string, goalId: string): void {
    const removed = this.deps.store.deleteProjectedTasks(podId, goalId);
    if (removed > 0) this.deps.notify(podId);
  }

  reconcileArchive(podId: string, goalId: string, ok: boolean): void {
    const open = new Set<PodTaskStatus>(['pending', 'in_progress', 'blocked', 'review', 'reopened']);
    const tasks = this.deps.store.listTasks(podId, goalId).filter((task) => open.has(task.status));
    for (const task of tasks) {
      this.deps.store.updateTask(task.id, { status: ok ? 'done' : 'failed' }, this.deps.now());
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
