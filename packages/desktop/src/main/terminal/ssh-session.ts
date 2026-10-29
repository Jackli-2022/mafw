// SSH session lifecycle (spec 2026-10-29 §6.2/§6.3/§6.6).
// One ssh2 client + shell stream per session; ring buffer for reattach/replay.
import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import type { ConnectConfig } from "ssh2"
import type { KnownHostEntry, SshHostProfile } from "../../shared/ssh-host"
import type {
  HostKeyRequest,
  PromptRequest,
  TerminalEvent,
  TerminalSessionInfo,
  TerminalSessionStatus,
} from "../../shared/terminal-session"
import {
  buildSshConnectConfig,
  createHostVerifier,
  type HostKeyDecision,
  type HostKeyResponder,
  type SshRuntimeSecret,
} from "./ssh-connect"
import { canAutoReconnect, reconnectDelay } from "./reconnect-policy"
import { redactError } from "./redact"

export type SshClientLike = EventEmitter & {
  connect(cfg: ConnectConfig): void
  shell(
    opts: { term: string; cols: number; rows: number; width?: number; height?: number },
    cb: (err: Error | null, stream: SshStreamLike) => void,
  ): void
  end(): void
}

export type SshStreamLike = EventEmitter & {
  write(data: string): void
  setWindow(rows: number, cols: number, height: number, width: number): void
  close?(): void
}

export type SshSessionDeps = {
  createClient: () => SshClientLike
  knownHosts: {
    get(host: string, port: number): KnownHostEntry | null
    put(entry: KnownHostEntry): void
    replace(entry: KnownHostEntry): void
  }
  requestHostKey: HostKeyResponder
  requestPrompt: (req: PromptRequest) => Promise<string[] | null>
  onEvent: (ev: TerminalEvent) => void
  now?: () => number
  timers?: {
    setTimeout(fn: () => void, ms: number): any
    clearTimeout(handle: any): void
  }
  keyTypeOf?: (key: Buffer) => string
  hasSecret?: { hasPassword: boolean; hasPassphrase: boolean; hasKey: boolean }
  agentAvailable?: boolean
}

export type SshSessionOptions = {
  id: string
  profile: SshHostProfile
  secret: SshRuntimeSecret
  jump?: { profile: SshHostProfile; secret: SshRuntimeSecret }
}

export type SshSession = {
  info(): TerminalSessionInfo
  connect(): void
  attach(sub: (ev: TerminalEvent) => void, key: unknown): void
  detach(key: unknown): void
  input(data: string): void
  resize(cols: number, rows: number): void
  reconnect(): void
  close(): void
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

function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8")
  return String(chunk ?? "")
}

function isAuthError(message: string, level?: unknown): boolean {
  if (typeof level === "string" && level.startsWith("client-authentication")) return true
  return /authentication|all configured authentication methods failed/i.test(message)
}

