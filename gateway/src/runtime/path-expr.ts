/**
 * 裁剪 JSONPath 子集求值器 —— 迁移到 `@mafw/runtime-core`（Plan 6 Task 2）。
 *
 * gateway 侧保留本模块作为再导出路径，既有导入零改动。
 */
export { isValidPath, getPath, evalConditions, renderTemplate, setPath } from '@mafw/runtime-core';
export type { Condition } from '@mafw/runtime-core';
