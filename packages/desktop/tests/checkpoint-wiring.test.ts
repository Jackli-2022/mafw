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
    expect(pane).toContain("runtimeCaps")
    expect(pane).toContain("runtimeName")
    expect(pane).toContain("时间线")
    expect(pane).toContain("sessions.revertDiff")
  })

  test("MafwShell supplies runtime name and capabilities", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toContain("rtName")
    expect(shell).toContain("runtimeName={rtName()}")
    expect(shell).toContain("runtimeCaps={rtCaps()}")
  })
})
