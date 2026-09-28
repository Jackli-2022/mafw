import { describe, test, expect } from "bun:test"
import { buildSessionTree, pageGroups } from "./session-tree"

const NOW = new Date(2026, 8, 28, 12, 0, 0).getTime()
const DAY = 86400000

const sess = (id: string, updated: number, role?: string, dir?: string): any => ({
  id,
  title: `s-${id}`,
  time: { updated },
  ...(role ? { metadata: { mafw: { role } } } : {}),
  ...(dir ? { directory: dir } : {}),
})

const P1 = "/repo/proj-one"
const P2 = "/repo/proj-two"
const projects = [
  { id: "p1", name: "proj-one", worktree: P1 },
  { id: "p2", name: "proj-two", worktree: P2 },
]

describe("buildSessionTree", () => {
  test("项目节点按传入顺序，current 标记正确（键为 projectID=worktree||id）", () => {
    const tree = buildSessionTree(projects, { [P1]: [], [P2]: [] }, P2, NOW)
    expect(tree.map(n => n.projectID)).toEqual([P1, P2])
    expect(tree[1].current).toBe(true)
    expect(tree[0].current).toBe(false)
  })

  test("manager 会话置顶并从日期组移除", () => {
    const tree = buildSessionTree(projects, {
      [P1]: [sess("a", NOW - 3600_000), sess("m", NOW, "manager")],
    }, P1, NOW)
    const p1 = tree[0]
    expect(p1.manager?.id).toBe("m")
    expect(p1.groups.flatMap(g => g.items).map(i => i.id)).toEqual(["a"])
  })

  test("日期分组：今天/昨天/过去 7 天/按月", () => {
    const tree = buildSessionTree(projects, {
      [P1]: [
        sess("t", NOW - 3600_000),
        sess("y", NOW - DAY - 3600_000),
        sess("w", NOW - 3 * DAY),
        sess("o", NOW - 40 * DAY),
      ],
    }, P1, NOW)
    expect(tree[0].groups.map(g => g.label)).toEqual(["今天", "昨天", "过去 7 天", "8月"])
  })

  test("worktree 徽标：directory basename 带 <base>-wt- 前缀", () => {
    const tree = buildSessionTree(projects, {
      [P1]: [sess("w", NOW, undefined, "/repo/proj-one-wt-feat")],
    }, P1, NOW)
    expect(tree[0].groups[0].items[0].worktree).toBe("feat")
  })

  test("未加载项目（sessionsByProject 缺键）给空组", () => {
    const tree = buildSessionTree(projects, {}, P1, NOW)
    expect(tree[1].groups).toEqual([])
    expect(tree[1].manager).toBeNull()
  })
})

describe("pageGroups（v6 修复：逐项目分页）", () => {
  const groups = [
    { label: "今天", items: [{ id: "a" }, { id: "b" }] },
    { label: "昨天", items: [{ id: "c" }] },
    { label: "9月", items: [{ id: "d" }, { id: "e" }, { id: "f" }] },
  ] as any

  test("limit 大于总数时原样返回", () => {
    const r = pageGroups(groups, 10)
    expect(r.hasMore).toBe(false)
    expect(r.groups.flatMap((g: any) => g.items).map((i: any) => i.id)).toEqual(["a", "b", "c", "d", "e", "f"])
    expect(r.total).toBe(6)
  })

  test("跨组截断，保留前 limit 条并标记 hasMore", () => {
    const r = pageGroups(groups, 3)
    expect(r.groups.flatMap((g: any) => g.items).map((i: any) => i.id)).toEqual(["a", "b", "c"])
    expect(r.hasMore).toBe(true)
    expect(r.total).toBe(6)
  })

  test("limit 落在组中间时该组被裁剪", () => {
    const r = pageGroups(groups, 4)
    expect(r.groups.map((g: any) => [g.label, g.items.length])).toEqual([["今天", 2], ["昨天", 1], ["9月", 1]])
  })
})
