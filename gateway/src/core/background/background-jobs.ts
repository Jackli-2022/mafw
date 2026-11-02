/**
 * Task 3：background jobs 三源聚合 —— TaskService（mafw-task）· runtime shell（runtime-shell）
 * · 子代理会话（subagent）→ 单一中性 DTO `MafwBackgroundJob`。
 *
 * 设计（docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md §7.3）：
 *  - 状态机、输出游标、取消语义由 MAFW 定义；runtime 原生 shell DTO 不外泄。
 *  - 同一作业跨源合并按**稳定 id**（task id / shell id / 子会话 id），task 行优先
 *    （task 拥有更完整的生命周期与输出），并保留 `runtimeShellID` / `childSessionID` 定位信息。
 *  - `session.background`（把阻塞工具转后台）仍是独立动作，不与本查询合并。
 *
 * 事件侧：runtime 的 synthetic shell/subagent 生命周期（旧实现伪装成 user/assistant
 * 消息）经 Ingress 翻译为 canonical `background.job.updated`，由 `RuntimeShellRegistry`
 * 记账（终态不回退），REST 快照仍是对账权威。
 */
import type { SessionInfo } from '../../runtime/contract';
import { MAFW } from '../../runtime/mafw-vocabulary';
import type { MafwBackgroundJob, MafwBackgroundJobStatus } from '../../runtime/canonical-types';
import type { TaskEntity, TaskService, TaskStatus } from '../../runtime/task-service';

/** 输出读取结果（游标式增量；绝不携带 runtime 原生 output DTO）。 */
export interface MafwBackgroundOutput {
  /** 下一次读取的起点。 */
  cursor: number
  data: string
  truncated: boolean
}

/**
 * runtime shell 的归一化行（内部形状，不出 REST）。
 *
 * `status` 保留 runtime 原生枚举（running | exited | timeout | killed），
 * 由 `backgroundJobStatusOfShell` 映射到 MAFW 状态机；未知值按 running 处理。
 */
export interface RuntimeShellRow {
  id: string
  sessionID: string
  title?: string
  command?: string
  status?: string
  exitCode?: number
  /** location-scoped shell 调用需要（内部字段，不进 DTO）。 */
  directory?: string
  time?: { created?: number; updated?: number; completed?: number }
}

/** 三源行集合：聚合输入（纯数据，便于单测）。 */
export interface BackgroundRows {
  tasks: TaskEntity[]
  runtimeShells: RuntimeShellRow[]
  subagents: SessionInfo[]
}

const ACTIVE_STATUSES: ReadonlySet<MafwBackgroundJobStatus> = new Set(['running', 'input_required']);

