// 左 dock 状态模型（纯函数，无 Solid 依赖）。
// spec: docs/superpowers/specs/2026-10-22-workbench-layout-design.md D2/D3/Builder 已决项
export type LeftDockFace = "sessions" | "search"
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

// 窗口化（非最大化）恒浮层；最大化/全屏且非窄视口才推挤（窄窗口恒浮层）。
export function resolveMode(open: boolean, maximized: boolean, narrow: boolean): LeftDockMode {
  if (!open) return "closed"
  if (maximized && !narrow) return "push"
  return "overlay"
}

// 旧 Rail 键一次性迁移：老用户显式收起过（"1"）→ 左 dock 保持收起；
// 旧键不存在 → 不表态（null），由新键默认值决定。
export function migrateLegacyRail(
  railCollapsed: string | null,
  railWidth: string | null,
): { open: boolean | null; width: number | null } {
  const width = railWidth === null ? null : Number(railWidth)
  if (railCollapsed === null) return { open: null, width: Number.isFinite(width) ? width : null }
  return { open: railCollapsed === "0", width: Number.isFinite(width) ? width : null }
}
