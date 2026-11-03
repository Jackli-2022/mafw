import { test, expect, mock } from "bun:test"
import { MafwClient } from "./client"

function stubFetch(status: number, body: unknown) {
  return mock(async (_url: string | URL | Request, _init?: RequestInit) => ({
    ok: status < 400,
    status,
    statusText: `HTTP ${status}`,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
}

test("sdk plugins.list hits GET /api/plugins and passes builtin fields", async () => {
  const f = stubFetch(200, { plugins: [{ type: "usage", name: "deepseek", file: "deepseek.js", status: "enabled", size: 1, mtime: "2026-09-11T00:00:00Z", builtin: true, overridden: false, pluginType: "api" }] })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  const res = await client.plugins.list()
  expect((f as any).mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/plugins")
  expect(res.plugins[0].name).toBe("deepseek")
  expect(res.plugins[0].builtin).toBe(true)
  expect(res.plugins[0].pluginType).toBe("api")
})

test("sdk plugins.install posts raw bytes with query params", async () => {
  const f = stubFetch(200, { type: "runtime", name: "foo", file: "foo.js", status: "enabled", size: 2, mtime: "" })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  const bytes = new Uint8Array([104, 105])
  await client.plugins.install({ filename: "foo.js", bytes })
  expect((f as any).mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/plugins/install?filename=foo.js")
  expect((f as any).mock.calls[0][1].headers["Content-Type"]).toBe("application/octet-stream")
  expect((f as any).mock.calls[0][1].body).toBe(bytes)
})

test("sdk plugins.install forwards optional type/overwrite", async () => {
  const f = stubFetch(200, {})
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  await client.plugins.install({ filename: "b.js", type: "ui", bytes: new Uint8Array([1]), overwrite: true })
  const url = (f as any).mock.calls[0][0] as string
  expect(url).toContain("type=ui")
  expect(url).toContain("overwrite=1")
})

test("sdk plugins.enable/disable/delete post to their paths", async () => {
  const f = stubFetch(200, { ok: true })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  await client.plugins.enable("runtime", "foo.js")
  await client.plugins.disable("runtime", "foo.js")
  await client.plugins.delete("runtime", "foo.js")
  const urls = (f as any).mock.calls.map((c: any[]) => c[0] as string)
  expect(urls).toEqual([
    "http://127.0.0.1:3000/api/plugins/enable",
    "http://127.0.0.1:3000/api/plugins/disable",
    "http://127.0.0.1:3000/api/plugins/delete",
  ])
})

test("sdk plugins error response throws with server message", async () => {
  const f = stubFetch(400, { error: "ambiguous plugin interface: media/usage" })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  await expect(client.plugins.install({ filename: "foo.js", bytes: new Uint8Array([1]) }))
    .rejects.toThrow("ambiguous plugin interface: media/usage")
})

// ── Unified plugin package namespace (Task 6) ──

test("sdk plugins.client hits GET /api/plugins/client", async () => {
  const f = stubFetch(200, { revision: "boot:2", plugins: [{ name: "acme" }] })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  const res = await client.plugins.client()
  expect((f as any).mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/plugins/client")
  expect((f as any).mock.calls[0][1].method).toBeUndefined()
  expect(res.revision).toBe("boot:2")
  expect(res.plugins[0].name).toBe("acme")
})

test("sdk plugins.installPackage posts the install input as JSON", async () => {
  const f = stubFetch(200, { name: "acme", saved: true, application: "applied" })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  const res = await client.plugins.installPackage({ path: "C:\\tmp\\acme", overwrite: true, requestId: "r1" })
  const call = (f as any).mock.calls[0]
  expect(call[0]).toBe("http://127.0.0.1:3000/api/plugins/packages/install")
  expect(call[1].method).toBe("POST")
  expect(JSON.parse(call[1].body)).toEqual({ path: "C:\\tmp\\acme", overwrite: true, requestId: "r1" })
  expect(res.name).toBe("acme")
})

test("sdk plugins.check posts {path}", async () => {
  const f = stubFetch(200, { ok: false, name: "acme", error: "bad contributions" })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  const res = await client.plugins.check({ path: "C:\\tmp\\acme" })
  const call = (f as any).mock.calls[0]
  expect(call[0]).toBe("http://127.0.0.1:3000/api/plugins/check")
  expect(call[1].method).toBe("POST")
  expect(JSON.parse(call[1].body)).toEqual({ path: "C:\\tmp\\acme" })
  expect(res.ok).toBe(false)
})

test("sdk plugins.apply/reload post to encoded package paths", async () => {
  const f = stubFetch(200, { name: "acme", application: "applied" })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  await client.plugins.apply("acme space")
  await client.plugins.reload("acme space")
  const calls = (f as any).mock.calls
  expect(calls[0][0]).toBe("http://127.0.0.1:3000/api/plugins/acme%20space/apply")
  expect(calls[0][1].method).toBe("POST")
  expect(calls[1][0]).toBe("http://127.0.0.1:3000/api/plugins/acme%20space/reload")
  expect(calls[1][1].method).toBe("POST")
})

test("sdk plugins.invoke posts {input, sessionID} and unwraps output", async () => {
  const f = stubFetch(200, { package: "acme", action: "load", revision: "boot:2", output: { title: "Acme" } })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  const res = await client.plugins.invoke("acme", "load", { id: 1 }, "s1")
  const call = (f as any).mock.calls[0]
  expect(call[0]).toBe("http://127.0.0.1:3000/api/plugins/acme/actions/load")
  expect(call[1].method).toBe("POST")
  expect(JSON.parse(call[1].body)).toEqual({ input: { id: 1 }, sessionID: "s1" })
  expect(res).toEqual({ title: "Acme" })
})

test("sdk plugins.invoke surfaces action error text", async () => {
  const f = stubFetch(409, { error: "superseded revision", code: "stale-revision" })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  await expect(client.plugins.invoke("acme", "load", {}))
    .rejects.toThrow("superseded revision")
})

test("sdk plugins.enablePackage/disablePackage/removePackage post {package}", async () => {
  const f = stubFetch(200, { name: "acme", saved: true })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  await client.plugins.enablePackage("acme")
  await client.plugins.disablePackage("acme")
  await client.plugins.removePackage("acme")
  const calls = (f as any).mock.calls
  expect(calls.map((c: any[]) => c[0])).toEqual([
    "http://127.0.0.1:3000/api/plugins/enable",
    "http://127.0.0.1:3000/api/plugins/disable",
    "http://127.0.0.1:3000/api/plugins/delete",
  ])
  for (const call of calls) {
    expect(call[1].method).toBe("POST")
    expect(JSON.parse(call[1].body)).toEqual({ package: "acme" })
  }
})

