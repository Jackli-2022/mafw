import { test, expect, mock } from "bun:test"
import { MafwClient } from "./client"

function stubFetch(status: number, body: unknown) {
  return mock(async (_url: string | URL | Request, _init?: RequestInit) => ({
    ok: status < 400,
    status,
    json: async () => body,
  }))
}

test("sdk plugins.list hits GET /api/plugins", async () => {
  const f = stubFetch(200, { plugins: [{ type: "runtime", name: "foo", file: "foo.js", status: "enabled", size: 1, mtime: "2026-09-11T00:00:00Z" }] })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  const res = await client.plugins.list()
  expect((f as any).mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/plugins")
  expect(res.plugins[0].name).toBe("foo")
})

test("sdk plugins.install posts JSON body", async () => {
  const f = stubFetch(200, { type: "media", name: "bar", file: "bar.js", status: "enabled", size: 3, mtime: "2026-09-11T00:00:00Z" })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  const res = await client.plugins.install({ type: "media", filename: "bar.js", contentBase64: "eHg=" })
  expect((f as any).mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/plugins/install")
  expect(JSON.parse((f as any).mock.calls[0][1].body)).toEqual({ type: "media", filename: "bar.js", contentBase64: "eHg=", overwrite: false })
  expect(res.name).toBe("bar")
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
  const f = stubFetch(409, { error: "plugin already exists: foo.js" })
  const client = new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
  await expect(client.plugins.install({ type: "runtime", filename: "foo.js", contentBase64: "eHg=" }))
    .rejects.toThrow("plugin already exists: foo.js")
})
