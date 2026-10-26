// 左 dock 状态模型（纯函数，无 Solid 依赖）。
// spec: docs/superpowers/specs/2026-10-22-workbench-layout-design.md D2/D3/Builder 已决项
export type LeftDockFace = "sessions" | "search" | "notes"
export type LeftDockMode = "closed" | "overlay" | "push"

export interface LeftDockState {
  face: LeftDockFace
  open: boolean
}

// VS Code toggle 语义：点已激活的同 face = 收起；不同 face = 切换保持打开。
export function toggleFace(s: LeftDockState, face: LeftDockFace): LeftDockState {
  if (s.open && s.face === face) return { face: s.face, open: false }
  return { face, open: true }
}

// 宽度决定模态：≥1366 推挤，以下浮层。窗口最大化与否不再改变布局。
export const LEFT_DOCK_PUSH_MIN_WIDTH = 1366

export function resolveMode(open: boolean, width: number): LeftDockMode {
  if (!open) return "closed"
  return width >= LEFT_DOCK_PUSH_MIN_WIDTH ? "push" : "overlay"
}

/** 启动时存储为 open 的左 dock 只在可推挤宽度恢复；浮层态不自动展开。 */
export function restoreLeftDockOpen(stored: string | null, width: number): boolean {
  return stored === "1" && width >= LEFT_DOCK_PUSH_MIN_WIDTH
}

// 浮层模式下，选中会话/导航离开 chat 时自动关；推挤列保持。
export function shouldCloseOnSelect(mode: LeftDockMode): boolean {
  return mode === "overlay"
}

// 左 dock 宽度（加载即 clamp；ResizeHandle 也用同一上下限）。
export const LEFT_DOCK_WIDTH = { min: 180, max: 400, default: 264 } as const

export function clampLeftDockWidth(w: number): number {
  return Math.min(LEFT_DOCK_WIDTH.max, Math.max(LEFT_DOCK_WIDTH.min, w))
}

// 旧 Rail 宽度键严格一次性迁移：新键有效则忽略旧键；否则采用旧键。
// migrated=true 时调用方负责写入新键并删除旧键（旧键此后不再参与）。
export function resolveLeftDockWidth(
  current: string | null,
  legacy: string | null,
): { width: number; migrated: boolean } {
  const cur = Number(current)
  if (current !== null && Number.isFinite(cur) && cur > 0) {
    return { width: clampLeftDockWidth(cur), migrated: false }
  }
  const old = Number(legacy)
  if (legacy !== null && Number.isFinite(old) && old > 0) {
    return { width: clampLeftDockWidth(old), migrated: true }
  }
  return { width: LEFT_DOCK_WIDTH.default, migrated: false }
}

// 徽标数字必须进入无障碍名称（否则读屏只听到 "Dashboard"，审批数不可见）。
export function railAriaLabel(label: string, badge?: number): string {
  return badge !== undefined && badge > 0 ? `${label}（${badge} 项待处理）` : label
}

// 连接点状态：网关被用户明确停止（stopped）是中性态，不能红点冒充故障。
export function connDotState(phase: string, gatewayState?: string | null): string {
  if (gatewayState === "stopped") return "stopped"
  return phase === "connected" ? "ready"
    : phase === "reconnecting" ? "reconnecting"
    : phase === "down" ? "failed"
    : "starting"
}
