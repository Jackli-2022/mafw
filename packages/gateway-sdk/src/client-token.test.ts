// E5a-4: human token wiring on the SDK client.
// Spec §5.1 — `MafwClientOptions.clientToken` must reach every JSON request as
// `X-MAFW-Human-Token`, `headers` must merge underneath it, per-call headers win,
// and non-JSON paths (fetchPath / binary / SSE) must NOT carry the token.
import { test, expect, mock, beforeEach } from "bun:test"
import { MafwClient } from "./client"

const TOKEN = "a".repeat(64)

let fetchMock: ReturnType<typeof mock>

beforeEach(() => {
  fetchMock = mock()
  globalThis.fetch = fetchMock as any
})

function okJson(data: unknown) {
  return Promise.resolve({
    ok: true, status: 200, statusText: "OK",
    headers: { get: () => "application/json" },
    json: () => Promise.resolve(data),
  } as unknown as Response)
}

function headersOf(callIndex = 0): Headers {
  const init = (fetchMock as any).mock.calls[callIndex][1] as RequestInit | undefined
  return new Headers(init?.headers)
}

// ── token injection ──

test("clientToken is sent as X-MAFW-Human-Token on every JSON request", async () => {
  fetchMock.mockResolvedValue(okJson({ sessions: [] }))
  const c = new MafwClient({ baseUrl: "http://gw:3000", clientToken: TOKEN })
  await c.session.list()
  await c.project.current()
  expect((fetchMock as any).mock.calls.length).toBe(2)
  for (let i = 0; i < 2; i += 1) {
    expect(headersOf(i).get("x-mafw-human-token")).toBe(TOKEN)
    expect(headersOf(i).get("content-type")).toBe("application/json")
  }
})

test("no clientToken → no human header (string constructor form unchanged)", async () => {
  fetchMock.mockResolvedValue(okJson({ sessions: [] }))
  const c = new MafwClient("http://gw:3000")
  await c.session.list()
  expect(headersOf(0).get("x-mafw-human-token")).toBe(null)
  expect(headersOf(0).get("content-type")).toBe("application/json")
})

test("options without clientToken but with headers keeps them", async () => {
  fetchMock.mockResolvedValue(okJson({ sessions: [] }))
  const c = new MafwClient({ baseUrl: "http://gw:3000", headers: { "X-Tenant": "acme" } })
  await c.session.list()
  expect(headersOf(0).get("x-tenant")).toBe("acme")
  expect(headersOf(0).get("x-mafw-human-token")).toBe(null)
})

// ── merge order: default Content-Type → options.headers → clientToken → per-call ──

test("merge order: options.headers < clientToken < per-call headers", async () => {
  fetchMock.mockResolvedValue(okJson({ ok: true }))
  const c = new MafwClient({
    baseUrl: "http://gw:3000",
    clientToken: TOKEN,
    headers: {
      "X-Tenant": "acme",
      "X-MAFW-Human-Token": "from-options",
      "Content-Type": "text/plain",
    },
  })

  await (c as any).request("/api/ping")
  const base = headersOf(0)
  expect(base.get("x-tenant")).toBe("acme")
  // options.headers can override the default Content-Type …
  expect(base.get("content-type")).toBe("text/plain")
  // … but clientToken wins over a conflicting options.headers value.
  expect(base.get("x-mafw-human-token")).toBe(TOKEN)

  await (c as any).request("/api/ping", { headers: { "X-MAFW-Human-Token": "per-call", "X-Tenant": "other" } })
  const perCall = headersOf(1)
  expect(perCall.get("x-mafw-human-token")).toBe("per-call")
  expect(perCall.get("x-tenant")).toBe("other")
})

test("per-call headers accept Headers and tuple-array forms", async () => {
  fetchMock.mockResolvedValue(okJson({ ok: true }))
  const c = new MafwClient({ baseUrl: "http://gw:3000", clientToken: TOKEN })

  await (c as any).request("/api/ping", { headers: new Headers({ "X-From": "headers-instance" }) })
  expect(headersOf(0).get("x-from")).toBe("headers-instance")
  expect(headersOf(0).get("x-mafw-human-token")).toBe(TOKEN)

  await (c as any).request("/api/ping", { headers: [["X-From", "tuple-array"]] as any })
  expect(headersOf(1).get("x-from")).toBe("tuple-array")
  expect(headersOf(1).get("x-mafw-human-token")).toBe(TOKEN)
})

// ── token must not leak onto non-JSON paths ──

test("clientToken is NOT attached to fetchPath (SSE / binary / raw Response)", async () => {
  fetchMock.mockResolvedValue(okJson({ ok: true }))
  const c = new MafwClient({ baseUrl: "http://gw:3000", clientToken: TOKEN })

  await (c as any).fetchPath("/api/events")
  expect(headersOf(0).get("x-mafw-human-token")).toBe(null)
})

test("clientToken is NOT attached to binary media upload", async () => {
  fetchMock.mockResolvedValue(okJson({ artifactId: "a1" }))
  const c = new MafwClient({ baseUrl: "http://gw:3000", clientToken: TOKEN })
  await c.media.upload({ bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" })
  expect(headersOf(0).get("x-mafw-human-token")).toBe(null)
  expect(headersOf(0).get("content-type")).toBe("application/octet-stream")
})

// ── call-site headers are preserved through the merge ──

test("existing per-call Content-Type survives the merge", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient({ baseUrl: "http://gw:3000", clientToken: TOKEN })
  await c.session.rename({ path: { id: "s1" }, body: { title: "x" } })
  expect(headersOf(0).get("content-type")).toBe("application/json")
  expect(headersOf(0).get("x-mafw-human-token")).toBe(TOKEN)
})
