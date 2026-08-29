import { test, expect, mock, beforeEach, afterEach } from "bun:test"
import { MafwClient } from "./client"
import { SSEConnection } from "./sse"

let fetchMock: ReturnType<typeof mock>

beforeEach(() => {
  fetchMock = mock()
  globalThis.fetch = fetchMock as any
})

function okJson(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, statusText: "OK", json: () => Promise.resolve(data) } as Response)
}

function notOk(status: number) {
  return Promise.resolve({
    ok: false, status, statusText: `HTTP ${status}`,
    json: () => Promise.reject(new Error("no body")),
  } as Response)
}

// ── Constructor ──

test("MafwClient constructor accepts string URL", () => {
  const c = new MafwClient("http://custom:1234")
  expect((c as any).baseUrl).toBe("http://custom:1234")
})

test("MafwClient constructor accepts MafwClientOptions", () => {
  const c = new MafwClient({ baseUrl: "http://opt:5678" })
  expect((c as any).baseUrl).toBe("http://opt:5678")
})

test("MafwClient constructor defaults to localhost:3000", () => {
  const c = new MafwClient()
  expect((c as any).baseUrl).toBe("http://localhost:3000")
})

// ── Session ──

test("session.create sends POST /api/session", async () => {
  fetchMock.mockResolvedValue(okJson({ id: "s1", title: "Test" }))
  const c = new MafwClient("http://gw:3000")
  const result = await c.session.create({ directory: "/proj" })
  expect(fetchMock).toHaveBeenCalledWith("http://gw:3000/api/session", expect.objectContaining({ method: "POST" }))
  expect(result.id).toBe("s1")
})

test("session.get sends GET /api/sessions/:id", async () => {
  fetchMock.mockResolvedValue(okJson({ id: "s1" }))
  const c = new MafwClient("http://gw:3000")
  const result = await c.session.get({ path: { id: "s1" } })
  expect(fetchMock).toHaveBeenCalledWith("http://gw:3000/api/sessions/s1", expect.anything())
  expect(result.id).toBe("s1")
})

test("session.list without query sends GET /api/sessions", async () => {
  fetchMock.mockResolvedValue(okJson({ sessions: [{ id: "s1" }] }))
  const c = new MafwClient("http://gw:3000")
  const result = await c.session.list()
  expect(fetchMock).toHaveBeenCalledWith("http://gw:3000/api/sessions", expect.anything())
  expect(result).toHaveLength(1)
})

test("session.list with projectID sends ?projectID= param", async () => {
  fetchMock.mockResolvedValue(okJson({ sessions: [] }))
  const c = new MafwClient("http://gw:3000")
  await c.session.list({ query: { projectID: "proj-1" } })
  const url = (fetchMock as any).mock.calls[0][0] as string
  expect(url).toContain("?projectID=proj-1")
})

test("session.delete sends DELETE /api/session/:id", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient("http://gw:3000")
  await c.session.delete({ path: { id: "s1" } })
  expect(fetchMock).toHaveBeenCalledWith("http://gw:3000/api/session/s1", expect.objectContaining({ method: "DELETE" }))
})

test("session.messages sends GET with query params", async () => {
  fetchMock.mockResolvedValue(okJson({ data: [] }))
  const c = new MafwClient("http://gw:3000")
  await c.session.messages({ path: { id: "s1" }, query: { limit: 50, before: "abc" } })
  const url = (fetchMock as any).mock.calls[0][0] as string
  expect(url).toContain("/api/sessions/s1/messages?")
  expect(url).toContain("limit=50")
  expect(url).toContain("before=abc")
})

test("session.messages omits optional query params when absent", async () => {
  fetchMock.mockResolvedValue(okJson({ data: [] }))
  const c = new MafwClient("http://gw:3000")
  await c.session.messages({ path: { id: "s1" } })
  const url = (fetchMock as any).mock.calls[0][0] as string
  expect(url).toBe("http://gw:3000/api/sessions/s1/messages?")
})

