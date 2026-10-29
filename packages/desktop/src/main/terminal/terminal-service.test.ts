import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createTerminalService } from "./terminal-service"
import type { LocalTerminalOps } from "./local-terminal"
import type { SshHostProfileInput } from "../../shared/ssh-host"
import type { TerminalEvent } from "../../shared/terminal-session"
import type { SshSession, SshSessionDeps } from "./ssh-session"
import { installTerminalServiceIpc } from "./terminal-ipc"

const base: SshHostProfileInput = {
  name: "prod-01",
  group: "生产",
  host: "10.0.0.12",
  port: 22,
  username: "deploy",
  auth: "password",
  autoReconnect: true,
  keepaliveSeconds: 15,
}

const fakeLocal: LocalTerminalOps = {
  async probe() { return { available: true, serveUrl: "http://127.0.0.1:4096" } },
  async attach() { return { ok: true, ptyId: "p1", replayed: false } },
  detach() {},
  input() {},
  async resize() {},
  async kill() {},
}

const safe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from("enc:" + s),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
})

function makeService(opts: { safeStorageAvailable?: boolean; onEvent?: (ev: TerminalEvent) => void } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "mafw-svc-"))
  const events: TerminalEvent[] = []
  const tested: any[] = []
  const svc = createTerminalService({
    dataDir,
    local: fakeLocal,
    safeStorage: safe(opts.safeStorageAvailable !== false),
    onEvent: (ev) => { events.push(ev); opts.onEvent?.(ev) },
    openExternal: async () => {},
    log: () => {},
    now: () => 1000,
    id: (() => { let n = 0; return () => `id${++n}` })(),
    testSshConnection: (async (opts: any) => {
      tested.push(opts)
      return { ok: true }
    }) as any,
  })
  return { svc, dataDir, events, tested }
}

describe("terminal-service", () => {
  test("hosts.list returns hasPassword without the secret", async () => {
    const { svc } = makeService()
    const saved = await svc.hosts.save({ ...base }, { password: "x" })
    assert.equal(saved.hasPassword, true)
    const list = await svc.hosts.list()
    assert.equal(list[0].hasPassword, true)
    assert.equal("password" in list[0], false)
  })

  test("hosts.save validates and persists; remove clears secret", async () => {
    const { svc, dataDir } = makeService()
    await assert.rejects(() => svc.hosts.save({ ...base, host: "" }, {}), /主机不能为空/)
    const saved = await svc.hosts.save({ ...base }, { password: "x" })
    assert.equal((await svc.hosts.list()).length, 1)
    await svc.hosts.remove(saved.id)
    assert.deepEqual(await svc.hosts.list(), [])
    const secrets = JSON.parse(readFileSync(join(dataDir, "secrets.json"), "utf8"))
    assert.equal(secrets.entries[saved.id], undefined)
  })

  test("hosts.save rejects secret when safeStorage is unavailable", async () => {
    const { svc } = makeService({ safeStorageAvailable: false })
    await assert.rejects(() => svc.hosts.save({ ...base }, { password: "x" }), /凭据存储不可用/)
  })

  test("hosts.test uses the injected connection probe without persisting", async () => {
    const { svc, tested } = makeService()
    const result = await svc.hosts.test({ ...base, host: "example.com" }, { password: "x" })
    assert.deepEqual(result, { ok: true })
    assert.equal(tested.length, 1)
    assert.equal(tested[0].profile.host, "example.com")
    assert.equal(tested[0].secret.password, "x")
    assert.deepEqual(await svc.hosts.list(), [])
  })

  test("IPC installer exposes v2 channels", () => {
    const handlers: Record<string, Function> = {}
    const ipcMain = { handle: (ch: string, fn: Function) => { handlers[ch] = fn } }
    const { dataDir } = { dataDir: mkdtempSync(join(tmpdir(), "mafw-ipc-")) }
    installTerminalServiceIpc(ipcMain, {
      dataDir,
      gatewayBase: () => "http://127.0.0.1:3000",
      safeStorage: safe(),
      openExternal: async () => {},
      broadcast: () => {},
      log: () => {},
    })
    for (const ch of [
      "mafw-terminal-v2-list",
      "mafw-terminal-v2-local-attach",
      "mafw-terminal-v2-ssh-create",
      "mafw-terminal-v2-hosts-list",
      "mafw-terminal-v2-hostkey-respond",
    ]) {
      assert.equal(typeof handlers[ch], "function", ch)
    }
  })
})
