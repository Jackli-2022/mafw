import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createLocalTerminalOps } from "./local-terminal"
import type { TerminalEvent } from "../../shared/terminal-session"

type Route = { method: string; match: RegExp; status?: number; body?: any }

function fakeFetch(routes: Route[]) {
  const calls: Array<{ method: string; url: string; body?: any; headers?: any }> = []
  const impl = async (url: string, init?: any) => {
    const method = init?.method ?? "GET"
    const headers = init?.headers ?? {}
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body, headers })
    const hit = routes.find((r) => r.method === method && r.match.test(url))
    if (!hit) return { ok: false, status: 404, json: async () => ({}) }
    const payload = typeof hit.body === "function" ? hit.body() : hit.body
    return { ok: (hit.status ?? 200) < 400, status: hit.status ?? 200, json: async () => payload ?? {} }
  }
  return { impl: impl as any, calls }
}

function fakeWsFactory() {
  const sockets: any[] = []
  const factory = (url: string) => {
    const ws: any = {
      url,
      readyState: 1,
      binaryType: "arraybuffer",
      sent: [] as string[],
      send(d: string) { ws.sent.push(d) },
      close() { ws.readyState = 3; ws.onclose?.({ code: 1000 }) },
      onmessage: null as any,
      onclose: null as any,
      onerror: null as any,
    }
    sockets.push(ws)
    return ws
  }
  return { factory, sockets }
}

const GW = "http://127.0.0.1:3000"
const D = "C:\\work\\proj"
const SID = "local:c:/work/proj"
const INFO_OK = { body: { urls: ["http://127.0.0.1:4096"], capabilities: { persistentPty: true } } }
const TOKEN_OK = { body: { data: { ticket: "tk", expires_in: 60 } } }

function opsWith(routes: Route[]) {
  const f = fakeFetch(routes)
  const w = fakeWsFactory()
  const ops = createLocalTerminalOps({ gatewayBase: () => GW, fetchImpl: f.impl, wsFactory: w.factory })
  return { ops, f, w }
}

function baseRoutes(listBody: any): Route[] {
  return [
    { method: "GET", match: /\/api\/info$/, ...INFO_OK },
    { method: "GET", match: /\/api\/pty\?/, body: listBody },
    { method: "POST", match: /\/api\/pty\?/, body: { data: { id: "p1", status: "running" } } },
    { method: "POST", match: /\/api\/pty\/p1\/connect-token/, ...TOKEN_OK },
  ]
}

