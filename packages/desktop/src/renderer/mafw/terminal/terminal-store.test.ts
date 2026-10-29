import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createTerminalStore } from "./terminal-store"
import type { TerminalEvent, TerminalSessionInfo } from "../../../shared/terminal-session"
import type { SshHostProfile } from "../../../shared/ssh-host"

const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function memStorage(seed: Record<string, string> = {}) {
  const data = { ...seed }
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value },
    removeItem: (key: string) => { delete data[key] },
    dump: () => data,
  }
}

const host: SshHostProfile = {
  id: "h1",
  name: "prod-01",
  group: "生产",
  host: "10.0.0.12",
  port: 22,
  username: "deploy",
  auth: "password",
  autoReconnect: true,
  keepaliveSeconds: 15,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 1,
}

function fakeApi(opts: { sessions?: TerminalSessionInfo[] } = {}) {
  const events: TerminalEvent[] = []
  let sub: ((ev: TerminalEvent) => void) | null = null
  let created = 0
  let restored = 0
  let connected = 0
  let attachedLocal = 0
  let closed = 0
  let killed = 0
  let hostKeyResponse: any = null
  const api = {
    sessions: {
      list: async () => opts.sessions ?? [],
      attachLocal: async (directory: string) => {
        attachedLocal++
        return { id: `local:${directory.toLowerCase()}`, kind: "local", title: "本地", directory, status: "connected" } as TerminalSessionInfo
      },
      createSsh: async ({ hostId }: { hostId: string }) => {
        created++
        return { id: `ssh:${created}`, kind: "ssh", title: host.name, hostId, status: "connecting" } as TerminalSessionInfo
      },
      restore: async ({ id, hostId }: { id: string; hostId: string }) => {
        restored++
        return { id, kind: "ssh", title: host.name, hostId, status: "disconnected" } as TerminalSessionInfo
      },
      attach: async () => ({ ok: true, replayed: false }),
      detach: async () => {},
      input: async () => {},
      resize: async () => {},
      close: async () => { closed++ },
      kill: async () => { killed++ },
      reconnect: async () => { connected++ },
    },
    hosts: {
      list: async () => [host],
      save: async () => host,
      remove: async () => {},
      test: async () => ({ ok: true }),
    },
    hostkey: { respond: async (input: any) => { hostKeyResponse = input } },
    prompt: { respond: async () => {} },
    onEvent: (cb: (ev: TerminalEvent) => void) => { sub = cb; return () => { sub = null } },
  }
  return {
    api,
    events,
    emit: (ev: TerminalEvent) => { events.push(ev); sub?.(ev) },
    get created() { return created },
    get restored() { return restored },
    get connected() { return connected },
    get attachedLocal() { return attachedLocal },
    get closed() { return closed },
    get killed() { return killed },
    get hostKeyResponse() { return hostKeyResponse },
  }
}

const key = "mafw-terminal-tabs-v1"

