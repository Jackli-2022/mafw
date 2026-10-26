import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createTerminalOps, installTerminalBridge, type TerminalEvent } from "./terminal-bridge"

// ── fake fetch：路由表 (method + url 正则) → 响应（body 可为函数以模拟时序）──
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
const INFO_OK = { body: { urls: ["http://127.0.0.1:4096"], capabilities: { persistentPty: true } } }
const TOKEN_OK = { body: { data: { ticket: "tk", expires_in: 60 } } }

function opsWith(routes: Route[]) {
  const f = fakeFetch(routes)
  const w = fakeWsFactory()
  const ops = createTerminalOps({ gatewayBase: () => GW, fetchImpl: f.impl, wsFactory: w.factory })
  return { ops, f, w }
}

/** 常规路由：info + list + create + token（id 固定 p1）。 */
function baseRoutes(listBody: any): Route[] {
  return [
    { method: "GET", match: /\/api\/info$/, ...INFO_OK },
    { method: "GET", match: /\/api\/pty\?/, body: listBody },
    { method: "POST", match: /\/api\/pty\?/, body: { data: { id: "p1", status: "running" } } },
    { method: "POST", match: /\/api\/pty\/p1\/connect-token/, ...TOKEN_OK },
  ]
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
    const { ops, f, w } = opsWith(baseRoutes({ data: [] }))
    const r = await ops.attach(D, () => {})
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.ptyId, "p1")
    const create = f.calls.find((c) => c.method === "POST" && /\/api\/pty\?/.test(c.url))!
    assert.equal(create.body.cwd, D)
    assert.equal("command" in create.body, false)
    const token = f.calls.find((c) => /connect-token/.test(c.url))!
    assert.equal(token.headers["x-opencode-ticket"], "1")
    assert.match(w.sockets[0].url, /^ws:\/\/127\.0\.0\.1:4096\/api\/pty\/p1\/connect\?ticket=tk/)
  })

  test("attach 已有 running：不创建，直接 token + WS", async () => {
    const { ops, f, w } = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    await ops.attach(D, () => {})
    assert.equal(f.calls.filter((c) => c.method === "POST" && /\/api\/pty\?/.test(c.url)).length, 0)
    assert.match(w.sockets[0].url, /pty\/p1\/connect/)
  })

  test("token 每次 attach 现取（断线重连不缓存）", async () => {
    const { ops, f, w } = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    await ops.attach(D, () => {})
    w.sockets[0].onclose?.({ code: 1006 })
    await ops.attach(D, () => {})
    assert.equal(f.calls.filter((c) => /connect-token/.test(c.url)).length, 2)
    assert.equal(w.sockets.length, 2)
  })

  test("WS 文本帧 fanout 给该目录全部订阅者；meta 帧不 fanout", async () => {
    const { ops, w } = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    const a: TerminalEvent[] = []
    const b: TerminalEvent[] = []
    await ops.attach(D, (ev) => a.push(ev))
    await ops.attach(D, (ev) => b.push(ev)) // 复用同一 WS，不同订阅者
    assert.equal(w.sockets.length, 1, "第二订阅者不新开 WS")
    w.sockets[0].onmessage({ data: "hello" })
    assert.deepEqual(a.at(-1), { directory: D, type: "data", data: "hello" })
    assert.deepEqual(b.at(-1), { directory: D, type: "data", data: "hello" })

    const meta = new Uint8Array([0, ...new TextEncoder().encode('{"cursor":7}')]).buffer
    w.sockets[0].onmessage({ data: meta })
    assert.equal(a.filter((e) => e.type === "data").length, 1, "meta 帧不得当输出")
  })

  test("Critical-1：同 key 重挂载收到 ring buffer replay（不再空屏）", async () => {
    const { ops, w } = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    await ops.attach(D, () => {}, { key: "win-1" })
    w.sockets[0].onmessage({ data: "prompt$ " })

    const replay: TerminalEvent[] = []
    const r = await ops.attach(D, (ev) => replay.push(ev), { key: "win-1" })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.replayed, true)
    assert.deepEqual(replay.filter((e) => e.type === "data").map((e) => e.data), ["prompt$ "])
  })

  test("Critical-2：同 key 重挂载替换旧订阅者，不重复投递（不 2×/N× 输出）", async () => {
    const { ops, w } = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    const first: TerminalEvent[] = []
    const second: TerminalEvent[] = []
    await ops.attach(D, (ev) => first.push(ev), { key: "win-1" })
    await ops.attach(D, (ev) => second.push(ev), { key: "win-1" }) // 同窗口重挂载
    first.length = 0
    second.length = 0
    w.sockets[0].onmessage({ data: "x" })
    assert.equal(first.length, 0, "旧订阅者必须被替换")
    assert.equal(second.filter((e) => e.type === "data").length, 1, "每个 chunk 只投递一次")
  })

  test("Important-3：4404 关闭 → gone；PTY 消失后 attach 返回 gone；reopen 强制重建", async () => {
    // ① WS close 4404 = terminal gone
    const a = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    const evs: TerminalEvent[] = []
    await a.ops.attach(D, (ev) => evs.push(ev), { key: "w1" })
    a.w.sockets[0].onclose?.({ code: 4404 })
    assert.equal(evs.at(-1)?.type, "gone", "4404 必须是 gone 而非普通断开")

    // ② serve 重启：先有 p1，重启后 list 空 → 非 reopen 返回 gone（不静默重建）
    let listCalls = 0
    const f = fakeFetch([
      { method: "GET", match: /\/api\/info$/, ...INFO_OK },
      { method: "GET", match: /\/api\/pty\?/, body: () => (listCalls++ === 0 ? { data: [{ id: "p1", status: "running" }] } : { data: [] }) },
      { method: "POST", match: /\/api\/pty\?/, body: { data: { id: "p2", status: "running" } } },
      { method: "POST", match: /\/api\/pty\/p1\/connect-token/, ...TOKEN_OK },
      { method: "POST", match: /\/api\/pty\/p2\/connect-token/, ...TOKEN_OK },
    ])
    const w = fakeWsFactory()
    const ops = createTerminalOps({ gatewayBase: () => GW, fetchImpl: f.impl, wsFactory: w.factory })
    await ops.attach(D, () => {}, { key: "w1" })
    w.sockets[0].onclose?.({ code: 1006 }) // 异常断开（进程死亡无 close 帧）
    const res = await ops.attach(D, () => {}, { key: "w1" })
    assert.deepEqual(res, { ok: false, reason: "gone" })

    // ③ reopen=true 越过 gone，强制新建
    const re = await ops.attach(D, () => {}, { key: "w1", reopen: true })
    assert.equal(re.ok, true)
    if (re.ok) assert.equal(re.ptyId, "p2")
  })

  test("input 原样发送（\\r 不改写）；resize PUT size；kill DELETE 且关 WS", async () => {
    const { ops, f, w } = opsWith([
      ...baseRoutes({ data: [{ id: "p1", status: "running" }] }),
      { method: "PUT", match: /\/api\/pty\/p1\?/, body: {} },
      { method: "DELETE", match: /\/api\/pty\/p1\?/, status: 204, body: {} },
    ])
    await ops.attach(D, () => {})
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

  test("minor：非法 0x00 meta 帧被消费而非当输出；Uint8Array view 按 byteOffset 解码", async () => {
    const { ops, w } = opsWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    const evs: TerminalEvent[] = []
    await ops.attach(D, (e) => evs.push(e))
    w.sockets[0].onmessage({ data: new Uint8Array([0, 123, 98, 97, 100]).buffer }) // \0{bad
    assert.equal(evs.filter((e) => e.type === "data").length, 0, "非法 meta 不得进终端")
    const raw = new TextEncoder().encode("XhelloY")
    w.sockets[0].onmessage({ data: new Uint8Array(raw.buffer, 1, 5) })
    assert.equal(evs.at(-1)?.data, "hello", "view 必须按 byteOffset/byteLength 切片")
  })
})

