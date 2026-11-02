import * as fs from 'fs';
import * as path from 'path';
import {
  addWaveTask,
  deleteWaveTask,
  editWaveTask,
  ensureWaveTaskIds,
  taskIdAt,
} from '../goal/wave-plan-edit';
import {
  PodError,
  PodStore,
  type PodTaskRow,
  type PodTaskStatus,
} from './pod-store';

export type PodTaskKind = 'plan' | 'note' | 'external_request';
export type PodTaskView = PodTaskRow & { kind: PodTaskKind };

export function podTaskKindOf(
  task: Pick<PodTaskRow, 'sourceKey' | 'goalId' | 'externalTaskId'>,
): PodTaskKind {
  if (task.goalId && task.externalTaskId) return 'plan';
  if (task.sourceKey.startsWith('manual:')) return 'note';
  return 'external_request';
}

function withKind(task: PodTaskRow): PodTaskView {
  return { ...task, kind: podTaskKindOf(task) };
}

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
  /**
   * Task 13：计划内容被改写（编辑/新增/删除）→ 刷新或失效 planApproval 的绑定哈希。
   * 缺省不接线；approve 侧仍会按 hash 复核，所以这里 fail-open 不会放过旧批准。
   */
  invalidatePlanApproval?(goalId: string): void;
}

const TERMINAL_ACTIONS = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED']);

const ALLOWED_TRANSITIONS: Record<PodTaskStatus, PodTaskStatus[]> = {
  pending: ['in_progress', 'blocked', 'reopened'],
  in_progress: ['review', 'blocked', 'done', 'failed', 'reopened'],
  blocked: ['in_progress', 'failed'],
  review: ['done', 'reopened'],
  reopened: ['in_progress', 'failed'],
  done: [],
  skipped: [],
  failed: [],
};

export class PodTaskService {
  constructor(private readonly deps: PodTaskServiceDeps) {}

  projectWaves(podId: string, goalId: string, plan: WavePlan): PodTaskView[] {
    if (!plan || !Array.isArray(plan.waves)) {
      throw new PodError(400, 'invalid wave plan');
    }
    const tasks: PodTaskView[] = [];
    for (const wave of plan.waves) {
      if (!wave || typeof wave.id !== 'string' || !Array.isArray(wave.tasks)) {
        throw new PodError(400, 'invalid wave');
      }
      wave.tasks.forEach((raw, index) => {
        const title = typeof raw === 'string'
          ? raw
          : String((raw as any)?.title ?? '').trim();
        if (!title) return;
        const explicitId = typeof (raw as any)?.taskId === 'string' ? (raw as any).taskId.trim() : '';
        const externalTaskId = taskIdAt(wave, raw, index) ?? `${wave.id}-t${index + 1}`;
        // legacy 计划（无 taskId）继续用位置 key，避免给已有投影制造重复行；
        // 结构编辑补 id 后由 migrateLegacyTaskKeys 统一迁移。
        const sourceKey = explicitId
          ? `wave:${wave.id}:task:${externalTaskId}`
          : `wave:${wave.id}:task:${index}`;
        const acceptance = raw && typeof raw === 'object' && Array.isArray((raw as any).acceptance)
          ? (raw as any).acceptance.map((item: unknown) => String(item)).filter((item: string) => item.trim())
          : [];
        const task = this.deps.store.upsertTask({
          id: this.deps.newId(),
          podId,
          goalId,
          sourceKey,
          externalTaskId,
          title,
          description: null,
          ownerMemberId: null,
          status: 'pending',
          dependenciesJson: null,
          artifactRefsJson: null,
          acceptanceJson: acceptance.length > 0 ? JSON.stringify(acceptance) : null,
          now: this.deps.now(),
        });
        tasks.push(withKind(task));
      });
    }
    if (tasks.length > 0) this.deps.notify(podId);
    return tasks;
  }

  applyReceipt(podId: string, goalId: string, receipt: GoalReceipt): PodTaskView[] {
    if (!receipt || !Array.isArray(receipt.receipts)) {
      throw new PodError(400, 'invalid goal receipt');
    }
    const byExternal = new Map(
      this.deps.store.listTasks(podId, goalId)
        .filter((task) => task.externalTaskId)
        .map((task) => [task.externalTaskId!, task]),
    );
    const updated: PodTaskView[] = [];
    for (const item of receipt.receipts) {
      const task = byExternal.get(item.taskId);
      if (!task) continue;
      const status: PodTaskStatus = item.status === 'done'
        ? 'review'
        : item.status === 'skipped'
          ? 'skipped'
          : 'failed';
      const files = item.files ?? [];
      const existingFiles = parseStringArray(task.artifactRefsJson);
      const mergedFiles = Array.from(new Set([...existingFiles, ...files]));
      this.deps.store.updateTask(task.id, {
        status,
        artifactRefsJson: mergedFiles.length > 0 ? JSON.stringify(mergedFiles) : task.artifactRefsJson,
      }, this.deps.now());
      updated.push(withKind(this.deps.store.getTask(task.id)!));
    }
    if (updated.length > 0) this.deps.notify(podId);
    return updated;
  }

