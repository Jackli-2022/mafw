/**
 * Runtime server root（**不是 session 目录**）。
 *
 * 规范（2026-10-29）：agent runtime 的 server（opencode `serve`）必须在一个
 * 稳定的、跨项目共享的根目录启动，而不是继承 gateway/Electron 的启动目录，
 * 也不能跟随 UI 当前项目切换（server 不随项目重启）。
 *
 * 固定根：`~/.mafw/runtime-root`。
 * session 的工作目录仍然只由 `SessionCreateOpts.directory` 决定。
 *
 * Plan 6 Task 3：实现迁至 `@mafw/runtime-core`（`runtime-root.ts`）；本模块
 * 只保留旧导出路径（re-export shim），调用方无需改动。
 */
export {
  RUNTIME_ROOT_DIRNAME,
  resolveRuntimeRoot,
  ensureRuntimeRoot,
} from '@mafw/runtime-core';