describe("local-terminal", () => {
  test("probe: persistentPty true/false", async () => {
    const a = opsWith([{ method: "GET", match: /\/api\/info$/, ...INFO_OK }])
    assert.deepEqual(await a.ops.probe(), { available: true, serveUrl: "http://127.0.0.1:4096" })
    const b = opsWith([{ method: "GET", match: /\/api\/info$/, body: { urls: [], capabilities: { persistentPty: false } } }])
    const r = await b.ops.probe()
    assert.equal(r.available, false)
    assert.ok(r.reason)
  })

  test("attach creates cwd-only PTY, token with header, WS; emits connected", async () => {
    const { ops, f, w } = opsWith(baseRoutes({ data: [] }))
    const events: TerminalEvent[] = []
    const r = await ops.attach(D, SID, (ev) => events.push(ev), "v1")
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.ptyId, "p1")
    const create = f.calls.find((c) => c.method === "POST" && /\/api\/pty\?/.test(c.url))!
    assert.equal(create.body.cwd, D)
    assert.equal("command" in create.body, false)
    const token = f.calls.find((c) => /connect-token/.test(c.url))!
    assert.equal(token.headers["x-opencode-ticket"], "1")
    assert.match(w.sockets[0].url, /^ws:\/\/127\.0\.0\.1:4096\/api\/pty\/p1\/connect\?ticket=tk/)
    assert.deepEqual(events[0], { type: "status", sessionId: SID, status: "connected", connectedAt: events[0]!.type === "status" ? (events[0] as any).connectedAt : undefined })
  })

  test("existing running PTY is reused; token is fresh each attach", async () => {
    const { ops, f, w } = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    await ops.attach(D, SID, () => {})
    assert.equal(f.calls.filter((c) => c.method === "POST" && /\/api\/pty\?/.test(c.url)).length, 0)
    w.sockets[0].onclose?.({ code: 1006 })
    await ops.attach(D, SID, () => {})
    assert.equal(f.calls.filter((c) => /connect-token/.test(c.url)).length, 2)
    assert.equal(w.sockets.length, 2)
  })

  test("data fanout to all subscribers; meta frames are not data", async () => {
    const { ops, w } = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    const a: TerminalEvent[] = []
    const b: TerminalEvent[] = []
    await ops.attach(D, SID, (ev) => a.push(ev), "a")
    await ops.attach(D, SID, (ev) => b.push(ev), "b")
    assert.equal(w.sockets.length, 1)
    w.sockets[0].onmessage({ data: "hello" })
    assert.deepEqual(a.at(-1), { type: "data", sessionId: SID, data: "hello" })
    assert.deepEqual(b.at(-1), { type: "data", sessionId: SID, data: "hello" })
    const meta = new Uint8Array([0, ...new TextEncoder().encode('{"cursor":7}')]).buffer
    w.sockets[0].onmessage({ data: meta })
    assert.equal(a.filter((e) => e.type === "data").length, 1)
  })

  test("same key replaces subscriber and replays ring buffer", async () => {
    const { ops, w } = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    const first: TerminalEvent[] = []
    await ops.attach(D, SID, (ev) => first.push(ev), "win-1")
    w.sockets[0].onmessage({ data: "prompt$ " })
    const replay: TerminalEvent[] = []
    const r = await ops.attach(D, SID, (ev) => replay.push(ev), "win-1")
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.replayed, true)
    assert.deepEqual(replay.filter((e) => e.type === "data").map((e) => e.data), ["prompt$ "])
    first.length = 0
    replay.length = 0
    w.sockets[0].onmessage({ data: "x" })
    assert.equal(first.length, 0)
    assert.equal(replay.filter((e) => e.type === "data").length, 1)
  })

  test("4404 close emits disconnected; PTY disappearance returns gone; reopen recreates", async () => {
    const a = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    const evs: TerminalEvent[] = []
    await a.ops.attach(D, SID, (ev) => evs.push(ev), "w1")
    a.w.sockets[0].onclose?.({ code: 4404 })
    const last = evs.at(-1)
    assert.equal(last?.type, "status")
    if (last?.type === "status") {
      assert.equal(last.status, "disconnected")
      assert.match(last.error ?? "", /重启/)
    }

    let listCalls = 0
    const f = fakeFetch([
      { method: "GET", match: /\/api\/info$/, ...INFO_OK },
      { method: "GET", match: /\/api\/pty\?/, body: () => (listCalls++ === 0 ? { data: [{ id: "p1", status: "running" }] } : { data: [] }) },
      { method: "POST", match: /\/api\/pty\?/, body: { data: { id: "p2", status: "running" } } },
      { method: "POST", match: /\/api\/pty\/p1\/connect-token/, ...TOKEN_OK },
      { method: "POST", match: /\/api\/pty\/p2\/connect-token/, ...TOKEN_OK },
    ])
    const w = fakeWsFactory()
    const ops = createLocalTerminalOps({ gatewayBase: () => GW, fetchImpl: f.impl, wsFactory: w.factory })
    await ops.attach(D, SID, () => {}, "w1")
    w.sockets[0].onclose?.({ code: 1006 })
    assert.deepEqual(await ops.attach(D, SID, () => {}, "w1"), { ok: false, reason: "gone" })
    const re = await ops.attach(D, SID, () => {}, "w1", { reopen: true })
    assert.equal(re.ok, true)
    if (re.ok) assert.equal(re.ptyId, "p2")
  })

  test("input is identity (\\r preserved); resize PUT; kill DELETE", async () => {
    const { ops, f, w } = opsWith([
      ...baseRoutes({ data: [{ id: "p1", status: "running" }] }),
      { method: "PUT", match: /\/api\/pty\/p1\?/, body: {} },
      { method: "DELETE", match: /\/api\/pty\/p1\?/, status: 204, body: {} },
    ])
    await ops.attach(D, SID, () => {})
    ops.input(D, "echo hi\r")
    assert.equal(w.sockets[0].sent.at(-1), "echo hi\r")
    await ops.resize(D, 100, 30)
    const put = f.calls.find((c) => c.method === "PUT")!
    assert.deepEqual(put.body, { size: { cols: 100, rows: 30 } })
    await ops.kill(D)
    assert.equal(f.calls.some((c) => c.method === "DELETE"), true)
    assert.equal(w.sockets[0].readyState, 3)
    ops.input(D, "x")
    assert.equal(w.sockets[0].sent.length, 1)
  })

  test("invalid 0x00 meta is consumed; Uint8Array view respects byteOffset", async () => {
    const { ops, w } = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    const evs: TerminalEvent[] = []
    await ops.attach(D, SID, (e) => evs.push(e), "v")
    w.sockets[0].onmessage({ data: new Uint8Array([0, 123, 98, 97, 100]).buffer })
    assert.equal(evs.filter((e) => e.type === "data").length, 0)
    const raw = new TextEncoder().encode("XhelloY")
    w.sockets[0].onmessage({ data: new Uint8Array(raw.buffer, 1, 5) })
    assert.equal(evs.at(-1)?.type === "data" ? (evs.at(-1) as any).data : "", "hello")
  })
})
