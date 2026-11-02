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
const PROTO = "mafw-terminal/1"

const ACTIONS_OK = {
  body: {
    experienceVersion: "2026.11.2",
    actions: { "terminal.attach": { id: "terminal.attach", supported: true, enabled: true } },
  },
}
const LIST_OK = (sessions: any[] = [], supported = true) => ({
  body: { protocol: PROTO, supported, sessions },
})
const CREATE_OK = { body: { protocol: PROTO, id: "t1" } }
const TICKET_OK = {
  body: {
    protocol: PROTO,
    ticket: "tk",
    url: `/api/terminal/sessions/t1/connect?ticket=tk`,
    expiresAt: 9_999,
  },
}

function opsWith(routes: Route[]) {
  const f = fakeFetch(routes)
  const w = fakeWsFactory()
  const ops = createLocalTerminalOps({ gatewayBase: () => GW, fetchImpl: f.impl, wsFactory: w.factory })
  return { ops, f, w }
}

function baseRoutes(sessions: any[] = [], supported = true): Route[] {
  return [
    { method: "GET", match: /\/api\/experience\/actions$/, ...ACTIONS_OK },
    { method: "GET", match: /\/api\/terminal\/sessions\?/, body: LIST_OK(sessions, supported).body },
    { method: "POST", match: /\/api\/terminal\/sessions$/, ...CREATE_OK },
    { method: "POST", match: /\/api\/terminal\/sessions\/t1\/connect-ticket$/, ...TICKET_OK },
  ]
}

const frame = (payload: any) => JSON.stringify(payload)

