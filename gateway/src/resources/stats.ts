/**
 * E4-8 `/api/kernel/stats` 快照构建器（纯函数）。
 *
 * kernel 只做组装（把 live provider 塞进来），形状与归一化规则都在这里，
 * 这样 stats 的 wire 契约可以在没有 live kernel 的情况下被单测锁定。
 *
 * 归一化裁决：
 *  - governor 缺席 = fail-open：pressure `{disk:'unknown', heap:'ok', degraded:[]}`，
 *    disk 零值 + `unknown`，heap `null`（schema 允许），**不**让 stats 500；
 *  - `DiskSample.error` 是可选字段，wire 上必须是 `string|null`（undefined 会被
 *    JSON.stringify 直接吞掉，客户端拿到缺键而不是 null）；
 *  - timer 名里的连接级后缀（`sse:ping:<connectionId>`）按 family 折叠求和，
 *    否则每个 SSE 连接都会在 `byName` 里长出一个键；
 *  - `buffers` 直接透传 `BufferCounters.snapshot()`（E4-5 的唯一记账源；含
 *    `sseWriteErrors`，spec §4.8 的嵌套示意是在聚合口径定稿前画的）；
 *  - 不返回路径/文件内容/token：process entries 只暴露可序列化字段。
 */
import type { BufferCounters } from './outbound-buffer';
import type { ConnectionSnapshot } from './connections';
import type { GovernorSnapshot, Pressure } from './governor';
import type { HeapSample } from './heap';
import type { DiskState } from './disk';
import type { ProcessLedgerSnapshot } from './process-ledger';
import type { QuotaSnapshot } from './quotas';
import type { SchedulerStats } from '../scheduler/task-descriptor';

type BufferSnapshot = ReturnType<BufferCounters['snapshot']>;
type TimerStats = { active: number; byName: Record<string, number> };

/** `process.getActiveResourcesInfo()` 的类型计数（Linux 附带 `/proc/self/fd` 数）。 */
export interface KernelStatsHandles {
  total: number;
  byType: Record<string, number>;
  fdCount?: number;
}

export interface KernelStatsSnapshot {
  timestamp: string;
  uptimeSec: number;
  pressure: Pressure;
  disk: { totalBytes: number; freeBytes: number; state: DiskState; error: string | null };
  heap: HeapSample | null;
  connections: ConnectionSnapshot;
  buffers: BufferSnapshot;
  timers: TimerStats;
  processes: ProcessLedgerSnapshot;
  quotas: QuotaSnapshot;
  handles: KernelStatsHandles;
  scheduler: SchedulerStats;
  events: { headSeq: number; appendFailures: number };
  serve: { running: boolean; owned: boolean };
}

/**
 * kernel 注入的 live provider 集合。除 `governor` / `events` / `handles` 外必填——
 * 它们由 kernel 无条件持有；缺席的三种就是"尚未接线"，按 fail-open 降级。
 */
export interface KernelStatsInput {
  now?: number;
  uptimeSec: number;
  governor?: { snapshot(): GovernorSnapshot };
  connections: { snapshot(): ConnectionSnapshot };
  buffers: { snapshot(): BufferSnapshot };
  timers: { stats(): TimerStats };
  processes: { snapshot(): ProcessLedgerSnapshot };
  quotas: { snapshot(currents: Record<string, number>): QuotaSnapshot };
  scheduler: { stats(): SchedulerStats };
  events: { headSeq(): number; appendFailures(): number } | null;
  serve: { running: boolean; owned: boolean };
  handles?: KernelStatsHandles;
  quotaCurrents: { projects: number; sessions: number; sessionRecordsPerProject: number };
}

const DEFAULT_PRESSURE: Pressure = { disk: 'unknown', heap: 'ok', degraded: [] };

const EMPTY_DISK: KernelStatsSnapshot['disk'] = {
  totalBytes: 0,
  freeBytes: 0,
  state: 'unknown',
  error: null,
};

/**
 * 连接级 timer 的 family 前缀（spec §4.1：`sse:ping:<connectionId>`）。
 * 只折叠已知前缀——其他名字原样保留，避免把 `ws:ping` 之类的固定 timer 误合并。
 */
const TIMER_FAMILIES: ReadonlyArray<{ prefix: string; family: string }> = [
  { prefix: 'sse:ping:', family: 'sse:ping' },
];

function timerFamily(name: string): string {
  for (const { prefix, family } of TIMER_FAMILIES) {
    if (name.startsWith(prefix)) return family;
  }
  return name;
}

function aggregateTimers(stats: TimerStats): TimerStats {
  const byName: Record<string, number> = {};
  for (const [name, count] of Object.entries(stats?.byName ?? {})) {
    if (typeof count !== 'number' || !Number.isFinite(count)) continue;
    const family = timerFamily(name);
    byName[family] = (byName[family] ?? 0) + count;
  }
  // provider 的 active 是权威值；缺失时退回折叠后的合计（两者正常情况下相等）。
  const active = typeof stats?.active === 'number' && Number.isFinite(stats.active)
    ? stats.active
    : Object.values(byName).reduce((sum, n) => sum + n, 0);
  return { active, byName };
}

/** `process.getActiveResourcesInfo()` → 按类型计数；`fdCount` 仅在有采样时出现。 */
export function buildHandlesSnapshot(activeResources: string[], fdCount?: number): KernelStatsHandles {
  const list = Array.isArray(activeResources) ? activeResources : [];
  const byType: Record<string, number> = {};
  for (const type of list) {
    const key = typeof type === 'string' && type.length > 0 ? type : 'unknown';
    byType[key] = (byType[key] ?? 0) + 1;
  }
  const handles: KernelStatsHandles = { total: list.length, byType };
  if (typeof fdCount === 'number' && Number.isFinite(fdCount) && fdCount >= 0) {
    handles.fdCount = Math.floor(fdCount);
  }
  return handles;
}

export function buildKernelStatsSnapshot(input: KernelStatsInput): KernelStatsSnapshot {
  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
  const governor = input.governor?.snapshot() ?? null;
  const pressure: Pressure = governor
    ? { disk: governor.pressure.disk, heap: governor.pressure.heap, degraded: [...governor.pressure.degraded] }
    : { ...DEFAULT_PRESSURE, degraded: [] };

  const disk: KernelStatsSnapshot['disk'] = governor
    ? {
      totalBytes: governor.disk.totalBytes,
      freeBytes: governor.disk.freeBytes,
      state: governor.disk.state,
      error: governor.disk.error ?? null,
    }
    : { ...EMPTY_DISK };

  return {
    timestamp: new Date(now).toISOString(),
    uptimeSec: Math.floor(typeof input.uptimeSec === 'number' ? input.uptimeSec : 0),
    pressure,
    disk,
    heap: governor?.heap ?? null,
    connections: input.connections.snapshot(),
    buffers: input.buffers.snapshot(),
    timers: aggregateTimers(input.timers.stats()),
    processes: input.processes.snapshot(),
    quotas: input.quotas.snapshot(input.quotaCurrents),
    handles: input.handles ?? { total: 0, byType: {} },
    scheduler: input.scheduler.stats(),
    events: input.events
      ? { headSeq: input.events.headSeq(), appendFailures: input.events.appendFailures() }
      : { headSeq: 0, appendFailures: 0 },
    serve: { running: !!input.serve?.running, owned: !!input.serve?.owned },
  };
}
