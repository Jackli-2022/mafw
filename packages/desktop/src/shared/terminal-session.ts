// Terminal session vocabulary shared by main and renderer (spec 2026-10-29 §5/§7).
// Pure types + path normalization only; no Solid, Electron, or Node-only imports.

export type TerminalSessionKind = "local" | "ssh"

export type TerminalSessionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error"
  | "closed"

export type TerminalSessionInfo = {
  id: string
  kind: TerminalSessionKind
  title: string
  subtitle?: string
  directory?: string
  hostId?: string
  status: TerminalSessionStatus
  reconnectAttempt?: number
  reconnectInMs?: number
  connectedAt?: number
  error?: string
}

export type TerminalProbe = {
  localAvailable: boolean
  sshAvailable: boolean
  reason?: string
}

export type PersistedTab = {
  id: string
  kind: TerminalSessionKind
  hostId?: string
  title?: string
}

export type PersistedTerminal = {
  activeId: string | null
  tabs: PersistedTab[]
}

export type HostKeyRequest = {
  requestId: string
  sessionId: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  kind: "new" | "changed"
  oldFingerprint?: string
}

export type PromptRequest = {
  requestId: string
  sessionId: string
  title: string
  instructions?: string
  prompts: { prompt: string; echo: boolean }[]
}

export type TerminalEvent =
  | { type: "data"; sessionId: string; data: string }
  | {
      type: "status"
      sessionId: string
      status: TerminalSessionStatus
      reconnectAttempt?: number
      reconnectInMs?: number
      connectedAt?: number
      error?: string
    }
  | ({ type: "hostkey" } & HostKeyRequest)
  | ({ type: "prompt" } & PromptRequest)

/** Directory key: win32 normalizes separators + case, darwin folds case, linux is exact. */
export function dirKey(dir: string, platform: string): string {
  const normalized = platform === "win32" ? dir.replace(/\\/g, "/") : dir
  return platform === "win32" || platform === "darwin" ? normalized.toLowerCase() : normalized
}

/** Stable local session id for a directory. */
export function localSessionId(directory: string, platform: string): string {
  return `local:${dirKey(directory, platform)}`
}
