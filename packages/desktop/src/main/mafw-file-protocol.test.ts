import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { buildMafwFileUrl } from "../shared/mafw-file"
import {
  createRootRegistry,
  registerMafwFileProtocol,
  registerRootDir,
  resolveMafwFileRequest,
} from "./mafw-file-protocol"

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8")

describe("createRootRegistry", () => {
  test("同 root 幂等复用 token；不同 root 不同 token", () => {
    let n = 0
    const reg = createRootRegistry(() => `ab12cd3${n++}`)
    const a = reg.tokenForRoot("C:/proj/a")
    assert.equal(reg.tokenForRoot("C:/proj/a"), a)
    const b = reg.tokenForRoot("C:/proj/b")
    assert.notEqual(a, b)
    assert.equal(reg.rootForToken(a), resolve("C:/proj/a"))
  })
  test("clearRoot 双向清掉", () => {
    const seq = ["ab12cd34", "deadbeef"]
    const reg = createRootRegistry(() => seq.shift()!)
    const t = reg.tokenForRoot("C:/proj/a")
    reg.clearRoot("C:/proj/a")
    assert.equal(reg.rootForToken(t), undefined)
    assert.notEqual(reg.tokenForRoot("C:/proj/a"), t)
  })
  test("token 撞车时重抽", () => {
    const seq = ["ab12cd34", "ab12cd34", "deadbeef"]
    const reg = createRootRegistry(() => seq.shift()!)
    const t1 = reg.tokenForRoot("C:/a")
    const t2 = reg.tokenForRoot("C:/b")
    assert.equal(t1, "ab12cd34")
    assert.equal(t2, "deadbeef")
  })
})

describe("resolveMafwFileRequest", () => {
  const mk = () => {
    const reg = createRootRegistry(() => "ab12cd34")
    reg.tokenForRoot("C:/proj")
    return reg
  }

  test("合法 URL → 绝对路径 + mime", () => {
    const reg = mk()
    const hit = resolveMafwFileRequest(buildMafwFileUrl("ab12cd34", "assets/a.png"), reg)
    assert.ok(hit)
    assert.equal(hit.mime, "image/png")
    assert.ok(hit.file.endsWith("a.png"))
  })
  test("未知 token / 失效 token → null", () => {
    const reg = mk()
    assert.equal(resolveMafwFileRequest("mafw-file://deadbeef/a.png", reg), null)
    reg.clearRoot("C:/proj")
    assert.equal(resolveMafwFileRequest(buildMafwFileUrl("ab12cd34", "a.png"), reg), null)
  })
  test("traversal / 坏 URL → null", () => {
    const reg = mk()
    assert.equal(resolveMafwFileRequest("mafw-file://ab12cd34/../a.png", reg), null)
    assert.equal(resolveMafwFileRequest("https://x/a.png", reg), null)
  })
})

