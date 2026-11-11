/**
 * E4 共享配置归一化。
 *
 * `config.resources` 是用户可编辑的原始 YAML：可能缺失、为 0/负数（= 不限）、
 * 是越界比例，或给了过小的采样间隔。这些规则必须只有一个实现，否则连接表、
 * 配额、缓冲区和 governor 会各自解释（spec §5）。
 */
export const DEFAULT_SAMPLE_INTERVAL_MS = 30000;
const MIN_SAMPLE_INTERVAL_MS = 1000;
const MIN_RATIO = 0.01;
const MAX_RATIO = 0.99;

/** 采样间隔：finite 且 >= 1000ms 才采纳（向下取整），否则回退 30s。 */
export function resolveSampleIntervalMs(ms: unknown): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < MIN_SAMPLE_INTERVAL_MS) {
    return DEFAULT_SAMPLE_INTERVAL_MS;
  }
  return Math.floor(ms);
}

/** 比例阈值：finite 则夹到 (0, 1) 的开区间端点，否则用 fallback。 */
export function clampRatio(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, MIN_RATIO), MAX_RATIO);
}

/**
 * 数量上限：finite 且 > 0 时向下取整；0/负数/NaN/Infinity/缺失 = 不限（Infinity）。
 * 调用方直接用它比较 `current >= limit` 即可，`Infinity` 永不命中。
 */
export function limitOf(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return Infinity;
  return Math.floor(n);
}
