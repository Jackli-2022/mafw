import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// opencode 2.1 的 revert 是 stage+commit，commit 后不可逆（无 unrevert）：
// 能力位 revertUndoApi=false 时桌面不得再展示「撤销回滚」。
describe("revert undo capability wiring", () => {
  const shell = readFileSync(join(import.meta.dirname, "MafwShell.tsx"), "utf8")
  const pane = readFileSync(join(import.meta.dirname, "components/ChatPane.tsx"), "utf8")

  test("MafwShell 从 /api/runtime capabilities 推导并下传", () => {
    expect(shell).toContain("rtCaps().revertUndoApi === true")
    expect(shell).toContain("revertUndoEnabled={revertUndoEnabled()}")
  })

  test("ChatPane 仅在能力为 true 时展示 undo，revert 后不无条件点亮", () => {
    expect(pane).toContain("props.revertUndoEnabled === true && canUnrevert()")
    expect(pane).toContain("setCanUnrevert(props.revertUndoEnabled === true)")
    expect(pane).toContain("props.revertUndoEnabled === true && !!info?.revert")
  })
})