  createManual(podId: string, goalId: string | null, title: string, ownerMemberId?: string): PodTaskView {
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
    return withKind(task);
  }

  /** Rename a note, or route a plan task rename through the wave plan. */
  editTitle(podId: string, taskId: string, title: string): PodTaskView {
    const value = String(title ?? '').trim();
    if (!value) throw new PodError(400, 'task title is required');
    const task = this.deps.store.getTask(taskId);
    if (!task || task.podId !== podId) throw new PodError(404, `task not found: ${taskId}`);
    if (podTaskKindOf(task) === 'plan') {
      return this.editPlanTask(podId, taskId, { title: value });
    }
    if (podTaskKindOf(task) !== 'note') {
      throw new PodError(400, 'external requests cannot be renamed');
    }
    this.deps.store.updateTask(taskId, { title: value }, this.deps.now());
    this.deps.notify(podId);
    return withKind(this.deps.store.getTask(taskId)!);
  }

  updateTask(
    podId: string,
    taskId: string,
    patch: { status?: PodTaskStatus; ownerMemberId?: string },
  ): PodTaskView {
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
    return withKind(this.deps.store.getTask(taskId)!);
  }

  /**
   * 计划任务编辑（v1：标题 + 验收）：写回 waves.json 后重新投影。
   * 门：goal 未终止、无节点在跑；任务必须是 waves 投影出来的（有 goalId + externalTaskId）。
   */
  editPlanTask(
    podId: string,
    taskId: string,
    patch: { title?: string; acceptance?: string[] },
  ): PodTaskView {
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

    const { wavesPath, plan } = this.loadEditablePlan(task.goalId);
    const next = editWaveTask(plan, task.externalTaskId, {
      title: patch.title,
      acceptance: patch.acceptance,
    });
    if (!next) throw new PodError(404, `task ${task.externalTaskId} not found in plan`);

    this.writePlan(wavesPath, next);
    this.invalidatePlanApproval(task.goalId);
    this.projectWaves(podId, task.goalId, next as WavePlan);
    this.deps.notify(podId);
    return withKind(this.deps.store.getTask(taskId)!);
  }

  /**
   * 追加计划任务（v2）：写回 waves.json（缺 id 的任务先补稳定 id），
   * 迁移 legacy 投影 key 后重新投影，返回新任务行。
   */
  addPlanTask(
    podId: string,
    goalId: string,
    waveId: string | null,
    title: string,
    acceptance?: string[],
  ): PodTaskView {
    if (String(title ?? '').trim() === '') throw new PodError(400, 'task title is required');
    if (acceptance !== undefined && !Array.isArray(acceptance)) {
      throw new PodError(400, 'acceptance must be a string array');
    }
    const { wavesPath, plan } = this.loadEditablePlan(goalId);
    const added = addWaveTask(plan, waveId, { title, acceptance });
    if (!added) throw new PodError(404, `wave not found or plan empty: ${waveId ?? '(last)'}`);

    this.writePlan(wavesPath, added.plan);
    this.invalidatePlanApproval(goalId);
    this.migrateLegacyTaskKeys(podId, goalId);
    this.projectWaves(podId, goalId, added.plan as WavePlan);
    this.deps.notify(podId);
    const row = this.deps.store.listTasks(podId, goalId)
      .find((task) => task.externalTaskId === added.taskId);
    if (!row) throw new PodError(500, `projected task missing after add: ${added.taskId}`);
    return withKind(row);
  }

