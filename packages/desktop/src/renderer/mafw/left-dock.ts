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

// 窗口化（非最大化）恒浮层；最大化/全屏推挤（用户决策：由窗口状态决定，
// 不再用窄宽度断点劫持——高分屏缩放下最大化窗口 CSS 宽可能 <1200）。
export function resolveMode(open: boolean, maximized: boolean): LeftDockMode {
  if (!open) return "closed"
  return maximized ? "push" : "overlay"
}

// 浮层模式下，选中会话/导航离开 chat 时自动关；推挤列保持。
export function shouldCloseOnSelect(mode: LeftDockMode): boolean {
  return mode === "overlay"
}

// 旧 Rail 宽度键一次性迁移；非法值返回 null（由新键默认值决定）。
// 左 dock 默认关闭是新布局的既定默认（spec mockup），旧收起/展开状态不再沿用。
export function migrateLegacyRailWidth(railWidth: string | null): number | null {
  if (railWidth === null) return null
  const width = Number(railWidth)
  return Number.isFinite(width) ? width : null
}
