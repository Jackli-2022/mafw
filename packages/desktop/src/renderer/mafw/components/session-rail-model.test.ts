import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { captureAttachmentName, formatCaptureBatch, type PendingCapture } from "../chat/pending-captures"
import { RAIL_ITEMS, railBadgeFor } from "./session-rail-model"

const cap = (over: Partial<PendingCapture> = {}): PendingCapture => ({
  id: "cap-1",
  sessionID: "s",
  kind: "screenshot",
  comment: "",
  dataUrl: "",
  createdAt: 1,
  ...over,
})

describe("session rail badge", () => {
  test("只有 subagents / background 显示各自 badge（其余不显示）", () => {
    assert.equal(railBadgeFor("subagents", 3, 5), 3)
    assert.equal(railBadgeFor("background", 3, 5), 5)
    for (const t of ["tasks", "trajectory", "usage", "notes", "changes"]) {
      assert.equal(railBadgeFor(t, 3, 5), 0)
    }
  })

  test("七项图标轨定义", () => {
    assert.deepEqual(RAIL_ITEMS.map((i) => i.id), ["tasks", "trajectory", "usage", "notes", "changes", "subagents", "background"])
  })
})

describe("capture attachment naming", () => {
  test("capture 附件名带 id（删除联动用）", () => {
    assert.equal(captureAttachmentName("cap-123"), "capture-cap-123.png")
  })
})

describe("formatCaptureBatch：元素信息字段透传", () => {
  test("selector + 文本 + 关键属性", () => {
    const items: PendingCapture[] = [
      cap({
        kind: "element",
        comment: "链接要对齐",
        meta: {
          tag: "a",
          selector: "a.nav-link",
          text: "文档",
          attrs: { href: "/docs", title: "文档中心" },
          outerHTML: '<a class="nav-link" href="/docs">文档</a>',
        },
      }),
    ]
    assert.equal(
      formatCaptureBatch(items),
      "【元素点选 1】a a.nav-link「文档」 — 链接要对齐\n  href=/docs title=文档中心",
    )
  })
})
