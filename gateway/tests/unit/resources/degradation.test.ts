/**
 * E4-6b: 资源压力 → scheduler 准入（spec §4.2 / §4.3 / §6）。
 *
 * `createResourceBudgetChecker` 是 governor 与 scheduler 之间的唯一接缝：
 * governor 降级（disk/heap critical）时拒绝**非前台**任务，前台永远放行
 * （chat / health / SSE 不被压力阻断）；governor 缺席或未降级时逐字委托
 * 既有 pipeline budget 逻辑（既有行为不得改变）。
 */
import { createResourceBudgetChecker, shouldPruneEventLog } from '../../../src/resources/degradation';
import type { TaskDescriptor, TaskPriority } from '../../../src/scheduler/task-descriptor';
import type { Pressure } from '../../../src/resources/governor';

function task(priority: TaskPriority): TaskDescriptor<any> {
  return { priority, strategy: 'queue' };
}

function governor(degraded: boolean) {
  return { isDegraded: () => degraded };
}

const FALLBACK_OK = { ok: true } as const;

describe('createResourceBudgetChecker: 前台放行', () => {
  it('降级状态下 foreground 仍走 fallback（不被压力阻挡）', () => {
    const fallback = jest.fn(() => FALLBACK_OK);
    const check = createResourceBudgetChecker(() => governor(true), fallback);
    expect(check(task('foreground'))).toEqual(FALLBACK_OK);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('foreground 的 fallback 拒绝结果原样返回（不覆盖 pipeline 预算）', () => {
    const denied = { ok: false, reason: 'pipeline daily cap' };
    const check = createResourceBudgetChecker(() => governor(true), () => denied);
    expect(check(task('foreground'))).toEqual(denied);
  });
});

describe('createResourceBudgetChecker: 非前台在降级时拒绝', () => {
  it.each<TaskPriority>(['background', 'midground', 'idle'])('%s 在降级时被拒绝且不调用 fallback', (priority) => {
    const fallback = jest.fn(() => FALLBACK_OK);
    const check = createResourceBudgetChecker(() => governor(true), fallback);
    expect(check(task(priority))).toEqual({ ok: false, reason: 'resource pressure' });
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('createResourceBudgetChecker: 无压力时逐字委托', () => {
  it('governor 缺席（null / undefined）→ fallback', () => {
    for (const getGovernor of [() => null, () => undefined]) {
      const fallback = jest.fn(() => FALLBACK_OK);
      const check = createResourceBudgetChecker(getGovernor, fallback);
      expect(check(task('background'))).toEqual(FALLBACK_OK);
      expect(fallback).toHaveBeenCalledTimes(1);
    }
  });

  it('governor 存在但未降级 → fallback（所有优先级）', () => {
    for (const priority of ['foreground', 'midground', 'background', 'idle'] as TaskPriority[]) {
      const fallback = jest.fn(() => FALLBACK_OK);
      const check = createResourceBudgetChecker(() => governor(false), fallback);
      expect(check(task(priority))).toEqual(FALLBACK_OK);
      expect(fallback).toHaveBeenCalledTimes(1);
    }
  });

  it('每次调用都读 live governor（降级即时生效、恢复即时放行）', () => {
    let degraded = false;
    const fallback = jest.fn(() => FALLBACK_OK);
    const check = createResourceBudgetChecker(() => governor(degraded), fallback);

    expect(check(task('background'))).toEqual(FALLBACK_OK);
    degraded = true;
    expect(check(task('background'))).toEqual({ ok: false, reason: 'resource pressure' });
    degraded = false;
    expect(check(task('background'))).toEqual(FALLBACK_OK);
  });
});

describe('shouldPruneEventLog: disk critical 边沿', () => {
  const pressure = (disk: Pressure['disk'], heap: Pressure['heap'] = 'ok'): Pressure => ({
    disk,
    heap,
    degraded: [
      ...(disk === 'critical' ? (['disk_critical'] as const) : []),
      ...(heap === 'critical' ? (['heap_critical'] as const) : []),
    ],
  });

  it('进入 disk critical：ok→critical / warn→critical / unknown→critical 都触发', () => {
    expect(shouldPruneEventLog(pressure('ok'), pressure('critical'))).toBe(true);
    expect(shouldPruneEventLog(pressure('warn'), pressure('critical'))).toBe(true);
    expect(shouldPruneEventLog(pressure('unknown'), pressure('critical'))).toBe(true);
  });

  it('critical 状态下压力组合变化不重复裁剪（heap 升级 / 回落 warn 均为 false）', () => {
    expect(shouldPruneEventLog(pressure('critical'), pressure('critical', 'critical'))).toBe(false);
    expect(shouldPruneEventLog(pressure('critical'), pressure('warn'))).toBe(false);
    expect(shouldPruneEventLog(pressure('critical'), pressure('ok'))).toBe(false);
  });

  it('heap 单独 critical 不裁剪 event_log（磁盘不是瓶颈）', () => {
    expect(shouldPruneEventLog(pressure('ok'), pressure('ok', 'critical'))).toBe(false);
  });

  it('恢复路径不触发（warn→ok / critical→unknown 非进入边沿）', () => {
    expect(shouldPruneEventLog(pressure('warn'), pressure('ok'))).toBe(false);
    expect(shouldPruneEventLog(pressure('critical'), pressure('unknown'))).toBe(false);
  });
});
