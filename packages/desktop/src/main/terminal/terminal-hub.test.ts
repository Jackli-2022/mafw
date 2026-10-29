import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createTerminalHub, type TerminalHubDeps } from "./terminal-hub"
import type { LocalTerminalOps } from "./local-terminal"
import type { SshHostProfile } from "../../shared/ssh-host"
import type { TerminalEvent, TerminalSessionInfo } from "../../shared/terminal-session"
import type { SshSession, SshSessionOptions } from "./ssh-session"

const host = (over: Partial<SshHostProfile> = {}): SshHostProfile => ({
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
  ...over,
})

class FakeLocal implements LocalTerminalOps {
  attachCalls = 0
  detachCalls = 0
  killCalls = 0
  inputCalls: string[] = []
  resizeCalls: number[][] = []
  sub: ((ev: TerminalEvent) => void) | null = null
  async probe() { return { available: true } }
  async attach(_directory: string, sessionId: string, sub: (ev: TerminalEvent) => void) {
    this.attachCalls++
    this.sub = sub
    sub({ type: "status", sessionId, status: "connected", connectedAt: 1000 })
    return { ok: true as const, ptyId: "p1", replayed: false }
  }
  detach() { this.detachCalls++ }
  input(_directory: string, data: string) { this.inputCalls.push(data) }
  async resize(_directory: string, cols: number, rows: number) { this.resizeCalls.push([cols, rows]) }
  async kill() { this.killCalls++ }
  emit(ev: TerminalEvent) { this.sub?.(ev) }
}

class FakeSsh implements SshSession {
  infoData: TerminalSessionInfo
  connectCalls = 0
  disposed = 0
  inputs: string[] = []
  resizes: number[][] = []
  constructor(private opts: SshSessionOptions, private onEvent: (ev: TerminalEvent) => void) {
    this.infoData = {
      id: opts.id,
      kind: "ssh",
      title: opts.profile.name,
      hostId: opts.profile.id,
      status: "disconnected",
    }
  }
  info() { return { ...this.infoData } }
  connect() {
    this.connectCalls++
    this.infoData = { ...this.infoData, status: "connecting" }
    this.onEvent({ type: "status", sessionId: this.opts.id, status: "connecting" })
  }
  attach() {}
  detach() {}
  input(data: string) { this.inputs.push(data) }
  resize(cols: number, rows: number) { this.resizes.push([cols, rows]) }
  reconnect() { this.connect() }
  close() { this.disposed++ }
  dispose() { this.disposed++ }
  emit(ev: TerminalEvent) { this.onEvent(ev) }
}

function makeDeps(over: Partial<TerminalHubDeps> = {}) {
  const local = new FakeLocal()
  const created: FakeSsh[] = []
  const events: TerminalEvent[] = []
  const profiles = [host(), host({ id: "bastion", name: "bastion", host: "10.0.0.8" })]
  let n = 0
  const deps: TerminalHubDeps = {
    local,
    profiles: () => profiles,
    secretFor: () => ({ password: "x" }),
    createSshSession: (opts, onEvent) => {
      const s = new FakeSsh(opts, onEvent)
      created.push(s)
      return s
    },
    onEvent: (ev) => events.push(ev),
    id: () => `u${++n}`,
    now: () => 1000,
    ...over,
  }
  return { deps, local, created, events, profiles }
}

