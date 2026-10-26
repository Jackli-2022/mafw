import type { RuntimeClient } from './contract';
import type { OutputSchemaSpec } from './structured-output';
import { TaskStore } from './task-store';

export type TaskKind = 'shell' | 'subagent';
export type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export interface TaskEntity {
  id: string;
  kind: TaskKind;
  parentSessionID: string;
  childSessionID?: string;
  shellID?: string;
  title: string;
  status: TaskStatus;
  directory?: string;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  exitCode?: number;
  error?: string;
  metadata?: Record<string, unknown>;
  /** 终态 shell 的有界输出快照（内部持久化，API/SSE 不返回全文）。 */
  output?: string;
  outputCursor?: number;
  outputSize?: number;
  outputTruncated?: boolean;
  /** 续聊后等待新回合完成的门槛（child idleAt >= resumeAt 才算完成）。 */
  resumeAt?: number;
}

export interface TaskSubmitOpts {
  kind: TaskKind;
  parentSessionID: string;
  title?: string;
  command?: string;
  cwd?: string;
  timeout?: number;
  prompt?: string;
  agent?: string;
  description?: string;
  model?: { providerID: string; modelID: string };
  outputSchema?: OutputSchemaSpec;
}

export interface TaskServiceDeps {
  storeDir: string;
  shell?: NonNullable<RuntimeClient['shell']>;
  spawnSubagent(opts: {
    parentID: string;
    prompt: string;
    agent?: string;
    description?: string;
    background?: boolean;
    model?: { providerID: string; modelID: string };
    outputSchema?: OutputSchemaSpec;
  }): Promise<{ id: string; status?: string; error?: string }>;
  cancelSubagent(parentID: string, childID: string): Promise<void>;
  messageSubagent(parentID: string, childID: string, text: string): Promise<void>;
  getSession(sessionID: string): Promise<any>;
  pendingInput?(sessionID: string, directory?: string): Promise<boolean>;
  emit(task: TaskEntity): void;
  now?: () => number;
}

export class TaskError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const ACTIVE: TaskStatus[] = ['working', 'input_required'];

export class TaskService {
  private tasks = new Map<string, TaskEntity>();
  private store: TaskStore;
  private timer: NodeJS.Timeout | null = null;
  private initialized = false;
  private readonly now: () => number;

  constructor(private readonly deps: TaskServiceDeps) {
    this.store = new TaskStore(deps.storeDir);
    this.now = deps.now ?? Date.now;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    for (const task of this.store.loadAll()) this.tasks.set(task.id, task);
    for (const task of this.tasks.values()) {
      if (ACTIVE.includes(task.status)) await this.refresh(task);
    }
  }

  async start(): Promise<void> {
    await this.init();
    if (this.timer) return;
    this.timer = setInterval(() => { void this.poll(); }, 2000);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 测试/运维：立即跑一轮状态刷新（不启动定时器）。 */
  async refreshOnce(): Promise<void> {
    await this.poll();
  }

  async submit(opts: TaskSubmitOpts): Promise<TaskEntity> {
    if (opts.kind !== 'shell' && opts.kind !== 'subagent') throw new TaskError(400, 'kind must be shell|subagent');
    if (!opts.parentSessionID) throw new TaskError(400, 'parentSessionID is required');
    const parent = await this.deps.getSession(opts.parentSessionID).catch(() => null);
    if (!parent) throw new TaskError(404, `parent session not found: ${opts.parentSessionID}`);
    const directory = parent.directory || parent.location?.directory;
    const now = this.now();
    const id = `task_${now}_${Math.random().toString(36).slice(2, 8)}`;

    let task: TaskEntity;
    if (opts.kind === 'shell') {
      if (!opts.command?.trim()) throw new TaskError(400, 'command is required');
      if (!this.deps.shell) throw new TaskError(503, 'shell task API not available on this runtime');
      const info = await this.deps.shell.create({
        command: opts.command,
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(typeof opts.timeout === 'number' ? { timeout: opts.timeout } : {}),
        metadata: { taskID: id, parentSessionID: opts.parentSessionID },
        ...(directory ? { directory } : {}),
      });
      const shellID = info?.id;
      if (!shellID) throw new TaskError(502, 'runtime did not return a shell id');
      task = {
        id, kind: 'shell', parentSessionID: opts.parentSessionID, shellID,
        title: opts.title || opts.command, status: 'working',
        ...(directory ? { directory } : {}),
        createdAt: now, updatedAt: now,
        metadata: { command: opts.command },
      };
    } else {
      if (!opts.prompt?.trim()) throw new TaskError(400, 'prompt is required');
      const rec = await this.deps.spawnSubagent({
        parentID: opts.parentSessionID,
        prompt: opts.prompt,
        ...(opts.agent ? { agent: opts.agent } : {}),
        ...(opts.description ? { description: opts.description } : {}),
        background: true,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.outputSchema ? { outputSchema: opts.outputSchema } : {}),
      });
      if (!rec?.id) throw new TaskError(502, 'runtime did not return a child session id');
      const failed = rec.status === 'failed';
      task = {
        id, kind: 'subagent', parentSessionID: opts.parentSessionID, childSessionID: rec.id,
        title: opts.title || opts.description || 'Subagent',
        status: failed ? 'failed' : 'working',
        ...(directory ? { directory } : {}),
        createdAt: now, updatedAt: now,
        ...(failed ? { finishedAt: now, error: rec.error ?? 'spawn failed' } : {}),
      };
    }

    this.tasks.set(task.id, task);
    this.persist(task);
    this.emit(task);
    return this.publicTask(task);
  }

