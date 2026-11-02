import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("checkpoint wiring", () => {
  test("ChatPane opens the overlay and implements both rewind paths", () => {
    const pane = read("src/renderer/mafw/components/ChatPane.tsx")
    expect(pane).toContain("CheckpointOverlay")
    expect(pane).toContain("checkpointsOpen")
    expect(pane).toContain("revertCodeTo")
    expect(pane).toContain("allHunksPatches")
    expect(pane).toContain("isInvertiblePatch")
    expect(pane).not.toContain("sessions.diff")
    expect(pane).toContain("revertWarning")
    expect(pane).toContain('experienceStore.action("checkpoint.restore")')
    expect(pane).toContain("时间线")
    expect(pane).toContain("sessions.revertDiff")
    // Task 10：runtime 名称/裸能力不得再进聊天业务组件。
    expect(pane).not.toContain("runtimeCaps")
    expect(pane).not.toContain("runtimeName")
  })

  test("MafwShell supplies Experience actions instead of runtime name/capabilities", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).not.toContain("rtName")
    expect(shell).not.toContain("rtCaps")
    expect(shell).toContain("experienceStore.supported(\"branch.fork\")")
    expect(shell).toContain('revertUndoEnabled={revertUndoEnabled()}')
    expect(shell).toContain("experienceStore.semantics(\"checkpoint.restore\")")
  })

  test("CheckpointOverlay decides server mode from supported/sessionBacked", () => {
    const overlay = read("src/renderer/mafw/components/CheckpointOverlay.tsx")
    expect(overlay).toContain("resolveServerMode")
    expect(overlay).not.toContain("checkpointAction?.enabled === true ||")
    // 分支 revert 的确认文案读 branch.revert 语义，不能拿 checkpoint.restore 冒充。
    expect(overlay).toContain('experienceStore.semantics("branch.revert")')
    const server = read("src/renderer/mafw/components/server-checkpoints.ts")
    expect(server).toContain("semantics?.sessionBacked === true")
  })
})
