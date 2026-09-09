import { describe, expect, test } from "bun:test"
import {
  leafIds,
  leafCount,
  splitAtPath,
  splitLeaf,
  splitWithTarget,
  replaceAtPath,
  removeSid,
  removeLeaf,
  setRatio,
  firstLeafPath,
  findSidPath,
  parentDirOf,
  zoneForPoint,
  zoneToDir,
  type SplitNode,
} from "./SplitView"

const sid = (id: string): SplitNode => ({ sid: id })
const empty = (): SplitNode => ({ empty: true })

describe("leafIds / leafCount", () => {
  test("single sid leaf", () => {
    expect(leafIds(sid("a"))).toEqual(["a"])
    expect(leafCount(sid("a"))).toBe(1)
  })
  test("empty leaf has no ids but counts as a pane", () => {
    expect(leafIds(empty())).toEqual([])
    expect(leafCount(empty())).toBe(1)
  })
  test("nested tree", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: { dir: "v", ratio: 0.5, a: sid("b"), b: sid("c") } }
    expect(leafIds(tree)).toEqual(["a", "b", "c"])
    expect(leafCount(tree)).toBe(3)
  })
})

describe("firstLeafPath", () => {
  test("single leaf → []", () => {
    expect(firstLeafPath(sid("a"))).toEqual([])
  })
  test("two leaves → [0]", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(firstLeafPath(tree)).toEqual([0])
  })
  test("nested → [0,1,...]", () => {
    const tree: SplitNode = { dir: "v", ratio: 0.5, a: { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }, b: sid("c") }
    expect(firstLeafPath(tree)).toEqual([0, 0])
  })
})

describe("splitAtPath", () => {
  test("split a single leaf 'after'", () => {
    const tree = sid("a")
    const next = splitAtPath(tree, [], "h", "b", "after")
    expect(next).toEqual({ dir: "h", ratio: 0.5, a: { sid: "a" }, b: { sid: "b" } })
    expect(leafIds(next)).toEqual(["a", "b"])
  })
  test("split a single leaf 'before'", () => {
    const tree = sid("a")
    const next = splitAtPath(tree, [], "v", "b", "before")
    expect(next).toEqual({ dir: "v", ratio: 0.5, a: { sid: "b" }, b: { sid: "a" } })
  })
  test("split nested leaf at path [1]", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    const next = splitAtPath(tree, [1], "v", "c", "after")
    expect(next).toEqual({ dir: "h", ratio: 0.5, a: sid("a"), b: { dir: "v", ratio: 0.5, a: sid("b"), b: sid("c") } })
    expect(leafIds(next)).toEqual(["a", "b", "c"])
  })
  test("guard: fresh already on screen", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(splitAtPath(tree, [0], "v", "b", "after")).toBe(tree)
  })
  test("guard: 4-pane cap", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: { dir: "v", ratio: 0.5, a: sid("a"), b: sid("b") }, b: { dir: "v", ratio: 0.5, a: sid("c"), b: sid("d") } }
    expect(splitAtPath(tree, [0], "v", "e", "after")).toBe(tree)
    expect(leafCount(tree)).toBe(4)
  })
})

describe("replaceAtPath", () => {
  test("replace root leaf", () => {
    expect(replaceAtPath(sid("a"), [], "b")).toEqual(sid("b"))
  })
  test("replace nested leaf", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(replaceAtPath(tree, [1], "c")).toEqual({ dir: "h", ratio: 0.5, a: sid("a"), b: sid("c") })
  })
  test("replace empty placeholder", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: empty(), b: sid("b") }
    expect(replaceAtPath(tree, [0], "c")).toEqual({ dir: "h", ratio: 0.5, a: sid("c"), b: sid("b") })
  })
})

describe("removeSid", () => {
  test("remove the only leaf → empty", () => {
    const { tree, removed, removedPath } = removeSid(sid("a"), "a")
    expect(removed).toBe(true)
    expect(tree).toEqual(empty())
    expect(removedPath).toEqual([])
  })
  test("remove one of two leaves collapses to sibling", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    const { tree: next, removed, removedPath } = removeSid(tree, "a")
    expect(removed).toBe(true)
    expect(next).toEqual(sid("b"))
    expect(removedPath).toEqual([0])
  })
  test("remove nested leaf collapses the branch", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: { dir: "v", ratio: 0.5, a: sid("b"), b: sid("c") } }
    const { tree: next, removed, removedPath } = removeSid(tree, "b")
    expect(removed).toBe(true)
    expect(removedPath).toEqual([1, 0])
    // b's branch {b,c} collapsed to {c}, then root becomes {a, c}
    expect(next).toEqual({ dir: "h", ratio: 0.5, a: sid("a"), b: sid("c") })
  })
  test("remove missing sid → unchanged", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    const { tree: next, removed } = removeSid(tree, "zzz")
    expect(removed).toBe(false)
    expect(next).toBe(tree)
  })
})

describe("zoneForPoint / zoneToDir", () => {
  const rect = { width: 200, height: 100, left: 0, top: 0 } as DOMRect
  test("edges", () => {
    expect(zoneForPoint(rect, 10, 50)).toBe("left")
    expect(zoneForPoint(rect, 190, 50)).toBe("right")
    expect(zoneForPoint(rect, 100, 10)).toBe("top")
    expect(zoneForPoint(rect, 100, 90)).toBe("bottom")
    expect(zoneForPoint(rect, 100, 50)).toBe("center")
  })
  test("mapping", () => {
    expect(zoneToDir("left")).toEqual({ dir: "h", place: "before" })
    expect(zoneToDir("right")).toEqual({ dir: "h", place: "after" })
    expect(zoneToDir("top")).toEqual({ dir: "v", place: "before" })
    expect(zoneToDir("bottom")).toEqual({ dir: "v", place: "after" })
    expect(zoneToDir("center")).toBeNull()
  })
})