describe("terminal-hub", () => {
  test("local attach returns local:<dirKey>, forwards data, sets connectedAt", async () => {
    const { deps, local, events } = makeDeps()
    const hub = createTerminalHub(deps)
    const info = await hub.attachLocal("C:\\Work\\App")
    assert.equal(info.id, "local:c:/work/app")
    assert.equal(info.status, "connected")
    assert.equal(info.connectedAt, 1000)
    assert.equal(local.attachCalls, 1)

    const got: TerminalEvent[] = []
    const a = await hub.attach(info.id, (ev) => got.push(ev), "v1")
    assert.equal(a.ok, true)
    local.emit({ type: "data", sessionId: info.id, data: "hi" })
    assert.deepEqual(got.filter((e) => e.type === "data"), [{ type: "data", sessionId: info.id, data: "hi" }])
    assert.equal(events.some((e) => e.type === "data" && e.data === "hi"), true)
  })

  test("multiple ssh sessions to the same host stay distinct", async () => {
    const { deps, created } = makeDeps()
    const hub = createTerminalHub(deps)
    const a = await hub.createSsh({ hostId: "h1" })
    const b = await hub.createSsh({ hostId: "h1" })
    assert.notEqual(a.id, b.id)
    assert.equal(hub.list().filter((s) => s.hostId === "h1").length, 2)
    assert.equal(created.length, 2)
    assert.equal(created[0].connectCalls, 1)
  })

  test("restoreSsh is disconnected until connect()", async () => {
    const { deps } = makeDeps()
    const hub = createTerminalHub(deps)
    const info = hub.restoreSsh({ id: "ssh:r1", hostId: "h1" })
    assert.equal(info.status, "disconnected")
    await hub.connect(info.id)
    assert.equal(hub.list().find((s) => s.id === info.id)?.status, "connecting")
  })

  test("close local detaches without killing; kill removes", async () => {
    const { deps, local } = makeDeps()
    const hub = createTerminalHub(deps)
    const info = await hub.attachLocal("C:\\Work\\App")
    await hub.close(info.id)
    assert.equal(local.killCalls, 0)
    assert.equal(local.detachCalls, 1)
    await hub.attachLocal("C:\\Work\\App")
    await hub.kill("local:c:/work/app")
    assert.equal(local.killCalls, 1)
    assert.equal(hub.list().some((s) => s.kind === "local"), false)
  })

  test("input/resize route by session kind", async () => {
    const { deps, local, created } = makeDeps()
    const hub = createTerminalHub(deps)
    const localInfo = await hub.attachLocal("C:\\Work\\App")
    hub.input(localInfo.id, "ls\r")
    await hub.resize(localInfo.id, 100, 30)
    assert.deepEqual(local.inputCalls, ["ls\r"])
    assert.deepEqual(local.resizeCalls, [[100, 30]])

    const ssh = await hub.createSsh({ hostId: "h1" })
    hub.input(ssh.id, "pwd\r")
    await hub.resize(ssh.id, 80, 24)
    assert.deepEqual(created[0].inputs, ["pwd\r"])
    assert.deepEqual(created[0].resizes, [[80, 24]])
  })

  test("attach replays buffer and detach removes subscriber", async () => {
    const { deps, local } = makeDeps()
    const hub = createTerminalHub(deps)
    const info = await hub.attachLocal("C:\\Work\\App")
    local.emit({ type: "data", sessionId: info.id, data: "before\n" })
    const got: TerminalEvent[] = []
    const r = await hub.attach(info.id, (ev) => got.push(ev), "v1")
    assert.equal(r.replayed, true)
    assert.deepEqual(got.filter((e) => e.type === "data").map((e) => (e as any).data), ["before\n"])
    hub.detach(info.id, "v1")
    local.emit({ type: "data", sessionId: info.id, data: "after\n" })
    assert.equal(got.filter((e) => e.type === "data").length, 1)
  })

  test("jump host options are resolved for the ssh session", async () => {
    const { deps, profiles } = makeDeps()
    profiles[0] = host({ jumpHostId: "bastion" })
    const hub = createTerminalHub(deps)
    await hub.createSsh({ hostId: "h1" })
    // createSshSession captured the options through FakeSsh's private constructor;
    // assert via profiles + a fresh capturing dep.
    const seen: SshSessionOptions[] = []
    const hub2 = createTerminalHub({
      ...deps,
      createSshSession: (opts, onEvent) => {
        seen.push(opts)
        return new FakeSsh(opts, onEvent)
      },
    })
    await hub2.createSsh({ hostId: "h1" })
    assert.equal(seen[0].jump?.profile.id, "bastion")
  })

  test("dispose closes ssh sessions and detaches local", async () => {
    const { deps, local, created } = makeDeps()
    const hub = createTerminalHub(deps)
    await hub.attachLocal("C:\\Work\\App")
    await hub.createSsh({ hostId: "h1" })
    hub.dispose()
    assert.equal(created[0].disposed, 1)
    assert.equal(local.detachCalls, 1)
    assert.deepEqual(hub.list(), [])
  })
})
