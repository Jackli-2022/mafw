import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createSessionTurnDiffsStore } from "./session-turn-diffs"

const user = (id: string, created: number) => ({ id, role: "user", time: { created } })
const asst = (id: string, created: number, snapshot: any) => ({ id, role: "assistant", time: { created }, snapshot })
const PATCH = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n"
const tick = () => new Promise((r) => setTimeout(r, 0))

describe("session-turn-diffs store", () => {
  test("busy 时排除在飞回合；回合完成后补拉并按合并结果计数", async () => {
    const called: string[] = []
    const store = createSessionTurnDiffsStore(async (_sid, mid) => {
      called.push(mid)
      return { files: [{ file: `${mid}.txt`, patch: PATCH }] }
    })
    const m1 = [
      user("u0", 1), asst("a0", 2, { start: "s0", end: "e0" }),
      user("u1", 3), asst("a1", 4, { start: "s1", end: "e1" }),
    ]
    store.ensure({ sid: "s", messages: m1, runtimeName: "opencode", busy: true, diffApi: true })
    await tick()
    assert.deepEqual(called, ["u0"], "在飞回合（最后 user）不请求")
    assert.equal(store.count("s", m1), 1)

    store.ensure({ sid: "s", messages: m1, runtimeName: "opencode", busy: false, diffApi: true })
    await tick()
    assert.deepEqual([...new Set(called)].sort(), ["u0", "u1"])
    assert.equal(store.count("s", m1), 2, "badge 用合并后的 per-turn 数")
  })

  test("失败 key 可重试（不会永久跳过）", async () => {
    let calls = 0
    const store = createSessionTurnDiffsStore(async () => {
      calls++
      throw new Error("404")
    })
    const msgs = [user("u1", 1), asst("a1", 2, { start: "s1", end: "e1" })]
    store.ensure({ sid: "s", messages: msgs, runtimeName: "opencode", busy: false, diffApi: true })
    await tick()
    assert.equal(calls, 1)
    assert.equal(store.count("s", msgs), 0)
    store.ensure({ sid: "s", messages: msgs, runtimeName: "opencode", busy: false, diffApi: true })
    await tick()
    assert.equal(calls, 2, "失败后同 key 允许重试")
  })

  test("代际守卫：晚到的旧请求不得覆盖新数据", async () => {
    const pending: Array<(file: string) => void> = []
    let n = 0
    const store = createSessionTurnDiffsStore((_sid, _mid) => new Promise((resolve) => {
      const idx = n++
      pending[idx] = (file) => resolve({ files: [{ file, patch: PATCH }] })
    }))
    const msgs = [user("u1", 1), asst("a1", 2, { start: "s1", end: "e1" })]
    store.ensure({ sid: "s", messages: msgs, runtimeName: "a", busy: false, diffApi: true })
    store.ensure({ sid: "s", messages: msgs, runtimeName: "b", busy: false, diffApi: true })
    assert.equal(n, 2)

    pending[1]("new.txt")
    await tick()
    assert.equal(store.perTurn("s").u1?.[0]?.file, "new.txt")

    pending[0]("old.txt")
    await tick()
    assert.equal(store.perTurn("s").u1?.[0]?.file, "new.txt", "旧代际必须被丢弃")
  })

  test("diffApi 关闭 / 无候选 → 不请求", async () => {
    let calls = 0
    const store = createSessionTurnDiffsStore(async () => { calls++; return { files: [] } })
    const noSnapshot = [user("u1", 1), asst("a1", 2, {})]
    store.ensure({ sid: "s", messages: noSnapshot, runtimeName: "opencode", busy: false, diffApi: true })
    store.ensure({ sid: "s", messages: noSnapshot, runtimeName: "opencode", busy: false, diffApi: false })
    await tick()
    assert.equal(calls, 0)
  })
})