test("session.prompt sends POST /api/session/:id/prompt", async () => {
  fetchMock.mockResolvedValue(okJson({ parts: [] }))
  const c = new MafwClient("http://gw:3000")
  await c.session.prompt({
    path: { id: "s1" },
    body: { parts: [{ type: "text", text: "hello" }] },
  })
  expect(fetchMock).toHaveBeenCalledWith("http://gw:3000/api/session/s1/prompt",
    expect.objectContaining({ method: "POST" }))
  const body = JSON.parse((fetchMock as any).mock.calls[0][1].body)
  expect(body.parts[0].text).toBe("hello")
})

// ── Error paths ──

test("session.list returns [] on null sessions", async () => {
  fetchMock.mockResolvedValue(okJson({ sessions: null }))
  const c = new MafwClient()
  expect(await c.session.list()).toEqual([])
})

test("session.list returns [] on empty response", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  expect(await c.session.list()).toEqual([])
})

test("session.get throws on 500", async () => {
  fetchMock.mockResolvedValue(notOk(500))
  const c = new MafwClient()
  await expect(c.session.get({ path: { id: "x" } })).rejects.toThrow("HTTP 500")
})

test("session.promptAsync throws on 400", async () => {
  fetchMock.mockResolvedValue(notOk(400))
  const c = new MafwClient()
  await expect(c.session.promptAsync({ path: { id: "s1" }, body: { message: "hi" } })).rejects.toThrow("HTTP 400")
})

test("session.delete throws on 404", async () => {
  fetchMock.mockResolvedValue(notOk(404))
  const c = new MafwClient()
  await expect(c.session.delete({ path: { id: "x" } })).rejects.toThrow("HTTP 404")
})

test("project.current throws on 500", async () => {
  fetchMock.mockResolvedValue(notOk(500))
  const c = new MafwClient()
  await expect(c.project.current()).rejects.toThrow("HTTP 500")
})

test("chat.send throws on 500", async () => {
  fetchMock.mockResolvedValue(notOk(500))
  const c = new MafwClient()
  await expect(c.chat.send("hi")).rejects.toThrow("Chat send failed")
})

test("chat.sendEnriched throws on 500", async () => {
  fetchMock.mockResolvedValue(notOk(500))
  const c = new MafwClient()
  await expect(c.chat.sendEnriched("hi")).rejects.toThrow("Chat sendEnriched failed")
})

test("memory.search returns [] on empty response", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  expect(await c.memory.search({ query: "x" })).toEqual([])
})

test("approvals.list returns [] on empty response", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  expect(await c.approvals.list()).toEqual([])
})

test("triage.list returns [] on empty response", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  expect(await c.triage.list()).toEqual([])
})

test("automations.list returns [] on empty response", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  expect(await c.automations.list()).toEqual([])
})

test("session.promptAsync sends POST /api/session/:id/promptAsync", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient("http://gw:3000")
  await c.session.promptAsync({ path: { id: "s1" }, body: { message: "hello" } })
  const url = (fetchMock as any).mock.calls[0][0] as string
  expect(url).toBe("http://gw:3000/api/session/s1/promptAsync")
  const body = JSON.parse((fetchMock as any).mock.calls[0][1].body)
  expect(body.message).toBe("hello")
})

test("session.events connects SSE to session-specific endpoint (uses own connection)", async () => {
  const connectSpy = mock()
  const orig = SSEConnection.prototype.connectToSession
  SSEConnection.prototype.connectToSession = connectSpy as any
  try {
    const c = new MafwClient("http://gw:3000")
    const sub = await c.session.events({ path: { id: "s1" } })
    expect(connectSpy).toHaveBeenCalledWith("http://gw:3000", "s1")
    expect(typeof sub.on).toBe("function")
  } finally {
    SSEConnection.prototype.connectToSession = orig
  }
})

test("session.create fails on non-ok response", async () => {
  fetchMock.mockResolvedValue(notOk(500))
  const c = new MafwClient("http://gw:3000")
  await expect(c.session.create({})).rejects.toThrow("HTTP 500")
})

// ── Project ──

test("project.list sends GET /api/projects", async () => {
  fetchMock.mockResolvedValue(okJson({ projects: [{ id: "p1" }] }))
  const c = new MafwClient()
  const list = await c.project.list()
  expect(list).toHaveLength(1)
})

test("project.current returns project from envelope", async () => {
  fetchMock.mockResolvedValue(okJson({ project: { id: "p1", worktree: "/w" } }))
  const c = new MafwClient()
  const p = await c.project.current()
  expect(p.id).toBe("p1")
})

