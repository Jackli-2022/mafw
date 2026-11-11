/**
 * E4-3 堆水位采样。
 *
 * `process.memoryUsage().heapUsed` 是好样本，但"多大算高"取决于 V8 的
 * heap_size_limit（随机器内存和启动参数变化），所以比例、而不是绝对字节，
 * 是降级判据。与磁盘共用 `governor:sample` 定时器。
 */
export type HeapState = 'ok' | 'warn' | 'critical';

export interface HeapSample {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
  heapLimit: number;
  ratio: number;
  state: HeapState;
}

export interface HeapThresholds {
  warnRatio: number;
  criticalRatio: number;
}

/** spec §5 默认值。 */
export const DEFAULT_HEAP_THRESHOLDS: HeapThresholds = {
  warnRatio: 0.75,
  criticalRatio: 0.9,
};

function finiteOr0(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function classifyHeap(ratio: number, thresholds: HeapThresholds): HeapState {
  if (ratio >= thresholds.criticalRatio) return 'critical';
  if (ratio >= thresholds.warnRatio) return 'warn';
  return 'ok';
}

export function sampleHeap(
  usage: NodeJS.MemoryUsage,
  heapLimit: number,
  thresholds: HeapThresholds = DEFAULT_HEAP_THRESHOLDS,
): HeapSample {
  const heapUsed = finiteOr0(usage?.heapUsed);
  const limit = typeof heapLimit === 'number' && Number.isFinite(heapLimit) && heapLimit > 0 ? heapLimit : 0;
  const ratio = limit > 0 ? heapUsed / limit : 0;
  return {
    heapUsed,
    heapTotal: finiteOr0(usage?.heapTotal),
    rss: finiteOr0(usage?.rss),
    external: finiteOr0(usage?.external),
    arrayBuffers: finiteOr0(usage?.arrayBuffers),
    heapLimit: limit,
    ratio,
    state: classifyHeap(ratio, thresholds),
  };
}

export { classifyHeap };