describe("registerMafwFileProtocol（注入 session/fetch，可单测）", () => {
  const fakeSession = () => {
    const handlers = new Map<string, (req: Request) => Promise<Response>>()
    return {
      handlers,
      protocol: { handle: (scheme: string, fn: any) => handlers.set(scheme, fn) },
    }
  }
  const fakeFetch = (ok: boolean) => async (url: string, opts?: any) => {
    if (!ok) return new Response("missing", { status: 404 })
    return new Response("bytes", {
      status: opts?.headers?.range ? 206 : 200,
      headers: { "content-range": "bytes 0-4/5", "accept-ranges": "bytes" },
    })
  }

  test("两个 session 都挂 handler；命中回 200 + 正确 content-type", async () => {
    const reg = createRootRegistry(() => "ab12cd34")
    reg.tokenForRoot("C:/proj")
    const s1 = fakeSession()
    const s2 = fakeSession()
    registerMafwFileProtocol([s1 as any, s2 as any], reg, fakeFetch(true) as any)
    assert.ok(s1.handlers.get("mafw-file"))
    assert.ok(s2.handlers.get("mafw-file"))
    const res = await s1.handlers.get("mafw-file")!(new Request(buildMafwFileUrl("ab12cd34", "a.png")))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get("content-type"), "image/png")
    assert.equal(res.headers.get("access-control-allow-origin"), "*")
  })
  test("未命中 → 404", async () => {
    const reg = createRootRegistry(() => "ab12cd34")
    const s = fakeSession()
    registerMafwFileProtocol([s as any], reg, fakeFetch(true) as any)
    const res = await s.handlers.get("mafw-file")!(new Request("mafw-file://deadbeef/a.png"))
    assert.equal(res.status, 404)
  })
  test("range 透传（206 保留）", async () => {
    const reg = createRootRegistry(() => "ab12cd34")
    reg.tokenForRoot("C:/proj")
    const s = fakeSession()
    registerMafwFileProtocol([s as any], reg, fakeFetch(true) as any)
    const req = new Request(buildMafwFileUrl("ab12cd34", "a.png"), { headers: { range: "bytes=0-4" } })
    const res = await s.handlers.get("mafw-file")!(req)
    assert.equal(res.status, 206)
    assert.equal(res.headers.get("content-range"), "bytes 0-4/5")
  })
})

describe("registerRootDir（IPC 入参校验）", () => {
  const io = (isDir: boolean) => ({ stat: async (_abs: string) => ({ isDirectory: () => isDir }) })

  test("绝对路径且是目录 → token；同 root 幂等", async () => {
    const reg = createRootRegistry(() => "ab12cd34")
    const t1 = await registerRootDir(reg, io(true) as any, "C:/proj")
    const t2 = await registerRootDir(reg, io(true) as any, "C:/proj")
    assert.equal(t1, "ab12cd34")
    assert.equal(t2, t1)
  })
  test("相对路径按 cwd 归一（project id 可能是 \".\"）", async () => {
    const reg = createRootRegistry(() => "ab12cd34")
    let seen = ""
    const io = { stat: async (abs: string) => { seen = abs; return { isDirectory: () => true } } }
    const t = await registerRootDir(reg, io as any, ".")
    assert.equal(t, "ab12cd34")
    assert.equal(seen, resolve("."))
    assert.equal(reg.rootForToken("ab12cd34"), resolve("."))
  })
  test("空 / 非目录 → null", async () => {
    const reg = createRootRegistry(() => "ab12cd34")
    assert.equal(await registerRootDir(reg, io(true) as any, ""), null)
    assert.equal(await registerRootDir(reg, io(false) as any, "C:/proj/file.txt"), null)
  })
})

describe("接线契约", () => {
  test("windows.ts 在 ready 前注册 mafw-file scheme privileges", () => {
    const src = read("main/windows.ts")
    const head = src.slice(0, src.indexOf("protocol.registerSchemesAsPrivileged"))
    assert.ok(head.includes("mafw-file"))
    const block = src.slice(src.indexOf("protocol.registerSchemesAsPrivileged"), src.indexOf("])", src.indexOf("protocol.registerSchemesAsPrivileged")) + 2)
    assert.match(src, /scheme:\s*(MAFW_FILE_SCHEME|"mafw-file")/)
    assert.ok(/standard:\s*true/.test(block))
    assert.ok(/stream:\s*true/.test(block))
    assert.ok(/corsEnabled:\s*true/.test(block))
  })
  test("index.ts ready 后对 default session + 浏览器 partition 双注册", () => {
    const src = read("main/index.ts")
    assert.match(src, /registerMafwFileProtocol\(/)
    assert.match(src, /fromPartition\(BROWSER_PARTITION\)/)
  })
  test("ipc + preload 暴露 fs-register-root / registerRoot", () => {
    assert.match(read("main/ipc.ts"), /fs-register-root/)
    assert.match(read("preload/index.ts"), /registerRoot/)
  })
})
