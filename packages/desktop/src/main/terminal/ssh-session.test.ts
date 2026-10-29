import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createSshSession, testSshConnection, type SshClientLike, type SshStreamLike } from "./ssh-session"
import type { KnownHostEntry, SshHostProfile } from "../../shared/ssh-host"
import type { HostKeyRequest, PromptRequest, TerminalEvent } from "../../shared/terminal-session"
import type { HostKeyDecision } from "./ssh-connect"

const base: SshHostProfile = {
  id: "h1",
  name: "prod-01",
  group: "生产",
  host: "10.0.0.12",
  port: 22,
  username: "deploy",
  auth: "password",
  autoReconnect: true,
  keepaliveSeconds: 15,
  createdAt: 1,
  updatedAt: 1,
}

class FakeStream extends EventEmitter implements SshStreamLike {
  written: string[] = []
  windows: number[][] = []
  write(data: string) { this.written.push(data) }
  setWindow(rows: number, cols: number, height: number, width: number) {
    this.windows.push([rows, cols, height, width])
  }
  close() { this.emit("close") }
}

class FakeClient extends EventEmitter implements SshClientLike {
  cfg: any
  shellOpts: any
  shellCalls = 0
  ended = false
  stream: FakeStream | null = null
  forwardCalls: number[][] = []
  forwardStream = new FakeStream()
  constructor(private hostKeyOnConnect = false) { super() }
  connect(cfg: any) {
    this.cfg = cfg
    if (this.hostKeyOnConnect) {
      cfg.hostVerifier(Buffer.from("new-key"), (ok: boolean) => {
        if (!ok) {
          this.emit("error", new Error("host key rejected"))
          this.emit("close")
        }
      })
    }
  }
  shell(opts: any, cb: (err: Error | null, stream: SshStreamLike) => void) {
    this.shellCalls++
    this.shellOpts = opts
    this.stream = new FakeStream()
    cb(null, this.stream)
  }
  forwardOut(srcIP: string, srcPort: number, dstIP: string, dstPort: number, cb: any) {
    this.forwardCalls.push([srcIP, srcPort, dstIP, dstPort])
    cb(null, this.forwardStream)
  }
  end() {
    this.ended = true
    this.emit("close")
  }
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function makeTimers() {
  let now = 0
  let seq = 0
  const timers = new Map<number, { fn: () => void; at: number }>()
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = ++seq
      timers.set(id, { fn, at: now + ms })
      return id
    },
    clearTimeout(id: any) { timers.delete(Number(id)) },
    pending() { return timers.size },
    runNext() {
      const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!entry) return
      timers.delete(entry[0])
      now = entry[1].at
      entry[1].fn()
    },
    advance(ms: number) {
      now += ms
      for (const [id, t] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          timers.delete(id)
          t.fn()
        }
      }
    },
  }
}

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function makeSession(opts: {
  autoReconnect?: boolean
  hasPassword?: boolean
  hostKeyOnConnect?: boolean
  jump?: boolean
} = {}) {
  const clients: FakeClient[] = []
  const events: TerminalEvent[] = []
  const timers = makeTimers()
  let pendingHostKey: Deferred<HostKeyDecision> | null = null
  let pendingPrompt: Deferred<string[] | null> | null = null
  const deps = {
    createClient: () => {
      const c = new FakeClient(opts.hostKeyOnConnect === true)
      clients.push(c)
      return c
    },
    knownHosts: {
      get: (_host: string, _port: number): KnownHostEntry | null => null,
      put: () => {},
      replace: () => {},
    },
    requestHostKey: (req: HostKeyRequest): Promise<HostKeyDecision> => {
      assert.equal(req.sessionId, "ssh:1")
      pendingHostKey = deferred<HostKeyDecision>()
      return pendingHostKey.promise
    },
    requestPrompt: (req: PromptRequest): Promise<string[] | null> => {
      assert.equal(req.sessionId, "ssh:1")
      pendingPrompt = deferred<string[] | null>()
      return pendingPrompt.promise
    },
    onEvent: (ev: TerminalEvent) => events.push(ev),
    now: () => 1000,
    timers,
    hasSecret: {
      hasPassword: opts.hasPassword === true,
      hasPassphrase: false,
      hasKey: false,
    },
    keyTypeOf: () => "ssh-ed25519",
  }
  const profile = { ...base, autoReconnect: opts.autoReconnect === true }
  const jump = opts.jump
    ? { profile: { ...base, id: "bastion", name: "bastion", host: "10.0.0.8", username: "ops" }, secret: {} }
    : undefined
  const session = createSshSession({
    id: "ssh:1",
    profile,
    secret: opts.hasPassword ? { password: "x" } : {},
    ...(jump ? { jump } : {}),
  }, deps as any)
  return {
    session,
    clients,
    events,
    timers,
    deps,
    get pendingHostKey() { return pendingHostKey },
    get prompts() { return pendingPrompt },
  }
}