describe("terminal-store", () => {
  test("restored ssh tabs stay disconnected until visible", async () => {
    const fake = fakeApi({ sessions: [] })
    const store = createTerminalStore({
      api: fake.api as any,
      storage: memStorage({ [key]: JSON.stringify({ activeId: "ssh:r1", tabs: [{ id: "ssh:r1", kind: "ssh", hostId: "h1" }] }) }),
      localDirectory: () => "C:\\Work\\App",
    })
    await store.init()
    assert.equal(store.sessions().find((s) => s.id === "ssh:r1")?.status, "disconnected")
    assert.equal(fake.restored, 1)
    assert.equal(fake.connected, 0)
    store.setVisible(true)
    await tick()
    assert.equal(fake.connected, 1)
  })

  test("hidden directory change does not attach local pty", async () => {
    const fake = fakeApi()
    const store = createTerminalStore({ api: fake.api as any, storage: memStorage(), localDirectory: () => "C:\\A" })
    await store.init()
    store.setVisible(false)
    store.ensureLocal("C:\\B")
    assert.equal(fake.attachedLocal, 0)
    assert.equal(store.sessions().find((s) => s.kind === "local")?.directory, "C:\\B")
    store.setVisible(true)
    await tick()
    assert.equal(fake.attachedLocal, 1)
  })

  test("closing local tab stays closed until openLocal", async () => {
    const fake = fakeApi()
    const store = createTerminalStore({ api: fake.api as any, storage: memStorage(), localDirectory: () => "C:\\A" })
    await store.init()
    const local = store.sessions().find((s) => s.kind === "local")!
    await store.closeTab(local.id)
    store.ensureLocal("C:\\A")
    assert.equal(store.sessions().some((s) => s.kind === "local"), false)
    store.openLocal()
    assert.equal(store.sessions().some((s) => s.kind === "local"), true)
  })

  test("same host two tabs persists both", async () => {
    const fake = fakeApi()
    const storage = memStorage()
    const store = createTerminalStore({ api: fake.api as any, storage, localDirectory: () => "C:\\A" })
    await store.init()
    await store.openSsh("h1")
    await store.openSsh("h1")
    assert.equal(store.sessions().filter((s) => s.kind === "ssh").length, 2)
    const saved = JSON.parse(storage.dump()[key])
    assert.equal(saved.tabs.filter((t: any) => t.kind === "ssh").length, 2)
  })

  test("live sessions win and are not restored twice", async () => {
    const live: TerminalSessionInfo = { id: "ssh:live", kind: "ssh", title: "prod", hostId: "h1", status: "connected" }
    const fake = fakeApi({ sessions: [live] })
    const store = createTerminalStore({
      api: fake.api as any,
      storage: memStorage({ [key]: JSON.stringify({ activeId: "ssh:live", tabs: [{ id: "ssh:live", kind: "ssh", hostId: "h1" }] }) }),
      localDirectory: () => "C:\\A",
    })
    await store.init()
    assert.equal(fake.restored, 0)
    assert.equal(store.sessions().filter((s) => s.id === "ssh:live").length, 1)
  })

  test("restored ssh without saved credentials is not auto-connected", async () => {
    const fake = fakeApi({ sessions: [] })
    fake.api.hosts.list = async () => [{ ...host, hasPassword: false }]
    const store = createTerminalStore({
      api: fake.api as any,
      storage: memStorage({ [key]: JSON.stringify({ activeId: "ssh:r1", tabs: [{ id: "ssh:r1", kind: "ssh", hostId: "h1" }] }) }),
      localDirectory: () => null,
    })
    await store.init()
    store.setVisible(true)
    await tick()
    assert.equal(fake.connected, 0)
    store.setVisible(false)
    store.setVisible(true)
    await tick()
    assert.equal(fake.connected, 0)
  })

  test("openLocal works from last ensured directory when localDirectory is null", async () => {
    const fake = fakeApi()
    const store = createTerminalStore({ api: fake.api as any, storage: memStorage(), localDirectory: () => null })
    await store.init()
    store.ensureLocal("C:\\A")
    const local = store.sessions().find((s) => s.kind === "local")!
    await store.closeTab(local.id)
    store.openLocal()
    assert.equal(store.sessions().some((s) => s.kind === "local"), true)
  })

  test("host key event is surfaced and responded", async () => {
    const fake = fakeApi()
    const store = createTerminalStore({ api: fake.api as any, storage: memStorage(), localDirectory: () => "C:\\A" })
    await store.init()
    const req = {
      type: "hostkey" as const,
      requestId: "r1",
      sessionId: "ssh:1",
      host: "h",
      port: 22,
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:x",
      kind: "new" as const,
    }
    fake.emit(req)
    assert.equal(store.hostKey()?.requestId, "r1")
    await store.respondHostKey("trust-and-save")
    assert.deepEqual(fake.hostKeyResponse, { requestId: "r1", action: "trust-and-save" })
    assert.equal(store.hostKey(), null)
  })

  test("host key prompts queue instead of overwriting", async () => {
    const fake = fakeApi()
    const store = createTerminalStore({ api: fake.api as any, storage: memStorage(), localDirectory: () => "C:\\A" })
    await store.init()
    const req = (requestId: string) => ({
      type: "hostkey" as const,
      requestId,
      sessionId: `ssh:${requestId}`,
      host: "h",
      port: 22,
      keyType: "ssh-ed25519",
      fingerprint: `SHA256:${requestId}`,
      kind: "new" as const,
    })
    fake.emit(req("r1"))
    fake.emit(req("r2"))
    assert.equal(store.hostKey()?.requestId, "r1")
    await store.respondHostKey("trust")
    assert.equal(store.hostKey()?.requestId, "r2")
  })

  test("close active picks a neighbor and kill local removes it", async () => {
    const fake = fakeApi()
    const store = createTerminalStore({ api: fake.api as any, storage: memStorage(), localDirectory: () => "C:\\A" })
    await store.init()
    await store.openSsh("h1")
    const ssh = store.sessions().find((s) => s.kind === "ssh")!
    store.setActive(ssh.id)
    await store.closeTab(ssh.id)
    assert.ok(store.activeId())
    assert.equal(store.sessions().some((s) => s.id === ssh.id), false)
    const local = store.sessions().find((s) => s.kind === "local")!
    await store.killLocal(local.id)
    assert.equal(fake.killed, 1)
    assert.equal(store.sessions().some((s) => s.id === local.id), false)
  })
})
