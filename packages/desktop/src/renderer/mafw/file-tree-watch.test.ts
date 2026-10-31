import { describe, expect, test } from "bun:test"
import { planDirWatches, nextChildrenAfterRefresh, sameDirEntries } from "./file-tree-watch"

// 文件树自动刷新（2026-10-31）：与已展开集合同步的目录 watch 差分。
describe("文件树目录 watch 差分", () => {
  test("首次：全部新增", () => {
    expect(planDirWatches(new Set(), ["", "src"])).toEqual({ add: ["", "src"], remove: [] })
  })

  test("展开新目录 → 只 add 新增项", () => {
    expect(planDirWatches(new Set([""]), ["", "src"])).toEqual({ add: ["src"], remove: [] })
  })

  test("收起目录 → 只 remove 消失项", () => {
    expect(planDirWatches(new Set(["", "src", "src/components"]), ["", "src"]))
      .toEqual({ add: [], remove: ["src/components"] })
  })

  test("集合稳定 → 空计划（不重复注册/退订）", () => {
    expect(planDirWatches(new Set(["", "src"]), ["", "src"])).toEqual({ add: [], remove: [] })
  })
})

describe("目录刷新结果合并", () => {
  test("返回条目 → 覆盖该目录缓存", () => {
    const prev = { src: [{ name: "old.ts", kind: "file" as const }] }
    expect(nextChildrenAfterRefresh(prev, "src", [{ name: "new.ts", kind: "file" }]))
      .toEqual({ src: [{ name: "new.ts", kind: "file" }] })
  })

  test("目录消失（null）→ 删除该目录缓存（保留其他目录）", () => {
    const prev = {
      src: [{ name: "a.ts", kind: "file" as const }],
      docs: [{ name: "b.md", kind: "file" as const }],
    }
    expect(nextChildrenAfterRefresh(prev, "src", null)).toEqual({ docs: prev.docs })
  })

  test("目录消失且本来不存在 → 原对象不变（防无谓 signal 抖动）", () => {
    const prev = { docs: [{ name: "b.md", kind: "file" as const }] }
    expect(nextChildrenAfterRefresh(prev, "src", null)).toBe(prev)
  })
})

describe("目录条目深比较（事件等值时保持引用稳定）", () => {
  const a = [{ name: "a.ts", kind: "file" as const }, { name: "src", kind: "dir" as const }]

  test("同名同 kind 同序 → true", () => {
    expect(sameDirEntries(a, [{ name: "a.ts", kind: "file" }, { name: "src", kind: "dir" }])).toBe(true)
  })
  test("改名 / 增删 / kind 变化 → false", () => {
    expect(sameDirEntries(a, [{ name: "b.ts", kind: "file" }, { name: "src", kind: "dir" }])).toBe(false)
    expect(sameDirEntries(a, [{ name: "a.ts", kind: "file" }])).toBe(false)
    expect(sameDirEntries(a, [{ name: "a.ts", kind: "dir" }, { name: "src", kind: "dir" }])).toBe(false)
  })
})