describe("ssh-session", () => {
  test("ready -> shell -> connected; data fanout; input/resize", () => {
    const { session, clients } = makeSession()
    session.connect()
    clients[0].emit("ready")
    const stream = clients[0].stream!
    assert.equal(clients[0].shellOpts.term, "xterm-256color")
    assert.equal(session.info().status, "connected")
    assert.equal(session.info().connectedAt, 1000)

    const got: string[] = []
    session.attach((ev) => { if (ev.type === "data") got.push(ev.data) }, "v1")
    stream.emit("data", "hello")
    assert.deepEqual(got, ["hello"])
    session.input("ls\r")
    assert.equal(stream.written.at(-1), "ls\r")
    session.resize(100, 40)
    assert.deepEqual(stream.windows.at(-1), [40, 100, 0, 0])
  })

  test("ring buffer replays on attach", () => {
    const { session, clients } = makeSession()
    session.connect()
    clients[0].emit("ready")
    clients[0].stream!.emit("data", "before\n")
    const got: string[] = []
    session.attach((ev) => { if (ev.type === "data") got.push(ev.data) }, "v2")
    assert.equal(got.join(""), "before\n")
  })

  test("close -> auto reconnect; 5 attempts then stop; user close cancels", () => {
    const { session, clients, timers } = makeSession({ autoReconnect: true, hasPassword: true })
    session.connect()
    clients[0].emit("ready")
    clients[0].emit("close")
    assert.equal(session.info().status, "reconnecting")
    assert.equal(timers.pending(), 1)

    for (let i = 1; i <= 5; i++) {
      timers.runNext()
      clients.at(-1)!.emit("close")
    }
    assert.equal(session.info().status, "disconnected")
    assert.equal(timers.pending(), 0)

    clients.at(-1)!.emit("close")
    session.close()
    assert.equal(timers.pending(), 0)
    assert.equal(session.info().status, "closed")
  })

  test("keyboard-interactive prompt is forwarded and answered", async () => {
    const m = makeSession()
    m.session.connect()
    let finish: (a: string[]) => void = () => {}
    m.clients[0].emit("keyboard-interactive", "OTP", "", "en", [{ prompt: "Code", echo: false }], (a: string[]) => { finish = a })
    assert.ok(m.prompts)
    m.prompts!.resolve(["123456"])
    await tick()
    assert.deepEqual(finish, ["123456"])
  })

  test("keyboard-interactive times out to cancel", async () => {
    const m = makeSession()
    m.session.connect()
    let finish: (a: string[]) => void = () => {}
    m.clients[0].emit("keyboard-interactive", "OTP", "", "en", [{ prompt: "Code", echo: false }], (a: string[]) => { finish = a })
    assert.ok(m.prompts)
    m.timers.advance(120_000)
    await tick()
    assert.deepEqual(finish, [])
  })

  test("testSshConnection resolves on ready without opening shell", async () => {
    const { clients, deps } = makeSession()
    const p = testSshConnection({ id: "test", profile: base, secret: {} }, deps as any)
    clients[0].emit("ready")
    assert.deepEqual(await p, { ok: true })
    assert.equal(clients[0].shellCalls, 0)
  })

  test("testSshConnection routes through a jump host", async () => {
    const m = makeSession()
    const jumpProfile = { ...base, id: "bastion", name: "bastion", host: "10.0.0.8" }
    const p = testSshConnection(
      { id: "test", profile: base, secret: {}, jump: { profile: jumpProfile, secret: {} } },
      m.deps as any,
    )
    m.clients[0].emit("ready")
    await tick()
    assert.equal(m.clients.length, 2)
    assert.equal(m.clients[1].cfg.sock, m.clients[0].forwardStream)
    m.clients[1].emit("ready")
    assert.deepEqual(await p, { ok: true })
  })

  test("auto reconnect pauses when host key needs human confirmation", async () => {
    const m = makeSession({
      autoReconnect: true,
      hasPassword: true,
      hostKeyOnConnect: true,
    })
    m.session.connect()
    assert.ok(m.pendingHostKey, "initial attempt asks for host key")
    m.pendingHostKey!.resolve("trust-and-save")
    await tick()
    m.clients[0].emit("ready")
    m.clients[0].emit("close")
    m.timers.runNext()
    assert.ok(m.pendingHostKey, "auto attempt should ask for host key")
    assert.equal(m.timers.pending(), 0, "no next retry while a human prompt is pending")
    m.pendingHostKey!.resolve("reject")
    await tick()
    assert.equal(m.session.info().status, "disconnected")
    assert.equal(m.timers.pending(), 0)
  })

  test("jump host forwards a socket to the target", async () => {
    const m = makeSession({ jump: true })
    m.session.connect()
    m.clients[0].emit("ready")
    await tick()
    assert.deepEqual(m.clients[0].forwardCalls, [["127.0.0.1", 0, "10.0.0.12", 22]])
    assert.equal(m.clients.length, 2)
    assert.equal(m.clients[1].cfg.sock, m.clients[0].forwardStream)
    m.clients[1].emit("ready")
    assert.equal(m.session.info().status, "connected")
  })

  test("auto reconnect resumes after a TOFU prompt was accepted", async () => {
    const m = makeSession({ autoReconnect: true, hasPassword: true, hostKeyOnConnect: true })
    m.session.connect()
    assert.ok(m.pendingHostKey)
    m.pendingHostKey!.resolve("trust-and-save")
    await tick()
    m.clients[0].emit("ready")
    assert.equal(m.session.info().status, "connected")
    m.clients[0].emit("close")
    assert.equal(m.session.info().status, "reconnecting")
    assert.equal(m.timers.pending(), 1)
  })

  test("auth failure is not auto-retried", () => {
    const { session, clients, timers } = makeSession({ autoReconnect: true, hasPassword: true })
    session.connect()
    clients[0].emit("error", new Error("All configured authentication methods failed"))
    clients[0].emit("close")
    assert.equal(session.info().status, "error")
    assert.equal(timers.pending(), 0)
  })

  test("user close cancels pending reconnect", () => {
    const { session, clients, timers } = makeSession({ autoReconnect: true, hasPassword: true })
    session.connect()
    clients[0].emit("ready")
    clients[0].emit("close")
    assert.equal(timers.pending(), 1)
    session.close()
    assert.equal(timers.pending(), 0)
    assert.equal(session.info().status, "closed")
  })
})
