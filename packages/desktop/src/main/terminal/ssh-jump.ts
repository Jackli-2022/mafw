// One-hop SSH jump host (ProxyJump): connect bastion, forward a socket to target.
import { EventEmitter } from "node:events"
import type { ConnectConfig } from "ssh2"
import type { KnownHostEntry, SshHostProfile } from "../../shared/ssh-host"
import {
  buildSshConnectConfig,
  createHostVerifier,
  type HostKeyResponder,
  type SshRuntimeSecret,
} from "./ssh-connect"

export type JumpClientLike = EventEmitter & {
  connect(cfg: ConnectConfig): void
  forwardOut?(
    srcIP: string,
    srcPort: number,
    dstIP: string,
    dstPort: number,
    cb: (err: Error | null, stream: any) => void,
  ): void
  end(): void
}

export type JumpSock = {
  sock: any
  close(): void
}

/** Connect the bastion with its own TOFU/auth, then forward to target. */
export function createJumpSock(input: {
  sessionId: string
  target: { host: string; port: number }
  jump: { profile: SshHostProfile; secret: SshRuntimeSecret }
  knownHosts: {
    get(host: string, port: number): KnownHostEntry | null
    put(entry: KnownHostEntry): void
    replace(entry: KnownHostEntry): void
  }
  requestHostKey: HostKeyResponder
  createClient: () => JumpClientLike
  keyTypeOf?: (key: Buffer) => string
  timeoutMs?: number
}): Promise<JumpSock> {
  return new Promise((resolve, reject) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const client = input.createClient()

    const fail = (err: unknown) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      try { client.end() } catch { /* ignore */ }
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    timer = setTimeout(() => fail(new Error("跳板机连接超时")), input.timeoutMs ?? 30_000)

    const hostVerifier = createHostVerifier({
      sessionId: input.sessionId,
      host: input.jump.profile.host,
      port: input.jump.profile.port,
      knownHosts: input.knownHosts,
      request: input.requestHostKey,
      ...(input.keyTypeOf ? { keyTypeOf: input.keyTypeOf } : {}),
    })

    client.on("ready", () => {
      if (!client.forwardOut) return fail(new Error("跳板机客户端不支持 forwardOut"))
      client.forwardOut("127.0.0.1", 0, input.target.host, input.target.port, (err, stream) => {
        if (err) return fail(err)
        if (done) return
        done = true
        if (timer) clearTimeout(timer)
        resolve({
          sock: stream,
          close() {
            try { stream?.close?.() } catch { /* ignore */ }
            try { client.end() } catch { /* ignore */ }
          },
        })
      })
    })
    client.on("error", (err: unknown) => fail(err))
    client.on("close", () => fail(new Error("跳板机连接已关闭")))

    client.connect(buildSshConnectConfig({
      profile: input.jump.profile,
      secret: input.jump.secret,
      hostVerifier,
    }))
  })
}
