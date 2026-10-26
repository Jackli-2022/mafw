import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createPendingCaptureStore, formatCaptureBatch, type PendingCapture } from "./pending-captures"

const base = (over: Partial<PendingCapture> = {}): Omit<PendingCapture, "id" | "createdAt"> => ({
  sessionID: "s1",
  kind: "screenshot",
  comment: "",
  dataUrl: "data:image/png;base64,AAA",
  ...over,
})

describe("pending-captures store", () => {
  test("add / pendingFor：按会话隔离", () => {
    const store = createPendingCaptureStore()
    store.add(base({ comment: "按钮歪了" }))
    store.add(base({ sessionID: "s2", kind: "element", comment: "文案要改" }))
    assert.equal(store.pendingFor("s1").length, 1)
    assert.equal(store.pendingFor("s2").length, 1)
    assert.equal(store.pendingFor("s1")[0].comment, "按钮歪了")
    assert.ok(store.pendingFor("s1")[0].id)
    assert.ok(store.pendingFor("s1")[0].createdAt > 0)
  })

  test("updateComment 只改目标项", () => {
    const store = createPendingCaptureStore()
    const a = store.add(base())
    const b = store.add(base())
    store.updateComment("s1", a.id, "补充说明")
    assert.equal(store.pendingFor("s1").find(x => x.id === a.id)?.comment, "补充说明")
    assert.equal(store.pendingFor("s1").find(x => x.id === b.id)?.comment, "")
  })

  test("remove / clear", () => {
    const store = createPendingCaptureStore()
    const a = store.add(base())
    store.add(base())
    store.remove("s1", a.id)
    assert.equal(store.pendingFor("s1").length, 1)
    store.clear("s1")
    assert.equal(store.pendingFor("s1").length, 0)
  })

  test("take：返回并清空（发送即消耗）", () => {
    const store = createPendingCaptureStore()
    store.add(base({ comment: "x" }))
    const taken = store.take("s1")
    assert.equal(taken.length, 1)
    assert.equal(store.pendingFor("s1").length, 0)
    assert.equal(store.take("s1").length, 0)
  })
})

describe("formatCaptureBatch", () => {
  test("截屏批注 + 元素点选混排", () => {
    const items: PendingCapture[] = [
      { id: "1", sessionID: "s", kind: "screenshot", comment: "按钮对齐一下", dataUrl: "", createdAt: 1 },
      { id: "2", sessionID: "s", kind: "element", comment: "文案要改", dataUrl: "", createdAt: 2, meta: { tag: "button", selector: "button.primary", text: "提交" } },
      { id: "3", sessionID: "s", kind: "screenshot", comment: "  ", dataUrl: "", createdAt: 3 },
    ]
    assert.equal(
      formatCaptureBatch(items),
      [
        "【截屏批注 1】按钮对齐一下",
        "【元素点选 2】button button.primary「提交」 — 文案要改",
        "【截屏批注 3】（无评注）",
      ].join("\n"),
    )
  })

  test("空列表 → 空串", () => {
    assert.equal(formatCaptureBatch([]), "")
  })
})
