// Unified terminal session hub: local PTY + SSH sessions behind one sessionId.
import { randomUUID } from "node:crypto"
import { basename } from "node:path"
import type { SshHostProfile } from "../../shared/ssh-host"
import type {
  TerminalEvent,
  TerminalSessionInfo,
  TerminalSessionStatus,
} from "../../shared/terminal-session"
import { localSessionId } from "../../shared/terminal-session"
import type { LocalTerminalOps, LocalTerminalSubscriber } from "./local-terminal"
import type { SshRuntimeSecret } from "./ssh-connect"
import type { SshSession, SshSessionOptions } from "./ssh-session"

export type TerminalHubDeps = {
  local: LocalTerminalOps
  profiles: () => SshHostProfile[]
  secretFor: (hostId: string) => SshRuntimeSecret
  createSshSession: (opts: SshSessionOptions, onEvent: (ev: TerminalEvent) => void) => SshSession
  onEvent: (ev: TerminalEvent) => void
  id?: () => string
  now?: () => number
}

type HubSession = {
  id: string
  kind: "local" | "ssh"
  directory?: string
  info: TerminalSessionInfo
  subscribers: Map<unknown, (ev: TerminalEvent) => void>
  buffer: string
  localSub?: LocalTerminalSubscriber
  ssh?: SshSession
}

export type TerminalHub = {
  list(): TerminalSessionInfo[]
  attachLocal(directory: string): Promise<TerminalSessionInfo>
  createSsh(input: { id?: string; hostId: string }): Promise<TerminalSessionInfo>
  restoreSsh(input: { id: string; hostId: string }): TerminalSessionInfo
  connect(sessionId: string): Promise<void>
  attach(sessionId: string, sub: (ev: TerminalEvent) => void, key: unknown): Promise<{ ok: boolean; replayed: boolean }>
  detach(sessionId: string, key: unknown): void
  input(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): Promise<void>
  close(sessionId: string): Promise<void>
  kill(sessionId: string): Promise<void>
  reconnect(sessionId: string): Promise<void>
  dispose(): void
}

const BUFFER_LIMIT = 200_000

function appendBuffer(prev: string, chunk: string): string {
  const next = prev + chunk
  if (next.length <= BUFFER_LIMIT) return next
  const cut = next.length - BUFFER_LIMIT
  const nl = next.indexOf("\n", cut)
  return next.slice(nl >= 0 && nl - cut < 2000 ? nl + 1 : cut)
}

