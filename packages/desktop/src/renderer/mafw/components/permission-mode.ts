// Per-session approval mode (Cowork Manual/Auto-lite). Pure decision logic:
// auto mode approves safe commands only, with a hard budget of consecutive
// auto-approvals after which the mode falls back to manual (runaway agent
// loops must never auto-approve forever). Dangerous commands (the double-click
// arm class) always require a human.
export type PermissionMode = "manual" | "auto"

export const AUTO_APPROVE_BUDGET = 25

export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  return mode === "manual" ? "auto" : "manual"
}

export function shouldAutoApprove(opts: {
  mode: PermissionMode
  isDangerous: boolean
  autoApprovals?: number
}): boolean {
  if (opts.mode !== "auto") return false
  if (opts.isDangerous) return false
  if ((opts.autoApprovals ?? 0) >= AUTO_APPROVE_BUDGET) return false
  return true
}