export function createSshSession(opts: SshSessionOptions, deps: SshSessionDeps): SshSession {
  const { id, profile, secret } = opts
  const now = deps.now ?? Date.now
  const timers = deps.timers ?? {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle: any) => globalThis.clearTimeout(handle),
  }

  let status: TerminalSessionStatus = "disconnected"
  let connectedAt: number | undefined
  let reconnectAttempt: number | undefined
  let reconnectInMs: number | undefined
  let error: string | undefined
  let userClosed = false
  let humanInteracted = false
  let authFailed = false
  let attempt = 0
  let timer: any = null
  let client: SshClientLike | null = null
  let stream: SshStreamLike | null = null
  let buffer = ""
  let pendingHostKeyCancel: (() => void) | null = null
  let pendingPromptCancel: (() => void) | null = null
  const subscribers = new Map<unknown, (ev: TerminalEvent) => void>()

  const clearTimer = () => {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
  }

  const emitStatus = (next: TerminalSessionStatus, extra: { error?: string; reconnectAttempt?: number; reconnectInMs?: number } = {}) => {
    status = next
    if (next === "connected") {
      connectedAt = now()
    } else {
      connectedAt = undefined
    }
    if (next === "reconnecting") {
      reconnectAttempt = extra.reconnectAttempt
      reconnectInMs = extra.reconnectInMs
    } else {
      reconnectAttempt = undefined
      reconnectInMs = undefined
    }
    error = extra.error
    const ev: TerminalEvent = { type: "status", sessionId: id, status: next }
    if (connectedAt !== undefined) ev.connectedAt = connectedAt
    if (reconnectAttempt !== undefined) ev.reconnectAttempt = reconnectAttempt
    if (reconnectInMs !== undefined) ev.reconnectInMs = reconnectInMs
    if (extra.error !== undefined) ev.error = extra.error
    deps.onEvent(ev)
  }

  const fanout = (ev: TerminalEvent) => {
    for (const sub of subscribers.values()) {
      try { sub(ev) } catch { /* subscriber failure must not break others */ }
    }
  }

  const requestHostKey = (req: HostKeyRequest): Promise<HostKeyDecision> => {
    humanInteracted = true
    return new Promise<HostKeyDecision>((resolve) => {
      let settled = false
      const done = (decision: HostKeyDecision) => {
        if (settled) return
        settled = true
        pendingHostKeyCancel = null
        resolve(decision)
      }
      pendingHostKeyCancel = () => done("reject")
      deps.requestHostKey(req).then(done, () => done("reject"))
    })
  }

  const requestPrompt = (req: PromptRequest): Promise<string[] | null> => {
    humanInteracted = true
    return new Promise<string[] | null>((resolve) => {
      let settled = false
      let timeout: any = null
      const done = (answers: string[] | null) => {
        if (settled) return
        settled = true
        if (timeout !== null) timers.clearTimeout(timeout)
        pendingPromptCancel = null
        resolve(answers)
      }
      timeout = timers.setTimeout(() => done(null), 120_000)
      pendingPromptCancel = () => done(null)
      deps.requestPrompt(req).then(done, () => done(null))
    })
  }

  const scheduleReconnect = () => {
    const next = attempt + 1
    const delay = reconnectDelay(next)
    if (delay === null) {
      emitStatus("disconnected", { error: error ?? "自动重连失败，已停止" })
      return
    }
    attempt = next
    emitStatus("reconnecting", { reconnectAttempt: attempt, reconnectInMs: delay })
    timer = timers.setTimeout(() => {
      timer = null
      connectInternal(true)
    }, delay)
  }

  const onClose = () => {
    if (userClosed) return
    stream = null
    client = null
    if (humanInteracted) {
      emitStatus("disconnected", { error: error ?? "需要人工确认或输入凭据" })
      return
    }
    if (authFailed) {
      emitStatus("error", { error: error ?? "认证失败" })
      return
    }
    const hasSecret = deps.hasSecret ?? {
      hasPassword: !!secret.password,
      hasPassphrase: !!secret.passphrase,
      hasKey: !!secret.privateKey,
    }
    if (canAutoReconnect({
      profile,
      ...hasSecret,
      agentAvailable: deps.agentAvailable === true,
    })) {
      scheduleReconnect()
      return
    }
    emitStatus(error ? "error" : "disconnected", error ? { error } : {})
  }

  const onError = (err: unknown) => {
    if (userClosed) return
    const info = redactError(err)
    error = info.message
    authFailed = isAuthError(info.message, (err as any)?.level)
    emitStatus("error", { error })
  }

  const connectInternal = (auto: boolean) => {
    if (userClosed) return
    clearTimer()
    if (!auto) attempt = 0
    humanInteracted = false
    authFailed = false
    error = undefined
    emitStatus("connecting")

    const nextClient = deps.createClient()
    client = nextClient
    const hostVerifier = createHostVerifier({
      sessionId: id,
      host: profile.host,
      port: profile.port,
      knownHosts: deps.knownHosts,
      request: requestHostKey,
      ...(deps.keyTypeOf ? { keyTypeOf: deps.keyTypeOf } : {}),
    })

    nextClient.on("ready", () => {
      if (client !== nextClient || userClosed) return
      nextClient.shell(
        { term: "xterm-256color", cols: 120, rows: 30, width: 0, height: 0 },
        (err, nextStream) => {
          if (client !== nextClient || userClosed) return
          if (err) {
            onError(err)
            onClose()
            return
          }
          stream = nextStream
          nextStream.on("data", (chunk: unknown) => {
            const text = chunkText(chunk)
            buffer = appendBuffer(buffer, text)
            fanout({ type: "data", sessionId: id, data: text })
          })
          nextStream.on("close", onClose)
          attempt = 0
          emitStatus("connected")
        },
      )
    })
    nextClient.on("error", onError)
    nextClient.on("close", onClose)
    nextClient.on("end", onClose)
    nextClient.on("keyboard-interactive", (name: string, instructions: string, _lang: string, prompts: { prompt: string; echo: boolean }[], finish: (answers: string[]) => void) => {
      const req: PromptRequest = {
        requestId: randomUUID(),
        sessionId: id,
        title: name || "SSH 认证",
        ...(instructions ? { instructions } : {}),
        prompts: prompts.map((p) => ({ prompt: p.prompt, echo: p.echo })),
      }
      void requestPrompt(req).then((answers) => {
        try { finish(answers ?? []) } catch { /* stream may be gone */ }
      })
    })

    nextClient.connect(buildSshConnectConfig({ profile, secret, hostVerifier }))
  }

  return {
    info() {
      return {
        id,
        kind: "ssh",
        title: profile.name,
        subtitle: `${profile.username}@${profile.host}:${profile.port}`,
        hostId: profile.id,
        status,
        ...(reconnectAttempt !== undefined ? { reconnectAttempt } : {}),
        ...(reconnectInMs !== undefined ? { reconnectInMs } : {}),
        ...(connectedAt !== undefined ? { connectedAt } : {}),
        ...(error ? { error } : {}),
      }
    },

    connect() {
      userClosed = false
      attempt = 0
      connectInternal(false)
    },

    attach(sub, key) {
      subscribers.set(key, sub)
      if (buffer) sub({ type: "data", sessionId: id, data: buffer })
    },

    detach(key) {
      subscribers.delete(key)
    },

    input(data) {
      if (stream) stream.write(data)
    },

    resize(cols, rows) {
      if (stream) stream.setWindow(rows, cols, 0, 0)
    },

    reconnect() {
      userClosed = false
      attempt = 0
      connectInternal(false)
    },

    close() {
      userClosed = true
      clearTimer()
      pendingHostKeyCancel?.()
      pendingPromptCancel?.()
      pendingHostKeyCancel = null
      pendingPromptCancel = null
      stream?.close?.()
      stream = null
      client?.end()
      client = null
      emitStatus("closed")
    },

    dispose() {
      this.close()
      subscribers.clear()
    },
  }
}

