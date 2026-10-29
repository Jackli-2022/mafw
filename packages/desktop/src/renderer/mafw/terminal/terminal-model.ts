// Pure renderer model for terminal tabs/status (spec 2026-10-29 §4/§5).
import type {
  PersistedTerminal,
  TerminalEvent,
  TerminalSessionInfo,
} from "../../../shared/terminal-session"

export { dirKey, localSessionId } from "../../../shared/terminal-session"

export function tabTitle(session: TerminalSessionInfo): string {
  return session.title || (session.kind === "local" ? "本地终端" : "SSH 会话")
}

export function statusTone(session: TerminalSessionInfo): "ok" | "warn" | "bad" | "idle" {
  switch (session.status) {
    case "connected":
      return "ok"
    case "connecting":
    case "reconnecting":
      return "warn"
    case "disconnected":
    case "error":
      return "bad"
    default:
      return "idle"
  }
}

export function statusLabel(session: TerminalSessionInfo): string {
  switch (session.status) {
    case "connecting":
      return "连接中"
    case "connected":
      return "已连接"
    case "reconnecting":
      return session.reconnectAttempt ? `重连中 ${session.reconnectAttempt}/5` : "重连中"
    case "disconnected":
      return "已断开"
    case "error":
      return "连接失败"
    case "closed":
      return "已关闭"
  }
}

export function reconnectLabel(session: TerminalSessionInfo): string | null {
  if (session.status !== "reconnecting" || session.reconnectInMs === undefined) return null
  const seconds = Math.max(1, Math.ceil(session.reconnectInMs / 1000))
  return `${seconds} 秒后重试${session.reconnectAttempt ? `（${session.reconnectAttempt}/5）` : ""}`
}

/** Pick the tab to activate after closing `closingId` (previous first, then next). */
export function nextActiveAfterClose(
  tabs: TerminalSessionInfo[],
  activeId: string | null,
  closingId: string,
): string | null {
  if (activeId !== closingId) return activeId
  const index = tabs.findIndex((t) => t.id === closingId)
  if (index < 0) return activeId
  return tabs[index - 1]?.id ?? tabs[index + 1]?.id ?? null
}

export function persistedTabs(tabs: TerminalSessionInfo[], activeId: string | null): PersistedTerminal {
  return {
    activeId,
    tabs: tabs.map((t) => ({
      id: t.id,
      kind: t.kind,
      ...(t.hostId ? { hostId: t.hostId } : {}),
      ...(t.title ? { title: t.title } : {}),
    })),
  }
}

/** Merge a main-process status event into the tab list without dropping identity fields. */
export function applyTerminalEvent(
  state: { sessions: TerminalSessionInfo[] },
  ev: TerminalEvent,
): { sessions: TerminalSessionInfo[] } {
  if (ev.type !== "status") return state
  let found = false
  const sessions = state.sessions.map((s) => {
    if (s.id !== ev.sessionId) return s
    found = true
    const next: TerminalSessionInfo = { ...s, status: ev.status }
    if (ev.reconnectAttempt !== undefined) next.reconnectAttempt = ev.reconnectAttempt
    if (ev.reconnectInMs !== undefined) next.reconnectInMs = ev.reconnectInMs
    if (ev.error !== undefined) next.error = ev.error
    if (ev.status === "connected") {
      next.connectedAt = ev.connectedAt ?? s.connectedAt
    } else {
      next.connectedAt = undefined
      next.reconnectAttempt = ev.reconnectAttempt
      next.reconnectInMs = ev.reconnectInMs
    }
    if (ev.status !== "error") next.error = undefined
    return next
  })
  return found ? { sessions } : state
}
