/**
 * eventBus → 顶层扁平广播的发射注册表（v2：发射侧注册表化，替换 index.ts
 * setupEventBus 的硬编码 if 链）。
 *
 * wire 契约：顶层广播必须扁平（无 `data` 键）——desktop 剥壳 `raw?.data || raw`
 * 会把 `data` 当作 mafw_event 内层载荷吞掉 `type`（见 event-broadcast.ts 注释）。
 *
 * 特殊消费者（goal 编排启动 / goalDriver 唤醒 / milestone 推送）不在此表——
 * 它们是 eventBus 的业务订阅，与广播翻译正交，仍由 setupEventBus 独立挂载。
 */

export type FlatPayload = { type: string; [key: string]: any };

/** eventBus 事件名 → 扁平广播载荷构造（逐字保留原 if 链分支的形状）。 */
export const FLAT_EMITTERS: ReadonlyMap<string, (data: any) => FlatPayload> = new Map([
  ['goal_created', (d) => ({ type: 'goal_created', ...d })],
  ['state_change', (d) => ({ type: 'state_change', ...d })],
  ['user_question', (d) => ({ type: 'user_question', ...d })],
  ['user_feedback', (d) => ({ type: 'user_feedback', ...d })],
  ['phase_transition', (d) => ({ type: 'phase_transition', ...d })],
  ['memory_written', (d) => ({ type: 'memory_written', ...d })],
  ['memory_energy_changed', (d) => ({ type: 'memory_energy_changed', ...d })],
  ['memory_distillation_complete', (d) => ({ type: 'memory_distillation_complete', ...d })],
  ['automation_triggered', (d) => ({ type: 'automation_triggered', ...d })],
  ['automation_completed', (d) => ({ type: 'automation_completed', ...d })],
]);