describe("local-terminal (neutral gateway surfaces)", () => {
  test("local terminal uses MAFW terminal endpoints and frames only", async () => {
    const { ops, f, w } = opsWith(baseRoutes())
    const sub = () => {}
    await ops.probe()
    await ops.attach(D, SID, sub, "k")

    const urls = f.calls.map((c) => String(c.url))
    assert.equal(urls.every((u) => !/\/api\/pty|\/api\/info/.test(u)), true)
    assert.equal(w.sockets.length, 1)
    assert.match(w.sockets[0].url, /^ws:\/\/127\.0\.0\.1:3000\/api\/terminal\/sessions\//)
    assert.doesNotMatch(JSON.stringify(f.calls), /x-opencode-ticket|persistentPty/)
    assert.doesNotMatch(JSON.stringify(f.calls), /\/api\/info/)
  })

  test("probe reads the Experience terminal.attach action", async () => {
    const ok = opsWith([{ method: "GET", match: /\/api\/experience\/actions$/, ...ACTIONS_OK }])
    assert.deepEqual(await ok.ops.probe(), { available: true })

    const unsupported = opsWith([{
      method: "GET",
      match: /\/api\/experience\/actions$/,
      body: { actions: { "terminal.attach": { id: "terminal.attach", supported: false, enabled: false } } },
    }])
    const r = await unsupported.ops.probe()
    assert.equal(r.available, false)
    assert.ok(r.reason)

    const legacy = opsWith([{ method: "GET", match: /\/api\/experience\/actions$/, status: 404 }])
    const l = await legacy.ops.probe()
    assert.equal(l.available, false)
    assert.match(l.reason ?? "", /不支持|不可用|gateway/i)

    const offline = createLocalTerminalOps({
      gatewayBase: () => GW,
      fetchImpl: (async () => { throw new Error("ECONNREFUSED") }) as any,
    })
    const o = await offline.probe()
    assert.equal(o.available, false)
    assert.match(o.reason ?? "", /gateway/i)
  })

  test("attach creates a terminal with directory-only body, takes a ticket, opens the neutral WS, emits connected", async () => {
    const { ops, f, w } = opsWith(baseRoutes())
    const events: TerminalEvent[] = []
    const r = await ops.attach(D, SID, (ev) => events.push(ev), "v1")
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.terminalId, "t1")

    const create = f.calls.find((c) => c.method === "POST" && /\/api\/terminal\/sessions$/.test(c.url))!
    assert.equal(create.body.directory, D)
    assert.equal(create.body.cwd, D)
    assert.equal("command" in create.body, false)
    const ticket = f.calls.find((c) => /connect-ticket/.test(c.url))!
    assert.equal(ticket.body.directory, D)
    assert.match(w.sockets[0].url, /\/api\/terminal\/sessions\/t1\/connect\?ticket=tk$/)
    assert.equal(events[0]?.type, "status")
    if (events[0]?.type === "status") assert.equal(events[0].status, "connected")
  })

  test("existing running terminal is reused; ticket is fresh each attach", async () => {
    const { ops, f, w } = opsWith(baseRoutes([{ id: "t1", status: "running" }]))
    await ops.attach(D, SID, () => {})
    assert.equal(f.calls.filter((c) => c.method === "POST" && /\/api\/terminal\/sessions$/.test(c.url)).length, 0)
    w.sockets[0].onclose?.({ code: 1006 })
    await ops.attach(D, SID, () => {})
    assert.equal(f.calls.filter((c) => /connect-ticket/.test(c.url)).length, 2)
    assert.equal(w.sockets.length, 2)
  })

  test("unsupported runtime reports unavailable instead of faking a PTY", async () => {
    const { ops, f } = opsWith(baseRoutes([], false))
    const r = await ops.attach(D, SID, () => {}, "k")
    assert.deepEqual(r, { ok: false, reason: "unavailable" })
    assert.equal(f.calls.some((c) => c.method === "POST" && /\/api\/terminal\/sessions$/.test(c.url)), false)
  })

  test("output frames fan out to all subscribers; meta/unknown frames are not data", async () => {
    const { ops, w } = opsWith(baseRoutes([{ id: "t1", status: "running" }]))
    const a: TerminalEvent[] = []
    const b: TerminalEvent[] = []
    await ops.attach(D, SID, (ev) => a.push(ev), "a")
    await ops.attach(D, SID, (ev) => b.push(ev), "b")
    assert.equal(w.sockets.length, 1)
    w.sockets[0].onmessage({ data: frame({ v: 1, type: "output", data: "hello" }) })
    assert.deepEqual(a.at(-1), { type: "data", sessionId: SID, data: "hello" })
    assert.deepEqual(b.at(-1), { type: "data", sessionId: SID, data: "hello" })
    w.sockets[0].onmessage({ data: frame({ v: 1, type: "meta", event: "cursor", payload: { cursor: 7 } }) })
    w.sockets[0].onmessage({ data: frame({ v: 1, type: "bogus" }) })
    assert.equal(a.filter((e) => e.type === "data").length, 1)
  })

  test("close frame emits disconnected with the server reason", async () => {
    const { ops, w } = opsWith(baseRoutes([{ id: "t1", status: "running" }]))
    const evs: TerminalEvent[] = []
    await ops.attach(D, SID, (ev) => evs.push(ev), "w1")
    w.sockets[0].onmessage({ data: frame({ v: 1, type: "close", code: 4502, reason: "terminal upstream unavailable" }) })
    const last = evs.at(-1)
    assert.equal(last?.type, "status")
    if (last?.type === "status") {
      assert.equal(last.status, "disconnected")
      assert.match(last.error ?? "", /upstream/)
    }
  })

  test("ticket failure with a previously tracked terminal reports gone; reopen recreates", async () => {
    let listCalls = 0
    const f = fakeFetch([
      { method: "GET", match: /\/api\/experience\/actions$/, ...ACTIONS_OK },
      { method: "GET", match: /\/api\/terminal\/sessions\?/, body: () => (listCalls++ === 0 ? LIST_OK([{ id: "t1", status: "running" }]).body : LIST_OK([]).body) },
      { method: "POST", match: /\/api\/terminal\/sessions$/, ...CREATE_OK },
      { method: "POST", match: /\/api\/terminal\/sessions\/t1\/connect-ticket$/, ...TICKET_OK },
    ])
    const w = fakeWsFactory()
    const ops = createLocalTerminalOps({ gatewayBase: () => GW, fetchImpl: f.impl, wsFactory: w.factory })
    await ops.attach(D, SID, () => {}, "w1")
    w.sockets[0].onclose?.({ code: 1006 })
    assert.deepEqual(await ops.attach(D, SID, () => {}, "w1"), { ok: false, reason: "gone" })

    const reopened = await ops.attach(D, SID, () => {}, "w1", { reopen: true })
    assert.equal(reopened.ok, true)
    assert.equal(f.calls.filter((c) => c.method === "POST" && /\/api\/terminal\/sessions$/.test(c.url)).length >= 1, true)
  })

  test("same key replaces subscriber and replays the ring buffer", async () => {
    const { ops, w } = opsWith(baseRoutes([{ id: "t1", status: "running" }]))
    const first: TerminalEvent[] = []
    await ops.attach(D, SID, (ev) => first.push(ev), "win-1")
    w.sockets[0].onmessage({ data: frame({ v: 1, type: "output", data: "prompt$ " }) })
    const replay: TerminalEvent[] = []
    const r = await ops.attach(D, SID, (ev) => replay.push(ev), "win-1")
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.replayed, true)
    assert.deepEqual(replay.filter((e) => e.type === "data").map((e) => e.data), ["prompt$ "])
    first.length = 0
    replay.length = 0
    w.sockets[0].onmessage({ data: frame({ v: 1, type: "output", data: "x" }) })
    assert.equal(first.length, 0)
    assert.equal(replay.filter((e) => e.type === "data").length, 1)
  })

  test("input and resize travel as MAFW frames; kill deletes the neutral session", async () => {
    const { ops, f, w } = opsWith([
      ...baseRoutes([{ id: "t1", status: "running" }]),
      { method: "DELETE", match: /\/api\/terminal\/sessions\/t1\?/, body: { ok: true } },
    ])
    await ops.attach(D, SID, () => {})
    ops.input(D, "echo hi\r")
    assert.deepEqual(JSON.parse(w.sockets[0].sent.at(-1)), { v: 1, type: "input", data: "echo hi\r" })
    await ops.resize(D, 100, 30)
    assert.deepEqual(JSON.parse(w.sockets[0].sent.at(-1)), { v: 1, type: "resize", cols: 100, rows: 30 })
    await ops.resize(D, 100, 30) // identical size is not resent
    assert.equal(w.sockets[0].sent.filter((s: string) => s.includes('"resize"')).length, 1)
    await ops.kill(D)
    const del = f.calls.find((c) => c.method === "DELETE")!
    assert.match(del.url, /\/api\/terminal\/sessions\/t1\?directory=/)
    assert.equal(w.sockets[0].readyState, 3)
    ops.input(D, "x")
    assert.equal(w.sockets[0].sent.filter((s: string) => s.includes('"input"')).length, 1)
  })

  test("malformed server frames close the session instead of rendering garbage", async () => {
    const { ops, w } = opsWith(baseRoutes([{ id: "t1", status: "running" }]))
    const evs: TerminalEvent[] = []
    await ops.attach(D, SID, (ev) => evs.push(ev), "v")
    w.sockets[0].onmessage({ data: "not-a-frame" })
    assert.equal(evs.filter((e) => e.type === "data").length, 0)
    const last = evs.at(-1)
    assert.equal(last?.type, "status")
    if (last?.type === "status") assert.equal(last.status, "disconnected")
  })

  test("resize retries after a failed send (lastSize only advances on success)", async () => {
    const f = fakeFetch(baseRoutes([{ id: "t1", status: "running" }]))
    let failures = 1
    const sockets: any[] = []
    const wsFactory = (url: string) => {
      const ws: any = {
        url,
        readyState: 1,
        binaryType: "arraybuffer",
        sent: [] as string[],
        send(d: string) {
          if (failures > 0) { failures -= 1; throw new Error("socket closing") }
          ws.sent.push(d)
        },
        close() { ws.readyState = 3; ws.onclose?.({ code: 1000 }) },
        onmessage: null,
        onclose: null,
        onerror: null,
      }
      sockets.push(ws)
      return ws
    }
    const ops = createLocalTerminalOps({ gatewayBase: () => GW, fetchImpl: f.impl, wsFactory })
    await ops.attach(D, SID, () => {}, "k")
    await ops.resize(D, 100, 30) // send throws → must not be remembered as applied
    await ops.resize(D, 100, 30) // retries the same size
    assert.equal(sockets[0].sent.filter((s: string) => s.includes('"resize"')).length, 1)
    await ops.resize(D, 100, 30) // now applied → no duplicate
    assert.equal(sockets[0].sent.filter((s: string) => s.includes('"resize"')).length, 1)
  })
})
