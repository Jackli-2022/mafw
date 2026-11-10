/**
 * Background job event helpers —— runtime 原生 shell/子代理生命周期 →
 * 中性 `MafwBackgroundJob` DTO 与其 canonical 事件信封（纯函数，无服务依赖）。
 *
 * runtime-neutral（Plan 6 Task 2）：从 `gateway/src/core/background/background-jobs.ts`
 * 原样搬出，gateway 侧再导出；聚合（task 行优先的 `mergeBackgroundJobs`）与
 * `BackgroundJobRegistry` / `BackgroundJobService` 仍留在 gateway（依赖 TaskService）。
 *
 * 事件侧：runtime 的 synthetic shell/subagent 生命周期（旧实现伪装成 user/assistant
 * 消息）经 Ingress 翻译为 canonical `background.job.updated`，由 `BackgroundJobRegistry`
 * 记账（终态不回退），REST 快照仍是对账权威。
 */
import type { MafwBackgroundJob, MafwBackgroundJobStatus } from './view-dto.generated.ts';

/** canonical `background.job.updated`（gateway 词汇 MAFW.backgroundJobUpdated 的同一字面量）。 */
const BACKGROUND_JOB_UPDATED = 'background.job.updated';

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

/**
 * 子代理行（聚合输入）。
 *
 * 权威形态来自 `SubagentService.list()`（`id/parentID/description/status/createdAt/
 * updatedAt`）——`status` 是唯一可信来源，聚合器不再自行从会话时间推算终态。
 * 纯 `SessionInfo` 行（无 status）仅作回退：以 `time.completed` 判断终态。
 */
export interface BackgroundSubagentRow {
  id: string
  parentID?: string
  title?: string
  description?: string
  /** SubagentService 状态（running | completed | failed | aborted | input_required）。 */
  status?: BackgroundSubagentStatus
  createdAt?: number
  updatedAt?: number
  time?: { created?: number; updated?: number; completed?: number }
}

/** SubagentService 状态 + DTO 已有的等待态（input_required 归一为 running）。 */
export type BackgroundSubagentStatus =
  | 'running'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'aborted'

const ACTIVE_STATUSES: ReadonlySet<MafwBackgroundJobStatus> = new Set(['running', 'input_required']);

export function isTerminalBackgroundStatus(status: MafwBackgroundJobStatus): boolean {
  return !ACTIVE_STATUSES.has(status);
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

/**
 * 子代理状态（SubagentService 权威值）→ MAFW 状态机。
 *
 * `aborted` = 用户/父会话主动中止 → `cancelled`；`input_required` 与 `running`
 * 同属「活跃」（brief：两者归 `running`）。缺 status 的纯会话行回退到
 * `time.completed` 推断（仅兜底，不再作为主路径）。
 */
export function backgroundJobStatusOfSubagent(
  status: BackgroundSubagentStatus | undefined,
  hasCompletedTime = false,
): MafwBackgroundJobStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'aborted':
      return 'cancelled';
    case 'running':
    case 'input_required':
      return 'running';
    default:
      return hasCompletedTime ? 'completed' : 'running';
  }
}

/** 反向映射（registry 行化用；保证子代理行↔job 往返不改变状态）。 */
function subagentStatusOfJob(job: MafwBackgroundJob): BackgroundSubagentStatus {
  switch (job.status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'aborted';
    case 'input_required':
      return 'input_required';
    default:
      return 'running';
  }
}

export function jobFromSubagent(row: BackgroundSubagentRow, ownerSessionID?: string): MafwBackgroundJob {
  const completedTime = Number.isFinite(row.time?.completed) ? row.time!.completed : undefined;
  const status = backgroundJobStatusOfSubagent(row.status, completedTime !== undefined);
  const terminal = isTerminalBackgroundStatus(status);
  const created = row.createdAt ?? row.time?.created;
  const updated = row.updatedAt ?? row.time?.updated ?? completedTime;
  const time = optionalTime({
    created,
    updated,
    completed: terminal ? (row.updatedAt ?? completedTime ?? updated) : undefined,
  });
  const title = row.title ?? row.description;
  return {
    id: row.id,
    source: 'subagent',
    kind: 'subagent',
    status,
    sessionID: ownerSessionID ?? row.parentID ?? row.id,
    childSessionID: row.id,
    ...(title ? { title } : {}),
    ...(time ? { time } : {}),
  };
}

/** registry job → 子代理行（merge 输入；状态往返保持）。 */
export function subagentRowFromJob(job: MafwBackgroundJob): BackgroundSubagentRow {
  return {
    id: job.childSessionID ?? job.id,
    parentID: job.sessionID,
    ...(job.title ? { title: job.title } : {}),
    status: subagentStatusOfJob(job),
    ...(Number.isFinite(job.time?.created) ? { createdAt: job.time!.created } : {}),
    ...(Number.isFinite(job.time?.updated ?? job.time?.completed)
      ? { updatedAt: job.time?.updated ?? job.time?.completed }
      : {}),
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
    payload: { type: BACKGROUND_JOB_UPDATED, properties: { job } },
    sessionID: job.sessionID,
    ...(opts.directory ? { directory: opts.directory } : {}),
  };
}
