import { describe, expect, test } from "bun:test"
import { isWorktreeSession, worktreeBadge } from "./worktree-label"

describe("isWorktreeSession", () => {
  test("worktree directory → true（含反斜杠/盘符形态差异）", () => {
    expect(isWorktreeSession("C:\\proj\\proj-wt-fix", "C:\\proj\\proj")).toBe(true)
    expect(isWorktreeSession("C:/proj/proj-wt-fix", "C:\\proj\\proj")).toBe(true)
  })
  test("项目主目录本身 / 缺失 → false", () => {
    expect(isWorktreeSession("C:\\proj\\proj", "C:\\proj\\proj")).toBe(false)
    expect(isWorktreeSession(undefined, "C:\\proj\\proj")).toBe(false)
    expect(isWorktreeSession("C:\\proj\\proj-wt-fix", null)).toBe(false)
    expect(isWorktreeSession("C:\\proj\\proj-wt-fix", undefined)).toBe(false)
  })
  test("不同项目下的 -wt- 目录不误判（basename 前缀必须匹配项目名）", () => {
    expect(isWorktreeSession("C:\\other\\other-wt-x", "C:\\proj\\proj")).toBe(false)
  })
})

describe("worktreeBadge", () => {
  test("剥 <base>-wt- 前缀", () => {
    expect(worktreeBadge("C:\\proj\\proj-wt-fix-api", "C:\\proj\\proj")).toBe("fix-api")
  })
  test("非 worktree → null", () => {
    expect(worktreeBadge("C:\\proj\\proj", "C:\\proj\\proj")).toBeNull()
  })
})
