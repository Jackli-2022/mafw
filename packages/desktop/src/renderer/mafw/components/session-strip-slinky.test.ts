import { describe, expect, test } from "bun:test"
import { freezeTabs } from "./session-strip-slinky"

const el = (w: number, flex = "") => ({ offsetWidth: w, style: { flex } })

describe("freezeTabs (tab slinky)", () => {
  test("冻结为当前像素宽，restore 还原原 flex 值", () => {
    const a = el(120), b = el(104)
    const restore = freezeTabs([a, b])
    expect(a.style.flex).toBe("0 0 120px")
    expect(b.style.flex).toBe("0 0 104px")
    restore()
    expect(a.style.flex).toBe("")
    expect(b.style.flex).toBe("")
  })

  test("restore 幂等（多次调用不重复写）", () => {
    const a = el(100, "1 1 auto")
    const restore = freezeTabs([a])
    restore()
    restore()
    expect(a.style.flex).toBe("1 1 auto")
  })

  test("空列表安全", () => {
    expect(() => freezeTabs([])()).not.toThrow()
  })
})
