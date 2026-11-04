// Workbench Focus 快照：进入全宽前保存 detent/L1/L2，退出时原样恢复。
// 纯数据模块，不接触 Solid signal 或 localStorage（Focus 本身是瞬态）。
import type { WorkbenchDetent } from "./workbench-detents"
import type { ExecutionSection, WorkbenchSurface, WorkbenchView } from "./workbench-views"

export type WorkbenchFocusSnapshot = {
  detent: WorkbenchDetent
  view: WorkbenchView
  surface: WorkbenchSurface
  previousSurface: "code" | "browser"
  executionSection: ExecutionSection
}

export function captureWorkbenchFocusSnapshot(current: WorkbenchFocusSnapshot): WorkbenchFocusSnapshot {
  return { ...current }
}

export function restoreWorkbenchFocusSnapshot(
  snapshot: WorkbenchFocusSnapshot | null,
  fallback: WorkbenchFocusSnapshot,
): WorkbenchFocusSnapshot {
  return snapshot ? { ...snapshot } : { ...fallback }
}