describe("setRatio", () => {
  test("root ratio (path [])", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(setRatio(tree, [], 0.7)).toEqual({ dir: "h", ratio: 0.7, a: sid("a"), b: sid("b") })
  })
  test("child ratio (path [0])", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: { dir: "v", ratio: 0.3, a: sid("a"), b: sid("b") }, b: sid("c") }
    const next = setRatio(tree, [0], 0.6)
    expect(next).toEqual({ dir: "h", ratio: 0.5, a: { dir: "v", ratio: 0.6, a: sid("a"), b: sid("b") }, b: sid("c") })
  })
  test("leaf path → unchanged", () => {
    const tree = sid("a")
    expect(setRatio(tree, [], 0.9)).toBe(tree)
  })
})

describe("splitLeaf", () => {
  test("fresh === target → no-op", () => {
    const tree = sid("a")
    expect(splitLeaf(tree, "a", "h", "a")).toBe(tree)
  })
  test("fresh already on screen → no-op", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(splitLeaf(tree, "a", "h", "b")).toBe(tree)
  })
  test("4-pane cap → no-op", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: { dir: "v", ratio: 0.5, a: sid("a"), b: sid("b") }, b: { dir: "v", ratio: 0.5, a: sid("c"), b: sid("d") } }
    expect(splitLeaf(tree, "a", "h", "e")).toBe(tree)
  })
  test("split single leaf", () => {
    expect(splitLeaf(sid("a"), "a", "h", "b")).toEqual({ dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") })
  })
})

describe("removeLeaf", () => {
  test("remove root leaf → empty placeholder", () => {
    expect(removeLeaf(sid("a"), "a")).toEqual(empty())
  })
  test("remove one of two → sibling", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(removeLeaf(tree, "a")).toEqual(sid("b"))
    expect(removeLeaf(tree, "b")).toEqual(sid("a"))
  })
  test("remove missing → unchanged", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(removeLeaf(tree, "zzz")).toBe(tree)
  })
})

describe("findSidPath", () => {
  test("single leaf", () => {
    expect(findSidPath(sid("a"), "a")).toEqual([])
    expect(findSidPath(sid("a"), "b")).toBeNull()
  })
  test("nested", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: { dir: "v", ratio: 0.5, a: sid("a"), b: sid("b") }, b: sid("c") }
    expect(findSidPath(tree, "a")).toEqual([0, 0])
    expect(findSidPath(tree, "b")).toEqual([0, 1])
    expect(findSidPath(tree, "c")).toEqual([1])
    expect(findSidPath(tree, "zzz")).toBeNull()
  })
})

describe("splitAtPath edge cases", () => {
  test("path past a leaf → unchanged (safety)", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(splitAtPath(tree, [0, 1], "v", "c", "after")).toBe(tree)
  })
  test("invalid path on collapsed tree → unchanged", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(splitAtPath(tree, [2], "v", "c", "after")).toBe(tree)
  })
})

describe("parentDirOf", () => {
  test("root leaf → null", () => {
    expect(parentDirOf(sid("a"), [])).toBeNull()
  })
  test("child of h split → h", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(parentDirOf(tree, [0])).toBe("h")
    expect(parentDirOf(tree, [1])).toBe("h")
  })
  test("nested leaf → parent direction", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: { dir: "v", ratio: 0.5, a: sid("a"), b: sid("b") }, b: sid("c") }
    expect(parentDirOf(tree, [0, 0])).toBe("v")
    expect(parentDirOf(tree, [0, 1])).toBe("v")
    expect(parentDirOf(tree, [1])).toBe("h")
  })
  test("invalid path → null", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(parentDirOf(tree, [2])).toBeNull()
  })
})

describe("splitWithTarget", () => {
  test("split single leaf with empty placeholder after", () => {
    const next = splitWithTarget(sid("a"), [], "h", "after", empty())
    expect(next).toEqual({ dir: "h", ratio: 0.5, a: sid("a"), b: empty() })
    expect(leafCount(next)).toBe(2)
  })
  test("split with sid before", () => {
    const next = splitWithTarget(sid("a"), [], "v", "before", sid("b"))
    expect(next).toEqual({ dir: "v", ratio: 0.5, a: sid("b"), b: sid("a") })
  })
  test("split nested leaf", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    const next = splitWithTarget(tree, [1], "v", "after", empty())
    expect(next).toEqual({ dir: "h", ratio: 0.5, a: sid("a"), b: { dir: "v", ratio: 0.5, a: sid("b"), b: empty() } })
  })
  test("4-pane cap → no-op", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: { dir: "v", ratio: 0.5, a: sid("a"), b: sid("b") }, b: { dir: "v", ratio: 0.5, a: sid("c"), b: sid("d") } }
    expect(splitWithTarget(tree, [0], "v", "after", empty())).toBe(tree)
  })
  test("sid already on screen → downgraded to empty placeholder", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    const next = splitWithTarget(tree, [0], "v", "after", sid("b"))
    expect(next).toEqual({ dir: "h", ratio: 0.5, a: { dir: "v", ratio: 0.5, a: sid("a"), b: empty() }, b: sid("b") })
    expect(leafIds(next)).toEqual(["a", "b"])
  })
  test("invalid path → unchanged", () => {
    const tree: SplitNode = { dir: "h", ratio: 0.5, a: sid("a"), b: sid("b") }
    expect(splitWithTarget(tree, [2], "v", "after", empty())).toBe(tree)
  })
})
