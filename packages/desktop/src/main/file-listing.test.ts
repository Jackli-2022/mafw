import { describe, expect, test } from "bun:test"
import { walkProjectFiles } from "./file-listing"

function fakeFs(tree: Record<string, string[]>, dirs: Set<string> = new Set(["src"])) {
  return async (dir: string) =>
    (tree[dir] || []).map(name => ({
      name,
      isDirectory: () => dirs.has(name),
    }))
}

describe("project file walker", () => {
  test("collects relative paths with forward slashes", async () => {
    const io = fakeFs({
      root: ["src", "README.md"],
      "root/src": ["index.ts"],
    })
    const out = await walkProjectFiles("root", io, 100, 8)
    expect(out).toEqual(["/README.md", "/src/index.ts"])
  })

  test("skips ignored directories entirely", async () => {
    const io = fakeFs({
      root: ["src", "node_modules", ".git"],
      "root/src": ["a.ts"],
      "root/node_modules": ["junk.js"],
      "root/.git": ["config"],
    }, new Set(["src", "node_modules", ".git"]))
    const out = await walkProjectFiles("root", io, 100, 8)
    expect(out).toEqual(["/src/a.ts"])
  })

  test("respects the file cap", async () => {
    const io = fakeFs({ root: Array.from({ length: 10 }, (_, i) => `f${i}.ts`) })
    const out = await walkProjectFiles("root", io, 3, 8)
    expect(out).toHaveLength(3)
  })

  test("respects the depth cap", async () => {
    const io = async (dir: string) => {
      const depth = dir.split("/").length
      return depth <= 10 ? [{ name: "sub", isDirectory: () => true }, { name: "f.ts", isDirectory: () => false }] : []
    }
    const out = await walkProjectFiles("root", io, 100, 3)
    expect(out.every(p => p.split("/").length <= 4)).toBe(true)
  })
})