export function createTerminalHub(deps: TerminalHubDeps): TerminalHub {
  const now = deps.now ?? Date.now
  const newId = deps.id ?? randomUUID
  const sessions = new Map<string, HubSession>()

  const handleEvent = (session: HubSession, ev: TerminalEvent) => {
    if (ev.type === "status") {
      session.info.status = ev.status
      if (ev.status === "connected") {
        session.info.connectedAt = ev.connectedAt ?? now()
      } else {
        session.info.connectedAt = undefined
      }
      session.info.reconnectAttempt = ev.reconnectAttempt
      session.info.reconnectInMs = ev.reconnectInMs
      session.info.error = ev.error
    } else if (ev.type === "data") {
      session.buffer = appendBuffer(session.buffer, ev.data)
    }
    // Exactly-once renderer delivery: the service broadcasts every event to
    // windows; attach subscribers only receive the replay buffer. Fanning out
    // here too would deliver every data chunk twice to the attaching window.
    deps.onEvent(ev)
  }

  const sshOptions = (id: string, hostId: string): SshSessionOptions => {
    const profile = deps.profiles().find((p) => p.id === hostId)
    if (!profile) throw new Error(`SSH 主机不存在：${hostId}`)
    const secret = deps.secretFor(hostId)
    const jumpProfile = profile.jumpHostId
      ? deps.profiles().find((p) => p.id === profile.jumpHostId)
      : undefined
    if (profile.jumpHostId && !jumpProfile) throw new Error(`跳板机不存在：${profile.jumpHostId}`)
    return {
      id,
      profile,
      secret,
      ...(jumpProfile ? { jump: { profile: jumpProfile, secret: deps.secretFor(jumpProfile.id) } } : {}),
    }
  }

  const addSsh = (id: string, hostId: string, connect: boolean): TerminalSessionInfo => {
    if (sessions.has(id)) {
      const existing = sessions.get(id)!
      return existing.ssh?.info() ?? { ...existing.info }
    }
    const options = sshOptions(id, hostId)
    const info: TerminalSessionInfo = {
      id,
      kind: "ssh",
      title: options.profile.name,
      subtitle: `${options.profile.username}@${options.profile.host}:${options.profile.port}`,
      hostId,
      status: "disconnected",
    }
    const session: HubSession = { id, kind: "ssh", info, subscribers: new Map(), buffer: "" }
    session.ssh = deps.createSshSession(options, (ev) => handleEvent(session, ev))
    sessions.set(id, session)
    if (connect) session.ssh.connect()
    return session.ssh.info()
  }

  return {
    list() {
      return [...sessions.values()].map((s) => (s.ssh ? s.ssh.info() : { ...s.info }))
    },

    async attachLocal(directory) {
      const id = localSessionId(directory, process.platform)
      const existing = sessions.get(id)
      if (existing && existing.localSub) {
        // Re-attach also recovers a local adapter whose WS closed or whose
        // serve restarted (reopen=true recreates the PTY when gone).
        const result = await deps.local.attach(existing.directory!, id, existing.localSub, "hub", { reopen: true })
        if (!result.ok) {
          existing.info.status = result.reason === "unavailable" ? "error" : "disconnected"
          existing.info.error =
            result.reason === "unavailable"
              ? "当前 runtime 不支持本地终端"
              : "终端已随服务重启关闭"
        } else if (existing.info.status !== "connected") {
          existing.info.status = "connected"
          existing.info.connectedAt = now()
        }
        return { ...existing.info }
      }

      const info: TerminalSessionInfo = {
        id,
        kind: "local",
        title: `本地 · ${basename(directory) || "终端"}`,
        directory,
        status: "connecting",
      }
      const session: HubSession = { id, kind: "local", directory, info, subscribers: new Map(), buffer: "" }
      const sub: LocalTerminalSubscriber = (ev) => handleEvent(session, ev)
      session.localSub = sub
      sessions.set(id, session)
      const result = await deps.local.attach(directory, id, sub, "hub")
      if (!result.ok) {
        info.status = result.reason === "unavailable" ? "error" : "disconnected"
        if (result.reason === "gone") info.error = "终端已随服务重启关闭"
        if (result.reason === "unavailable") info.error = "当前 runtime 不支持本地终端"
      }
      return { ...info }
    },

    async createSsh(input) {
      const id = input.id ?? `ssh:${newId()}`
      const info = addSsh(id, input.hostId, true)
      return { ...info }
    },

    restoreSsh(input) {
      const info = addSsh(input.id, input.hostId, false)
      return { ...info }
    },

    async connect(sessionId) {
      sessions.get(sessionId)?.ssh?.connect()
    },

    async attach(sessionId, sub, key) {
      const session = sessions.get(sessionId)
      if (!session) return { ok: false, replayed: false }
      session.subscribers.set(key, sub)
      if (session.buffer) sub({ type: "data", sessionId, data: session.buffer })
      return { ok: true, replayed: session.buffer.length > 0 }
    },

    detach(sessionId, key) {
      sessions.get(sessionId)?.subscribers.delete(key)
    },

    input(sessionId, data) {
      const session = sessions.get(sessionId)
      if (!session) return
      if (session.ssh) session.ssh.input(data)
      else if (session.directory) deps.local.input(session.directory, data)
    },

    async resize(sessionId, cols, rows) {
      const session = sessions.get(sessionId)
      if (!session) return
      if (session.ssh) session.ssh.resize(cols, rows)
      else if (session.directory) await deps.local.resize(session.directory, cols, rows)
    },

    async close(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) return
      if (session.ssh) {
        session.ssh.dispose()
      } else if (session.directory) {
        deps.local.detach(session.directory, "hub")
      }
      sessions.delete(sessionId)
    },

    async kill(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) return
      if (session.ssh) {
        session.ssh.dispose()
      } else if (session.directory) {
        await deps.local.kill(session.directory)
      }
      sessions.delete(sessionId)
    },

    async reconnect(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) return
      if (session.ssh) {
        session.ssh.reconnect()
      } else if (session.directory) {
        await this.attachLocal(session.directory)
      }
    },

    dispose() {
      for (const session of sessions.values()) {
        if (session.ssh) session.ssh.dispose()
        else if (session.directory) deps.local.detach(session.directory, "hub")
      }
      sessions.clear()
    },
  }
}
