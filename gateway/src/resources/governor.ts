import * as v8 from 'v8';
import type { GatewayConfig } from '../config';
import { TimerHandle, TimerService } from '../core/timer-service';
import { DiskSample, DiskState, DiskThresholds, StatfsFn, classifyDisk, defaultStatfs, sampleDisk } from './disk';
import { HeapSample, HeapState, HeapThresholds, classifyHeap, sampleHeap } from './heap';

/**
 * E4-2/E4-3 资源压力状态机。
 *
 * 采样（disk statfs + heap memoryUsage）与降级判定分两层：
 *  - 采样器只回答"现在是多少"；
 *  - governor 负责回滞：升档按阈值立即生效，降档必须越过恢复线
 *    （disk critical → warn 要回到 1.5×，warn → ok 要回到 1.1×；
 *      heap 每档留 0.05 余量），避免在阈值附近抖动导致后台任务反复拒绝/接纳。
 *
 * `unknown`（statfs 失败）只进快照，不进 `degraded` —— fail-open。
 * 只有 critical 进 `degraded`；warn 只用于观测。
 */
export interface Pressure {
  disk: DiskState;
  heap: HeapState;
  /** 机器码：`disk_critical` / `heap_critical`（只有 critical 才出现）。 */
  degraded: string[];
}

export interface GovernorSnapshot {
  disk: DiskSample;
  heap: HeapSample | null;
  pressure: Pressure;
  sampledAt: number | null;
}

export type ChangeListener = (prev: Pressure, next: Pressure) => void;

export interface ResourceGovernorDeps {
  /** 数据根（`config.resolvePath()`），statfs 采样目标。 */
  dataDir: string;
  /** live getter：不缓存配置对象，hot reload 在下一次采样生效。 */
  config: () => GatewayConfig['resources'];
  timers: TimerService;
  statfs?: StatfsFn;
  memoryUsage?: () => NodeJS.MemoryUsage;
  heapLimit?: () => number;
  now?: () => number;
}

const DISK_CRITICAL_RECOVERY = 1.5;
const DISK_WARN_RECOVERY = 1.1;
const HEAP_HYSTERESIS = 0.05;
/** 浮点容差：0.9 - 0.05 在 IEEE754 下不是 0.85，边界值必须落在"未恢复"一侧。 */
const RATIO_EPSILON = 1e-9;

const INITIAL_PRESSURE: Pressure = { disk: 'unknown', heap: 'ok', degraded: [] };

function emptyDiskSample(): DiskSample {
  return { totalBytes: 0, freeBytes: 0, state: 'unknown' };
}

export function diskStateAfter(prev: DiskState, sample: DiskSample, thresholds: DiskThresholds): DiskState {
  if (sample.state === 'unknown') return 'unknown';
  const free = sample.freeBytes;
  switch (prev) {
    case 'unknown':
    case 'ok':
      // 升档无回滞：ok 直接按阈值分类（ok→warn 或 ok→critical 都立即）。
      return classifyDisk(free, thresholds);
    case 'warn':
      if (free < thresholds.criticalFreeBytes) return 'critical';
      if (free >= thresholds.warnFreeBytes * DISK_WARN_RECOVERY) return 'ok';
      return 'warn';
    case 'critical':
      if (free >= thresholds.criticalFreeBytes * DISK_CRITICAL_RECOVERY) return 'warn';
      return 'critical';
    default:
      return classifyDisk(free, thresholds);
  }
}

export function heapStateAfter(prev: HeapState, sample: HeapSample | null, thresholds: HeapThresholds): HeapState {
  if (!sample) return prev;
  const ratio = sample.ratio;
  switch (prev) {
    case 'ok':
      return classifyHeap(ratio, thresholds);
    case 'warn':
      if (ratio >= thresholds.criticalRatio) return 'critical';
      if (ratio < thresholds.warnRatio - HEAP_HYSTERESIS - RATIO_EPSILON) return 'ok';
      return 'warn';
    case 'critical':
      if (ratio < thresholds.criticalRatio - HEAP_HYSTERESIS - RATIO_EPSILON) return 'warn';
      return 'critical';
    default:
      return classifyHeap(ratio, thresholds);
  }
}

function degradedFor(disk: DiskState, heap: HeapState): string[] {
  const degraded: string[] = [];
  if (disk === 'critical') degraded.push('disk_critical');
  if (heap === 'critical') degraded.push('heap_critical');
  return degraded;
}