test("project.setCurrent sends POST /api/projects/register", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  await c.project.setCurrent("/my/project")
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/projects/register",
    expect.objectContaining({ method: "POST" }))
})

// ── Goals ──

test("goals.list returns goals", async () => {
  fetchMock.mockResolvedValue(okJson({ goals: [{ goalId: "g1" }] }))
  const c = new MafwClient()
  const list = await c.goals.list()
  expect(list).toHaveLength(1)
})

test("goals.validate sends POST /api/work/:goalId/validate", async () => {
  fetchMock.mockResolvedValue(okJson({ goalId: "g1" }))
  const c = new MafwClient()
  const r = await c.goals.validate({ goalId: "g1", title: "T", charter: "C" })
  expect(r.goalId).toBe("g1")
})

test("goals.control sends POST /api/goals/control", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  await c.goals.control({ action: "PAUSE", goalId: "g1" })
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/goals/control",
    expect.objectContaining({ method: "POST" }))
})

test("goals.get returns null on 404", async () => {
  fetchMock.mockResolvedValue({
    ok: false, status: 404, statusText: "Not Found",
    json: () => Promise.reject(new Error("no body")),
  } as Response)
  const c = new MafwClient()
  const r = await c.goals.get("missing")
  expect(r).toBeNull()
})

test("goals.get throws on non-404 error", async () => {
  fetchMock.mockResolvedValue({
    ok: false, status: 500, statusText: "Server Error",
    json: () => Promise.reject(new Error("no body")),
  } as Response)
  const c = new MafwClient()
  await expect(c.goals.get("bad")).rejects.toThrow("HTTP 500")
})

// ── Memory ──

test("memory.search sends query param", async () => {
  fetchMock.mockResolvedValue(okJson({ results: [] }))
  const c = new MafwClient()
  await c.memory.search({ query: "test" })
  const url = (fetchMock as any).mock.calls[0][0] as string
  expect(url).toContain("query=test")
})

test("memory.mergedSearch returns facts", async () => {
  fetchMock.mockResolvedValue(okJson({ results: [{ source: "harmonic", type: "fact", content: "x", energy: 1 }] }))
  const c = new MafwClient()
  const facts = await c.memory.mergedSearch({ query: "x" })
  expect(facts).toHaveLength(1)
  expect(facts[0].source).toBe("harmonic")
})

test("memory.delete sends DELETE", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  await c.memory.delete("mem-1")
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/memory/mem-1",
    expect.objectContaining({ method: "DELETE" }))
})

// ── Approvals ──

test("approvals.list returns approvals", async () => {
  fetchMock.mockResolvedValue(okJson({ approvals: [{ id: "a1" }] }))
  const c = new MafwClient()
  const list = await c.approvals.list()
  expect(list).toHaveLength(1)
})

test("approvals.respond sends POST", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  await c.approvals.respond("a1", "approve")
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/approvals/a1/respond",
    expect.objectContaining({ method: "POST" }))
})

// ── Triage ──

test("triage.list returns items", async () => {
  fetchMock.mockResolvedValue(okJson({ items: [{ goalId: "g1" }] }))
  const c = new MafwClient()
  const list = await c.triage.list()
  expect(list).toHaveLength(1)
})

test("triage.dismiss sends POST", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  await c.triage.dismiss("t1")
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/triage/t1/dismiss",
    expect.objectContaining({ method: "POST" }))
})

// ── Chat ──

test("chat.send returns sessionID", async () => {
  fetchMock.mockResolvedValue(okJson({ sessionID: "cs1" }))
  const c = new MafwClient()
  const r = await c.chat.send("hello")
  expect(r.sessionID).toBe("cs1")
})

test("chat.send passes optional sessionID in body", async () => {
  fetchMock.mockResolvedValue(okJson({ sessionID: "sess-1" }))
  const c = new MafwClient()
  const r = await c.chat.send("hello", "sess-1")
  const body = JSON.parse((fetchMock as any).mock.calls[0][1].body)
  expect(body.sessionID).toBe("sess-1")
  expect(r.sessionID).toBe("sess-1")
})

