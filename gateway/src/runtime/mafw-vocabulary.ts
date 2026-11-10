/**
 * MAFW 事件词汇 v2 —— gateway 侧 re-export shim。
 *
 * Plan 6 Task 3：词汇单源迁至 `@mafw/runtime-contract`（`vocabulary.ts`），
 * runtime 驱动不再需要 import gateway 即可声明 canonical 恒等行。
 *
 * 客户端契约单源仍在 packages/gateway-sdk/src/events.ts（零 import 约定），
 * 与之的双向交叉钉扎在 gateway `vocabulary-sync.test.ts`。
 *
 * 设计：docs/superpowers/specs/2026-10-12-native-event-vocabulary-design.md
 */

export { MAFW, MAFW_RUNTIME_EVENT_NAMES, RUNTIME_IDENTITY_TYPES } from '@mafw/runtime-contract';

/** gateway 侧扁平广播名全集（= SDK FLAT_EVENT_TYPES；交叉测试钉扎）。 */
export const MAFW_FLAT_EVENT_NAMES: readonly string[] = [
  'user_question', 'user_feedback', 'goal_created', 'state_change', 'phase_transition',
  'memory_written', 'memory_energy_changed', 'memory_distillation_complete',
  'automation_triggered', 'automation_completed', 'project_registered',
  'runtime_switched', 'mafw_commands_changed', 'goal_node', 'connected', 'plugins.changed',
];
