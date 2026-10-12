import { describe, test, expect } from "bun:test"
import { readSavedTheme, nextTheme, applyTheme } from "./theme"

const fakeStorage = (v: string | null) => ({ getItem: (_k: string) => v })
const fakeRoot = () => {
  const dataset: Record<string, string> = {}
  const removed: string[] = []
  return {
    dataset,
    removed,
    removeAttribute(k: string) {
      removed.push(k)
      delete dataset[k.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())]
    },
  } as unknown as HTMLElement
}

describe("readSavedTheme", () => {
  test("light/dark 原样返回", () => {
    expect(readSavedTheme(fakeStorage("light"))).toBe("light")
    expect(readSavedTheme(fakeStorage("dark"))).toBe("dark")
  })
  test("缺省/非法值 → null（跟随系统）", () => {
    expect(readSavedTheme(fakeStorage(null))).toBeNull()
    expect(readSavedTheme(fakeStorage("oc-2"))).toBeNull()
  })
})

describe("nextTheme", () => {
  test("两态循环", () => {
    expect(nextTheme("light")).toBe("dark")
    expect(nextTheme("dark")).toBe("light")
  })
})

describe("applyTheme", () => {
  test("saved=light：写 data-theme + data-color-scheme", () => {
    const root = fakeRoot()
    applyTheme(root, "light", false)
    expect(root.dataset.theme).toBe("light")
    expect(root.dataset.colorScheme).toBe("light")
  })
  test("saved=dark：写 data-theme + data-color-scheme", () => {
    const root = fakeRoot()
    applyTheme(root, "dark", true)
    expect(root.dataset.theme).toBe("dark")
    expect(root.dataset.colorScheme).toBe("dark")
  })
  test("null + 系统亮：移除 data-theme，colorScheme=light", () => {
    const root = fakeRoot()
    root.dataset.theme = "dark"
    applyTheme(root, null, true)
    expect(root.dataset.theme).toBeUndefined()
    expect(root.dataset.colorScheme).toBe("light")
  })
  test("null + 系统暗：移除 data-theme，colorScheme=dark", () => {
    const root = fakeRoot()
    applyTheme(root, null, false)
    expect(root.dataset.theme).toBeUndefined()
    expect(root.dataset.colorScheme).toBe("dark")
  })
})