test("chat.sendEnriched returns sessionID", async () => {
  fetchMock.mockResolvedValue(okJson({ sessionID: "cs2" }))
  const c = new MafwClient()
  const r = await c.chat.sendEnriched({ message: "hello enriched" })
  expect(r.sessionID).toBe("cs2")
})

test("chat.sendEnriched passes optional sessionID in body", async () => {
  fetchMock.mockResolvedValue(okJson({ sessionID: "sess-2" }))
  const c = new MafwClient()
  const r = await c.chat.sendEnriched({ message: "hello enriched", sessionID: "sess-2" })
  const body = JSON.parse((fetchMock as any).mock.calls[0][1].body)
  expect(body.sessionID).toBe("sess-2")
  expect(r.sessionID).toBe("sess-2")
})

test("chat.sendEnriched forwards parts/agent/model", async () => {
  fetchMock.mockResolvedValue(okJson({ sessionID: "cs3" }))
  const c = new MafwClient()
  await c.chat.sendEnriched({
    message: "hi",
    sessionID: "sess-3",
    parts: [{ type: "file", id: "prt_x", mime: "text/plain", filename: "a.txt", url: "file:///C:/a.txt" }],
    agent: "explore",
    model: { providerID: "deepseek", modelID: "deepseek-v4-pro" },
  })
  const body = JSON.parse((fetchMock as any).mock.calls[0][1].body)
  expect(body.parts).toHaveLength(1)
  expect(body.parts[0].type).toBe("file")
  expect(body.agent).toBe("explore")
  expect(body.model).toEqual({ providerID: "deepseek", modelID: "deepseek-v4-pro" })
})

test("providers.list + agents.list hit their routes", async () => {
  fetchMock.mockResolvedValue(okJson({ items: { all: [], connected: [] } }))
  const c = new MafwClient()
  const p = await c.providers.list()
  expect((fetchMock as any).mock.calls[0][0]).toContain("/api/provider")
  expect(p).toEqual({ all: [], connected: [] })

  fetchMock.mockResolvedValue(okJson({ items: [{ name: "explore" }] }))
  const a = await c.agents.list()
  expect((fetchMock as any).mock.calls[1][0]).toContain("/api/agents")
  expect(a).toHaveLength(1)
})

// ── Config ──

test("config.get returns config", async () => {
  fetchMock.mockResolvedValue(okJson({ key: "val" }))
  const c = new MafwClient()
  const cfg = await c.config.get()
  expect(cfg.key).toBe("val")
})

test("config.get with key returns specific field", async () => {
  fetchMock.mockResolvedValue(okJson({ theme: "dark", lang: "en" }))
  const c = new MafwClient()
  const theme = await c.config.get("theme")
  expect(theme).toBe("dark")
})

// ── Automations ──

test("automations.list returns rules", async () => {
  fetchMock.mockResolvedValue(okJson({ rules: [{ id: "r1" }] }))
  const c = new MafwClient()
  const list = await c.automations.list()
  expect(list).toHaveLength(1)
})

test("automations.toggle sends PUT", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient()
  await c.automations.toggle("r1", true)
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/automations/r1",
    expect.objectContaining({ method: "PUT" }))
})

// ── Event ──

test("event.subscribe connects SSE", async () => {
  const connectSpy = mock()
  const orig = SSEConnection.prototype.connect
  SSEConnection.prototype.connect = connectSpy as any
  try {
    const c = new MafwClient("http://gw:3000")
    const sub = await c.event.subscribe()
    expect(connectSpy).toHaveBeenCalledWith("http://gw:3000")
    expect(typeof sub.on).toBe("function")
  } finally {
    SSEConnection.prototype.connect = orig
  }
})

test("event.subscribeToSession connects SSE with sessionID", async () => {
  const connectSpy = mock()
  const orig = SSEConnection.prototype.connectToSession
  SSEConnection.prototype.connectToSession = connectSpy as any
  try {
    const c = new MafwClient("http://gw:3000")
    const sub = await c.event.subscribeToSession("s1")
    expect(connectSpy).toHaveBeenCalledWith("http://gw:3000", "s1")
    expect(typeof sub.on).toBe("function")
  } finally {
    SSEConnection.prototype.connectToSession = orig
  }
})

// ── Runtime & Media switch ──

