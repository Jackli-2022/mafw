import { test, expect, mock } from "bun:test"
import { MafwClient } from "./client"

function ok(body: unknown) {
  return mock(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => body,
  }))
}

function fail(status: number) {
  return mock(async () => ({
    ok: false,
    status,
    headers: { get: () => "application/json" },
    json: async () => ({}),
  }))
}

function clientWith(f: any) {
  return new MafwClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: f as unknown as typeof fetch })
}

async function captureError(fn: () => Promise<unknown>): Promise<any> {
  try { await fn(); return null } catch (e) { return e }
}

test("shells.list unwraps {location,data} envelope + passes directory", async () => {
  const f = ok({ location: { directory: "C:/p" }, data: [{ id: "sh1" }] })
  const list = await clientWith(f).shells.list({ directory: "C:/p" })
  expect((f as any).mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/shell?directory=C%3A%2Fp")
  expect(list).toEqual([{ id: "sh1" }])
})

test("shells.list 非数组 body → 抛错（调用方 fail-open，reviewer Critical 1）", async () => {
  const f = ok({ data: { error: "shape" } })
  const err = await captureError(() => clientWith(f).shells.list())
  expect(String(err?.message)).toContain("Unexpected /api/shell response shape")
})

test("shells.get 把 HTTP 404 映射为 null（对账 cancelled 路径，reviewer Critical 1）", async () => {
  const f = fail(404)
  expect(await clientWith(f).shells.get({ path: { id: "gone" } })).toBeNull()
})

test("shells.get 非 404 错误照常抛出（fail-open 由调用方）", async () => {
  const f = fail(500)
  const err = await captureError(() => clientWith(f).shells.get({ path: { id: "x" } }))
  expect(String(err?.message)).toContain("HTTP 500")
})

test("shells.output 传 cursor/limit/directory（尾部取用，reviewer Important 9）", async () => {
  const f = ok({ data: { output: "tail", cursor: 10, size: 20, truncated: true } })
  const out = await clientWith(f).shells.output({ path: { id: "sh 1" }, directory: "C:\\p", cursor: 10, limit: 4096 })
  expect((f as any).mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/shell/sh%201/output?directory=C%3A%5Cp&cursor=10&limit=4096")
  expect(out).toEqual({ output: "tail", cursor: 10, size: 20, truncated: true })
})

test("shells.remove 404 = 幂等成功；其他状态抛错", async () => {
  await clientWith(fail(404)).shells.remove({ path: { id: "gone" } })
  const err = await captureError(() => clientWith(fail(500)).shells.remove({ path: { id: "x" } }))
  expect(String(err?.message)).toContain("HTTP 500")
})

test("session.background POST 到 v2 透传路由", async () => {
  const f = ok({})
  await clientWith(f).session.background({ path: { id: "s1" } })
  expect((f as any).mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/session/s1/background")
  expect((f as any).mock.calls[0][1].method).toBe("POST")
})
