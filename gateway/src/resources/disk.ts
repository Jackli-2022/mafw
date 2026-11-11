import * as fs from 'fs';

/**
 * E4-2 磁盘水位采样。
 *
 * `fs.statfs` 只报告字节，不报告"够不够用"；阈值判断放在这里，让 governor
 * 能在同一份样本上做回滞（升档立即、降档要越过恢复线）。采样失败一律
 * `unknown`（fail-open）：数据根统计不到不等于磁盘危险，绝不能因此降级。
 */
export type DiskState = 'ok' | 'warn' | 'critical' | 'unknown';

export interface DiskSample {
  totalBytes: number;
  freeBytes: number;
  state: DiskState;
  error?: string;
}

export interface DiskThresholds {
  warnFreeBytes: number;
  criticalFreeBytes: number;
}

export interface StatfsResult {
  bsize: number;
  blocks: number;
  bavail: number;
}

export type StatfsFn = (path: string) => Promise<StatfsResult>;

/** spec §5 默认值：warn 2 GiB 可用、critical 512 MiB 可用。 */
export const DEFAULT_DISK_THRESHOLDS: DiskThresholds = {
  warnFreeBytes: 2 * 1024 * 1024 * 1024,
  criticalFreeBytes: 512 * 1024 * 1024,
};

function classifyDisk(freeBytes: number, thresholds: DiskThresholds): DiskState {
  if (freeBytes <= thresholds.criticalFreeBytes) return 'critical';
  if (freeBytes <= thresholds.warnFreeBytes) return 'warn';
  return 'ok';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const defaultStatfs: StatfsFn = async (target: string) => {
  const statfs = (fs.promises as any).statfs;
  if (typeof statfs !== 'function') {
    throw new Error('fs.statfs is not available in this Node.js runtime');
  }
  return statfs(target);
};

/**
 * 采样 `target` 所在文件系统。永不抛出：任何 statfs 失败/垃圾数值 → unknown。
 */
export async function sampleDisk(
  target: string,
  statfsFn: StatfsFn = defaultStatfs,
  thresholds: DiskThresholds = DEFAULT_DISK_THRESHOLDS,
): Promise<DiskSample> {
  try {
    const stats = await statfsFn(target);
    const fields = [stats.bsize, stats.blocks, stats.bavail];
    if (fields.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      return {
        totalBytes: 0,
        freeBytes: 0,
        state: 'unknown',
        error: 'statfs returned non-finite values',
      };
    }
    // 负数字段是 statfs 契约破坏，不是"磁盘满了"：归零会误判成 critical。
    if (fields.some((value) => value < 0)) {
      return { totalBytes: 0, freeBytes: 0, state: 'unknown', error: 'invalid statfs values' };
    }
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    return { totalBytes: total, freeBytes: free, state: classifyDisk(free, thresholds) };
  } catch (err) {
    return { totalBytes: 0, freeBytes: 0, state: 'unknown', error: errorMessage(err) };
  }
}

export { classifyDisk };
