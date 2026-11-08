// 权限三档的 composer 呈现（纯函数，bun 可测）。
// 2026-11-09 定稿：常驻图标、无文字——靠「形状 + 颜色」区分（色盲靠形状），hover 出解释。
// 业界（Claude Code / Codex / VS Code Copilot）都用文字指示，我们在 256px 下只能用图标，
// 所以用三种形状 + 三种语义色做补偿编码。
import type { PermissionMode } from "./permission-card-mapping"

export type PermissionTone = "muted" | "accent" | "danger"
export type PermissionIcon = "eye" | "shield" | "warning"

export interface PermissionPresentation {
  /** 菜单 / aria 用的短标签。 */
  label: string
  icon: PermissionIcon
  tone: PermissionTone
  /** hover 解释（含"点击会切到哪一档"）。 */
  hint: string
}

export const PERMISSION_PRESENTATION: Record<PermissionMode, PermissionPresentation> = {
  "read-only": {
    label: "只读",
    icon: "eye",
    tone: "muted",
    hint: "审批模式：只读 — 只看不改，任何写操作都要你确认。点击切到「自动」",
  },
  auto: {
    label: "自动",
    icon: "shield",
    tone: "accent",
    hint: "审批模式：自动 — 安全命令免审，高危仍需确认；连续 25 次后回落只读。点击切到「全开」",
  },
  "full-access": {
    label: "全开",
    icon: "warning",
    tone: "danger",
    hint: "审批模式：全开 — 不再弹审批，危险命令也直接执行。点击切回「只读」",
  },
}

/** 未知 / legacy（gateway 会把 'manual' 归一为 read-only）一律回退只读，绝不丢安全默认。 */
export function permissionPresentation(mode: PermissionMode | string | null | undefined): PermissionPresentation {
  return PERMISSION_PRESENTATION[mode as PermissionMode] ?? PERMISSION_PRESENTATION["read-only"]
}

export function permissionAriaLabel(mode: PermissionMode | string | null | undefined): string {
  return `审批模式：${permissionPresentation(mode).label}（点击切换）`
}
