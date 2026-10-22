import { describe, expect, test } from "bun:test"
import { resolveWorkbenchRoot } from "./workbench-root"

describe("resolveWorkbenchRoot（文件树/编辑器根：会话目录优先，但必须属于当前项目）", () => {
  test("普通会话（=项目目录 / 项目子目录）→ 会话目录", () => {
    expect(resolveWorkbenchRoot("C:/work/look", "C:/work/look")).toBe("C:/work/look")
    expect(resolveWorkbenchRoot("C:/work/look", "C:/work/look/sub")).toBe("C:/work/look/sub")
  })
  test("worktree 会话（项目同级 -wt-）→ worktree 目录", () => {
    expect(resolveWorkbenchRoot("C:/work/look", "C:/work/look-wt-feature")).toBe("C:/work/look-wt-feature")
  })
  test("manager/内部会话目录在项目外（如 home）→ 回退项目目录", () => {
    expect(resolveWorkbenchRoot("C:/work/look", "C:/Users/15524")).toBe("C:/work/look")
    expect(resolveWorkbenchRoot("C:/work/look", "C:/Users/15524/29ea5079")).toBe("C:/work/look")
  })
  test("无会话目录 → 项目目录；无项目 → 会话目录；都无 → null", () => {
    expect(resolveWorkbenchRoot("C:/work/look", null)).toBe("C:/work/look")
    expect(resolveWorkbenchRoot(null, "C:/work/look")).toBe("C:/work/look")
    expect(resolveWorkbenchRoot(null, null)).toBeNull()
  })
  test("Windows 反斜杠归一比较（大小写不敏感）", () => {
    expect(resolveWorkbenchRoot("C:\\work\\look", "c:/work/look/sub")).toBe("c:/work/look/sub")
  })
})
