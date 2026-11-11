/**
 * E4-6b 资源压力 → scheduler 准入（spec §4.2 / §4.3 / §6）。
 *
 * 唯一的接缝：governor 只回答"现在是否降级"，scheduler 只问"能不能准入"。
 * 降级时拒绝**非前台**任务（backfill / 巩固 / 快照构建等），前台（chat /
 * health / SSE）永不因压力被阻挡——磁盘/堆紧张时前台仍是用户可感知的入口。
 *
 * governor 缺席（listen 前 / 采样失败）或未降级 → 逐字委托 fallback，
 * 既有 pipeline budget 行为不变（字节级保持）。
 */
import type { BudgetCheckResult, TaskDescriptor } from '../scheduler/task-descriptor';

export type ResourceBudgetChecker = (task: TaskDescriptor<any>) => BudgetCheckResult;

export function createResourceBudgetChecker(
  getGovernor: () => { isDegraded(): boolean } | null | undefined,
  fallback: (task: TaskDescriptor<any>) => BudgetCheckResult,
): ResourceBudgetChecker {
  return (task) => {
    if (task.priority !== 'foreground') {
      const governor = getGovernor();
      if (governor?.isDegraded()) {
        return { ok: false, reason: 'resource pressure' };
      }
    }
    return fallback(task);
  };
}
