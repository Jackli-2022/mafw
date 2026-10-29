// Host drawer view model: group by `group`, search name/host/user/group,
// aggregate SSH session counts and status priority.
import type { SshHostProfile } from "../../../shared/ssh-host"
import type { TerminalSessionInfo } from "../../../shared/terminal-session"

export type HostStatus = "connected" | "reconnecting" | "disconnected"

export type HostGroup = {
  group: string
  hosts: Array<{
    host: SshHostProfile
    status: HostStatus
    sessionCount: number
  }>
}

function priority(status: TerminalSessionInfo["status"]): number {
  if (status === "connected") return 2
  if (status === "reconnecting") return 1
  return 0
}

function hostStatus(status: TerminalSessionInfo["status"]): HostStatus {
  if (status === "connected") return "connected"
  if (status === "reconnecting") return "reconnecting"
  return "disconnected"
}

export function groupHosts(
  hosts: SshHostProfile[],
  sessions: TerminalSessionInfo[],
  query: string,
): HostGroup[] {
  const q = query.trim().toLowerCase()
  const byHost = new Map<string, { status: HostStatus; count: number }>()
  for (const session of sessions) {
    if (session.kind !== "ssh" || !session.hostId) continue
    const current = byHost.get(session.hostId) ?? { status: "disconnected", count: 0 }
    current.count += 1
    if (priority(session.status) > priority(current.status)) {
      current.status = hostStatus(session.status)
    }
    byHost.set(session.hostId, current)
  }

  const groups = new Map<string, HostGroup["hosts"]>()
  for (const host of hosts) {
    if (q) {
      const haystack = `${host.name} ${host.host} ${host.username} ${host.group}`.toLowerCase()
      if (!haystack.includes(q)) continue
    }
    const group = host.group.trim() || "未分组"
    const list = groups.get(group) ?? []
    const agg = byHost.get(host.id)
    list.push({
      host,
      status: agg?.status ?? "disconnected",
      sessionCount: agg?.count ?? 0,
    })
    groups.set(group, list)
  }

  return [...groups.entries()].map(([group, list]) => ({ group, hosts: list }))
}
