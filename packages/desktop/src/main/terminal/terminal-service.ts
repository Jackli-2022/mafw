// Terminal domain service: host profiles, encrypted secrets, known hosts, hub.
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import ssh2 from "ssh2"
import type {
  HostKeyRequest,
  PromptRequest,
  TerminalEvent,
} from "../../shared/terminal-session"
import type { SshHostProfile, SshHostProfileInput, SshSecretInput } from "../../shared/ssh-host"
import { validateSshHostProfile } from "../../shared/ssh-host"
import { createKnownHostsStore } from "./known-hosts-store"
import type { LocalTerminalOps } from "./local-terminal"
import type { HostKeyDecision, SshRuntimeSecret } from "./ssh-connect"
import { createSshSession, testSshConnection, type SshSession, type SshSessionDeps } from "./ssh-session"
import { createSshHostStore } from "./ssh-host-store"
import { createTerminalSecrets, type SafeStorageLike } from "./terminal-secrets"
import { createTerminalHub, type TerminalHub } from "./terminal-hub"

const { Client } = ssh2

export type TerminalServiceDeps = {
  dataDir: string
  local: LocalTerminalOps
  safeStorage: SafeStorageLike
  onEvent: (ev: TerminalEvent) => void
  openExternal: (directory: string) => Promise<void>
  log?: (msg: string) => void
  now?: () => number
  id?: () => string
  createSshSession?: (opts: Parameters<typeof createSshSession>[0], deps: SshSessionDeps) => SshSession
  testSshConnection?: typeof testSshConnection
}

export type TerminalService = {
  hub: TerminalHub
  hosts: {
    list(): Promise<SshHostProfile[]>
    save(input: SshHostProfileInput, secret?: SshSecretInput): Promise<SshHostProfile>
    remove(id: string): Promise<void>
    test(input: SshHostProfileInput, secret?: SshSecretInput): Promise<{ ok: boolean; error?: string }>
  }
  respondHostKey(requestId: string, decision: HostKeyDecision): void
  respondPrompt(requestId: string, answers?: string[]): void
  dispose(): void
}

function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2))
  return path
}

