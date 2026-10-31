import { describe, expect, test } from "bun:test"
import { nextOfficePreviewLoad, officePreviewKey } from "./office-preview-load"

describe("Office 预览重载判定", () => {
  test("首次有 url → 加载并记 key", () => {
    const r = nextOfficePreviewLoad("", "pptx", "mafw-file://t/a.pptx?v=1")
    expect(r.reload).toBe(true)
    expect(r.key).toBe(officePreviewKey("pptx", "mafw-file://t/a.pptx?v=1"))
  })

  test("url 为空（token 未就绪）→ 不加载、保留旧 key", () => {
    const prev = officePreviewKey("pptx", "mafw-file://t/a.pptx?v=1")
    const r = nextOfficePreviewLoad(prev, "pptx", "")
    expect(r.reload).toBe(false)
    expect(r.key).toBe(prev)
  })

  test("同一 kind/url 的无关信号抖动 → 不重新解析（闪帧回归）", () => {
    const key = officePreviewKey("pptx", "mafw-file://t/a.pptx?v=1")
    const r = nextOfficePreviewLoad(key, "pptx", "mafw-file://t/a.pptx?v=1")
    expect(r.reload).toBe(false)
    expect(r.key).toBe(key)
  })

  test("文件版本变化（agent 改写 / 外部变更）→ 重新加载", () => {
    const key = officePreviewKey("pptx", "mafw-file://t/a.pptx?v=1")
    const r = nextOfficePreviewLoad(key, "pptx", "mafw-file://t/a.pptx?v=2")
    expect(r.reload).toBe(true)
    expect(r.key).toBe(officePreviewKey("pptx", "mafw-file://t/a.pptx?v=2"))
  })

  test("kind 变化（切到另一个 Office 文件）→ 重新加载", () => {
    const key = officePreviewKey("pptx", "mafw-file://t/a.pptx?v=1")
    const r = nextOfficePreviewLoad(key, "xlsx", "mafw-file://t/a.pptx?v=1")
    expect(r.reload).toBe(true)
  })

  test("kind 与 url 相同的换行边界不串键", () => {
    expect(officePreviewKey("pptx", "a\nb")).not.toBe(officePreviewKey("pptx\na", "b"))
  })
})
