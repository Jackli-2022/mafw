import { describe, expect, test } from "bun:test"
import { visibleRows } from "./file-tree"

const root = [{ name: "src", kind: "dir" as const }, { name: "a.ts", kind: "file" as const }]

test("折叠态只出根层；展开目录插入其子项（depth+1）；未加载子项的展开目录不出子行", () => {
  expect(visibleRows(root, new Set(), {}).map(r => r.rel)).toEqual(["src", "a.ts"])
  const withKids = { src: [{ name: "b.ts", kind: "file" as const }] }
  expect(visibleRows(root, new Set(["src"]), withKids)).toEqual([
    { rel: "src", name: "src", kind: "dir", depth: 0 },
    { rel: "src/b.ts", name: "b.ts", kind: "file", depth: 1 },
    { rel: "a.ts", name: "a.ts", kind: "file", depth: 0 },
  ])
  expect(visibleRows(root, new Set(["src"]), {}).map(r => r.rel)).toEqual(["src", "a.ts"])
})

test("多层展开深度正确", () => {
  const children = {
    src: [{ name: "mafw", kind: "dir" as const }],
    "src/mafw": [{ name: "x.ts", kind: "file" as const }],
  }
  const rows = visibleRows(root, new Set(["src", "src/mafw"]), children)
  expect(rows[2]).toEqual({ rel: "src/mafw/x.ts", name: "x.ts", kind: "file", depth: 2 })
})