export function isTerminalBackgroundStatus(status: MafwBackgroundJobStatus): boolean {
  return !ACTIVE_STATUSES.has(status);
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

/**
 * runtime shell 原生状态 → MAFW 状态机。
 * running/未知 → running；exited 按退出码分完成/失败（无退出码视为失败，与 TaskService 一致）；
 * timeout → failed；killed → cancelled。
 */
export function backgroundJobStatusOfShell(status: string | undefined, exitCode?: number): MafwBackgroundJobStatus {
  switch (status) {
    case 'exited':
      return typeof exitCode === 'number' && exitCode === 0 ? 'completed' : 'failed';
    case 'timeout':
      return 'failed';
    case 'killed':
      return 'cancelled';
    default:
      return 'running';
  }
}

/** 反向映射（registry 行化用；保证 rows→merge 往返不改变状态）。 */
function shellStatusOfJob(job: MafwBackgroundJob): string {
  switch (job.status) {
    case 'completed':
      return 'exited';
    case 'failed':
      return 'exited';
    case 'cancelled':
      return 'killed';
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

export function jobFromRuntimeShell(row: RuntimeShellRow): MafwBackgroundJob {
  const time = optionalTime(row.time);
  return {
    id: row.id,
    source: 'runtime-shell',
    kind: 'shell',
    status: backgroundJobStatusOfShell(row.status, row.exitCode),
    sessionID: row.sessionID,
    runtimeShellID: row.id,
    ...(row.title ?? row.command ? { title: row.title ?? row.command } : {}),
    ...(row.command ? { command: row.command } : {}),
    ...(time ? { time } : {}),
    ...(typeof row.exitCode === 'number' ? { exitCode: row.exitCode } : {}),
  };
}

function subagentCompletedAt(info: SessionInfo): number | undefined {
  const time = info.time as { completed?: number; idle?: number } | undefined;
  const at = time?.completed ?? time?.idle;
  return Number.isFinite(at) ? at : undefined;
}

export function jobFromSubagent(info: SessionInfo, ownerSessionID?: string): MafwBackgroundJob {
  const completed = subagentCompletedAt(info);
  const time = optionalTime({ created: info.time?.created, updated: info.time?.updated, completed });
  return {
    id: info.id,
    source: 'subagent',
    kind: 'subagent',
    status: completed !== undefined ? 'completed' : 'running',
    sessionID: ownerSessionID ?? info.parentID ?? info.id,
    childSessionID: info.id,
    ...(info.title ? { title: info.title } : {}),
    ...(time ? { time } : {}),
  };
}

function syntheticSubagentStatus(metadata: any): MafwBackgroundJobStatus {
  if (metadata?.state === 'cancelled' || metadata?.status === 'cancelled') return 'cancelled';
  if (metadata?.state === 'error' || metadata?.status === 'failed' || metadata?.error != null) return 'failed';
  // synthetic = 该作业的终态消息（桌面旧检测器同语义：默认「完成」）
  return 'completed';
}

/**
 * synthetic 生命周期消息 → 中性 job（shell 走 runtime-shell 台账；subagent 派生作业）。
 *
 * 这是「synthetic 消息不得伪装成 user/assistant 消息」的落点：Ingress 只产出本
 * canonical 事件，聊天面无感知（spec §7.3 / 决策「synthetic shell 消息」）。
 */
export function backgroundJobFromSynthetic(
  sessionID: string | undefined,
  metadata: any,
  at?: number,
): MafwBackgroundJob | null {
  if (!sessionID || !metadata || typeof metadata !== 'object') return null;
  const shellRow = runtimeShellRowFromSynthetic(sessionID, metadata, at);
  if (shellRow) return jobFromRuntimeShell(shellRow);
  if (metadata.source !== 'subagent') return null;
  const childSessionID = typeof metadata.childID === 'string'
    ? metadata.childID
    : typeof metadata.childSessionID === 'string'
      ? metadata.childSessionID
      : typeof metadata.sessionID === 'string' ? metadata.sessionID : undefined;
  if (!childSessionID) return null;
  const status = syntheticSubagentStatus(metadata);
  const completedAt = Number.isFinite(at) ? at : Date.now();
  const title = typeof metadata.description === 'string'
    ? metadata.description
    : typeof metadata.title === 'string' ? metadata.title : undefined;
  return {
    id: childSessionID,
    source: 'subagent',
    kind: 'subagent',
    status,
    sessionID,
    childSessionID,
    ...(title ? { title } : {}),
    time: { updated: completedAt, completed: completedAt },
  };
}

/** registry job → runtime shell 行（merge 输入；状态往返保持）。 */
export function shellRowFromJob(job: MafwBackgroundJob): RuntimeShellRow {
  const status = shellStatusOfJob(job);
  const exitCode = typeof job.exitCode === 'number'
    ? job.exitCode
    : job.status === 'completed' ? 0 : job.status === 'failed' ? 1 : undefined;
  const time = optionalTime(job.time);
  return {
    id: job.runtimeShellID ?? job.id,
    sessionID: job.sessionID,
    ...(job.command ? { command: job.command } : {}),
    ...(job.title ? { title: job.title } : {}),
    status,
    ...(typeof exitCode === 'number' ? { exitCode } : {}),
    ...(time ? { time } : {}),
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * synthetic shell 完成消息的 metadata → runtime shell 行。
 *
 * 形状来源：opencode v2 `tool/plugin/shell.ts` + schema
 * （`docs/research/2026-10-22-background-wire-probe.md` §5）；判定写宽容：
 * 归一化状态（status）与 legacy 字段（state/exit/exitCode/signal/timeout）都认。
 */
export function runtimeShellRowFromSynthetic(
  sessionID: string,
  metadata: any,
  at?: number,
): RuntimeShellRow | null {
  if (!sessionID || !metadata || typeof metadata !== 'object') return null;
  if (metadata.source !== 'shell') return null;
  const id = typeof metadata.shellID === 'string'
    ? metadata.shellID
    : typeof metadata.jobID === 'string' ? metadata.jobID : undefined;
  if (!id) return null;
  const exitCode = numberOrUndefined(metadata.exitCode ?? metadata.exit);
  const status = syntheticShellStatus(metadata, exitCode);
  const command = typeof metadata.command === 'string' ? metadata.command : undefined;
  const completedAt = status === 'running' ? undefined : (Number.isFinite(at) ? at : Date.now());
  const time: RuntimeShellRow['time'] = completedAt !== undefined
    ? { updated: completedAt, completed: completedAt }
    : (Number.isFinite(at) ? { updated: at } : undefined);
  return {
    id,
    sessionID,
    status,
    ...(command ? { command } : {}),
    ...(typeof exitCode === 'number' ? { exitCode } : {}),
    ...(time ? { time } : {}),
  };
}

function syntheticShellStatus(metadata: any, exitCode: number | undefined): string {
  const normalized = typeof metadata.status === 'string' ? metadata.status : undefined;
  if (normalized === 'cancelled' || metadata.state === 'cancelled') return 'killed';
  if (normalized === 'timeout' || metadata.timeout === true) return 'timeout';
  if (normalized === 'failed' || normalized === 'error') return 'exited';
  if (normalized === 'completed') return 'exited';
  if (metadata.state === 'error' || metadata.error != null || metadata.signal) return 'exited';
  if (typeof exitCode === 'number') return 'exited';
  return 'running';
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

  return sortBackgroundJobs([...jobs.values()]);
}

export function sortBackgroundJobs(jobs: MafwBackgroundJob[]): MafwBackgroundJob[] {
  return [...jobs].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(a.status) ? 0 : 1;
    const bActive = ACTIVE_STATUSES.has(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const aAt = a.time?.updated ?? a.time?.completed ?? 0;
    const bAt = b.time?.updated ?? b.time?.completed ?? 0;
    if (bAt !== aAt) return bAt - aAt;
    return a.id.localeCompare(b.id);
  });
}

/** canonical 事件信封（`background.job.updated { job }`）。 */
export function backgroundJobEvent(
  job: MafwBackgroundJob,
  opts: { directory?: string } = {},
): { payload: { type: string; properties: { job: MafwBackgroundJob } }; sessionID: string; directory?: string } {
  return {
    payload: { type: MAFW.backgroundJobUpdated, properties: { job } },
    sessionID: job.sessionID,
    ...(opts.directory ? { directory: opts.directory } : {}),
  };
}

/**
 * runtime shell 台账（事件驱动）。
 *
 * 只收 `kind: 'shell'` 的 job（subagent / task 由 TaskService 与会话列表权威提供）。
 * 终态不回退：迟到的 started 事件不得把已完成的 shell 变回 running。
 */
export class RuntimeShellRegistry {
  private bySession = new Map<string, Map<string, MafwBackgroundJob>>();
  /** 每会话最多保留的行数（防长跑会话无限增长）。 */
  constructor(private readonly cap = 200) {}

  apply(job: MafwBackgroundJob): boolean {
    if (!job?.id || !job.sessionID || job.kind !== 'shell') return false;
    let bucket = this.bySession.get(job.sessionID);
    if (!bucket) {
      bucket = new Map();
      this.bySession.set(job.sessionID, bucket);
    }
    const prev = bucket.get(job.id);
    if (prev && isTerminalBackgroundStatus(prev.status) && !isTerminalBackgroundStatus(job.status)) {
      return false;
    }
    bucket.set(job.id, job);
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
    return sortBackgroundJobs([...bucket.values()]);
  }

  rows(sessionID: string): RuntimeShellRow[] {
    return this.list(sessionID).map(shellRowFromJob);
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
  registry?: RuntimeShellRegistry | null;
  /** 子代理来源（runtime.session.children；缺失/失败按空列表 fail-open）。 */
  listSubagents?(sessionID: string): Promise<SessionInfo[]> | SessionInfo[];
  /** runtime shell 输出（经 RuntimeAccess 的 session.shell 门）。 */
  outputShell?(opts: { shellID: string; cursor?: number; limit?: number; directory?: string }): Promise<any>;
  /** runtime shell 终止（DELETE /shell/:id 语义）。 */
  cancelShell?(opts: { shellID: string; directory?: string }): Promise<void>;
  /** 松散子代理终止（session.abort 语义）。 */
  cancelSubagent?(opts: { sessionID: string }): Promise<void>;
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
  private readonly registry: RuntimeShellRegistry;
  private readonly now: () => number;

  constructor(private readonly deps: BackgroundJobServiceDeps = {}) {
    this.registry = deps.registry ?? new RuntimeShellRegistry();
    this.now = deps.now ?? Date.now;
  }

  async list(sessionID: string): Promise<MafwBackgroundJob[]> {
    requireSession(sessionID);
    const tasks = this.deps.tasks?.list({ parentSessionID: sessionID }) ?? [];
    const subagents = await this.subagentRows(sessionID);
    return mergeBackgroundJobs(sessionID, {
      tasks: [...tasks],
      runtimeShells: this.registry.rows(sessionID),
      subagents,
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

    if (!this.deps.cancelSubagent) throw new BackgroundJobError(503, 'subagent cancel is not available on this runtime');
    await this.deps.cancelSubagent({ sessionID: job.childSessionID ?? job.id });
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
    if (job.kind === 'shell' && job.source === 'runtime-shell') this.registry.apply(job);
    try {
      this.deps.broadcast?.(job);
    } catch {
      // fail-open：广播失败不影响 REST 结果
    }
    return job;
  }

  private async subagentRows(sessionID: string): Promise<SessionInfo[]> {
    if (!this.deps.listSubagents) return [];
    try {
      const rows = await this.deps.listSubagents(sessionID);
      return Array.isArray(rows) ? rows : [];
    } catch {
      // fail-open：子代理来源不可用时其余来源照常返回
      return [];
    }
  }
}

function requireSession(sessionID: string | undefined): void {
  if (!sessionID) throw new BackgroundJobError(400, 'sessionID is required');
}

/** runtime 原生 output → 中性游标式结果（`cursor` = 下一次读取的起点）。 */
export function toBackgroundOutput(raw: any): MafwBackgroundOutput {
  const data = typeof raw?.output === 'string' ? raw.output : '';
  const start = Number(raw?.cursor);
  const size = Number(raw?.size);
  let cursor = Number.isFinite(start) ? start + data.length : data.length;
  if (Number.isFinite(size) && size >= 0 && cursor > size) cursor = size;
  return { cursor, data, truncated: raw?.truncated === true };
}