  list(query?: { parentSessionID?: string; status?: string }): TaskEntity[] {
    return [...this.tasks.values()]
      .filter((t) => !query?.parentSessionID || t.parentSessionID === query.parentSessionID)
      .filter((t) => !query?.status || t.status === query.status)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((t) => this.publicTask(t));
  }

  get(id: string): TaskEntity | undefined {
    const task = this.tasks.get(id);
    return task ? this.publicTask(task) : undefined;
  }

  async cancel(id: string): Promise<TaskEntity> {
    const task = this.tasks.get(id);
    if (!task) throw new TaskError(404, `task not found: ${id}`);
    if (!ACTIVE.includes(task.status)) return this.publicTask(task);
    this.transition(task, 'cancelled');
    try {
      if (task.kind === 'shell' && task.shellID && this.deps.shell) {
        await this.deps.shell.remove({ shellID: task.shellID, ...(task.directory ? { directory: task.directory } : {}) });
      } else if (task.kind === 'subagent' && task.childSessionID) {
        await this.deps.cancelSubagent(task.parentSessionID, task.childSessionID);
      }
    } catch (err: any) {
      task.error = err?.message ?? String(err);
      this.persist(task);
    }
    return this.publicTask(task);
  }

  async message(id: string, message: string): Promise<void> {
    if (!message?.trim()) throw new TaskError(400, 'message is required');
    const task = this.tasks.get(id);
    if (!task) throw new TaskError(404, `task not found: ${id}`);
    if (task.kind !== 'subagent' || !task.childSessionID) {
      throw new TaskError(400, 'message is only supported for subagent tasks');
    }
    await this.deps.messageSubagent(task.parentSessionID, task.childSessionID, message);
    // 续聊 = 同一 child 的新回合：终态任务回到 working，poller 继续跟踪。
    // resumeAt 防「message 刚入队、child 仍是旧 idle」被误判 completed。
    if (!ACTIVE.includes(task.status)) {
      task.resumeAt = this.now();
      this.transition(task, 'working');
    }
  }

  async output(id: string, opts?: { cursor?: number; limit?: number }): Promise<any> {
    const task = this.tasks.get(id);
    if (!task) throw new TaskError(404, `task not found: ${id}`);
    if (task.kind !== 'shell' || !task.shellID) throw new TaskError(400, 'output is only supported for shell tasks');
    if (!ACTIVE.includes(task.status) && typeof task.output === 'string') {
      return {
        output: task.output,
        cursor: task.outputCursor ?? task.output.length,
        size: task.outputSize ?? task.output.length,
        truncated: task.outputTruncated ?? false,
      };
    }
    if (!this.deps.shell) throw new TaskError(503, 'shell task API not available on this runtime');
    return this.deps.shell.output({
      shellID: task.shellID,
      ...(task.directory ? { directory: task.directory } : {}),
      ...(typeof opts?.cursor === 'number' ? { cursor: opts.cursor } : {}),
      ...(typeof opts?.limit === 'number' ? { limit: opts.limit } : {}),
    });
  }

  private async poll(): Promise<void> {
    for (const task of this.tasks.values()) {
      if (!ACTIVE.includes(task.status)) continue;
      await this.refresh(task).catch(() => {});
    }
  }

