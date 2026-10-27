import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createFileProtocolClient } from "../src/renderer/mafw/file-protocol-client"

describe("createFileProtocolClient（mafw-file token 缓存）", () => {
  test("ensureRootToken 缓存 + 并发去重（只注册一次）", async () => {
    let calls = 0
    const client = createFileProtocolClient(async () => {
      calls++
      await new Promise((r) => setTimeout(r, 5))
      return "ab12cd34"
    })
    const [a, b] = await Promise.all([client.ensureRootToken("C:/p"), client.ensureRootToken("C:/p")])
    assert.equal(a, "ab12cd34")
    assert.equal(b, "ab12cd34")
    assert.equal(calls, 1)
    assert.equal(await client.ensureRootToken("C:/p"), "ab12cd34")
    assert.equal(calls, 1)
  })
  test("注册失败 → null，且不缓存失败（下次可重试）", async () => {
    let calls = 0
    const client = createFileProtocolClient(async () => (++calls === 1 ? null : "deadbeef"))
    assert.equal(await client.ensureRootToken("C:/p"), null)
    assert.equal(await client.ensureRootToken("C:/p"), "deadbeef")
    assert.equal(calls, 2)
  })
  test("urlFor：有 token 才出 URL；version 透传", async () => {
    const client = createFileProtocolClient(async () => "ab12cd34")
    assert.equal(client.urlFor("C:/p", "a.png"), null)
    await client.ensureRootToken("C:/p")
    assert.equal(client.urlFor("C:/p", "a.png"), "mafw-file://ab12cd34/a.png")
    assert.equal(client.urlFor("C:/p", "a.png", 42), "mafw-file://ab12cd34/a.png?v=42")
  })
  test("不同 root 各自 token", async () => {
    let n = 0
    const client = createFileProtocolClient(async () => `ab12cd3${n++}`)
    assert.equal(await client.ensureRootToken("C:/a"), "ab12cd30")
    assert.equal(await client.ensureRootToken("C:/b"), "ab12cd31")
  })
})