export function createTerminalService(deps: TerminalServiceDeps): TerminalService {
  const now = deps.now ?? Date.now
  const newId = deps.id ?? randomUUID
  const log = deps.log ?? (() => {})
  const hosts = createSshHostStore({ filePath: join(deps.dataDir, "hosts.json"), now, id: newId })
  const secrets = createTerminalSecrets({ filePath: join(deps.dataDir, "secrets.json"), safeStorage: deps.safeStorage })
  const knownHosts = createKnownHostsStore({ filePath: join(deps.dataDir, "known-hosts.json"), now })
  const pendingHostKeys = new Map<string, (decision: HostKeyDecision) => void>()
  const pendingPrompts = new Map<string, (answers: string[] | null) => void>()

  const requestHostKey = (req: HostKeyRequest): Promise<HostKeyDecision> => {
    return new Promise((resolve) => {
      pendingHostKeys.set(req.requestId, resolve)
      deps.onEvent({ type: "hostkey", ...req })
    })
  }
  const requestPrompt = (req: PromptRequest): Promise<string[] | null> => {
    return new Promise((resolve) => {
      pendingPrompts.set(req.requestId, resolve)
      deps.onEvent({ type: "prompt", ...req })
    })
  }

  const secretFlags = (hostId: string) => {
    const has = secrets.has(hostId)
    return {
      hasPassword: has.password,
      hasPassphrase: has.passphrase,
      hasKey: !!hosts.get(hostId)?.privateKeyPath,
    }
  }

  const runtimeSecretFor = (hostId: string): SshRuntimeSecret => {
    const profile = hosts.get(hostId)
    if (!profile) throw new Error(`SSH 主机不存在：${hostId}`)
    const secret: SshRuntimeSecret = { ...secrets.get(hostId) }
    if (profile.auth === "key" && profile.privateKeyPath) {
      try {
        secret.privateKey = readFileSync(expandHome(profile.privateKeyPath), "utf8")
      } catch (err: any) {
        log(`[Terminal] 读取私钥失败 (${profile.name}): ${err?.message ?? err}`)
      }
    }
    return secret
  }

  const sshDeps = (opts: Parameters<typeof createSshSession>[0], onEvent: (ev: TerminalEvent) => void): SshSessionDeps => ({
    createClient: () => new Client() as any,
    knownHosts,
    requestHostKey,
    requestPrompt,
    onEvent,
    now,
    hasSecret: {
      hasPassword: secrets.has(opts.profile.id).password,
      hasPassphrase: secrets.has(opts.profile.id).passphrase,
      hasKey: !!opts.profile.privateKeyPath,
    },
    agentAvailable: process.platform === "win32" ? true : !!process.env.SSH_AUTH_SOCK,
  })

  const createSession = deps.createSshSession ?? createSshSession
  const hub = createTerminalHub({
    local: deps.local,
    profiles: () => hosts.list(),
    secretFor: runtimeSecretFor,
    createSshSession: (opts, onEvent) => createSession(opts, sshDeps(opts, onEvent)),
    onEvent: deps.onEvent,
    now,
    id: newId,
  })

  const decorate = (profile: SshHostProfile): SshHostProfile => {
    const has = secrets.has(profile.id)
    return { ...profile, hasPassword: has.password, hasPassphrase: has.passphrase }
  }

  const saveSecret = (hostId: string, secret?: SshSecretInput) => {
    if (!secret) return
    if ((secret.password || secret.passphrase) && !secrets.available()) {
      throw new Error("凭据存储不可用：系统钥匙串不可访问")
    }
    secrets.set(hostId, secret)
  }

  return {
    hub,

    hosts: {
      async list() {
        return hosts.list().map(decorate)
      },

      async save(input, secret) {
        if (secret && (secret.password || secret.passphrase) && !secrets.available()) {
          throw new Error("凭据存储不可用：系统钥匙串不可访问")
        }
        const saved = hosts.save(input, hosts.list())
        saveSecret(saved.id, secret)
        return decorate(saved)
      },

      async remove(id) {
        hosts.remove(id)
        secrets.remove(id)
      },

      async test(input, secret) {
        const validated = validateSshHostProfile(input, { hosts: hosts.list() })
        if (!validated.ok) throw new Error(validated.errors.join("; "))
        const profile: SshHostProfile = {
          ...validated.value,
          id: validated.value.id ?? input.id ?? "test",
          createdAt: now(),
          updatedAt: now(),
        }
        const savedProfile = input.id ? hosts.get(input.id) : null
        const canUseSaved =
          !!savedProfile &&
          savedProfile.host === validated.value.host &&
          savedProfile.port === validated.value.port &&
          savedProfile.username === validated.value.username &&
          savedProfile.auth === validated.value.auth &&
          (savedProfile.privateKeyPath ?? "") === (validated.value.privateKeyPath ?? "")
        const saved = canUseSaved ? secrets.get(input.id!) : {}
        const runtime: SshRuntimeSecret = {
          ...saved,
          ...(secret?.password !== undefined ? { password: secret.password } : {}),
          ...(secret?.passphrase !== undefined ? { passphrase: secret.passphrase } : {}),
        }
        if (profile.auth === "key" && profile.privateKeyPath) {
          try {
            runtime.privateKey = readFileSync(expandHome(profile.privateKeyPath), "utf8")
          } catch (err: any) {
            return { ok: false, error: `读取私钥失败：${err?.message ?? err}` }
          }
        }
        const testId = `test:${newId()}`
        const jumpProfile = profile.jumpHostId ? hosts.get(profile.jumpHostId) : null
        const jump = jumpProfile
          ? { profile: jumpProfile, secret: runtimeSecretFor(jumpProfile.id) }
          : undefined
        const opts = { id: testId, profile, secret: runtime, ...(jump ? { jump } : {}) }
        const run = deps.testSshConnection ?? testSshConnection
        return run(opts, sshDeps(opts, deps.onEvent))
      },
    },

    respondHostKey(requestId, decision) {
      const resolve = pendingHostKeys.get(requestId)
      if (!resolve) return
      pendingHostKeys.delete(requestId)
      resolve(decision)
    },

    respondPrompt(requestId, answers) {
      const resolve = pendingPrompts.get(requestId)
      if (!resolve) return
      pendingPrompts.delete(requestId)
      resolve(answers ?? null)
    },

    dispose() {
      hub.dispose()
      for (const resolve of pendingHostKeys.values()) resolve("reject")
      for (const resolve of pendingPrompts.values()) resolve(null)
      pendingHostKeys.clear()
      pendingPrompts.clear()
    },
  }
}