describe("terminal-bridge install layer（订阅生命周期）", () => {
  function installWith(routes: Route[]) {
    const f = fakeFetch(routes)
    const w = fakeWsFactory()
    const handlers: Record<string, (...a: any[]) => any> = {}
    const ipcMain = { handle: (ch: string, fn: any) => { handlers[ch] = fn } }
    const sent: any[] = []
    let onceCalls = 0
    const sender = { id: 7, isDestroyed: () => false, send: (_ch: string, payload: any) => sent.push(payload), once: () => { onceCalls++ } }
    installTerminalBridge(ipcMain, { gatewayBase: () => GW, fetchImpl: f.impl, wsFactory: w.factory })
    return { handlers, sender, sent, w, f, onceCalls: () => onceCalls }
  }

  test("同窗口重复 attach 只注册一个订阅者（Critical-2 install 层）", async () => {
    const { handlers, sender, sent, w } = installWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    await handlers["mafw-terminal-attach"]({ sender }, { directory: D })
    await handlers["mafw-terminal-attach"]({ sender }, { directory: D })
    w.sockets[0].onmessage({ data: "x" })
    assert.equal(sent.filter((p) => p.type === "data").length, 1, "每 chunk 只发一次 IPC")
  })

  test("detach 后不再推送（install 层释放订阅）", async () => {
    const { handlers, sender, sent, w } = installWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    await handlers["mafw-terminal-attach"]({ sender }, { directory: D })
    handlers["mafw-terminal-detach"]({ sender }, { directory: D })
    w.sockets[0].onmessage({ data: "x" })
    assert.equal(sent.filter((p) => p.type === "data").length, 0)
  })

  test("同一 webContents 只挂一个 destroyed 清理钩（HMR/多目录不泄漏监听器）", async () => {
    const { handlers, sender, onceCalls } = installWith(baseRoutes({ data: [{ id: "p1", status: "running" }] }))
    await handlers["mafw-terminal-attach"]({ sender }, { directory: D })
    await handlers["mafw-terminal-attach"]({ sender }, { directory: D })
    await handlers["mafw-terminal-attach"]({ sender }, { directory: "C:\\work\\other" })
    assert.equal(onceCalls(), 1)
  })
})
