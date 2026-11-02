import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// revert undo 语义由 Experience checkpoint action 提供；
// 前端不得再直接读 runtime capabilities。
describe("revert undo capability wiring", () => {
  const shell = readFileSync(join(import.meta.dirname, "MafwShell.tsx"), "utf8")
  const pane = readFileSync(join(import.meta.dirname, "components/ChatPane.tsx"), "utf8")

  test("MafwShell 从 Experience checkpoint action 推导并下传", () => {
    expect(shell).toContain("experienceStore.action(\"checkpoint.restore\")?.semantics?.undo")
    expect(shell).toContain("revertUndoEnabled={revertUndoEnabled()}")
  })

  test("ChatPane 仅在能力为 true 时展示 undo，revert 后不无条件点亮", () => {
    expect(pane).toContain("props.revertUndoEnabled === true && canUnrevert()")
    expect(pane).toContain("setCanUnrevert(props.revertUndoEnabled === true)")
    expect(pane).toContain("props.revertUndoEnabled === true && !!info?.revert")
  })
})
