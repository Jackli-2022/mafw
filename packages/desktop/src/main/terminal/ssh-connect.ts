// ssh2 connection config + TOFU host-key verification (spec 2026-10-29 §6.2/§6.4).
import { randomUUID } from "node:crypto"
import ssh2 from "ssh2"
import type { ConnectConfig } from "ssh2"
import type { KnownHostEntry, SshHostProfile } from "../../shared/ssh-host"
import type { HostKeyRequest } from "../../shared/terminal-session"

const { utils } = ssh2
import { fingerprintOf } from "./fingerprint"

export type HostKeyDecision = "trust" | "trust-and-save" | "replace" | "reject"
export type HostKeyResponder = (req: HostKeyRequest) => Promise<HostKeyDecision>

export type SshRuntimeSecret = {
  password?: string
  passphrase?: string
  privateKey?: string | Buffer
}

export type HostVerifier = (key: Buffer, verify: (ok: boolean) => void) => void

export type KnownHostsLookup = {
  get(host: string, port: number): KnownHostEntry | null
  put(entry: KnownHostEntry): void
  replace(entry: KnownHostEntry): void
}

function defaultKeyType(key: Buffer): string {
  try {
    const parsed = utils.parseKey(key)
    if (Array.isArray(parsed)) return parsed[0]?.type ?? "unknown"
    if (parsed && !(parsed instanceof Error)) return parsed.type ?? "unknown"
  } catch {
    /* fall through */
  }
  return "unknown"
}

function defaultAgent(): string | undefined {
  return process.platform === "win32" ? "\\\\.\\pipe\\openssh-ssh-agent" : process.env.SSH_AUTH_SOCK
}

/** Build the single ssh2 config used by sessions, tests, and jump hosts. */
export function buildSshConnectConfig(input: {
  profile: SshHostProfile
  secret: SshRuntimeSecret
  hostVerifier: HostVerifier
  sock?: ConnectConfig["sock"]
  agent?: string
}): ConnectConfig {
  const { profile, secret } = input
  const cfg: ConnectConfig = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    readyTimeout: 120_000,
    keepaliveInterval: Math.max(0, profile.keepaliveSeconds) * 1000,
    keepaliveCountMax: 3,
    tryKeyboard: true,
    hostVerifier: input.hostVerifier,
  }
  if (input.sock) cfg.sock = input.sock
  if (profile.auth === "password" && secret.password) cfg.password = secret.password
  if (profile.auth === "key") {
    if (secret.privateKey) cfg.privateKey = secret.privateKey
    if (secret.passphrase) cfg.passphrase = secret.passphrase
  }
  if (profile.auth === "agent") {
    const agent = input.agent ?? defaultAgent()
    if (agent) cfg.agent = agent
  }
  return cfg
}

/** TOFU verifier: first key asks, matching key proceeds, changed key blocks unless replaced. */
export function createHostVerifier(input: {
  sessionId: string
  host: string
  port: number
  knownHosts: KnownHostsLookup
  request: HostKeyResponder
  timeoutMs?: number
  now?: () => number
  keyTypeOf?: (key: Buffer) => string
}): HostVerifier {
  return (key, verify) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      verify(ok)
    }
    timer = setTimeout(() => finish(false), input.timeoutMs ?? 60_000)

    const keyType = input.keyTypeOf?.(key) ?? defaultKeyType(key)
    const fingerprint = fingerprintOf(key)
    const publicKey = key.toString("base64")
    const existing = input.knownHosts.get(input.host, input.port)
    if (existing && existing.publicKey === publicKey) {
      finish(true)
      return
    }

    const kind = existing ? "changed" : "new"
    const req: HostKeyRequest = {
      requestId: randomUUID(),
      sessionId: input.sessionId,
      host: input.host,
      port: input.port,
      keyType,
      fingerprint,
      kind,
      ...(existing ? { oldFingerprint: existing.fingerprint } : {}),
    }
    const stamp = input.now?.() ?? Date.now()
    void input.request(req)
      .then((decision) => {
        if (kind === "new") {
          if (decision === "trust" || decision === "trust-and-save" || decision === "replace") {
            if (decision !== "trust") {
              input.knownHosts.put({
                host: input.host,
                port: input.port,
                keyType,
                publicKey,
                fingerprint,
                addedAt: stamp,
                lastSeenAt: stamp,
              })
            }
            finish(true)
          } else {
            finish(false)
          }
          return
        }
        if (decision === "replace") {
          input.knownHosts.replace({
            ...(existing as KnownHostEntry),
            keyType,
            publicKey,
            fingerprint,
            lastSeenAt: stamp,
          })
          finish(true)
        } else {
          finish(false)
        }
      })
      .catch(() => finish(false))
  }
}
