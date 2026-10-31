// 左 dock 状态模型（纯函数，无 Solid 依赖）。
// spec: docs/superpowers/specs/2026-10-22-workbench-layout-design.md D2/D3/Builder 已决项
export type LeftDockFace = "sessions" | "search" | "notes" | "pod"
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

export interface LeftDockStorage {
  setItem(key: string, value: string): void
}

/**
 * Persist the preference BEFORE the caller calls setLeftDock.
 * `shouldAutoRestoreLeftDock` reads localStorage from an effect; if state flips
 * first, the effect sees the stale "1" and reopens the dock (two-click close bug).
 */
export function persistLeftDockState(io: LeftDockStorage, next: LeftDockState): void {
  try {
    io.setItem("mafw-left-dock-open", next.open ? "1" : "0")
    io.setItem("mafw-left-dock-face", next.face)
  } catch { /* storage blocked — fail-open */ }
}

export function toggleLeftDockState(s: LeftDockState, face: LeftDockFace, io: LeftDockStorage): LeftDockState {
  const next = toggleFace(s, face)
  persistLeftDockState(io, next)
  return next
}

export function closeLeftDockState(s: LeftDockState, io: LeftDockStorage): LeftDockState {
  const next = { ...s, open: false }
  persistLeftDockState(io, next)
  return next
}

// 宽度决定模态：推挤必须保住默认档 50:50（chat 640 + 工作台 640，spec 2026-10-27 §6.5）。
// 只保证默认档：chat 拉 520/760 不参与阈值，由 workbench-detents 护栏钳制。
export const LEFT_RAIL_WIDTH = 46
export const PUSH_PAIR_BUDGET = 1280 // 640 chat 默认档 + 640 工作台下限

/** 推挤预算：窗口宽 ≥ 此值才 push（默认 dock 264 → 1590）。 */
export function leftDockPushBudget(dockWidth: number): number {
  return LEFT_RAIL_WIDTH + dockWidth + PUSH_PAIR_BUDGET
}

/** push 态拖宽上限：钳在预算内，防止拖过预算点模式翻转、手柄消失。 */
export function leftDockPushDragMax(viewportWidth: number): number {
  const budgeted = Math.min(LEFT_DOCK_WIDTH.max, viewportWidth - LEFT_RAIL_WIDTH - PUSH_PAIR_BUDGET)
  return Math.max(LEFT_DOCK_WIDTH.min, budgeted)
}

export function resolveMode(open: boolean, width: number, dockWidth: number): LeftDockMode {
  if (!open) return "closed"
  return width >= leftDockPushBudget(dockWidth) ? "push" : "overlay"
}

/** 启动时存储为 open 的左 dock 只在可推挤宽度恢复；浮层态不自动展开。 */
export function restoreLeftDockOpen(stored: string | null, width: number, dockWidth: number): boolean {
  return stored === "1" && width >= leftDockPushBudget(dockWidth)
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

const LEFT_RAIL_WIDTH_LEGACY = 46
const CORE_CHAT_MIN_WIDTH = 520
const RIGHT_WORKBENCH_MIN_WIDTH = 520

/** 推挤时给 Chat + 右工作台留够最小宽度；新预算规则下 push 恒满足，此处为纵深防御。 */
export function effectiveLeftDockWidth(width: number, viewportWidth: number): number {
  const maxForViewport = viewportWidth - LEFT_RAIL_WIDTH_LEGACY - CORE_CHAT_MIN_WIDTH - RIGHT_WORKBENCH_MIN_WIDTH
  return Math.min(clampLeftDockWidth(width), clampLeftDockWidth(maxForViewport))
}

/** 启动时因窄幅被抑制的 open 偏好，在拉宽到推挤预算点后恢复。 */
export function shouldAutoRestoreLeftDock(stored: string | null, open: boolean, viewportWidth: number, dockWidth: number): boolean {
  return stored === "1" && !open && viewportWidth >= leftDockPushBudget(dockWidth)
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