test("runtime.get + runtime.switch hit their routes", async () => {
  fetchMock.mockResolvedValue(okJson({ active: { name: "opencode", capabilities: {} }, plugins: [] }))
  const c = new MafwClient()
  const r = await c.runtime.get()
  expect((fetchMock as any).mock.calls[0][0]).toContain("/api/runtime")
  expect(r.active.name).toBe("opencode")

  fetchMock.mockResolvedValue(okJson({ success: true, active: { name: "pi", capabilities: {} }, envOverride: false }))
  await c.runtime.switch("pi")
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/runtime/switch",
    expect.objectContaining({ method: "POST" }))
  const body = JSON.parse((fetchMock as any).mock.calls[1][1].body)
  expect(body).toEqual({ plugin: "pi" })
})

test("runtime.switch surfaces API error", async () => {
  fetchMock.mockResolvedValue({
    ok: false, status: 400, statusText: "Bad Request",
    json: () => Promise.resolve({ error: "Runtime plugin 'nope' not found" }),
  } as Response)
  const c = new MafwClient()
  await expect(c.runtime.switch("nope")).rejects.toThrow("Runtime plugin 'nope' not found")
})

test("media.plugins + media.switch hit their routes", async () => {
  fetchMock.mockResolvedValue(okJson({ plugins: [{ file: "x.js", name: "qwen-vl", status: "ok", modalities: ["image", "video"] }] }))
  const c = new MafwClient()
  const p = await c.media.plugins()
  expect((fetchMock as any).mock.calls[0][0]).toContain("/api/media/plugins")
  expect(p.plugins).toHaveLength(1)

  fetchMock.mockResolvedValue(okJson({ success: true, media: { video: { engine: "qwen-vl" } } }))
  await c.media.switch({ video: { engine: "qwen-vl" } })
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/media/switch",
    expect.objectContaining({ method: "POST" }))
  const body = JSON.parse((fetchMock as any).mock.calls[1][1].body)
  expect(body).toEqual({ video: { engine: "qwen-vl" } })
})

test("models.get + models.update hit their routes", async () => {
  const state = {
    recall: { workerModel: { providerID: "alibaba-cn", modelID: "qwen3.7-max" } },
    media: { provider: "xiaomi", model: "mimo-v2.5" },
    available: [{ providerID: "xiaomi", providerName: "xiaomi", models: [{ id: "mimo-v2.5", name: "MiMo V2.5" }] }],
  }
  fetchMock.mockResolvedValue(okJson(state))
  const c = new MafwClient()
  const st = await c.models.get()
  expect((fetchMock as any).mock.calls[0][0]).toContain("/api/model-config")
  expect(st.recall.workerModel.modelID).toBe("qwen3.7-max")

  fetchMock.mockResolvedValue(okJson({ success: true, recall: state.recall, media: state.media }))
  await c.models.update({ recall: { providerID: "xiaomi", modelID: "mimo-v2.5" } })
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/model-config",
    expect.objectContaining({ method: "POST" }))
  const body = JSON.parse((fetchMock as any).mock.calls[1][1].body)
  expect(body).toEqual({ recall: { providerID: "xiaomi", modelID: "mimo-v2.5" } })
})

test("models.update surfaces API error", async () => {
  fetchMock.mockResolvedValue({
    ok: false, status: 400, statusText: "Bad Request",
    json: () => Promise.resolve({ error: "Model 'x' not found under provider 'y'" }),
  } as Response)
  const c = new MafwClient()
  await expect(c.models.update({ recall: { providerID: "y", modelID: "x" } })).rejects.toThrow("not found")
})

test("request throws clean error on HTML response (gateway older than SDK)", async () => {
  // Regression: an old gateway's SPA fallback returns 200 + text/html for unknown
  // routes; res.json() then blows up with a useless SyntaxError inside IPC.
  fetchMock.mockResolvedValue({
    ok: true, status: 200, statusText: "OK",
    headers: new Map([["content-type", "text/html"]]),
    json: () => Promise.reject(new Error("Unexpected token '<'")),
  } as unknown as Response)
  const c = new MafwClient()
  await expect(c.models.get()).rejects.toThrow(/HTML instead of JSON.*gateway.*older/s)
})