  private async refresh(task: TaskEntity): Promise<void> {
    if (!ACTIVE.includes(task.status)) return;
    if (task.kind === 'shell') {
      if (!task.shellID || !this.deps.shell) return this.transition(task, 'failed', 'lost_after_restart');
      let info: any;
      try {
        info = await this.deps.shell.get({
          shellID: task.shellID,
          ...(task.directory ? { directory: task.directory } : {}),
        });
      } catch {
        return this.transition(task, 'failed', 'lost_after_restart');
      }
      const status = info?.status;
      if (!status || status === 'running') return this.transition(task, 'working');
      if (status === 'killed') {
        await this.captureShellOutput(task);
        return this.transition(task, 'cancelled');
      }
      if (status === 'timeout') {
        await this.captureShellOutput(task);
        return this.transition(task, 'failed', 'timeout');
      }
      if (status === 'exited') {
        const exit = Number(info.exit);
        await this.captureShellOutput(task);
        if (Number.isFinite(exit) && exit === 0) return this.transition(task, 'completed');
        task.exitCode = Number.isFinite(exit) ? exit : undefined;
        return this.transition(task, 'failed', Number.isFinite(exit) ? `exit ${exit}` : 'exited without exit code');
      }
      return;
    }

    if (!task.childSessionID) return this.transition(task, 'failed', 'missing child session');
    let info: any;
    try {
      info = await this.deps.getSession(task.childSessionID);
    } catch {
      info = null;
    }
    if (!info) return this.transition(task, 'failed', 'lost_after_restart');
    const idleAt = Number(info.time?.idle ?? info.time?.completed ?? 0);
    const hasIdle = Boolean(info.time?.idle || info.time?.completed);
    const idle = hasIdle && (!task.resumeAt || idleAt >= task.resumeAt);
    if (!idle) {
      const pending = this.deps.pendingInput
        ? await this.deps.pendingInput(task.childSessionID, task.directory).catch(() => false)
        : false;
      return this.transition(task, pending ? 'input_required' : 'working');
    }
    const outcome = info.outcome;
    if (outcome === 'failed') return this.transition(task, 'failed', 'subagent failed');
    if (outcome === 'interrupted') return this.transition(task, 'cancelled');
    return this.transition(task, 'completed');
  }

  /** 终态前抓取有界输出尾快照，shell 记录被 serve 清理后仍可查。 */
  private async captureShellOutput(task: TaskEntity): Promise<void> {
    if (!task.shellID || !this.deps.shell) return;
    const limit = 65536;
    try {
      let out = await this.deps.shell.output({
        shellID: task.shellID,
        ...(task.directory ? { directory: task.directory } : {}),
        limit,
      });
      if (out && Number(out.size) > limit) {
        const tail = await this.deps.shell.output({
          shellID: task.shellID,
          ...(task.directory ? { directory: task.directory } : {}),
          cursor: Math.max(0, Number(out.size) - limit),
          limit,
        });
        if (tail && typeof tail.output === 'string') out = { ...tail, truncated: true };
      }
      if (out && typeof out.output === 'string') {
        const captured = out.output.slice(-limit);
        task.output = captured;
        task.outputCursor = Number.isFinite(Number(out.cursor)) ? Number(out.cursor) : captured.length;
        task.outputSize = Number.isFinite(Number(out.size)) ? Number(out.size) : captured.length;
        task.outputTruncated = out.truncated === true || Number(out.size) > captured.length;
      }
    } catch {
      // Output is best-effort; task status remains authoritative.
    }
  }

  private transition(task: TaskEntity, status: TaskStatus, error?: string): void {
    if (task.status === status && (error === undefined || task.error === error)) return;
    const terminal = !ACTIVE.includes(status);
    task.status = status;
    task.updatedAt = this.now();
    if (terminal) task.finishedAt = task.updatedAt;
    else task.finishedAt = undefined;
    if (error !== undefined) task.error = error;
    else if (ACTIVE.includes(status)) task.error = undefined;
    this.persist(task);
    this.emit(task);
  }

  private persist(task: TaskEntity): void {
    try { this.store.save(task); } catch { /* fail-open: task stays in memory */ }
  }

  private publicTask(task: TaskEntity): TaskEntity {
    const { output: _output, resumeAt: _resumeAt, ...rest } = task;
    return { ...rest };
  }

  private emit(task: TaskEntity): void {
    try { this.deps.emit(this.publicTask(task)); } catch { /* fail-open */ }
  }
}
