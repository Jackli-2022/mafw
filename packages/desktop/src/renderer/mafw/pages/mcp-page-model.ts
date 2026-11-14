export type McpStatus = "connected" | "disabled" | "failed" | "needs_auth" | "unknown"
export type McpStatusTone = "ok" | "warn" | "fail" | "muted"
export type McpFilter = "all" | "connected" | "attention"

export interface McpServerLike {
  status?: string
}

export interface McpSummary {
  total: number
  connected: number
  needsAuth: number
  failed: number
  offline: number
}

/** Human labels for the runtime's MCP status enum. */
export function mcpStatusLabel(status: string | undefined): string {
  switch (status) {
    case "connected": return "已连接"
    case "needs_auth": return "需要认证"
    case "failed": return "连接失败"
    case "disabled": return "已禁用"
    default: return "未知"
  }
}

export function mcpStatusTone(status: string | undefined): McpStatusTone {
  switch (status) {
    case "connected": return "ok"
    case "needs_auth": return "warn"
    case "failed": return "fail"
    default: return "muted"
  }
}

export function summarizeMcpServers(servers: ReadonlyArray<McpServerLike> | null | undefined): McpSummary {
  const out: McpSummary = { total: 0, connected: 0, needsAuth: 0, failed: 0, offline: 0 }
  for (const server of servers ?? []) {
    out.total += 1
    switch (server?.status) {
      case "connected": out.connected += 1; break
      case "needs_auth": out.needsAuth += 1; break
      case "failed": out.failed += 1; break
      default: out.offline += 1; break
    }
  }
  return out
}

/** Filter bar semantics: "attention" = needs_auth / failed / unknown, not connected or disabled. */
export function mcpFilterMatches(status: string | undefined, filter: McpFilter): boolean {
  if (filter === "all") return true
  if (filter === "connected") return status === "connected"
  return status !== "connected" && status !== "disabled"
}
