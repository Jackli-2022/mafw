import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createTerminalOps, type TerminalEvent } from "./terminal-bridge"

// ── fake fetch：路由表 (method + url 正则) → 响应 ──────────────────────────
type Route = { method: string; match: RegExp; status?: number; body?: any; headers?: any }

function fakeFetch(routes: Route[]) {
  const calls: Array<{ method: string; url: string; body?: any; headers?: any }> = []
  const impl = async (url: string, init?: any) => {
    const method = init?.method ?? "GET"
    const headers = init?.headers ?? {}
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body, headers })
    const hit = routes.find((r) => r.method === method && r.match.test(url))
    if (!hit) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: (hit.status ?? 200) < 400, status: hit.status ?? 200, json: async () => hit.body ?? {} }
  }
  return { impl: impl as any, calls }
}

// ── fake ws：记录 url / send，可手动触发 onmessage / onclose ──────────────
function fakeWsFactory() {
  const sockets: any[] = []
  const factory = (url: string) => {
    const ws: any = {
      url,
      readyState: 1,
      binaryType: "arraybuffer",
      sent: [] as string[],
      send(d: string) { ws.sent.push(d) },
      close() { ws.readyState = 3; ws.onclose?.({}) },
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
const INFO_OK = { body: { urls: ["http://127.0.0.1:4096"], capabilities: { persistentPty: true } } }
const TOKEN_OK = { body: { data: { ticket: "tk", expires_in: 60 } } }

function opsWith(routes: Route[]) {
  const f = fakeFetch(routes)
  const w = fakeWsFactory()
  const ops = createTerminalOps({ gatewayBase: () => GW, fetchImpl: f.impl, wsFactory: w.factory })
  return { ops, f, w }
}

describe("terminal-bridge ops", () => {
  test("probe：persistentPty true → available + serveUrl；false → unavailable + reason", async () => {
    const a = opsWith([{ method: "GET", match: /\/api\/info$/, ...INFO_OK }])
    assert.deepEqual(await a.ops.probe(), { available: true, serveUrl: "http://127.0.0.1:4096" })

    const b = opsWith([{ method: "GET", match: /\/api\/info$/, body: { urls: [], capabilities: { persistentPty: false } } }])
    const r = await b.ops.probe()
    assert.equal(r.available, false)
    assert.ok(r.reason)
  })

  test("attach 无终端：创建（body cwd、无 command）→ 现取 token（带 x-opencode-ticket）→ 开 WS", async () => {
    const { ops, f, w } = opsWith([
      { method: "GET", match: /\/api\/info$/, ...INFO_OK },
      { method: "GET", match: /\/api\/pty\?/, body: { data: [] } },
      { method: "POST", match: /\/api\/pty\?/, body: { data: { id: "pty_1", status: "running" } } },
      { method: "POST", match: /\/api\/pty\/pty_1\/connect-token/, ...TOKEN_OK },
    ])
    const r = await ops.attach("C:\\work\\proj", () => {})
    assert.equal(r.ptyId, "pty_1")
    const create = f.calls.find((c) => c.method === "POST" && /\/api\/pty\?/.test(c.url))!
    assert.equal(create.body.cwd, "C:\\work\\proj")
    assert.equal("command" in create.body, false)
    const token = f.calls.find((c) => /connect-token/.test(c.url))!
    assert.equal(token.headers["x-opencode-ticket"], "1")
    assert.match(w.sockets[0].url, /^ws:\/\/127\.0\.0\.1:4096\/api\/pty\/pty_1\/connect\?ticket=tk/)
  })

  test("attach 已有 running：不创建，直接 token + WS", async () => {
    const { ops, f, w } = opsWith([
      { method: "GET", match: /\/api\/info$/, ...INFO_OK },
      { method: "GET", match: /\/api\/pty\?/, body: { data: [{ id: "p9", status: "running" }] } },
      { method: "POST", match: /\/api\/pty\/p9\/connect-token/, ...TOKEN_OK },
    ])
    await ops.attach("C:\\p", () => {})
    assert.equal(f.calls.filter((c) => c.method === "POST" && /\/api\/pty\?/.test(c.url)).length, 0)
    assert.match(w.sockets[0].url, /pty\/p9\/connect/)
  })

  test("token 每次 attach 现取（断线重连不缓存）", async () => {
    const { ops, f, w } = opsWith([
      { method: "GET", match: /\/api\/info$/, ...INFO_OK },
      { method: "GET", match: /\/api\/pty\?/, body: { data: [{ id: "p1", status: "running" }] } },
      { method: "POST", match: /\/api\/pty\/p1\/connect-token/, ...TOKEN_OK },
    ])
    await ops.attach("C:\\p", () => {})
    w.sockets[0].onclose?.({}) // 模拟断开
    await ops.attach("C:\\p", () => {})
    assert.equal(f.calls.filter((c) => /connect-token/.test(c.url)).length, 2)
    assert.equal(w.sockets.length, 2)
  })

  test("WS 文本帧 fanout 给该目录全部订阅者；meta 帧不 fanout", async () => {
    const { ops, w } = opsWith([
      { method: "GET", match: /\/api\/info$/, ...INFO_OK },
      { method: "GET", match: /\/api\/pty\?/, body: { data: [{ id: "p1", status: "running" }] } },
      { method: "POST", match: /\/api\/pty\/p1\/connect-token/, ...TOKEN_OK },
    ])
    const a: TerminalEvent[] = []
    const b: TerminalEvent[] = []
    await ops.attach("C:\\p", (ev) => a.push(ev))
    await ops.attach("C:\\p", (ev) => b.push(ev)) // 复用同一 WS
    assert.equal(w.sockets.length, 1, "第二订阅者不新开 WS")
    w.sockets[0].onmessage({ data: "hello" })
    assert.deepEqual(a.at(-1), { directory: "C:\\p", type: "data", data: "hello" })
    assert.deepEqual(b.at(-1), { directory: "C:\\p", type: "data", data: "hello" })

    const meta = new Uint8Array([0, ...new TextEncoder().encode('{"cursor":7}')]).buffer
    w.sockets[0].onmessage({ data: meta })
    assert.equal(a.filter((e) => e.type === "data").length, 1, "meta 帧不得当输出")
  })

  test("WS close → closed；token 404 → gone（订阅者收到）", async () => {
    const { ops, w } = opsWith([
      { method: "GET", match: /\/api\/info$/, ...INFO_OK },
      { method: "GET", match: /\/api\/pty\?/, body: { data: [{ id: "p1", status: "running" }] } },
      { method: "POST", match: /\/api\/pty\/p1\/connect-token/, ...TOKEN_OK },
    ])
    const evs: TerminalEvent[] = []
    await ops.attach("C:\\p", (ev) => evs.push(ev))
    w.sockets[0].onclose({})
    assert.equal(evs.at(-1)?.type, "closed")

    const g = opsWith([
      { method: "GET", match: /\/api\/info$/, ...INFO_OK },
      { method: "GET", match: /\/api\/pty\?/, body: { data: [{ id: "p2", status: "running" }] } },
      { method: "POST", match: /\/api\/pty\/p2\/connect-token/, status: 404, body: {} },
    ])
    const evs2: TerminalEvent[] = []
    await assert.rejects(g.ops.attach("C:\\q", (ev) => evs2.push(ev)))
    assert.equal(evs2.at(-1)?.type, "gone")
  })

  test("input 原样发送（\\r 不改写）；resize PUT size；kill DELETE 且关 WS", async () => {
    const { ops, f, w } = opsWith([
      { method: "GET", match: /\/api\/info$/, ...INFO_OK },
      { method: "GET", match: /\/api\/pty\?/, body: { data: [{ id: "p1", status: "running" }] } },
      { method: "POST", match: /\/api\/pty\/p1\/connect-token/, ...TOKEN_OK },
      { method: "PUT", match: /\/api\/pty\/p1\?/, body: {} },
      { method: "DELETE", match: /\/api\/pty\/p1\?/, status: 204, body: {} },
    ])
    await ops.attach("C:\\p", () => {})
    ops.input("C:\\p", "echo hi\r")
    assert.equal(w.sockets[0].sent.at(-1), "echo hi\r")
    await ops.resize("C:\\p", 100, 30)
    const put = f.calls.find((c) => c.method === "PUT")!
    assert.deepEqual(put.body, { size: { cols: 100, rows: 30 } })
    await ops.kill("C:\\p")
    assert.equal(f.calls.some((c) => c.method === "DELETE"), true)
    assert.equal(w.sockets[0].readyState, 3)
    ops.input("C:\\p", "x") // 会话已删 → 无副作用
    assert.equal(w.sockets[0].sent.length, 1)
  })
})
