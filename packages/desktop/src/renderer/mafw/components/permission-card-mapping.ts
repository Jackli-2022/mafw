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
    impact: req.metadata?.impact as string | undefined,
    createdAt,
    messageID: req.tool?.messageID,
    callID: req.tool?.callID,
  }
}

/** 🛡 toggle 循环（T11 消费；替代已删除的 permission-mode.ts nextPermissionMode）。 */
export function nextMode(prev: "manual" | "auto"): "manual" | "auto" {
  return prev === "manual" ? "auto" : "manual"
}

/** autoResolved 卡不发 OS 通知（gateway 已自动处置）。 */
export function shouldNotify(card: { autoResolved?: string }): boolean {
  return !card.autoResolved
}
