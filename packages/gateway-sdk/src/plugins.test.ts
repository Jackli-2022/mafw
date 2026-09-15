import { test, expect, mock } from "bun:test"
import { MafwClient } from "./client"

function stubFetch(status: number, body: unknown) {
  return mock(async (_url: string | URL | Request, _init?: RequestInit) => ({
    ok: status < 400,
    status,
    json: async () => body,
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
