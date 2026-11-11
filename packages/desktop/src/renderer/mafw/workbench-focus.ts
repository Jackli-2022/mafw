// Workbench Focus 快照：进入全宽前保存 detent/context/surface/execution，退出时原样恢复。
// 纯数据模块，不接触 Solid signal 或 localStorage（Focus 本身是瞬态）。
import type { WorkbenchDetent } from "./workbench-detents"
import type { ExecutionSection, WorkbenchSurface } from "./workbench-views"
import type { WorkbenchContext } from "./workbench-context"

export type WorkbenchFocusSnapshot = {
  detent: WorkbenchDetent
  context: WorkbenchContext
  surface: WorkbenchSurface
  previousSurface: "code" | "browser"
  executionOpen: boolean
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
