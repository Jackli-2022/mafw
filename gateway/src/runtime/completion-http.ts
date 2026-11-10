/**
 * 共享的无状态直连 HTTP 补全传输（OpenAI-compatible chat completions）。
 *
 * Plan 6 Task 3：实现迁至 `@mafw/runtime-core`（`completion-http.ts`）；本模块
 * 只保留旧导出路径（re-export shim）。凭据解析改为调用方注入的 `credentials`
 * resolver（不再在传输层 import gateway `auth.ts`）：
 *
 * ```ts
 * httpComplete(req, {
 *   ...deps,
 *   credentials: (providerID) => getProviderApiKey(providerID, undefined, credentials),
 * });
 * ```
 */
export { httpComplete, resolveCompletionBaseUrl } from '@mafw/runtime-core';
export type {
  HttpCompletionDeps,
  HttpCompletionRequest,
  HttpCompletionResult,
} from '@mafw/runtime-core';