/** Connect + authenticate only (no shell), used by the host form's 测试连接. */
export function testSshConnection(
  opts: SshSessionOptions,
  deps: SshSessionDeps,
): Promise<{ ok: boolean; error?: string }> {
  const timers = deps.timers ?? {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle: any) => globalThis.clearTimeout(handle),
  }
  return new Promise((resolve) => {
    let done = false
    const finish = (result: { ok: boolean; error?: string }) => {
      if (done) return
      done = true
      timers.clearTimeout(timeout)
      try { client.end() } catch { /* ignore */ }
      resolve(result)
    }
    const hostVerifier = createHostVerifier({
      sessionId: opts.id,
      host: opts.profile.host,
      port: opts.profile.port,
      knownHosts: deps.knownHosts,
      request: deps.requestHostKey,
      ...(deps.keyTypeOf ? { keyTypeOf: deps.keyTypeOf } : {}),
    })
    const client = deps.createClient()
    client.on("ready", () => finish({ ok: true }))
    client.on("error", (err: unknown) => finish({ ok: false, error: redactError(err).message }))
    client.on("close", () => finish({ ok: false, error: "连接已关闭" }))
    client.on("keyboard-interactive", (name: string, instructions: string, _lang: string, prompts: { prompt: string; echo: boolean }[], finishPrompt: (answers: string[]) => void) => {
      const req: PromptRequest = {
        requestId: randomUUID(),
        sessionId: opts.id,
        title: name || "SSH 认证",
        ...(instructions ? { instructions } : {}),
        prompts: prompts.map((p) => ({ prompt: p.prompt, echo: p.echo })),
      }
      void deps.requestPrompt(req).then((answers) => {
        try { finishPrompt(answers ?? []) } catch { /* ignore */ }
      })
    })
    const timeout = timers.setTimeout(() => finish({ ok: false, error: "连接超时" }), 30_000)
    client.connect(buildSshConnectConfig({ profile: opts.profile, secret: opts.secret, hostVerifier }))
  })
}
