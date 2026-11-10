/**
 * 消息错误 → 规范 `{kind, message}`（与 runtime 无关的中性归一层）。
 *
 * 实现已迁至 `@mafw/runtime-core`（Plan 6 Task 2：driver 需要同一套错误的归一，
 * 不得依赖 gateway）。本模块只保留既有导入路径的再导出。
 */
export { canonicalError, errorKindOf, errorTextOf, isCanonicalError } from '@mafw/runtime-core';
export type { MafwErrorKind } from '@mafw/runtime-core';
