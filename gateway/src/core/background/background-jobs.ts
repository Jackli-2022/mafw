/**
 * Task 3：background jobs 三源聚合 —— TaskService（mafw-task）· runtime shell（runtime-shell）
 * · 子代理会话（subagent）→ 单一中性 DTO `MafwBackgroundJob`。
 *
 * 设计（docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md §7.3）：
 *  - 状态机、输出游标、取消语义由 MAFW 定义；runtime 原生 shell DTO 不外泄。
 *  - 同一作业跨源合并按**稳定 id**（task id / shell id / 子会话 id），task 行优先
 *    （task 拥有更完整的生命周期与输出），并保留 `runtimeShellID` / `childSessionID` 定位信息。
 *  - 子代理状态取 `SubagentService` 权威值（failed→failed / aborted→cancelled），
 *    不自行从会话时间推算终态；事件证据只用于补「权威仍未终态」的终态。
 *  - 输出游标与 runtime 对齐为 **UTF-8 字节**（不是 UTF-16 code unit）。
 *  - `session.background`（把阻塞工具转后台）仍是独立动作，不与本查询合并。
 *
 * 事件侧：runtime 的 synthetic shell/subagent 生命周期（旧实现伪装成 user/assistant
 * 消息）经 Ingress 翻译为 canonical `background.job.updated`，由 `BackgroundJobRegistry`
 * 记账（终态不回退），REST 快照仍是对账权威——子代理终态同时接受
 * `SubagentService.list()` 权威行与事件证据（见 `mergeSubagentEvidence`）。
 */
import type { MafwBackgroundJob, MafwBackgroundJobStatus } from '../../runtime/canonical-types';
import type { TaskEntity, TaskService, TaskStatus } from '../../runtime/task-service';
import {
  backgroundJobFromSynthetic,
  backgroundJobStatusOfSubagent,
  isTerminalBackgroundStatus,
  jobFromBackgroundTask,
  jobFromRuntimeShell,
  jobFromSubagent,
  runtimeShellRowFromSynthetic,
  shellRowFromJob,
  sortBackgroundJobs,
  subagentRowFromJob,
} from '@mafw/runtime-core';
import type {
  BackgroundSubagentRow,
  BackgroundSubagentStatus,
  BackgroundTaskRow,
  RuntimeShellRow,
} from '@mafw/runtime-core';

/**
 * 纯事件/行转换助手已迁至 `@mafw/runtime-core`（Plan 6 Task 2）：
 * 状态映射、synthetic 元数据 → job/shell 行、行↔job 往返、排序与 canonical 事件信封。
 * 本模块只保留依赖 TaskService / SubagentService 的聚合与台账实现。
 */
export {
  backgroundJobFromSynthetic,
  backgroundJobEvent,
  backgroundJobStatusOfShell,
  backgroundJobStatusOfSubagent,
  isTerminalBackgroundStatus,
  jobFromBackgroundTask,
  jobFromRuntimeShell,
  jobFromSubagent,
  runtimeShellRowFromSynthetic,
  shellRowFromJob,
  sortBackgroundJobs,
  subagentRowFromJob,
} from '@mafw/runtime-core';
export type { BackgroundSubagentRow, BackgroundSubagentStatus, BackgroundTaskRow, RuntimeShellRow } from '@mafw/runtime-core';

/** 输出读取结果（游标式增量；绝不携带 runtime 原生 output DTO）。 */
export interface MafwBackgroundOutput {
  /** 下一次读取的起点。 */
  cursor: number
  data: string
  truncated: boolean
}

/** 行集合：聚合输入（纯数据，便于单测）。 */
export interface BackgroundRows {
  tasks: TaskEntity[]
  runtimeShells: RuntimeShellRow[]
  subagents: BackgroundSubagentRow[]
  /** runtime-managed tasks that are not child sessions (Claude managed tasks). */
  backgroundTasks?: BackgroundTaskRow[]
}

export class BackgroundJobError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'BackgroundJobError';
  }
}

/** TaskService 状态 → MAFW 状态机（working/input_required 都是「运行中」）。 */
export function backgroundJobStatusOfTask(status: TaskStatus): MafwBackgroundJobStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'working':
    case 'input_required':
    default:
      return 'running';
  }
}