  /** 删除任务：计划任务写回 waves.json（同门）；手工任务只删行。 */
  deleteTask(podId: string, taskId: string): { goalId: string | null; externalTaskId: string | null } {
    const task = this.deps.store.getTask(taskId);
    if (!task || task.podId !== podId) throw new PodError(404, `task not found: ${taskId}`);
    if (!task.goalId || !task.externalTaskId) {
      this.deps.store.deleteTask(taskId);
      this.deps.notify(podId);
      return { goalId: null, externalTaskId: null };
    }
    const { wavesPath, plan } = this.loadEditablePlan(task.goalId);
    const ensured = ensureWaveTaskIds(plan).plan;
    const deleted = deleteWaveTask(ensured, task.externalTaskId);
    if (!deleted) throw new PodError(404, `task ${task.externalTaskId} not found in plan`);

    this.writePlan(wavesPath, deleted.plan);
    this.invalidatePlanApproval(task.goalId);
    this.migrateLegacyTaskKeys(podId, task.goalId);
    this.projectWaves(podId, task.goalId, deleted.plan as WavePlan);
    this.deps.store.deleteTask(taskId);
    this.deps.notify(podId);
    return { goalId: task.goalId, externalTaskId: task.externalTaskId };
  }

  /** 共用的计划门 + 读取（终态/运行中拒绝，文件缺失/畸形按 404/422）。 */
  private loadEditablePlan(goalId: string): { wavesPath: string; plan: any } {
    const goal = this.deps.resolveGoalPlan?.(goalId);
    if (!goal) throw new PodError(404, `goal plan not found for ${goalId}`);
    if (TERMINAL_ACTIONS.has(goal.nextAction)) throw new PodError(409, 'goal is closed');
    if (goal.nodeSession) throw new PodError(409, 'goal is running; wait for the node to finish');
    if (!fs.existsSync(goal.wavesPath)) throw new PodError(404, 'waves.json not found');
    try {
      return { wavesPath: goal.wavesPath, plan: JSON.parse(fs.readFileSync(goal.wavesPath, 'utf-8')) };
    } catch {
      throw new PodError(422, 'malformed waves.json');
    }
  }

  private writePlan(wavesPath: string, plan: unknown): void {
    const tmp = `${wavesPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(plan, null, 2), 'utf-8');
    fs.renameSync(tmp, wavesPath);
  }

  /** Task 13：计划改写后让批准绑定失效（fail-open——approve 侧还会按 hash 复核）。 */
  private invalidatePlanApproval(goalId: string | null): void {
    if (!goalId) return;
    try { this.deps.invalidatePlanApproval?.(goalId); } catch { /* fail-open */ }
  }

  /** legacy 投影 key（`wave:<id>:task:<index>`）→ 稳定 id key；幂等。 */
  private migrateLegacyTaskKeys(podId: string, goalId: string): void {
    for (const task of this.deps.store.listTasks(podId, goalId)) {
      const match = /^wave:(.+):task:(\d+)$/.exec(task.sourceKey);
      if (!match || !task.externalTaskId) continue;
      const next = `wave:${match[1]}:task:${task.externalTaskId}`;
      if (next !== task.sourceKey) this.deps.store.updateTaskSourceKey(task.id, next);
    }
  }

  /**
   * Review rubric 收口：按每个任务的结果落状态（pass→done / fail→reopened / skipped→failed）。
   * 幂等：当前状态已等于目标则跳过；未知 taskId 忽略。
   */
  applyReviewResults(
    podId: string,
    goalId: string,
    results: Array<{ taskId: string; result: 'pass' | 'fail' | 'skipped' }>,
  ): PodTaskView[] {
    if (!Array.isArray(results) || results.length === 0) return [];
    const wanted = new Map<string, PodTaskStatus>();
    for (const item of results) {
      if (!item || typeof item.taskId !== 'string') continue;
      wanted.set(item.taskId, item.result === 'pass' ? 'done' : item.result === 'fail' ? 'reopened' : 'skipped');
    }
    if (wanted.size === 0) return [];
    const updated: PodTaskView[] = [];
    for (const task of this.deps.store.listTasks(podId, goalId)) {
      const target = task.externalTaskId ? wanted.get(task.externalTaskId) : undefined;
      if (!target) continue;
      this.deps.store.updateTask(task.id, { status: target }, this.deps.now());
      updated.push(withKind(this.deps.store.getTask(task.id)!));
    }
    if (updated.length > 0) this.deps.notify(podId);
    return updated;
  }

  reopenForReview(podId: string, goalId: string): PodTaskView[] {
    const tasks = this.deps.store.listTasks(podId, goalId)
      .filter((task) => task.status === 'in_progress' || task.status === 'review');
    for (const task of tasks) {
      this.deps.store.updateTask(task.id, { status: 'reopened' }, this.deps.now());
    }
    if (tasks.length > 0) this.deps.notify(podId);
    return this.list(podId, goalId).filter((task) => task.status === 'reopened');
  }

  startExecution(podId: string, goalId: string): PodTaskView[] {
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

  list(podId: string, goalId?: string): PodTaskView[] {
    return this.deps.store.listTasks(podId, goalId).map(withKind);
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