function samePressure(a: Pressure, b: Pressure): boolean {
  return a.disk === b.disk
    && a.heap === b.heap
    && a.degraded.length === b.degraded.length
    && a.degraded.every((code, i) => code === b.degraded[i]);
}

export class ResourceGovernor {
  private readonly deps: ResourceGovernorDeps;
  private started = false;
  private handle: TimerHandle | null = null;
  private registeredIntervalMs = 0;
  private sampledAt: number | null = null;
  private disk: DiskSample = emptyDiskSample();
  private heap: HeapSample | null = null;
  private current: Pressure = { ...INITIAL_PRESSURE, degraded: [] };
  private listeners = new Set<ChangeListener>();
  private inflight: Promise<Pressure> | null = null;

  constructor(deps: ResourceGovernorDeps) {
    this.deps = deps;
  }

  /** 立即采样一次并按 `resources.sampleIntervalMs` 注册 `governor:sample`。幂等。 */
  start(): Promise<void> {
    if (this.started) return Promise.resolve();
    this.started = true;
    this.ensureTimer(this.deps.config().sampleIntervalMs);
    return this.sampleNow().then(() => undefined);
  }

  /** 停采样并清掉定时器；已采到的快照保留（供 shutdown 前读取）。 */
  stop(): void {
    this.started = false;
    if (this.handle) {
      this.handle.clear();
      this.handle = null;
    }
    this.registeredIntervalMs = 0;
  }

  /** 手动采样（也由定时器调用）。并发调用合并为同一次采样。 */
  sampleNow(): Promise<Pressure> {
    if (this.inflight) return this.inflight;
    const run = this.doSample().finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  pressure(): Pressure {
    return { disk: this.current.disk, heap: this.current.heap, degraded: [...this.current.degraded] };
  }

  snapshot(): GovernorSnapshot {
    return {
      disk: { ...this.disk },
      heap: this.heap ? { ...this.heap } : null,
      pressure: this.pressure(),
      sampledAt: this.sampledAt,
    };
  }

  isDegraded(): boolean {
    return this.current.degraded.length > 0;
  }

  /** 只在 `pressure` 变化时触发；返回取消订阅函数。 */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async doSample(): Promise<Pressure> {
    const cfg = this.deps.config();
    const prev = this.current;

    const diskSample = await sampleDisk(
      this.deps.dataDir,
      this.deps.statfs ?? defaultStatfs,
      cfg.disk,
    );
    const heapSample = this.readHeap(cfg);

    const diskState = diskStateAfter(prev.disk, diskSample, cfg.disk);
    const heapState = heapStateAfter(prev.heap, heapSample, cfg.heap);
    const pressure: Pressure = { disk: diskState, heap: heapState, degraded: degradedFor(diskState, heapState) };

    this.disk = diskSample.state === diskState ? diskSample : { ...diskSample, state: diskState };
    if (heapSample) {
      // 快照里的 heap.state 与 pressure 保持一致（回滞可能把原始分类留在低一档）。
      this.heap = heapSample.state === heapState ? heapSample : { ...heapSample, state: heapState };
    }
    this.current = pressure;
    this.sampledAt = this.deps.now ? this.deps.now() : Date.now();

    if (this.started) this.ensureTimer(cfg.sampleIntervalMs);
    this.emitIfChanged(prev, pressure);
    return pressure;
  }

  private readHeap(cfg: GatewayConfig['resources']): HeapSample | null {
    try {
      const usage = this.deps.memoryUsage ? this.deps.memoryUsage() : process.memoryUsage();
      const limit = this.deps.heapLimit ? this.deps.heapLimit() : defaultHeapLimit();
      return sampleHeap(usage, limit, cfg.heap);
    } catch {
      // 采样失败 fail-open：保留上一次 heap 样本/状态，不升级压力。
      return this.heap;
    }
  }

  private ensureTimer(ms: number): void {
    if (this.handle && this.registeredIntervalMs === ms) return;
    if (this.handle) this.handle.clear();
    this.handle = this.deps.timers.every('governor:sample', ms, () => {
      void this.sampleNow();
    });
    this.registeredIntervalMs = ms;
  }

  private emitIfChanged(prev: Pressure, next: Pressure): void {
    if (samePressure(prev, next)) return;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(prev, { ...next, degraded: [...next.degraded] });
      } catch {
        // 监听器错误不得影响采样/降级状态。
      }
    }
  }
}

function defaultHeapLimit(): number {
  try {
    return v8.getHeapStatistics().heap_size_limit;
  } catch {
    return 0;
  }
}
