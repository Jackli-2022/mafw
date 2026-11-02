// 纯函数（bun 可测）：asked 事件 / permissionList → 一张 PermissionCardData。
// Review I1/I2：只消费规范 `MafwPermissionRequest`（id / kind / targets / suggestedRule
// / extensions），不再读 opencode `permission`+`patterns` 或 pi `toolName`+`args`
// ——pi 卡片曾因此丢 id（审批答复 undefined）且正文只显示 "shell"。
// `mafwPolicy` 是 gateway 富化字段（非 runtime 原生）：auto-approve / auto-deny
// 直接出生即 resolved（非交互记录，不进串行队列不发通知）；human 时 verdict 覆盖本地 risk 启发式。
import type { PermissionCardData } from "./PermissionCard"

export function actionTypeOf(kind: string): { type: string; title: string } {
  const p = (kind || "").toLowerCase()
  if (p.includes("bash") || p.includes("shell") || p.includes("terminal") || p.includes("command")) {
    return { type: "shell", title: "执行 Shell 命令" }
  }
  if (p.includes("unlink") || p.includes("delete")) return { type: "file-delete", title: "删除文件" }
  if (p.includes("write") || p.includes("edit") || p.includes("patch")) return { type: "file-write", title: "写入文件" }
  if (p.includes("network") || p.includes("webfetch") || p.includes("http") || p.includes("web")) return { type: "network", title: "访问网络" }
  return { type: "custom", title: kind || "工具调用" }
}

export function riskOf(kind: string, targets: string[]): "medium" | "high" {
  const p = (kind || "").toLowerCase()
  const joined = (targets ?? []).join(" ").toLowerCase()
  if (p.includes("unlink") || p.includes("delete")) return "high"
  if (p.includes("bash") && /\b(rm|del|format)\b/.test(joined)) return "high"
  return "medium"
}

export function dangerousPartsOf(kind: string, targets: string[]): string[] {
  const parts: string[] = []
  for (const target of targets ?? []) {
    if (/\b(rm|del|format|mv|dd)\b/.test(String(target).toLowerCase())) parts.push(target)
  }
  return parts
}

/** 规范请求的展示载荷：targets 优先；空 targets 退回 kind（保底不给空卡）。 */
export function permissionPayloadOf(kind: string, targets: string[]): string {
  const list = (targets ?? []).filter((t) => typeof t === "string" && t.length > 0)
  return list.length ? list.join(" && ") : kind
}

export function mapPermissionCard(req: any, createdAt: number, agentTitle: string): PermissionCardData {
  // 规范字段（gateway 投影保证存在）；缺 id 时用空串而不是 undefined——
  // 审批答复绝不能以 undefined 作为 requestId。
  const id = typeof req?.id === "string" ? req.id : ""
  const kind = typeof req?.kind === "string" && req.kind ? req.kind : "tool"
  const targets: string[] = Array.isArray(req?.targets)
    ? req.targets.filter((t: unknown): t is string => typeof t === "string")
    : []
  const { type, title } = actionTypeOf(kind)
  const extensions = (req?.extensions ?? {}) as { mafwPolicy?: { action?: string; verdict?: string }; impact?: string }
  const policy = (req?.mafwPolicy ?? extensions.mafwPolicy) as { action?: string; verdict?: string } | undefined
  const status: PermissionCardData["status"] =
    policy?.action === "auto-approve" ? "allowed-once"
    : policy?.action === "auto-deny" ? "denied"
    : "pending"
  const risk: PermissionCardData["risk"] =
    policy?.verdict === "dangerous" ? "high"
    : policy?.verdict === "safe" && policy?.action === "human" ? "medium"
    : riskOf(kind, targets)
  return {
    id,
    sessionID: typeof req?.sessionID === "string" ? req.sessionID : "",
    agentName: agentTitle || "Agent",
    status,
    risk,
    autoResolved: policy?.action === "auto-approve" ? "auto" : policy?.action === "auto-deny" ? "internal" : undefined,
    action: {
      type,
      title,
      payload: permissionPayloadOf(kind, targets),
      dangerousParts: dangerousPartsOf(kind, targets),
    },
    toolName: kind,
    impact: extensions.impact,
    createdAt,
    messageID: req?.tool?.messageID,
    callID: req?.tool?.callID,
  }
}

/** 审批三档预设（切 1）：read-only（只读放行、变更必问）/ auto（工作区内自由、危险问，25 次预算回落 read-only）/ full-access（全放）。legacy 'manual' 被 gateway 归一为 read-only。 */
export type PermissionMode = "read-only" | "auto" | "full-access"
export const PERMISSION_MODES: PermissionMode[] = ["read-only", "auto", "full-access"]

/** 🛡 toggle 循环（三档；未知值回退 read-only）。 */
export function nextMode(prev: PermissionMode | string): PermissionMode {
  const idx = PERMISSION_MODES.indexOf(prev as PermissionMode)
  if (idx < 0) return "auto" // read-only 的下一个
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