function optionalTime(time?: { created?: number; updated?: number; completed?: number }) {
  if (!time) return undefined;
  const out: { created?: number; updated?: number; completed?: number } = {};
  if (Number.isFinite(time.created)) out.created = time.created;
  if (Number.isFinite(time.updated)) out.updated = time.updated;
  if (Number.isFinite(time.completed)) out.completed = time.completed;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function jobFromTask(task: TaskEntity): MafwBackgroundJob {
  const command = typeof task.metadata?.command === 'string' ? task.metadata.command : undefined;
  const time = optionalTime({
    created: task.createdAt,
    updated: task.updatedAt,
    completed: task.finishedAt,
  });
  return {
    id: task.id,
    source: 'mafw-task',
    kind: task.kind,
    status: backgroundJobStatusOfTask(task.status),
    sessionID: task.parentSessionID,
    taskID: task.id,
    ...(task.title ? { title: task.title } : {}),
    ...(command ? { command } : {}),
    ...(task.shellID ? { runtimeShellID: task.shellID } : {}),
    ...(task.childSessionID ? { childSessionID: task.childSessionID } : {}),
    ...(time ? { time } : {}),
    ...(typeof task.exitCode === 'number' ? { exitCode: task.exitCode } : {}),
    ...(task.error ? { extensions: { error: task.error } } : {}),
  };
}

/** 合并三源 → 中性 jobs（task 行优先；active 在前，updated 降序，id 兜底）。 */
export function mergeBackgroundJobs(parentSessionID: string, rows: BackgroundRows): MafwBackgroundJob[] {
  const jobs = new Map<string, MafwBackgroundJob>();
  const claimedShells = new Set<string>();
  const claimedChildren = new Set<string>();

  for (const task of rows.tasks ?? []) {
    if (!task?.id || task.parentSessionID !== parentSessionID) continue;
    if (task.shellID) claimedShells.add(task.shellID);
    if (task.childSessionID) claimedChildren.add(task.childSessionID);
    const job = jobFromTask(task);
    jobs.set(job.id, job);
  }

  for (const row of rows.runtimeShells ?? []) {
    if (!row?.id || row.sessionID !== parentSessionID) continue;
    if (claimedShells.has(row.id)) continue;
    const job = jobFromRuntimeShell(row);
    if (!jobs.has(job.id)) jobs.set(job.id, job);
  }

  for (const info of rows.subagents ?? []) {
    if (!info?.id) continue;
    // 调用方按 parent 查询；仅在行显式声明其他 parent 时剔除（防御跨会话串台）。
    if (info.parentID && info.parentID !== parentSessionID) continue;
    if (claimedChildren.has(info.id)) continue;
    const job = jobFromSubagent(info, parentSessionID);
    if (!jobs.has(job.id)) jobs.set(job.id, job);
  }

  for (const task of rows.backgroundTasks ?? []) {
    if (!task?.id || task.sessionID !== parentSessionID) continue;
    const job = jobFromBackgroundTask(task);
    if (job && !jobs.has(job.id)) jobs.set(job.id, job);
  }

  return sortBackgroundJobs([...jobs.values()]);
}

/**
 * 事件驱动的作业台账（`background.job.updated` → 快照）。
 *
 * 收 **runtime 证据行**：`runtime-shell`（shell 生命周期）与 `subagent`
 * （子代理 synthetic 终态）。`mafw-task` 不收——TaskService 是其权威来源，
 * 台账镜像只会引入陈旧第二份数据（merge 时 task 行按 id 覆盖）。
 *
 * **location 不落 DTO**（`MafwBackgroundJob` 无 directory 字段），但 runtime shell
 * 的 output/cancel 必须 location-scoped；台账在 `apply` 时旁路记住事件携带的
 * directory（`opencode` 事件的 `location.directory`），供 `rows()` 回填。
 *
 * 终态不回退：迟到的 started / running 事件不得把已完成的作业变回 running。
 * 这样「事件」与「REST 快照」互相一致：事件先到 → 快照立刻反映；权威来源
 * 有新证据 → 权威行优先（见 `mergeSubagentEvidence`）。
 */
export class BackgroundJobRegistry {
  private bySession = new Map<string, Map<string, { job: MafwBackgroundJob; directory?: string }>>();
  /** 每会话最多保留的行数（防长跑会话无限增长）。 */
  constructor(private readonly cap = 200) {}

  /**
   * @param opts.directory 事件来源的 location（session 工作目录）；缺省沿用该
   *   id 上一次记住的值（取消/终态事件通常不再携带，但位置不变）。
   */
  apply(job: MafwBackgroundJob, opts: { directory?: string } = {}): boolean {
    if (!job?.id || !job.sessionID) return false;
    const accepted =
      (job.kind === 'shell' && job.source === 'runtime-shell') ||
      (job.kind === 'subagent' && job.source === 'subagent');
    if (!accepted) return false;
    let bucket = this.bySession.get(job.sessionID);
    if (!bucket) {
      bucket = new Map();
      this.bySession.set(job.sessionID, bucket);
    }
    const prev = bucket.get(job.id);
    if (prev && isTerminalBackgroundStatus(prev.job.status) && !isTerminalBackgroundStatus(job.status)) {
      return false;
    }
    const directory = opts.directory ?? prev?.directory;
    bucket.set(job.id, { job, ...(directory ? { directory } : {}) });
    while (bucket.size > this.cap) {
      const oldest = bucket.keys().next().value;
      if (oldest === undefined) break;
      bucket.delete(oldest);
    }
    return true;
  }

  list(sessionID: string): MafwBackgroundJob[] {
    const bucket = this.bySession.get(sessionID);
    if (!bucket) return [];
    return sortBackgroundJobs([...bucket.values()].map((entry) => entry.job));
  }

  /** runtime shell 行（merge 的 runtimeShells 输入；带 location）。 */
  rows(sessionID: string): RuntimeShellRow[] {
    const bucket = this.bySession.get(sessionID);
    if (!bucket) return [];
    return this.sorted(sessionID)
      .filter((job) => job.kind === 'shell')
      .map((job) => ({
        ...shellRowFromJob(job),
        ...(bucket.get(job.id)?.directory ? { directory: bucket.get(job.id)!.directory } : {}),
      }));
  }

  /** 子代理证据行（merge 的 subagents 输入；与权威 SubagentService 行合并）。 */
  subagentRows(sessionID: string): BackgroundSubagentRow[] {
    return this.sorted(sessionID)
      .filter((job) => job.kind === 'subagent')
      .map((job) => subagentRowFromJob(job));
  }

  private sorted(sessionID: string): MafwBackgroundJob[] {
    const bucket = this.bySession.get(sessionID);
    if (!bucket) return [];
    return sortBackgroundJobs([...bucket.values()].map((entry) => entry.job));
  }

  remove(sessionID: string, id: string): void {
    this.bySession.get(sessionID)?.delete(id);
  }

  clear(sessionID?: string): void {
    if (sessionID) this.bySession.delete(sessionID);
    else this.bySession.clear();
  }
}

/** REST/服务依赖面（index.ts 注入；测试可全量替换）。 */
export interface BackgroundJobServiceDeps {
  tasks?: Pick<TaskService, 'list' | 'get' | 'cancel' | 'output'> | null;
  registry?: BackgroundJobRegistry | null;
  /**
   * 子代理来源 = `SubagentService.list(parentID)`（权威状态：running/completed/
   * failed/aborted）。缺失/失败按空列表 fail-open。
   */
  listSubagents?(sessionID: string): Promise<BackgroundSubagentRow[]> | BackgroundSubagentRow[];
  /**
   * runtime-managed background tasks (RuntimeAccess `background.tasks`).
   * Missing/unsupported = no rows; failures fail-open.
   */
  listBackgroundTasks?(sessionID: string): Promise<BackgroundTaskRow[]> | BackgroundTaskRow[];
  /** runtime shell 输出（经 RuntimeAccess 的 session.shell 门）。 */
  outputShell?(opts: { shellID: string; cursor?: number; limit?: number; directory?: string }): Promise<any>;
  /** runtime shell 终止（DELETE /shell/:id 语义）。 */
  cancelShell?(opts: { shellID: string; directory?: string }): Promise<void>;
  /** 子代理终止 = `SubagentService.cancel(parent, child)`（含归属校验）。 */
  cancelSubagent?(opts: { parentSessionID: string; childSessionID: string }): Promise<void>;
  broadcast?(job: MafwBackgroundJob): void;
  now?(): number;
}

interface ResolvedJob {
  job: MafwBackgroundJob;
  row?: RuntimeShellRow;
}

/**
 * 中性 jobs 服务：list（三源合并）/ output（游标增量）/ cancel（按来源分派）。
 * 所有方法都要求显式 sessionID —— 作业归属是权限与定位的共同前提。
 */
export class BackgroundJobService {
  private readonly registry: BackgroundJobRegistry;
  private readonly now: () => number;

  constructor(private readonly deps: BackgroundJobServiceDeps = {}) {
    this.registry = deps.registry ?? new BackgroundJobRegistry();
    this.now = deps.now ?? Date.now;
  }

  async list(sessionID: string): Promise<MafwBackgroundJob[]> {
    requireSession(sessionID);
    const tasks = this.deps.tasks?.list({ parentSessionID: sessionID }) ?? [];
    const authoritative = await this.subagentRows(sessionID);
    return mergeBackgroundJobs(sessionID, {
      tasks: [...tasks],
      runtimeShells: this.registry.rows(sessionID),
      // 权威行 + 事件证据：事件只补「权威仍未终态」时的终态，权威终态永不被旧事件覆盖
      subagents: mergeSubagentEvidence(authoritative, this.registry.subagentRows(sessionID)),
      backgroundTasks: await this.managedTasks(sessionID),
    });
  }

  async output(sessionID: string, id: string, cursor?: number): Promise<MafwBackgroundOutput> {
    requireSession(sessionID);
    const resolved = await this.resolve(sessionID, id);
    const job = resolved.job;
    // 子代理没有 shell 输出面（先判 kind：task 拥有的子代理同样不适用）
    if (job.kind === 'subagent') {
      throw new BackgroundJobError(400, 'output is only supported for shell jobs');
    }
    if (job.source === 'mafw-task' && this.deps.tasks) {
      return toBackgroundOutput(await this.deps.tasks.output(job.taskID ?? job.id, {
        ...(typeof cursor === 'number' ? { cursor } : {}),
      }));
    }
    if (job.source === 'runtime-shell') {
      if (!this.deps.outputShell) throw new BackgroundJobError(503, 'runtime shell output is not available on this runtime');
      return toBackgroundOutput(await this.deps.outputShell({
        shellID: job.runtimeShellID ?? job.id,
        ...(typeof cursor === 'number' ? { cursor } : {}),
        limit: 65536,
        ...(resolved.row?.directory ? { directory: resolved.row.directory } : {}),
      }));
    }
    throw new BackgroundJobError(503, 'shell output is not available on this runtime');
  }

  async cancel(sessionID: string, id: string): Promise<MafwBackgroundJob> {
    requireSession(sessionID);
    const resolved = await this.resolve(sessionID, id);
    const job = resolved.job;
    if (isTerminalBackgroundStatus(job.status)) return job;

    if (job.source === 'mafw-task') {
      if (!this.deps.tasks) throw new BackgroundJobError(503, 'task service is not available');
      const task = await this.deps.tasks.cancel(job.taskID ?? job.id);
      return this.publish(jobFromTask(task));
    }

    if (job.source === 'runtime-shell') {
      if (!this.deps.cancelShell) throw new BackgroundJobError(503, 'runtime shell cancel is not available on this runtime');
      await this.deps.cancelShell({
        shellID: job.runtimeShellID ?? job.id,
        ...(resolved.row?.directory ? { directory: resolved.row.directory } : {}),
      });
      return this.publish(this.cancelledJob(job));
    }

    if (job.extensions?.runtimeTask === true) {
      throw new BackgroundJobError(503, 'background task cancel is not available on this runtime');
    }
    if (!this.deps.cancelSubagent) throw new BackgroundJobError(503, 'subagent cancel is not available on this runtime');
    // 归属校验由 SubagentService.cancel 负责（非本会话子代理 → 404）
    await this.deps.cancelSubagent({
      parentSessionID: sessionID,
      childSessionID: job.childSessionID ?? job.id,
    });
    return this.publish(this.cancelledJob(job));
  }

  private async resolve(sessionID: string, id: string): Promise<ResolvedJob> {
    if (!id) throw new BackgroundJobError(404, 'job id is required');
    const jobs = await this.list(sessionID);
    const job = jobs.find((j) => j.id === id);
    if (!job) throw new BackgroundJobError(404, `job not found: ${id}`);
    const row = job.source === 'runtime-shell'
      ? this.registry.rows(sessionID).find((r) => r.id === (job.runtimeShellID ?? job.id))
      : undefined;
    return { job, ...(row ? { row } : {}) };
  }

  private cancelledJob(job: MafwBackgroundJob): MafwBackgroundJob {
    const updated = this.now();
    return {
      ...job,
      status: 'cancelled',
      time: { ...(job.time ?? {}), updated, completed: updated },
    };
  }

  private publish(job: MafwBackgroundJob): MafwBackgroundJob {
    // 事件台账同步（shell/subagent 证据行；task 由 TaskService 权威提供）
    this.registry.apply(job);
    try {
      this.deps.broadcast?.(job);
    } catch {
      // fail-open：广播失败不影响 REST 结果
    }
    return job;
  }

  private async subagentRows(sessionID: string): Promise<BackgroundSubagentRow[]> {
    if (!this.deps.listSubagents) return [];
    try {
      const rows = await this.deps.listSubagents(sessionID);
      return Array.isArray(rows) ? rows : [];
    } catch {
      // fail-open：子代理来源不可用时其余来源照常返回
      return [];
    }
  }

  private async managedTasks(sessionID: string): Promise<BackgroundTaskRow[]> {
    if (!this.deps.listBackgroundTasks) return [];
    try {
      const rows = await this.deps.listBackgroundTasks(sessionID);
      return Array.isArray(rows) ? rows : [];
    } catch {
      // fail-open：managed task 来源不可用时其余来源照常返回
      return [];
    }
  }
}

function requireSession(sessionID: string | undefined): void {
  if (!sessionID) throw new BackgroundJobError(400, 'sessionID is required');
}

/**
 * 子代理证据合并：权威行（SubagentService）优先，事件只补终态。
 *
 * - 事件行没有权威对应行 → 直接采用（例：子会话已被清理，但完成事件仍在）
 * - 权威行仍未终态 + 事件行终态 → 采用事件的终态（事件是「终态已发生」的证据）
 * - 权威行已终态 → 权威胜（失败/中止不会被旧 completed 事件洗白）
 */
export function mergeSubagentEvidence(
  authoritative: BackgroundSubagentRow[],
  eventRows: BackgroundSubagentRow[],
): BackgroundSubagentRow[] {
  const byId = new Map<string, BackgroundSubagentRow>();
  for (const row of authoritative) {
    if (row?.id) byId.set(row.id, row);
  }
  for (const evidence of eventRows) {
    if (!evidence?.id) continue;
    const current = byId.get(evidence.id);
    if (!current) {
      byId.set(evidence.id, evidence);
      continue;
    }
    const currentStatus = backgroundJobStatusOfSubagent(
      current.status,
      Number.isFinite(current.time?.completed),
    );
    const evidenceStatus = backgroundJobStatusOfSubagent(
      evidence.status,
      Number.isFinite(evidence.time?.completed),
    );
    if (isTerminalBackgroundStatus(evidenceStatus) && !isTerminalBackgroundStatus(currentStatus)) {
      byId.set(evidence.id, {
        ...current,
        status: evidence.status,
        ...(evidence.updatedAt !== undefined
          ? { updatedAt: evidence.updatedAt }
          : current.updatedAt !== undefined ? { updatedAt: current.updatedAt } : {}),
        ...(evidence.time?.completed !== undefined
          ? { time: { ...(current.time ?? {}), completed: evidence.time.completed } }
          : {}),
      });
    }
  }
  return [...byId.values()];
}

/** runtime 原生 output → 中性游标式结果（`cursor` = 下一次读取的起点，UTF-8 字节）。 */
export function toBackgroundOutput(raw: any): MafwBackgroundOutput {
  const data = typeof raw?.output === 'string' ? raw.output : '';
  const start = Number(raw?.cursor);
  const size = Number(raw?.size);
  // runtime 的 cursor/size 都是**字节**（wire probe：cursor=<起始字节>, size=<总字节>）。
  // 用 UTF-16 length 会在 CJK/emoji 上多跳（`'你好'.length===2` vs 6 字节）→ 漏读与错页。
  const bytes = Buffer.byteLength(data, 'utf8');
  let cursor = Number.isFinite(start) ? start + bytes : bytes;
  if (Number.isFinite(size) && size >= 0 && cursor > size) cursor = size;
  return { cursor, data, truncated: raw?.truncated === true };
}
