// packages/desktop/src/renderer/mafw/execution-usage.ts
// 「执行 → 概览 → 用量与上下文」的展开状态（跨组件共享）：
// 命令面板/上下文 pill 可以直接把它打开，避免 UsageDock 藏在折叠区里找不到。
import { createSignal } from "solid-js"

const [executionUsageOpen, setExecutionUsageOpen] = createSignal(false)

export { executionUsageOpen, setExecutionUsageOpen }

/** 打开用量面板（调用方负责同时切到 执行 → 概览）。 */
export function openExecutionUsage(): void {
  setExecutionUsageOpen(true)
}
