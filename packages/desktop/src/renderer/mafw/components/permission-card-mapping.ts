// 纯函数（bun 可测）：asked 事件 / permissionList 项 → PermissionCardData。
// mafwPolicy（gateway 富化）优先：auto-approve/auto-deny 直接出生即 resolved
// （非交互记录，不进串行队列不发通知）；human 时 verdict 覆盖本地 risk 启发式。
import type { PermissionCardData } from "./PermissionCard"

export function actionTypeOf(permission: string): { type: string; title: string } {
  const p = permission.toLowerCase()
  if (p.includes("bash") || p.includes("shell") || p.includes("terminal") || p.includes("command")) {
    return { type: "shell", title: "执行 Shell 命令" }
  }
  if (p.includes("unlink") || p.includes("delete")) return { type: "file-delete", title: "删除文件" }
  if (p.includes("write") || p.includes("edit")) return { type: "file-write", title: "写入文件" }
  if (p.includes("network") || p.includes("webfetch") || p.includes("http")) return { type: "network", title: "访问网络" }
  return { type: "custom", title: permission }
}

export function riskOf(permission: string, patterns: string[]): "medium" | "high" {
  const p = permission.toLowerCase()
  const joined = patterns.join(" ").toLowerCase()
  if (p.includes("unlink") || p.includes("delete")) return "high"
  if (p.includes("bash") && /\b(rm|del|format)\b/.test(joined)) return "high"
  return "medium"
}

export function dangerousPartsOf(permission: string, patterns: string[]): string[] {
  const parts: string[] = []
  for (const pat of patterns) {
    if (/\b(rm|del|format|mv|dd)\b/.test(pat.toLowerCase())) parts.push(pat)
  }
  return parts
}

export function mapPermissionCard(req: any, createdAt: number, agentTitle: string): PermissionCardData {
  const patterns = Array.isArray(req.patterns) ? req.patterns : []
  const permission = req.permission ?? req.toolName ?? ""
  const { type, title } = actionTypeOf(permission)
  const policy = req.mafwPolicy as { action?: string; verdict?: string } | undefined
  const status: PermissionCardData["status"] =
    policy?.action === "auto-approve" ? "allowed-once"
    : policy?.action === "auto-deny" ? "denied"
    : "pending"
  const risk: PermissionCardData["risk"] =
    policy?.verdict === "dangerous" ? "high"
    : policy?.verdict === "safe" && policy?.action === "human" ? "medium"
    : riskOf(permission, patterns)
  return {
    id: req.id,
    sessionID: req.sessionID,
    agentName: agentTitle || "Agent",
    status,
    risk,
    autoResolved: policy?.action === "auto-approve" ? "auto" : policy?.action === "auto-deny" ? "internal" : undefined,
    action: {
      type,
      title,
      payload: patterns.join(" && ") || permission,
      dangerousParts: dangerousPartsOf(permission, patterns),
    },
    toolName: permission || undefined,
    impact: req.metadata?.impact as string | undefined,
    createdAt,
    messageID: req.tool?.messageID,
    callID: req.tool?.callID,
  }
}

/** 审批三档预设（切片 1）：read-only（只读放行、变更必问）/ auto（工作区内自由、危险问、
 *  25 次预算回落 read-only）/ full-access（全放）。legacy 'manual' 由 gateway 归一化 read-only。 */
export type PermissionMode = "read-only" | "auto" | "full-access"
export const PERMISSION_MODES: PermissionMode[] = ["read-only", "auto", "full-access"]

/** 🛡 toggle 循环（三档；未知值回退 read-only）。 */
export function nextMode(prev: PermissionMode | string): PermissionMode {
  const idx = PERMISSION_MODES.indexOf(prev as PermissionMode)
  if (idx < 0) return "auto" // read-only 的下一档
  return PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length]
}

/** autoResolved 卡不发 OS 通知（gateway 已自动处置）。 */
export function shouldNotify(card: { autoResolved?: string }): boolean {
  return !card.autoResolved
}

/** autoResolved 徽标文案；null = 无自动处置（走既有徽标文案）。 */
export function autoBadgeText(autoResolved: "auto" | "internal" | undefined): string | null {
  if (autoResolved === "auto") return "已自动放行"
  if (autoResolved === "internal") return "已自动拒绝 · 内部"
  return null
}
